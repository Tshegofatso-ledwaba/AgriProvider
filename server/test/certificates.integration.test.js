// End-to-end certificate rules, QA, Admin issuance, private download, and revocation.
// All synthetic rows and the migration run inside an outer transaction that is rolled back.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const { test } = require('node:test');
const { createApp } = require('../src/app');
const { apiClient, applyMigrationIfPending, tokenFor, transactionalDatabase } = require('./support/transactional-database');

const databaseUrl = process.env.AGRI_TEST_DATABASE_URL;
const migrationName = '202611150001_create_certificate_workflow.sql';
const jwtSecret = 'certificate-integration-test-secret-with-more-than-32-characters';

test('certificate workflow gates issuance on configured rules, QA, and Admin authorization', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  const ids = Object.fromEntries([
    'provider', 'admin', 'qa', 'learnerUser', 'assessor', 'programme', 'learner', 'enrolment',
    'requirement', 'session', 'assessorAssignment', 'qaAssignment', 'submission', 'evidenceReview',
    'submission2', 'evidenceReview2',
  ].map((key) => [key, randomUUID()]));
  const roles = new Map([
    [ids.provider, 'provider'], [ids.admin, 'admin'], [ids.qa, 'qa'],
    [ids.learnerUser, 'learner'], [ids.assessor, 'assessor'],
  ]);
  const files = new Map();
  const evidenceStorage = {
    provider: 'certificate-integration-storage',
    async save(buffer) {
      const key = randomUUID();
      files.set(key, Buffer.from(buffer));
      return key;
    },
    async read(key) { return files.get(key); },
    async delete(key) { files.delete(key); },
  };
  const database = transactionalDatabase(client);
  let server;

  try {
    await client.query('BEGIN');
    await applyMigrationIfPending(client, migrationName);
    for (const [key, role] of roles) {
      await client.query(
        `INSERT INTO users (id, email, full_name, password_hash, role)
         VALUES ($1, $2, $3, 'not-a-login-hash', $4)`,
        [key, `${key}@example.test`, `Synthetic ${role}`, role],
      );
    }
    await client.query(
      `INSERT INTO programmes (id, provider_user_id, name) VALUES ($1, $2, 'Synthetic certificate programme')`,
      [ids.programme, ids.provider],
    );
    await client.query(
      `INSERT INTO learners (id, provider_user_id, learner_reference, full_name, email, learner_user_id)
       VALUES ($1, $2, $3, 'Synthetic certificate learner', $4, $5)`,
      [ids.learner, ids.provider, `LRN-${randomUUID()}`, `${ids.learnerUser}@example.test`, ids.learnerUser],
    );
    await client.query(
      `INSERT INTO enrolments (id, provider_user_id, learner_id, programme_id, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'active', $2, $2)`,
      [ids.enrolment, ids.provider, ids.learner, ids.programme],
    );
    await client.query(
      `INSERT INTO programme_evidence_requirements (id, provider_user_id, programme_id, title, created_by, updated_by)
       VALUES ($1, $2, $3, 'Synthetic completion evidence', $2, $2)`,
      [ids.requirement, ids.provider, ids.programme],
    );
    await client.query(
      `INSERT INTO training_sessions (id, provider_user_id, programme_id, title, starts_at, created_by, updated_by)
       VALUES ($1, $2, $3, 'Synthetic milestone session', NOW() - INTERVAL '1 day', $2, $2)`,
      [ids.session, ids.provider, ids.programme],
    );
    await client.query(
      `INSERT INTO attendance_records (id, provider_user_id, programme_id, session_id, enrolment_id, status, marked_by)
       VALUES ($1, $2, $3, $4, $5, 'present', $2)`,
      [randomUUID(), ids.provider, ids.programme, ids.session, ids.enrolment],
    );
    await client.query(
      `INSERT INTO programme_assessor_assignments (id, programme_id, assessor_user_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)`,
      [ids.assessorAssignment, ids.programme, ids.assessor, ids.admin],
    );
    await client.query(
      `INSERT INTO qa_programme_assignments (id, programme_id, qa_user_id, assigned_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)`,
      [ids.qaAssignment, ids.programme, ids.qa, ids.admin],
    );
    await client.query(
      `INSERT INTO evidence_submissions (
         id, provider_user_id, programme_id, enrolment_id, requirement_id, submitted_by,
         original_filename, mime_type, file_size, sha256, storage_provider, storage_key, status, version
      ) VALUES ($1, $2, $3, $4, $5, $2, 'completion.pdf', 'application/pdf', 8, $6, 'integration-test', $7, 'CORRECTION_REQUIRED', 1)`,
      [ids.submission, ids.provider, ids.programme, ids.enrolment, ids.requirement,
        createHash('sha256').update('synthetic').digest('hex'), randomUUID()],
    );
    await client.query(
      `INSERT INTO evidence_reviews (
         id, evidence_submission_id, submission_version, programme_id, assignment_id, assessor_user_id, decision
      ) VALUES ($1, $2, 1, $3, $4, $5, 'CORRECTION_REQUESTED', 'Please provide the missing field record.')`,
      [ids.evidenceReview, ids.submission, ids.programme, ids.assessorAssignment, ids.assessor],
    );

    const app = createApp(database, { jwtSecret, evidenceStorage, webOrigin: 'http://localhost:8081' });
    server = app.listen(0);
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const call = apiClient(baseUrl, (userId) => roles.get(userId));
    const criteria = {
      certificates: [{
        key: 'field-milestone',
        type: 'MILESTONE',
        title: 'Field milestone certificate',
        requiredEvidenceRequirementIds: [ids.requirement],
        requiredAssessmentRequirementIds: [ids.requirement],
        attendanceRequirements: [{ sessionId: ids.session, acceptedStatuses: ['present'] }],
      }],
    };

    const draft = await call(ids.provider, 'POST', `/api/programmes/${ids.programme}/eligibility-configurations`, { criteria });
    assert.equal(draft.status, 201);
    const configurationId = draft.body.configuration.id;
    const submitted = await call(ids.provider, 'POST', `/api/programmes/${ids.programme}/eligibility-configurations/${configurationId}/submit`, {});
    assert.equal(submitted.status, 200);
    const approvedRules = await call(ids.admin, 'POST', `/api/admin/eligibility-configurations/${configurationId}/approve`, {});
    assert.equal(approvedRules.status, 200);
    assert.equal(approvedRules.body.configuration.approval_authority, 'Administrator');

    const qaQueue = await call(ids.qa, 'GET', `/api/qa/certification/eligibility?programmeId=${ids.programme}`);
    assert.equal(qaQueue.status, 200);
    assert.ok(qaQueue.body.reviews[0].blockers.some((blocker) => blocker.code === 'CORRECTION_UNRESOLVED'));
    const providerBlockedStatus = await call(ids.provider, 'GET', `/api/programmes/${ids.programme}/certificate-status`);
    assert.equal(providerBlockedStatus.status, 200);
    assert.ok(providerBlockedStatus.body.eligibility[0].blockers.some((blocker) => blocker.code === 'CORRECTION_UNRESOLVED'));
    const blockedApproval = await call(ids.qa, 'POST', '/api/qa/certification/eligibility-reviews', {
      enrolmentId: ids.enrolment,
      credentialKey: 'field-milestone',
      decision: 'APPROVED',
      comments: 'Must not approve unresolved corrections.',
    });
    assert.equal(blockedApproval.status, 409);
    const qaRejection = await call(ids.qa, 'POST', '/api/qa/certification/eligibility-reviews', {
      enrolmentId: ids.enrolment,
      credentialKey: 'field-milestone',
      decision: 'REJECTED',
      comments: 'Correction is outstanding.',
    });
    assert.equal(qaRejection.status, 201);
    const blockedAuthorization = await call(ids.admin, 'POST', `/api/admin/eligibility-reviews/${qaRejection.body.review.id}/decision`, {
      decision: 'APPROVED',
    });
    assert.equal(blockedAuthorization.status, 409);

    await client.query(
      `INSERT INTO evidence_submissions (
         id, provider_user_id, programme_id, enrolment_id, requirement_id, submitted_by,
         original_filename, mime_type, file_size, sha256, storage_provider, storage_key, status, version
       ) VALUES ($1, $2, $3, $4, $5, $2, 'completion-v2.pdf', 'application/pdf', 9, $6, 'integration-test', $7, 'APPROVED', 2)`,
      [ids.submission2, ids.provider, ids.programme, ids.enrolment, ids.requirement,
        createHash('sha256').update('synthetic-v2').digest('hex'), randomUUID()],
    );
    await client.query(
      `INSERT INTO evidence_reviews (
         id, evidence_submission_id, submission_version, programme_id, assignment_id, assessor_user_id, decision
       ) VALUES ($1, $2, 2, $3, $4, $5, 'APPROVED')`,
      [ids.evidenceReview2, ids.submission2, ids.programme, ids.assessorAssignment, ids.assessor],
    );
    const clearQueue = await call(ids.qa, 'GET', `/api/qa/certification/eligibility?programmeId=${ids.programme}`);
    assert.equal(clearQueue.status, 200);
    assert.deepEqual(clearQueue.body.reviews[0].blockers, []);
    const providerEligibleStatus = await call(ids.provider, 'GET', `/api/programmes/${ids.programme}/certificate-status`);
    assert.equal(providerEligibleStatus.status, 200);
    assert.deepEqual(providerEligibleStatus.body.eligibility[0].blockers, []);
    const qaReview = await call(ids.qa, 'POST', '/api/qa/certification/eligibility-reviews', {
      enrolmentId: ids.enrolment,
      credentialKey: 'field-milestone',
      decision: 'APPROVED',
      comments: 'The current evidence version and configured attendance satisfy the rules.',
    });
    assert.equal(qaReview.status, 201);

    const authorization = await call(ids.admin, 'POST', `/api/admin/eligibility-reviews/${qaReview.body.review.id}/decision`, {
      decision: 'APPROVED',
    });
    assert.equal(authorization.status, 201);
    assert.equal(authorization.body.certificate.status, 'ISSUED');
    const certificateId = authorization.body.certificate.id;
    const reference = authorization.body.certificate.verification_reference;
    assert.equal(authorization.body.certificate.issuer_title, 'Administrator');
    const providerIssuedStatus = await call(ids.provider, 'GET', `/api/programmes/${ids.programme}/certificate-status`);
    assert.equal(providerIssuedStatus.body.eligibility[0].certificate.status, 'ISSUED');

    const duplicate = await call(ids.admin, 'POST', `/api/admin/eligibility-reviews/${qaReview.body.review.id}/decision`, {
      decision: 'APPROVED',
    });
    assert.equal(duplicate.status, 409);

    const learnerList = await call(ids.learnerUser, 'GET', '/api/learner/certificates');
    assert.equal(learnerList.status, 200);
    assert.equal(learnerList.body.certificates.length, 1);
    const downloaded = await fetch(`${baseUrl}/api/learner/certificates/${certificateId}/file`, {
      headers: { Authorization: `Bearer ${tokenFor(ids.learnerUser, 'learner')}` },
    });
    const downloadedBytes = Buffer.from(await downloaded.arrayBuffer());
    assert.equal(downloaded.status, 200);
    assert.equal(downloadedBytes.subarray(0, 5).toString('ascii'), '%PDF-');
    const otherRole = await call(ids.provider, 'GET', '/api/learner/certificates');
    assert.equal(otherRole.status, 403);

    const publicVerification = await fetch(`${baseUrl}/api/certificates/verify/${reference}`);
    const verified = await publicVerification.json();
    assert.equal(verified.valid, true);
    assert.equal(Object.hasOwn(verified, 'learnerName'), false);
    const revoked = await call(ids.admin, 'POST', `/api/admin/certificates/${certificateId}/revoke`, { reason: 'Synthetic test revocation.' });
    assert.equal(revoked.status, 200);
    const providerRevokedStatus = await call(ids.provider, 'GET', `/api/programmes/${ids.programme}/certificate-status`);
    assert.equal(providerRevokedStatus.body.eligibility[0].certificate.status, 'REVOKED');
    const revokedVerification = await fetch(`${baseUrl}/api/certificates/verify/${reference}`);
    assert.equal((await revokedVerification.json()).valid, false);
    const revokedDownload = await call(ids.learnerUser, 'GET', `/api/learner/certificates/${certificateId}/file`);
    assert.equal(revokedDownload.status, 404);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { await client.query('ROLLBACK'); } finally {
      client.release();
      await pool.end();
    }
  }
});
