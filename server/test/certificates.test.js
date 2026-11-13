const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { test } = require('node:test');
const {
  buildCertificatePdf,
  createCertificateAdminRouter,
  createCertificateVerificationRouter,
  evaluateCredential,
  parseCriteria,
  validateDecisionBody,
} = require('../src/certificates');

const evidenceId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

function validCriteria() {
  return {
    certificates: [{
      key: 'field-skills',
      type: 'MILESTONE',
      title: 'Field skills milestone',
      requiredEvidenceRequirementIds: [evidenceId],
      requiredAssessmentRequirementIds: [evidenceId],
      attendanceRequirements: [{ sessionId, acceptedStatuses: ['present'] }],
    }],
  };
}

test('certificate criteria require explicit conditions and accept configured rules', () => {
  const parsed = parseCriteria(validCriteria());
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.certificates[0].key, 'field-skills');
  assert.equal(parseCriteria({ certificates: [{ key: 'empty', type: 'MILESTONE', title: 'Empty' }] }).error !== undefined, true);
});

test('certificate criteria reject duplicate keys, unsupported types, and ambiguous final rules', () => {
  const duplicate = validCriteria();
  duplicate.certificates.push({ ...duplicate.certificates[0] });
  assert.match(parseCriteria(duplicate).error, /unique lowercase key/);

  const unsupported = validCriteria();
  unsupported.certificates[0].type = 'QUALIFICATION';
  assert.match(parseCriteria(unsupported).error, /MILESTONE or FINAL/);

  const multipleFinals = validCriteria();
  multipleFinals.certificates[0].type = 'FINAL';
  multipleFinals.certificates.push({ ...multipleFinals.certificates[0], key: 'final-2' });
  assert.match(parseCriteria(multipleFinals).error, /Only one final certificate/);
});

test('certificate decisions reject client-supplied issuer data and require a reason for rejection', () => {
  assert.equal(validateDecisionBody({ decision: 'APPROVED' }, { authorization: true }).error, undefined);
  assert.match(validateDecisionBody({ decision: 'APPROVED', issuerTitle: 'Fake title' }, { authorization: true }).error, /Provide only/);
  assert.match(validateDecisionBody({ decision: 'REJECTED' }, { authorization: true }).error, /reason is required/);
});

test('generated PDF contains the configured credential, learner, issuer, and verification reference', async () => {
  const pdf = await buildCertificatePdf({
    certificateTitle: 'Field skills milestone',
    certificateType: 'MILESTONE',
    learnerName: 'Synthetic Learner',
    learnerReference: 'LRN-SYNTHETIC',
    programmeName: 'Synthetic Programme',
    verificationReference: 'CERT-2026-AB12CD34EF56',
    issuedAt: new Date('2026-11-13T10:00:00.000Z'),
    issuerName: 'Synthetic Administrator',
    issuerTitle: 'Authorized Administrator',
  });
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 500);
});

test('eligibility evaluation blocks missing evidence, corrections, and incomplete assessments', async () => {
  const credential = parseCriteria(validCriteria()).value.certificates[0];
  const baseRows = {
    enrolment: [{
      enrolment_id: 'enrolment', provider_user_id: 'provider', learner_id: 'learner',
      programme_id: 'programme', learner_name: 'Synthetic Learner',
      learner_reference: 'LRN-1', programme_name: 'Synthetic Programme',
    }],
    requirements: [{ id: evidenceId, title: 'Field record' }],
    latest: [],
    attendance: [{ id: sessionId, title: 'Field day', status: 'present' }],
  };
  const run = (rows) => evaluateCredential({
    async query(sql) {
      if (sql.includes('FROM enrolments e')) return { rows: rows.enrolment };
      if (sql.includes('FROM programme_evidence_requirements')) return { rows: rows.requirements };
      if (sql.includes('DISTINCT ON (s.requirement_id)')) return { rows: rows.latest };
      if (sql.includes('FROM training_sessions s')) return { rows: rows.attendance };
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  }, 'enrolment', credential);

  const missing = await run(baseRows);
  assert.ok(missing.blockers.some((blocker) => blocker.code === 'EVIDENCE_MISSING'));
  assert.ok(missing.blockers.some((blocker) => blocker.code === 'ASSESSMENT_INCOMPLETE'));

  const corrected = await run({
    ...baseRows,
    latest: [{ requirement_id: evidenceId, submission_id: 'submission', submission_status: 'CORRECTION_REQUIRED', version: 2, assessment_review_id: 'review', assessment_decision: 'CORRECTION_REQUESTED' }],
  });
  assert.ok(corrected.blockers.some((blocker) => blocker.code === 'CORRECTION_UNRESOLVED'));
  assert.ok(corrected.blockers.some((blocker) => blocker.code === 'ASSESSMENT_NOT_APPROVED'));

  const eligible = await run({
    ...baseRows,
    latest: [{ requirement_id: evidenceId, submission_id: 'submission', submission_status: 'APPROVED', version: 2, assessment_review_id: 'review', assessment_decision: 'APPROVED' }],
  });
  assert.deepEqual(eligible.blockers, []);
});

function authorizationToken(userId, role) {
  return jwt.sign({ role }, 'certificate-router-test-secret-with-more-than-32-characters', {
    subject: userId,
    audience: 'agriprovider-app',
    issuer: 'agriprovider-api',
    expiresIn: '5m',
  });
}

async function withHttpServer(app, run) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('certificate administration is admin-only and public verification reveals no learner identity', async () => {
  const providerId = '33333333-3333-4333-8333-333333333333';
  const adminId = '44444444-4444-4444-8444-444444444444';
  const userRows = new Map([
    [providerId, { id: providerId, email: 'provider@example.test', full_name: 'Provider', role: 'provider' }],
    [adminId, { id: adminId, email: 'admin@example.test', full_name: 'Admin', role: 'admin' }],
  ]);
  const database = {
    async query(sql, values = []) {
      if (sql.includes('FROM users') && sql.includes('WHERE id = $1')) {
        const row = userRows.get(values[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('FROM eligibility_rule_configurations')) return { rows: [] };
      if (sql.includes('FROM certificates WHERE verification_reference')) {
        return { rows: [{
          verification_reference: values[0],
          status: 'ISSUED',
          certificate_type: 'MILESTONE',
          certificate_title: 'Field skills milestone',
          programme_name: 'Synthetic Programme',
          issued_at: '2026-11-13T10:00:00.000Z',
          learner_name: 'Must not be exposed',
        }] };
      }
      throw new Error(`Unexpected SQL in certificate router test: ${sql}`);
    },
  };
  const app = express();
  app.use('/api/admin', createCertificateAdminRouter({
    database,
    jwtSecret: 'certificate-router-test-secret-with-more-than-32-characters',
    evidenceStorage: { provider: 'test', save: async () => 'key', read: async () => Buffer.from(''), delete: async () => {} },
  }));
  app.use('/api/certificates', createCertificateVerificationRouter({ database }));

  await withHttpServer(app, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/admin/eligibility-configurations`, {
      headers: { Authorization: `Bearer ${authorizationToken(providerId, 'provider')}` },
    });
    assert.equal(denied.status, 403);

    const allowed = await fetch(`${baseUrl}/api/admin/eligibility-configurations`, {
      headers: { Authorization: `Bearer ${authorizationToken(adminId, 'admin')}` },
    });
    assert.equal(allowed.status, 200);

    const verification = await fetch(`${baseUrl}/api/certificates/verify/CERT-2026-AB12CD34EF56`);
    const body = await verification.json();
    assert.equal(verification.status, 200);
    assert.equal(body.valid, true);
    assert.equal(Object.hasOwn(body, 'learnerName'), false);
    assert.equal(JSON.stringify(body).includes('Must not be exposed'), false);
  });
});
