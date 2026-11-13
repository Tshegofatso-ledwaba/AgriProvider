const { createHash, randomUUID } = require('node:crypto');
const PDFDocument = require('pdfkit');
const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const credentialKeyPattern = /^[a-z0-9][a-z0-9-]{0,59}$/;
const attendanceStatuses = new Set(['present', 'absent', 'excused']);
const certificateStatuses = new Set(['ISSUED', 'REVOKED', 'SUPERSEDED']);

class CertificateWorkflowError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCriteria(value) {
  let criteria = value;
  if (typeof criteria === 'string') {
    try {
      criteria = JSON.parse(criteria);
    } catch {
      return { error: 'Certificate criteria must be valid JSON.' };
    }
  }
  if (!isObject(criteria) || Object.keys(criteria).length !== 1 || !Array.isArray(criteria.certificates)) {
    return { error: 'Provide only a certificates array in the criteria object.' };
  }
  if (criteria.certificates.length < 1 || criteria.certificates.length > 30) {
    return { error: 'Configure between 1 and 30 milestone or final certificates.' };
  }

  const keys = new Set();
  let finalCount = 0;
  const normalized = [];
  for (const [index, item] of criteria.certificates.entries()) {
    if (!isObject(item)
      || Object.keys(item).some((key) => ![
        'key', 'type', 'title', 'requiredEvidenceRequirementIds',
        'requiredAssessmentRequirementIds', 'attendanceRequirements',
      ].includes(key))) {
      return { error: `Certificate ${index + 1} contains unsupported fields.` };
    }
    if (typeof item.key !== 'string' || !credentialKeyPattern.test(item.key) || keys.has(item.key)) {
      return { error: `Certificate ${index + 1} must have a unique lowercase key using letters, numbers, and hyphens.` };
    }
    if (item.type !== 'MILESTONE' && item.type !== 'FINAL') {
      return { error: `Certificate ${index + 1} type must be MILESTONE or FINAL.` };
    }
    if (item.type === 'FINAL') finalCount += 1;
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 160) {
      return { error: `Certificate ${index + 1} title must be between 1 and 160 characters.` };
    }

    const evidenceIds = validateUuidList(item.requiredEvidenceRequirementIds ?? [], 'Required evidence', 50);
    if (evidenceIds.error) return evidenceIds;
    const assessmentIds = validateUuidList(item.requiredAssessmentRequirementIds ?? [], 'Required assessment', 50);
    if (assessmentIds.error) return assessmentIds;
    const attendance = validateAttendanceRequirements(item.attendanceRequirements ?? []);
    if (attendance.error) return attendance;
    const requiredEvidence = evidenceIds.value;
    const requiredAssessments = assessmentIds.value;
    if (requiredEvidence.length === 0 && requiredAssessments.length === 0 && attendance.value.length === 0) {
      return { error: `Certificate ${item.key} needs at least one explicitly configured condition.` };
    }
    if (requiredAssessments.some((id) => !requiredEvidence.includes(id))) {
      return { error: `Required assessment items for ${item.key} must also be listed as required evidence.` };
    }
    keys.add(item.key);
    normalized.push({
      key: item.key,
      type: item.type,
      title: item.title.trim(),
      requiredEvidenceRequirementIds: requiredEvidence,
      requiredAssessmentRequirementIds: requiredAssessments,
      attendanceRequirements: attendance.value,
    });
  }
  if (finalCount > 1) return { error: 'Only one final certificate may be configured per programme version.' };
  return { value: { certificates: normalized } };
}

function validateUuidList(value, label, max) {
  if (!Array.isArray(value) || value.length > max
    || value.some((id) => typeof id !== 'string' || !uuidPattern.test(id))) {
    return { error: `${label} requirements must be an array of up to ${max} UUIDs.` };
  }
  if (new Set(value).size !== value.length) return { error: `${label} requirements cannot contain duplicates.` };
  return { value: [...value] };
}

function validateAttendanceRequirements(value) {
  if (!Array.isArray(value) || value.length > 50) {
    return { error: 'Attendance requirements must be an array of up to 50 configured sessions.' };
  }
  const ids = new Set();
  const normalized = [];
  for (const requirement of value) {
    if (!isObject(requirement) || Object.keys(requirement).some((key) => !['sessionId', 'acceptedStatuses'].includes(key))) {
      return { error: 'Each attendance requirement must contain only sessionId and acceptedStatuses.' };
    }
    if (typeof requirement.sessionId !== 'string' || !uuidPattern.test(requirement.sessionId)
      || ids.has(requirement.sessionId)) {
      return { error: 'Attendance session IDs must be unique UUIDs.' };
    }
    if (!Array.isArray(requirement.acceptedStatuses) || requirement.acceptedStatuses.length === 0
      || requirement.acceptedStatuses.some((status) => !attendanceStatuses.has(status))) {
      return { error: 'Configure at least one accepted attendance status for each required session.' };
    }
    ids.add(requirement.sessionId);
    normalized.push({
      sessionId: requirement.sessionId,
      acceptedStatuses: [...new Set(requirement.acceptedStatuses)],
    });
  }
  return { value: normalized };
}

function validateDecisionBody(body, { authorization = false } = {}) {
  const allowed = authorization
    ? ['decision', 'comments', 'supersedesCertificateId']
    : ['decision', 'comments'];
  if (!isObject(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: `Provide only ${allowed.join(', ')}.` };
  }
  if (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') {
    return { error: 'Decision must be APPROVED or REJECTED.' };
  }
  const comments = body.comments === undefined || body.comments === null ? '' : body.comments;
  if (typeof comments !== 'string' || comments.trim().length > 2000) {
    return { error: 'Comments must be 2,000 characters or fewer.' };
  }
  if (body.decision === 'REJECTED' && !comments.trim()) {
    return { error: 'A reason is required when rejecting eligibility or issuance.' };
  }
  const value = { decision: body.decision, comments: comments.trim() || null };
  if (authorization && body.decision === 'APPROVED') {
    if (body.supersedesCertificateId !== undefined) {
      if (typeof body.supersedesCertificateId !== 'string' || !uuidPattern.test(body.supersedesCertificateId)) {
        return { error: 'supersedesCertificateId must be a UUID.' };
      }
      value.supersedesCertificateId = body.supersedesCertificateId;
    }
  } else if (authorization && body.supersedesCertificateId !== undefined) {
    return { error: 'A rejected issuance cannot supersede a certificate.' };
  }
  return { value };
}

async function withTransaction(database, work) {
  const client = await database.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    const value = await work(client);
    await client.query('COMMIT');
    started = false;
    return value;
  } catch (error) {
    if (started) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function sendError(error, response, next) {
  if (error instanceof CertificateWorkflowError) {
    return response.status(error.status).json({
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  return next(error);
}

async function validateProgrammeReferences(client, programmeId, criteria) {
  const requirementIds = [...new Set(criteria.certificates.flatMap((credential) => [
    ...credential.requiredEvidenceRequirementIds,
    ...credential.requiredAssessmentRequirementIds,
  ]))];
  if (requirementIds.length) {
    const { rows } = await client.query(
      `SELECT id FROM programme_evidence_requirements
       WHERE programme_id = $1 AND archived_at IS NULL AND id = ANY($2::uuid[])`,
      [programmeId, requirementIds],
    );
    if (rows.length !== requirementIds.length) {
      throw new CertificateWorkflowError(400, 'Every evidence and assessment condition must reference an active requirement in this programme.');
    }
  }
  const attendanceIds = [...new Set(criteria.certificates.flatMap((credential) =>
    credential.attendanceRequirements.map((requirement) => requirement.sessionId)))];
  if (attendanceIds.length) {
    const { rows } = await client.query(
      `SELECT id FROM training_sessions
       WHERE programme_id = $1 AND archived_at IS NULL AND id = ANY($2::uuid[])`,
      [programmeId, attendanceIds],
    );
    if (rows.length !== attendanceIds.length) {
      throw new CertificateWorkflowError(400, 'Every attendance condition must reference an active session in this programme.');
    }
  }
}

async function getActiveConfiguration(database, programmeId) {
  const { rows } = await database.query(
    `SELECT id, programme_id, version, criteria, effective_from
     FROM eligibility_rule_configurations
     WHERE programme_id = $1 AND status = 'APPROVED'
       AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
     ORDER BY version DESC LIMIT 1`,
    [programmeId],
  );
  return rows[0] ?? null;
}

function getCredential(configuration, credentialKey) {
  const parsed = parseCriteria(configuration.criteria);
  if (parsed.error) throw new CertificateWorkflowError(500, 'The approved certificate rules are invalid.');
  return parsed.value.certificates.find((credential) => credential.key === credentialKey) ?? null;
}

async function evaluateCredential(database, enrolmentId, credential) {
  const { rows: enrolmentRows } = await database.query(
    `SELECT e.id AS enrolment_id, e.provider_user_id, e.learner_id, e.programme_id,
       l.full_name AS learner_name, l.learner_reference, p.name AS programme_name
     FROM enrolments e
     JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
     JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
     WHERE e.id = $1 AND e.status = 'active' AND l.archived_at IS NULL AND p.archived_at IS NULL`,
    [enrolmentId],
  );
  const enrolment = enrolmentRows[0];
  if (!enrolment) throw new CertificateWorkflowError(404, 'Active learner enrolment not found.');

  const blockers = [];
  const evidenceSnapshot = [];
  const requirementIds = [...new Set([
    ...credential.requiredEvidenceRequirementIds,
    ...credential.requiredAssessmentRequirementIds,
  ])];
  const requirements = new Map();
  if (requirementIds.length) {
    const { rows } = await database.query(
      `SELECT r.id, r.title FROM programme_evidence_requirements r
       WHERE r.programme_id = $1 AND r.archived_at IS NULL AND r.id = ANY($2::uuid[])`,
      [enrolment.programme_id, requirementIds],
    );
    rows.forEach((row) => requirements.set(row.id, row));
  }

  const latestEvidence = new Map();
  if (requirementIds.length) {
    const { rows } = await database.query(
      `SELECT DISTINCT ON (s.requirement_id) s.requirement_id, s.id AS submission_id,
         s.status AS submission_status, s.version,
         review.id AS assessment_review_id, review.decision AS assessment_decision
       FROM evidence_submissions s
       LEFT JOIN evidence_reviews review
         ON review.evidence_submission_id = s.id AND review.submission_version = s.version
       WHERE s.enrolment_id = $1 AND s.requirement_id = ANY($2::uuid[])
       ORDER BY s.requirement_id, s.version DESC`,
      [enrolmentId, requirementIds],
    );
    rows.forEach((row) => latestEvidence.set(row.requirement_id, row));
  }

  for (const requirementId of credential.requiredEvidenceRequirementIds) {
    const requirement = requirements.get(requirementId);
    const latest = latestEvidence.get(requirementId);
    const evidence = {
      requirementId,
      requirementTitle: requirement?.title ?? 'Unavailable requirement',
      submissionId: latest?.submission_id ?? null,
      submissionVersion: latest?.version ?? null,
      submissionStatus: latest?.submission_status ?? null,
      assessmentReviewId: latest?.assessment_review_id ?? null,
      assessmentDecision: latest?.assessment_decision ?? null,
    };
    evidenceSnapshot.push(evidence);
    if (!requirement) {
      blockers.push({ code: 'REQUIREMENT_UNAVAILABLE', requirementId, message: 'A configured evidence requirement is no longer active.' });
    } else if (!latest) {
      blockers.push({ code: 'EVIDENCE_MISSING', requirementId, message: `Required evidence is outstanding: ${requirement.title}.` });
    } else if (latest.submission_status === 'CORRECTION_REQUIRED') {
      blockers.push({ code: 'CORRECTION_UNRESOLVED', requirementId, message: `Corrections remain unresolved for ${requirement.title}.` });
    } else if (latest.submission_status !== 'APPROVED') {
      blockers.push({ code: 'EVIDENCE_NOT_APPROVED', requirementId, message: `Required evidence is not approved: ${requirement.title}.` });
    }
  }

  for (const requirementId of credential.requiredAssessmentRequirementIds) {
    const requirement = requirements.get(requirementId);
    const latest = latestEvidence.get(requirementId);
    if (!requirement) continue;
    if (!latest?.assessment_review_id) {
      blockers.push({ code: 'ASSESSMENT_INCOMPLETE', requirementId, message: `Required assessment is incomplete: ${requirement.title}.` });
    } else if (latest.assessment_decision !== 'APPROVED') {
      blockers.push({ code: 'ASSESSMENT_NOT_APPROVED', requirementId, message: `Required assessment is not approved: ${requirement.title}.` });
    }
  }

  const attendanceRequirements = credential.attendanceRequirements;
  if (attendanceRequirements.length) {
    const sessionIds = attendanceRequirements.map((requirement) => requirement.sessionId);
    const { rows } = await database.query(
      `SELECT s.id, s.title, attendance.status
       FROM training_sessions s
       LEFT JOIN attendance_records attendance
         ON attendance.session_id = s.id AND attendance.enrolment_id = $2
       WHERE s.programme_id = $1 AND s.archived_at IS NULL AND s.id = ANY($3::uuid[])`,
      [enrolment.programme_id, enrolmentId, sessionIds],
    );
    const sessions = new Map(rows.map((row) => [row.id, row]));
    for (const condition of attendanceRequirements) {
      const session = sessions.get(condition.sessionId);
      const snapshot = {
        sessionId: condition.sessionId,
        title: session?.title ?? 'Unavailable session',
        attendanceStatus: session?.status ?? null,
        acceptedStatuses: condition.acceptedStatuses,
      };
      evidenceSnapshot.push(snapshot);
      if (!session) {
        blockers.push({ code: 'ATTENDANCE_SESSION_UNAVAILABLE', sessionId: condition.sessionId, message: 'A configured attendance session is no longer active.' });
      } else if (!condition.acceptedStatuses.includes(session.status)) {
        blockers.push({ code: 'ATTENDANCE_CONDITION_UNMET', sessionId: condition.sessionId, message: `Required attendance is not recorded for ${session.title}.` });
      }
    }
  }

  return { enrolment, blockers, evidenceSnapshot };
}

function buildCertificatePdf(certificate) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const document = new PDFDocument({ size: 'A4', margin: 64, info: { Title: certificate.certificateTitle, Author: certificate.issuerName } });
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.font('Helvetica-Bold').fontSize(13).fillColor('#173F35').text('AGRIPROVIDER', { align: 'center', characterSpacing: 1.2 });
    document.moveDown(2);
    document.fontSize(27).text(certificate.certificateTitle, { align: 'center' });
    document.moveDown(1.5);
    document.font('Helvetica').fontSize(13).fillColor('#13271F').text('This certificate records that', { align: 'center' });
    document.moveDown(0.7);
    document.font('Helvetica-Bold').fontSize(23).text(certificate.learnerName, { align: 'center' });
    document.moveDown(0.7);
    document.font('Helvetica').fontSize(13).text(`has met the configured ${certificate.certificateType.toLowerCase()} conditions for`, { align: 'center' });
    document.moveDown(0.6);
    document.font('Helvetica-Bold').fontSize(18).text(certificate.programmeName, { align: 'center' });
    document.moveDown(2);
    document.font('Helvetica').fontSize(11).text(`Learner reference: ${certificate.learnerReference}`);
    document.text(`Certificate type: ${certificate.certificateType === 'FINAL' ? 'Final completion' : 'Milestone'}`);
    document.text(`Issue date: ${new Date(certificate.issuedAt).toLocaleDateString('en-ZA')}`);
    document.text(`Authorized issuer: ${certificate.issuerName}, ${certificate.issuerTitle}`);
    document.moveDown(1);
    document.font('Helvetica-Bold').fontSize(12).fillColor('#173F35').text(`Verification reference: ${certificate.verificationReference}`);
    document.moveDown(2);
    document.font('Helvetica').fontSize(9).fillColor('#5C6D67').text(
      'This record reflects the configured programme criteria and authorized review. It does not claim accreditation or qualification status.',
      { align: 'center' },
    );
    document.end();
  });
}

function publicCertificate(row) {
  return {
    id: row.id,
    certificate_type: row.certificate_type,
    certificate_title: row.certificate_title,
    credential_key: row.credential_key,
    programme_id: row.programme_id,
    programme_name: row.programme_name,
    learner_id: row.learner_id,
    learner_name: row.learner_name,
    learner_reference: row.learner_reference,
    verification_reference: row.verification_reference,
    issued_at: row.issued_at,
    issuer_name: row.issuer_name,
    issuer_title: row.issuer_title,
    status: row.status,
    file_size: Number(row.file_size),
  };
}

function sendCertificateFile(response, content, filename) {
  response.set({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': String(content.length),
    'Content-Type': 'application/pdf',
    'X-Content-Type-Options': 'nosniff',
  });
  return response.send(content);
}

function certificateReference() {
  return `CERT-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function createProviderCertificateRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  router.get('/:programmeId/eligibility-configurations', async (request, response, next) => {
    const { programmeId } = request.params;
    if (!uuidPattern.test(programmeId)) return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `SELECT c.id, c.programme_id, c.version, c.criteria, c.status, c.effective_from,
           c.created_by, c.created_at, c.submitted_at, c.approved_by, c.approved_at,
           c.rejected_by, c.rejected_at, c.rejection_reason
         FROM eligibility_rule_configurations c
         JOIN programmes p ON p.id = c.programme_id
         WHERE c.programme_id = $1 AND p.provider_user_id = $2
         ORDER BY c.version DESC`,
        [programmeId, request.auth.userId],
      );
      const { rows: accessRows } = await database.query(
        'SELECT id FROM programmes WHERE id = $1 AND provider_user_id = $2',
        [programmeId, request.auth.userId],
      );
      if (!accessRows[0]) return response.status(404).json({ error: 'Programme not found.' });
      return response.json({ configurations: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:programmeId/eligibility-configurations', async (request, response, next) => {
    const { programmeId } = request.params;
    if (!uuidPattern.test(programmeId)) return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    if (!isObject(request.body) || Object.keys(request.body).some((key) => key !== 'criteria')) {
      return response.status(400).json({ error: 'Provide only criteria.' });
    }
    const validated = parseCriteria(request.body.criteria);
    if (validated.error) return response.status(400).json({ error: validated.error });
    try {
      const result = await withTransaction(database, async (client) => {
        const { rows: programmeRows } = await client.query(
          'SELECT id FROM programmes WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL FOR UPDATE',
          [programmeId, request.auth.userId],
        );
        if (!programmeRows[0]) throw new CertificateWorkflowError(404, 'Active programme not found.');
        await validateProgrammeReferences(client, programmeId, validated.value);
        const { rows: versionRows } = await client.query(
          'SELECT COALESCE(MAX(version), 0)::integer + 1 AS version FROM eligibility_rule_configurations WHERE programme_id = $1',
          [programmeId],
        );
        const { rows } = await client.query(
          `INSERT INTO eligibility_rule_configurations (programme_id, version, criteria, status, created_by)
           VALUES ($1, $2, $3::jsonb, 'DRAFT', $4)
           RETURNING id, programme_id, version, criteria, status, created_by, created_at`,
          [programmeId, versionRows[0].version, JSON.stringify(validated.value), request.auth.userId],
        );
        await client.query(
          `INSERT INTO certificate_events (eligibility_configuration_id, actor_user_id, actor_role, event_type, details)
           VALUES ($1, $2, 'provider', 'RULES_CREATED', jsonb_build_object('version', $3))`,
          [rows[0].id, request.auth.userId, rows[0].version],
        );
        return rows[0];
      });
      return response.status(201).json({ configuration: result });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.post('/:programmeId/eligibility-configurations/:configurationId/submit', async (request, response, next) => {
    const { programmeId, configurationId } = request.params;
    if (!uuidPattern.test(programmeId) || !uuidPattern.test(configurationId)) {
      return response.status(400).json({ error: 'Programme and configuration IDs must be UUIDs.' });
    }
    try {
      const result = await withTransaction(database, async (client) => {
        const { rows } = await client.query(
          `UPDATE eligibility_rule_configurations c SET status = 'PENDING_APPROVAL', submitted_at = NOW()
           FROM programmes p
           WHERE c.id = $1 AND c.programme_id = $2 AND p.id = c.programme_id
             AND p.provider_user_id = $3 AND c.status = 'DRAFT'
           RETURNING c.id, c.programme_id, c.version, c.status, c.submitted_at`,
          [configurationId, programmeId, request.auth.userId],
        );
        if (!rows[0]) throw new CertificateWorkflowError(404, 'Draft certificate rules not found for this programme.');
        await client.query(
          `INSERT INTO certificate_events (eligibility_configuration_id, actor_user_id, actor_role, event_type)
           VALUES ($1, $2, 'provider', 'RULES_SUBMITTED')`,
          [configurationId, request.auth.userId],
        );
        return rows[0];
      });
      return response.json({ configuration: result });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.get('/:programmeId/certificate-status', async (request, response, next) => {
    const { programmeId } = request.params;
    if (!uuidPattern.test(programmeId)) return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    try {
      const { rows: programmeRows } = await database.query(
        'SELECT id FROM programmes WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL',
        [programmeId, request.auth.userId],
      );
      if (!programmeRows[0]) return response.status(404).json({ error: 'Active programme not found.' });
      const configuration = await getActiveConfiguration(database, programmeId);
      if (!configuration) return response.json({ configuration: null, eligibility: [] });
      const parsed = parseCriteria(configuration.criteria);
      if (parsed.error) return response.status(500).json({ error: 'The approved certificate rules are invalid.' });
      const { rows: enrolmentRows } = await database.query(
        `SELECT e.id AS enrolment_id, e.learner_id, l.full_name AS learner_name,
           l.learner_reference
         FROM enrolments e
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
         WHERE e.programme_id = $1 AND e.provider_user_id = $2 AND e.status = 'active'
           AND l.archived_at IS NULL
         ORDER BY l.full_name, e.id`,
        [programmeId, request.auth.userId],
      );
      const eligibility = [];
      for (const enrolment of enrolmentRows) {
        for (const credential of parsed.value.certificates) {
          const evaluation = await evaluateCredential(database, enrolment.enrolment_id, credential);
          const [latestReview, certificateResult] = await Promise.all([
            latestQaEligibilityReview(database, enrolment.enrolment_id, configuration.id, credential.key),
            database.query(
              `SELECT id, verification_reference, status, issued_at, revoked_at
               FROM certificates
               WHERE learner_id = $1 AND programme_id = $2 AND credential_key = $3
               ORDER BY issued_at DESC LIMIT 1`,
              [enrolment.learner_id, programmeId, credential.key],
            ),
          ]);
          eligibility.push({
            enrolmentId: enrolment.enrolment_id,
            learnerId: enrolment.learner_id,
            learnerName: enrolment.learner_name,
            learnerReference: enrolment.learner_reference,
            credentialKey: credential.key,
            credentialType: credential.type,
            credentialTitle: credential.title,
            blockers: evaluation.blockers,
            qaDecision: latestReview?.decision ?? null,
            qaReviewedAt: latestReview?.reviewed_at ?? null,
            certificate: certificateResult.rows[0] ?? null,
          });
        }
      }
      return response.json({ configuration: { id: configuration.id, version: configuration.version }, eligibility });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function createCertificateAdminRouter({ database, jwtSecret, evidenceStorage }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('admin'));

  router.get('/eligibility-configurations', async (request, response, next) => {
    const status = request.query.status;
    if (status !== undefined && !['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'INACTIVE'].includes(status)) {
      return response.status(400).json({ error: 'Invalid configuration status.' });
    }
    try {
      const { rows } = await database.query(
        `SELECT c.id, c.programme_id, p.name AS programme_name, p.provider_user_id,
           provider.full_name AS provider_name, c.version, c.criteria, c.status,
           c.effective_from, c.created_by, creator.full_name AS created_by_name,
           c.created_at, c.submitted_at, c.approved_by, approver.full_name AS approved_by_name,
           c.approved_at, c.approval_authority, c.rejected_by, rejector.full_name AS rejected_by_name,
           c.rejected_at, c.rejection_reason
         FROM eligibility_rule_configurations c
         JOIN programmes p ON p.id = c.programme_id
         JOIN users provider ON provider.id = p.provider_user_id
         JOIN users creator ON creator.id = c.created_by
         LEFT JOIN users approver ON approver.id = c.approved_by
         LEFT JOIN users rejector ON rejector.id = c.rejected_by
         WHERE ($1::text IS NULL OR c.status = $1)
         ORDER BY (c.status = 'PENDING_APPROVAL') DESC, c.created_at DESC, c.id`,
        [status ?? null],
      );
      return response.json({ configurations: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/eligibility-configurations/:configurationId/approve', async (request, response, next) => {
    const { configurationId } = request.params;
    if (!uuidPattern.test(configurationId)) return response.status(400).json({ error: 'Configuration ID must be a UUID.' });
    try {
      const result = await withTransaction(database, async (client) => {
        await client.query("SELECT set_config('app.certification_approval_authority', 'admin', TRUE)");
        await client.query("SELECT set_config('app.certification_actor', $1, TRUE)", [request.auth.userId]);
        const { rows } = await client.query(
          `UPDATE eligibility_rule_configurations
           SET status = 'APPROVED', approved_by = $2, approved_at = NOW(),
             approval_authority = 'Administrator', effective_from = COALESCE(effective_from, CURRENT_DATE)
           WHERE id = $1 AND status = 'PENDING_APPROVAL'
           RETURNING id, programme_id, version, criteria, status, effective_from, approved_by, approved_at, approval_authority`,
          [configurationId, request.auth.userId],
        );
        if (!rows[0]) throw new CertificateWorkflowError(404, 'Pending certificate rules not found.');
        await client.query(
          `INSERT INTO certificate_events (eligibility_configuration_id, actor_user_id, actor_role, event_type)
           VALUES ($1, $2, 'admin', 'RULES_APPROVED')`,
          [configurationId, request.auth.userId],
        );
        return rows[0];
      });
      return response.json({ configuration: result });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.post('/eligibility-configurations/:configurationId/reject', async (request, response, next) => {
    const { configurationId } = request.params;
    if (!uuidPattern.test(configurationId)) return response.status(400).json({ error: 'Configuration ID must be a UUID.' });
    const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
    if (!reason || reason.length > 2000 || Object.keys(request.body ?? {}).some((key) => key !== 'reason')) {
      return response.status(400).json({ error: 'Provide a rejection reason of 1–2,000 characters.' });
    }
    try {
      const result = await withTransaction(database, async (client) => {
        const { rows } = await client.query(
          `UPDATE eligibility_rule_configurations
           SET status = 'REJECTED', rejected_by = $2, rejected_at = NOW(), rejection_reason = $3
           WHERE id = $1 AND status = 'PENDING_APPROVAL'
           RETURNING id, programme_id, version, status, rejected_by, rejected_at, rejection_reason`,
          [configurationId, request.auth.userId, reason],
        );
        if (!rows[0]) throw new CertificateWorkflowError(404, 'Pending certificate rules not found.');
        await client.query(
          `INSERT INTO certificate_events (eligibility_configuration_id, actor_user_id, actor_role, event_type, details)
           VALUES ($1, $2, 'admin', 'RULES_REJECTED', jsonb_build_object('reason', $3))`,
          [configurationId, request.auth.userId, reason],
        );
        return rows[0];
      });
      return response.json({ configuration: result });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.get('/eligibility-reviews', async (request, response, next) => {
    const decision = request.query.decision;
    if (decision !== undefined && decision !== 'APPROVED' && decision !== 'REJECTED') {
      return response.status(400).json({ error: 'Decision must be APPROVED or REJECTED.' });
    }
    try {
      const { rows } = await database.query(
        `SELECT r.id, r.provider_user_id, r.learner_id, r.enrolment_id, r.programme_id,
           r.eligibility_configuration_id, r.credential_key, r.credential_type, r.credential_title,
           r.decision, r.blockers, r.comments, r.reviewed_at, r.qa_user_id, qa.full_name AS qa_name,
           learner.full_name AS learner_name, learner.learner_reference, programme.name AS programme_name,
           authorization.id AS authorization_id, authorization.decision AS authorization_decision,
           authorization.comments AS authorization_comments, authorization.decided_at
         FROM certificate_eligibility_reviews r
         JOIN learners learner ON learner.id = r.learner_id
         JOIN programmes programme ON programme.id = r.programme_id
         JOIN users qa ON qa.id = r.qa_user_id
         LEFT JOIN certificate_authorizations authorization ON authorization.eligibility_review_id = r.id
         WHERE ($1::text IS NULL OR r.decision = $1)
         ORDER BY r.reviewed_at DESC, r.id
         LIMIT 200`,
        [decision ?? null],
      );
      return response.json({ reviews: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/eligibility-reviews/:reviewId/decision', async (request, response, next) => {
    const { reviewId } = request.params;
    if (!uuidPattern.test(reviewId)) return response.status(400).json({ error: 'Eligibility review ID must be a UUID.' });
    const validated = validateDecisionBody(request.body, { authorization: true });
    if (validated.error) return response.status(400).json({ error: validated.error });
    let storedKey;
    try {
      const result = await withTransaction(database, async (client) => {
        const { rows } = await client.query(
          `SELECT r.*, e.status AS enrolment_status, c.version AS configuration_version,
             c.criteria AS approved_criteria, c.status AS configuration_status,
             learner.full_name AS learner_name, learner.learner_reference,
             programme.name AS programme_name, provider.full_name AS provider_name,
             admin.full_name AS admin_name
           FROM certificate_eligibility_reviews r
           JOIN enrolments e ON e.id = r.enrolment_id
           JOIN eligibility_rule_configurations c ON c.id = r.eligibility_configuration_id
           JOIN learners learner ON learner.id = r.learner_id
           JOIN programmes programme ON programme.id = r.programme_id
           JOIN users provider ON provider.id = r.provider_user_id
           JOIN users admin ON admin.id = $2
           WHERE r.id = $1 FOR UPDATE OF r, e`,
          [reviewId, request.auth.userId],
        );
        const review = rows[0];
        if (!review) throw new CertificateWorkflowError(404, 'QA eligibility review not found.');
        if (review.decision !== 'APPROVED') throw new CertificateWorkflowError(409, 'Only QA-approved eligibility can be authorized for issuance.');
        if (review.configuration_status !== 'APPROVED') throw new CertificateWorkflowError(409, 'The certificate rules are no longer approved.');
        const approvedConfiguration = await getActiveConfiguration(client, review.programme_id);
        if (!approvedConfiguration || approvedConfiguration.id !== review.eligibility_configuration_id) {
          throw new CertificateWorkflowError(409, 'A newer approved rule version exists. QA must review eligibility again.');
        }
        const criteria = parseCriteria(review.criteria_snapshot);
        if (criteria.error) throw new CertificateWorkflowError(500, 'The QA-reviewed certificate rules are invalid.');
        const credential = criteria.value.certificates.find((item) => item.key === review.credential_key);
        if (!credential) throw new CertificateWorkflowError(409, 'The reviewed credential no longer exists in its approved rule version.');
        const evaluation = await evaluateCredential(client, review.enrolment_id, credential);
        if (evaluation.blockers.length) {
          throw new CertificateWorkflowError(409, 'Eligibility conditions changed after QA review. QA must record a new decision.', evaluation.blockers);
        }
        const { rows: priorRows } = await client.query(
          `SELECT id, status FROM certificates
           WHERE learner_id = $1 AND programme_id = $2 AND credential_key = $3 AND status = 'ISSUED'
           FOR UPDATE`,
          [review.learner_id, review.programme_id, review.credential_key],
        );
        const prior = priorRows[0];
        if (prior && prior.id !== validated.value.supersedesCertificateId) {
          throw new CertificateWorkflowError(409, 'A certificate is already issued for this credential. Explicitly supersede it to issue a replacement.');
        }
        if (validated.value.supersedesCertificateId) {
          const { rows: supersededRows } = await client.query(
            `SELECT id FROM certificates WHERE id = $1 AND learner_id = $2 AND programme_id = $3
               AND credential_key = $4 AND status = 'ISSUED' FOR UPDATE`,
            [validated.value.supersedesCertificateId, review.learner_id, review.programme_id, review.credential_key],
          );
          if (!supersededRows[0]) throw new CertificateWorkflowError(409, 'Only the currently issued certificate for this credential can be superseded.');
        }
        const { rows: authorizationRows } = await client.query(
          `INSERT INTO certificate_authorizations (eligibility_review_id, decision, comments, admin_user_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, eligibility_review_id, decision, comments, admin_user_id, decided_at`,
          [reviewId, validated.value.decision, validated.value.comments, request.auth.userId],
        );
        const authorization = authorizationRows[0];
        await client.query(
          `INSERT INTO certificate_events (eligibility_review_id, authorization_id, actor_user_id, actor_role, event_type, details)
           VALUES ($1, $2, $3, 'admin', $4, jsonb_build_object('comments', $5))`,
          [reviewId, authorization.id, request.auth.userId,
            validated.value.decision === 'APPROVED' ? 'ADMIN_ISSUANCE_APPROVED' : 'ADMIN_ISSUANCE_REJECTED',
            validated.value.comments],
        );
        if (validated.value.decision === 'REJECTED') return { authorization, certificate: null };

        const issuedAt = new Date();
        const reference = certificateReference();
        const certificate = {
          certificateTitle: credential.title,
          certificateType: credential.type,
          learnerName: review.learner_name,
          learnerReference: review.learner_reference,
          programmeName: review.programme_name,
          verificationReference: reference,
          issuedAt,
          issuerName: review.admin_name,
          issuerTitle: 'Administrator',
        };
        const pdf = await buildCertificatePdf(certificate);
        storedKey = await evidenceStorage.save(pdf);
        if (prior) {
          await client.query(
            `UPDATE certificates SET status = 'SUPERSEDED', updated_by = $2, updated_at = NOW()
             WHERE id = $1`,
            [prior.id, request.auth.userId],
          );
          await client.query(
            `INSERT INTO certificate_events (certificate_id, actor_user_id, actor_role, event_type, details)
             VALUES ($1, $2, 'admin', 'CERTIFICATE_SUPERSEDED', jsonb_build_object('replacementReference', $3))`,
            [prior.id, request.auth.userId, reference],
          );
        }
        const { rows: certificateRows } = await client.query(
          `INSERT INTO certificates (
             eligibility_review_id, authorization_id, provider_user_id, learner_id, enrolment_id, programme_id,
             credential_key, certificate_type, certificate_title, learner_name, learner_reference,
             programme_name, verification_reference, issued_at, issuer_user_id, issuer_name, issuer_title,
             storage_provider, storage_key, file_size, sha256, supersedes_certificate_id, updated_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $15
           ) RETURNING *`,
          [
            reviewId, authorization.id, review.provider_user_id, review.learner_id, review.enrolment_id,
            review.programme_id, credential.key, credential.type, credential.title, review.learner_name,
            review.learner_reference, review.programme_name, reference, issuedAt, request.auth.userId,
            review.admin_name, 'Administrator', evidenceStorage.provider, storedKey, pdf.length,
            createHash('sha256').update(pdf).digest('hex'), prior?.id ?? null,
          ],
        );
        const certificateRow = certificateRows[0];
        await client.query(
          `INSERT INTO certificate_events (authorization_id, certificate_id, actor_user_id, actor_role, event_type, details)
           VALUES ($1, $2, $3, 'admin', 'CERTIFICATE_ISSUED', jsonb_build_object('reference', $4, 'generatedBy', 'system'))`,
          [authorization.id, certificateRow.id, request.auth.userId, reference],
        );
        return { authorization, certificate: publicCertificate(certificateRow) };
      });
      return response.status(201).json(result);
    } catch (error) {
      if (storedKey) {
        try { await evidenceStorage.delete(storedKey); } catch { /* Best effort cleanup after rollback. */ }
      }
      if (error.code === '23505') {
        return response.status(409).json({ error: 'This eligibility review has already received an issuance decision or this credential is already issued.' });
      }
      return sendError(error, response, next);
    }
  });

  router.get('/certificates', async (request, response, next) => {
    const status = request.query.status;
    if (status !== undefined && !certificateStatuses.has(status)) {
      return response.status(400).json({ error: 'Invalid certificate status.' });
    }
    try {
      const { rows } = await database.query(
        `SELECT id, learner_id, learner_name, learner_reference, programme_id, programme_name,
           credential_key, certificate_type, certificate_title, verification_reference, issued_at,
           issuer_name, issuer_title, status, revoked_at, revocation_reason, file_size
         FROM certificates WHERE ($1::text IS NULL OR status = $1)
         ORDER BY issued_at DESC LIMIT 200`,
        [status ?? null],
      );
      return response.json({ certificates: rows.map((row) => ({ ...row, file_size: Number(row.file_size) })) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/certificates/:certificateId/revoke', async (request, response, next) => {
    const { certificateId } = request.params;
    if (!uuidPattern.test(certificateId)) return response.status(400).json({ error: 'Certificate ID must be a UUID.' });
    const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
    if (!reason || reason.length > 2000 || Object.keys(request.body ?? {}).some((key) => key !== 'reason')) {
      return response.status(400).json({ error: 'A revocation reason of 1–2,000 characters is required.' });
    }
    try {
      const result = await withTransaction(database, async (client) => {
        const { rows } = await client.query(
          `UPDATE certificates SET status = 'REVOKED', revoked_by = $2, revoked_at = NOW(),
             revocation_reason = $3, updated_by = $2, updated_at = NOW()
           WHERE id = $1 AND status = 'ISSUED'
           RETURNING id, verification_reference, status, revoked_at, revocation_reason`,
          [certificateId, request.auth.userId, reason],
        );
        if (!rows[0]) throw new CertificateWorkflowError(404, 'Issued certificate not found.');
        await client.query(
          `INSERT INTO certificate_events (certificate_id, actor_user_id, actor_role, event_type, details)
           VALUES ($1, $2, 'admin', 'CERTIFICATE_REVOKED', jsonb_build_object('reason', $3))`,
          [certificateId, request.auth.userId, reason],
        );
        return rows[0];
      });
      return response.json({ certificate: result });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  return router;
}

function createQaCertificateRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('qa'));

  router.get('/eligibility', async (request, response, next) => {
    const { programmeId } = request.query;
    if (typeof programmeId !== 'string' || !uuidPattern.test(programmeId)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }
    try {
      const { rows: assignmentRows } = await database.query(
        `SELECT id FROM qa_programme_assignments
         WHERE programme_id = $1 AND qa_user_id = $2 AND status = 'ACTIVE' AND deactivated_at IS NULL`,
        [programmeId, request.auth.userId],
      );
      if (!assignmentRows[0]) return response.status(404).json({ error: 'Assigned programme not found.' });
      const configuration = await getActiveConfiguration(database, programmeId);
      if (!configuration) return response.json({ configuration: null, reviews: [] });
      const parsed = parseCriteria(configuration.criteria);
      if (parsed.error) return response.status(500).json({ error: 'The approved certificate rules are invalid.' });
      const { rows: enrolmentRows } = await database.query(
        `SELECT e.id, l.full_name AS learner_name, l.learner_reference
         FROM enrolments e JOIN learners l ON l.id = e.learner_id
         WHERE e.programme_id = $1 AND e.status = 'active' AND l.archived_at IS NULL
         ORDER BY l.full_name, e.id`,
        [programmeId],
      );
      const reviews = [];
      for (const enrolment of enrolmentRows) {
        for (const credential of parsed.value.certificates) {
          const evaluation = await evaluateCredential(database, enrolment.id, credential);
          reviews.push({
            enrolmentId: enrolment.id,
            learnerName: enrolment.learner_name,
            learnerReference: enrolment.learner_reference,
            credentialKey: credential.key,
            credentialType: credential.type,
            credentialTitle: credential.title,
            blockers: evaluation.blockers,
            latestReview: await latestQaEligibilityReview(database, enrolment.id, configuration.id, credential.key),
          });
        }
      }
      return response.json({
        configuration: { id: configuration.id, version: configuration.version },
        reviews,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/eligibility-reviews', async (request, response, next) => {
    const body = request.body;
    if (!isObject(body) || Object.keys(body).some((key) => !['enrolmentId', 'credentialKey', 'decision', 'comments'].includes(key))) {
      return response.status(400).json({ error: 'Provide only enrolmentId, credentialKey, decision, and comments.' });
    }
    if (typeof body.enrolmentId !== 'string' || !uuidPattern.test(body.enrolmentId)
      || typeof body.credentialKey !== 'string' || !credentialKeyPattern.test(body.credentialKey)
      || (body.decision !== 'APPROVED' && body.decision !== 'REJECTED')
      || typeof body.comments !== 'string' || !body.comments.trim() || body.comments.trim().length > 2000) {
      return response.status(400).json({ error: 'Provide a valid enrolment, credential key, QA decision, and 1–2,000 character comment.' });
    }
    try {
      const review = await withTransaction(database, async (client) => {
        const { rows: enrolmentRows } = await client.query(
          `SELECT e.id, e.provider_user_id, e.learner_id, e.programme_id,
             l.full_name AS learner_name, l.learner_reference, p.name AS programme_name
           FROM enrolments e
           JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
           JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
           JOIN qa_programme_assignments assignment ON assignment.programme_id = e.programme_id
             AND assignment.qa_user_id = $2 AND assignment.status = 'ACTIVE' AND assignment.deactivated_at IS NULL
           WHERE e.id = $1 AND e.status = 'active' AND l.archived_at IS NULL AND p.archived_at IS NULL
           FOR UPDATE OF e`,
          [body.enrolmentId, request.auth.userId],
        );
        const enrolment = enrolmentRows[0];
        if (!enrolment) throw new CertificateWorkflowError(404, 'Active enrolment not found within your QA assignment.');
        const configuration = await getActiveConfiguration(client, enrolment.programme_id);
        if (!configuration) throw new CertificateWorkflowError(409, 'No approved certificate rules are configured for this programme.');
        const credential = getCredential(configuration, body.credentialKey);
        if (!credential) throw new CertificateWorkflowError(404, 'Configured certificate not found.');
        const evaluation = await evaluateCredential(client, enrolment.id, credential);
        if (body.decision === 'APPROVED' && evaluation.blockers.length) {
          throw new CertificateWorkflowError(409, 'Eligibility conditions are not satisfied.', evaluation.blockers);
        }
        const { rows } = await client.query(
          `INSERT INTO certificate_eligibility_reviews (
             provider_user_id, learner_id, enrolment_id, programme_id, eligibility_configuration_id,
             credential_key, credential_type, credential_title, decision, blockers,
             criteria_snapshot, evidence_snapshot, comments, qa_user_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14)
           RETURNING *`,
          [
            enrolment.provider_user_id, enrolment.learner_id, enrolment.id, enrolment.programme_id,
            configuration.id, credential.key, credential.type, credential.title, body.decision,
            JSON.stringify(evaluation.blockers), JSON.stringify(configuration.criteria),
            JSON.stringify(evaluation.evidenceSnapshot), body.comments.trim(), request.auth.userId,
          ],
        );
        await client.query(
          `INSERT INTO certificate_events (eligibility_review_id, actor_user_id, actor_role, event_type, details)
           VALUES ($1, $2, 'qa', $3, jsonb_build_object('blockerCount', $4))`,
          [rows[0].id, request.auth.userId,
            body.decision === 'APPROVED' ? 'QA_ELIGIBILITY_APPROVED' : 'QA_ELIGIBILITY_REJECTED',
            evaluation.blockers.length],
        );
        return rows[0];
      });
      return response.status(201).json({ review });
    } catch (error) {
      return sendError(error, response, next);
    }
  });
  return router;
}

async function latestQaEligibilityReview(database, enrolmentId, configurationId, credentialKey) {
  const { rows } = await database.query(
    `SELECT id, decision, comments, reviewed_at FROM certificate_eligibility_reviews
     WHERE enrolment_id = $1 AND eligibility_configuration_id = $2 AND credential_key = $3
     ORDER BY reviewed_at DESC, id DESC LIMIT 1`,
    [enrolmentId, configurationId, credentialKey],
  );
  return rows[0] ?? null;
}

function createLearnerCertificatesRouter({ database, jwtSecret, evidenceStorage }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('learner'));

  router.get('/', async (request, response, next) => {
    try {
      const { rows } = await database.query(
        `SELECT c.id, c.credential_key, c.certificate_type, c.certificate_title,
           c.programme_id, c.programme_name, c.verification_reference, c.issued_at,
           c.issuer_name, c.issuer_title, c.status, c.revoked_at, c.file_size
         FROM certificates c
         JOIN learners l ON l.id = c.learner_id AND l.provider_user_id = c.provider_user_id
         WHERE l.learner_user_id = $1
         ORDER BY c.issued_at DESC, c.id`,
        [request.auth.userId],
      );
      return response.json({ certificates: rows.map((row) => ({ ...row, file_size: Number(row.file_size) })) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:certificateId/file', async (request, response, next) => {
    const { certificateId } = request.params;
    if (!uuidPattern.test(certificateId)) return response.status(400).json({ error: 'Certificate ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `SELECT c.storage_provider, c.storage_key, c.verification_reference
         FROM certificates c
         JOIN learners l ON l.id = c.learner_id AND l.provider_user_id = c.provider_user_id
         WHERE c.id = $1 AND l.learner_user_id = $2 AND c.status = 'ISSUED'`,
        [certificateId, request.auth.userId],
      );
      const certificate = rows[0];
      if (!certificate) return response.status(404).json({ error: 'Issued certificate not found.' });
      if (certificate.storage_provider !== evidenceStorage.provider) {
        return response.status(503).json({ error: 'This certificate is not available from the configured private storage adapter.' });
      }
      const content = await evidenceStorage.read(certificate.storage_key);
      return sendCertificateFile(response, content, `${certificate.verification_reference}.pdf`);
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

function createCertificateVerificationRouter({ database }) {
  const router = Router();
  router.get('/verify/:reference', async (request, response, next) => {
    const reference = request.params.reference;
    if (!/^CERT-\d{4}-[A-Z0-9]{12}$/.test(reference)) {
      return response.status(400).json({ error: 'Certificate reference is invalid.' });
    }
    try {
      const { rows } = await database.query(
        `SELECT verification_reference, status, certificate_type, certificate_title,
           programme_name, issued_at FROM certificates WHERE verification_reference = $1`,
        [reference],
      );
      const certificate = rows[0];
      if (!certificate) return response.status(404).json({ error: 'Certificate reference not found.' });
      return response.json({
        valid: certificate.status === 'ISSUED',
        status: certificate.status,
        verificationReference: certificate.verification_reference,
        certificateType: certificate.certificate_type,
        certificateTitle: certificate.certificate_title,
        programmeName: certificate.programme_name,
        issuedAt: certificate.issued_at,
      });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

module.exports = {
  CertificateWorkflowError,
  buildCertificatePdf,
  createCertificateAdminRouter,
  createCertificateVerificationRouter,
  createLearnerCertificatesRouter,
  createProviderCertificateRouter,
  createQaCertificateRouter,
  evaluateCredential,
  parseCriteria,
  validateDecisionBody,
};
