const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const qaDecisions = new Set(['VERIFIED', 'FURTHER_ACTION_REQUIRED', 'NOT_VERIFIED']);
const qaStatuses = new Set(['all', 'AWAITING_REVIEW', ...qaDecisions]);

class QaRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateQaReviewBody(body) {
  if (!isObject(body) || Object.keys(body).some((key) => !['decision', 'comments'].includes(key))) {
    return { error: 'Provide only decision and comments.' };
  }
  if (!qaDecisions.has(body.decision)) {
    return { error: 'Decision must be VERIFIED, FURTHER_ACTION_REQUIRED, or NOT_VERIFIED.' };
  }
  if (typeof body.comments !== 'string' || !body.comments.trim() || body.comments.trim().length > 4000) {
    return { error: 'Comments are required and must be 4,000 characters or fewer.' };
  }
  return { value: { decision: body.decision, comments: body.comments.trim() } };
}

function validateQaAssignmentBody(body) {
  if (!isObject(body) || Object.keys(body).some((key) => !['programmeId', 'qaUserId'].includes(key))) {
    return { error: 'Provide only programmeId and qaUserId.' };
  }
  if (!uuidPattern.test(body.programmeId ?? '') || !uuidPattern.test(body.qaUserId ?? '')) {
    return { error: 'Programme and QA Officer IDs must be UUIDs.' };
  }
  return { value: { programmeId: body.programmeId, qaUserId: body.qaUserId } };
}

const qaDashboardCte = `WITH latest_assessments AS (
  SELECT DISTINCT ON (s.enrolment_id, s.requirement_id)
    ar.id AS assessment_review_id, ar.decision AS assessor_decision,
    ar.feedback AS assessor_feedback, ar.reviewed_at AS assessor_reviewed_at,
    ar.assessor_user_id, assessor.full_name AS assessor_name,
    s.id AS submission_id, s.version AS submission_version, s.status AS submission_status,
    s.original_filename, s.mime_type, s.file_size, s.created_at AS submitted_at,
    s.enrolment_id, s.requirement_id,
    e.learner_id, l.full_name AS learner_name, l.learner_reference,
    p.id AS programme_id, p.name AS programme_name,
    provider.id AS provider_user_id, provider.full_name AS provider_name,
    requirement.title AS requirement_title, requirement.guidance,
    assignment.id AS assignment_id
  FROM evidence_reviews ar
  JOIN evidence_submissions s
    ON s.id = ar.evidence_submission_id AND s.version = ar.submission_version
  JOIN enrolments e ON e.id = s.enrolment_id AND e.provider_user_id = s.provider_user_id
  JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
  JOIN programmes p ON p.id = s.programme_id AND p.provider_user_id = s.provider_user_id
  JOIN users provider ON provider.id = p.provider_user_id
  JOIN users assessor ON assessor.id = ar.assessor_user_id
  JOIN programme_evidence_requirements requirement
    ON requirement.id = s.requirement_id AND requirement.programme_id = s.programme_id
  JOIN qa_programme_assignments assignment
    ON assignment.programme_id = s.programme_id AND assignment.qa_user_id = $1
    AND assignment.status = 'ACTIVE' AND assignment.deactivated_at IS NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM evidence_submissions newer
    WHERE newer.enrolment_id = s.enrolment_id
      AND newer.requirement_id = s.requirement_id AND newer.version > s.version
  )
  ORDER BY s.enrolment_id, s.requirement_id, s.version DESC, ar.reviewed_at DESC
), qa_dashboard_rows AS (
  SELECT latest_assessments.*,
    qa_review.id AS qa_review_id,
    qa_review.decision AS qa_decision,
    qa_review.comments AS qa_comments,
    qa_review.reviewed_at AS qa_reviewed_at,
    COALESCE(qa_review.decision, 'AWAITING_REVIEW') AS qa_status
  FROM latest_assessments
  LEFT JOIN qa_reviews qa_review
    ON qa_review.evidence_review_id = latest_assessments.assessment_review_id
)`;

function sendFile(response, submission, content) {
  const filename = submission.original_filename.replace(/[\r\n"]/g, '_');
  const asciiFilename = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  response.set({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Length': String(content.length),
    'Content-Type': submission.mime_type,
    'X-Content-Type-Options': 'nosniff',
  });
  return response.send(content);
}

function createQaRouter({ database, jwtSecret, evidenceStorage }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('qa'));

  router.get('/dashboard', async (request, response, next) => {
    const status = request.query.status ?? 'all';
    const search = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const programmeId = request.query.programmeId;
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (!qaStatuses.has(status)) return response.status(400).json({ error: 'Invalid QA status filter.' });
    if (search.length > 100) return response.status(400).json({ error: 'Search must be 100 characters or fewer.' });
    if (programmeId !== undefined && !uuidPattern.test(programmeId)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      return response.status(400).json({ error: 'Limit must be 1–100 and offset must be zero or greater.' });
    }

    try {
      const { rows: programmeRows } = await database.query(
        `SELECT p.id, p.name, provider.full_name AS provider_name, assignment.id AS assignment_id
         FROM qa_programme_assignments assignment
         JOIN programmes p ON p.id = assignment.programme_id AND p.archived_at IS NULL
         JOIN users provider ON provider.id = p.provider_user_id
         WHERE assignment.qa_user_id = $1 AND assignment.status = 'ACTIVE'
           AND assignment.deactivated_at IS NULL
         ORDER BY p.name, p.id`,
        [request.auth.userId],
      );

      const { rows: summaryRows } = await database.query(
        `${qaDashboardCte}
         SELECT COUNT(*)::integer AS total,
           COUNT(*) FILTER (WHERE qa_status = 'AWAITING_REVIEW')::integer AS awaiting_review,
           COUNT(*) FILTER (WHERE qa_status = 'VERIFIED')::integer AS verified,
           COUNT(*) FILTER (WHERE qa_status = 'FURTHER_ACTION_REQUIRED')::integer AS further_action_required,
           COUNT(*) FILTER (WHERE qa_status = 'NOT_VERIFIED')::integer AS not_verified
         FROM qa_dashboard_rows`,
        [request.auth.userId],
      );

      const conditions = [];
      const values = [request.auth.userId];
      if (status !== 'all') {
        values.push(status);
        conditions.push(`qa_status = $${values.length}`);
      }
      if (programmeId) {
        values.push(programmeId);
        conditions.push(`programme_id = $${values.length}`);
      }
      if (search) {
        values.push(`%${search.toLowerCase()}%`);
        conditions.push(`(lower(learner_name) LIKE $${values.length} OR lower(programme_name) LIKE $${values.length} OR lower(requirement_title) LIKE $${values.length})`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const filterValues = [...values, limit, offset];
      const { rows: reviewRows } = await database.query(
        `${qaDashboardCte}
         SELECT * FROM qa_dashboard_rows ${where}
         ORDER BY assessor_reviewed_at DESC, learner_name, requirement_title
         LIMIT $${filterValues.length - 1} OFFSET $${filterValues.length}`,
        filterValues,
      );
      const { rows: countRows } = await database.query(
        `${qaDashboardCte} SELECT COUNT(*)::integer AS total FROM qa_dashboard_rows ${where}`,
        values,
      );
      return response.json({
        programmes: programmeRows,
        summary: summaryRows[0] ?? { total: 0, awaiting_review: 0, verified: 0, further_action_required: 0, not_verified: 0 },
        reviews: reviewRows,
        total: countRows[0]?.total ?? 0,
        limit,
        offset,
        scopeConfigured: programmeRows.length > 0,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/submissions/:submissionId', async (request, response, next) => {
    const { submissionId } = request.params;
    if (!uuidPattern.test(submissionId)) return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `${qaDashboardCte}
         SELECT * FROM qa_dashboard_rows WHERE submission_id = $2 LIMIT 1`,
        [request.auth.userId, submissionId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Assigned assessment record not found.' });

      const { rows: historyRows } = await database.query(
        `SELECT ar.id AS assessment_review_id, ar.decision AS assessor_decision,
           ar.feedback AS assessor_feedback, ar.reviewed_at AS assessor_reviewed_at,
           ar.submission_version, s.id AS submission_id, s.status AS submission_status,
           s.original_filename, s.mime_type, s.file_size, s.created_at AS submitted_at,
           qa.id AS qa_review_id, qa.decision AS qa_decision, qa.comments AS qa_comments,
           qa.reviewed_at AS qa_reviewed_at
         FROM evidence_submissions target
         JOIN evidence_submissions s ON s.enrolment_id = target.enrolment_id
           AND s.requirement_id = target.requirement_id
         JOIN evidence_reviews ar ON ar.evidence_submission_id = s.id AND ar.submission_version = s.version
         LEFT JOIN qa_reviews qa ON qa.evidence_review_id = ar.id
         WHERE target.id = $1 AND EXISTS (
           SELECT 1 FROM qa_programme_assignments assignment
           WHERE assignment.programme_id = target.programme_id
             AND assignment.qa_user_id = $2 AND assignment.status = 'ACTIVE'
             AND assignment.deactivated_at IS NULL
         )
         ORDER BY s.version DESC, ar.reviewed_at DESC`,
        [submissionId, request.auth.userId],
      );
      return response.json({ submission: rows[0], history: historyRows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/submissions/:submissionId/file', async (request, response, next) => {
    const { submissionId } = request.params;
    if (!uuidPattern.test(submissionId)) return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `SELECT s.storage_key, s.storage_provider, s.original_filename, s.mime_type
         FROM evidence_submissions s
         WHERE s.id = $1 AND EXISTS (
           SELECT 1 FROM evidence_reviews ar WHERE ar.evidence_submission_id = s.id
         ) AND EXISTS (
           SELECT 1 FROM qa_programme_assignments assignment
           WHERE assignment.programme_id = s.programme_id AND assignment.qa_user_id = $2
             AND assignment.status = 'ACTIVE' AND assignment.deactivated_at IS NULL
         )`,
        [submissionId, request.auth.userId],
      );
      const submission = rows[0];
      if (!submission) return response.status(404).json({ error: 'Assigned evidence file not found.' });
      if (submission.storage_provider !== evidenceStorage.provider) {
        return response.status(503).json({ error: 'This evidence file is not available from the configured storage adapter.' });
      }
      return sendFile(response, submission, await evidenceStorage.read(submission.storage_key));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/submissions/:submissionId/reviews', async (request, response, next) => {
    const { submissionId } = request.params;
    if (!uuidPattern.test(submissionId)) return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    const validated = validateQaReviewBody(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });

    let client;
    let transactionStarted = false;
    try {
      client = await database.connect();
      await client.query('BEGIN');
      transactionStarted = true;
      const { rows } = await client.query(
        `SELECT s.id AS submission_id, s.version, s.enrolment_id, s.requirement_id,
           s.programme_id, ar.id AS assessment_review_id, assignment.id AS assignment_id
         FROM evidence_submissions s
         JOIN evidence_reviews ar ON ar.evidence_submission_id = s.id AND ar.submission_version = s.version
         JOIN qa_programme_assignments assignment ON assignment.programme_id = s.programme_id
           AND assignment.qa_user_id = $2 AND assignment.status = 'ACTIVE'
           AND assignment.deactivated_at IS NULL
         WHERE s.id = $1 AND s.version = (
           SELECT MAX(latest.version) FROM evidence_submissions latest
           WHERE latest.enrolment_id = s.enrolment_id AND latest.requirement_id = s.requirement_id
         )
         FOR UPDATE OF s, assignment`,
        [submissionId, request.auth.userId],
      );
      const assessment = rows[0];
      if (!assessment) {
        throw new QaRequestError(404, 'Latest assigned assessor review not found.');
      }
      const { rows: existingRows } = await client.query(
        'SELECT id FROM qa_reviews WHERE evidence_review_id = $1',
        [assessment.assessment_review_id],
      );
      if (existingRows[0]) throw new QaRequestError(409, 'This assessment version already has an immutable QA outcome.');
      const { rows: reviewRows } = await client.query(
        `INSERT INTO qa_reviews (
           id, evidence_review_id, evidence_submission_id, submission_version,
           programme_id, assignment_id, qa_user_id, decision, comments
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, evidence_review_id, evidence_submission_id, submission_version,
           programme_id, assignment_id, qa_user_id, decision, comments, reviewed_at`,
        [
          randomUUID(), assessment.assessment_review_id, assessment.submission_id,
          assessment.version, assessment.programme_id, assessment.assignment_id,
          request.auth.userId, validated.value.decision, validated.value.comments,
        ],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return response.status(201).json({ qaReview: reviewRows[0] });
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('QA review rollback failed:', rollbackError.code || rollbackError.name);
        }
      }
      if (error instanceof QaRequestError) {
        return response.status(error.status).json({ error: error.message });
      }
      if (error.code === '23505') {
        return response.status(409).json({ error: 'This assessor review already has an immutable QA outcome.' });
      }
      return next(error);
    } finally {
      client?.release();
    }
  });

  return router;
}

function createQaAdminRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('admin'));

  router.get('/qa-officers', async (_request, response, next) => {
    try {
      const { rows } = await database.query(
        `SELECT id, full_name, email FROM users
         WHERE role = 'qa' AND is_active = TRUE ORDER BY full_name, email`,
      );
      return response.json({ qaOfficers: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/qa-assignments', async (_request, response, next) => {
    try {
      const { rows } = await database.query(
        `SELECT assignment.id, assignment.programme_id, programme.name AS programme_name,
           provider.full_name AS provider_name, assignment.qa_user_id,
           qa.full_name AS qa_name, qa.email AS qa_email, assignment.assigned_by,
           administrator.full_name AS assigned_by_name, assignment.status,
           assignment.created_at, assignment.updated_at, assignment.deactivated_at
         FROM qa_programme_assignments assignment
         JOIN programmes programme ON programme.id = assignment.programme_id
         JOIN users provider ON provider.id = programme.provider_user_id
         JOIN users qa ON qa.id = assignment.qa_user_id
         JOIN users administrator ON administrator.id = assignment.assigned_by
         ORDER BY assignment.created_at DESC, assignment.id`,
      );
      return response.json({ assignments: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/qa-assignments', async (request, response, next) => {
    const validated = validateQaAssignmentBody(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });
    try {
      const { rows } = await database.query(
        `INSERT INTO qa_programme_assignments (
           programme_id, qa_user_id, assigned_by, updated_by
         )
         SELECT programme.id, qa.id, $3, $3
         FROM programmes programme
         JOIN users qa ON qa.id = $2 AND qa.role = 'qa' AND qa.is_active = TRUE
         WHERE programme.id = $1 AND programme.archived_at IS NULL
         RETURNING id, programme_id, qa_user_id, assigned_by, status,
           created_at, updated_at, deactivated_at`,
        [validated.value.programmeId, validated.value.qaUserId, request.auth.userId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Active programme or QA Officer not found.' });
      return response.status(201).json({ assignment: rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return response.status(409).json({ error: 'This QA Officer already has active access to the programme.', code: 'ACTIVE_QA_ASSIGNMENT_EXISTS' });
      }
      return next(error);
    }
  });

  router.patch('/qa-assignments/:assignmentId', async (request, response, next) => {
    const { assignmentId } = request.params;
    if (!uuidPattern.test(assignmentId)) return response.status(400).json({ error: 'Assignment ID must be a UUID.' });
    if (!isObject(request.body) || Object.keys(request.body).length !== 1
      || !['ACTIVE', 'INACTIVE'].includes(request.body.status)) {
      return response.status(400).json({ error: 'Provide only an ACTIVE or INACTIVE status.' });
    }
    try {
      const { rows } = await database.query(
        `UPDATE qa_programme_assignments
         SET status = $1, updated_by = $3,
           deactivated_at = CASE WHEN $1 = 'INACTIVE' THEN COALESCE(deactivated_at, NOW()) ELSE NULL END,
           updated_at = NOW()
         WHERE id = $2
         RETURNING id, programme_id, qa_user_id, assigned_by, status, created_at, updated_at, deactivated_at`,
        [request.body.status, assignmentId, request.auth.userId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'QA assignment not found.' });
      return response.json({ assignment: rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return response.status(409).json({ error: 'This QA Officer already has active access to the programme.', code: 'ACTIVE_QA_ASSIGNMENT_EXISTS' });
      }
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createQaAdminRouter,
  createQaRouter,
  qaDashboardCte,
  qaDecisions,
  validateQaAssignmentBody,
  validateQaReviewBody,
};
