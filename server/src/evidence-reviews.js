const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decisions = new Set(['APPROVED', 'CORRECTION_REQUESTED']);

class ReviewRequestError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateReviewBody(body) {
  if (!isObject(body) || Object.keys(body).some((key) => !['decision', 'feedback'].includes(key))) {
    return { error: 'Provide only decision and feedback.' };
  }
  if (!decisions.has(body.decision)) {
    return { error: 'Decision must be APPROVED or CORRECTION_REQUESTED.' };
  }
  if (body.feedback !== undefined && body.feedback !== null && typeof body.feedback !== 'string') {
    return { error: 'Feedback must be text.' };
  }
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : null;
  if (body.decision === 'CORRECTION_REQUESTED' && !feedback) {
    return { error: 'Feedback is required when requesting corrections.' };
  }
  if (feedback && feedback.length > 2000) {
    return { error: 'Feedback must be 2000 characters or fewer.' };
  }
  return { value: { decision: body.decision, feedback } };
}

function publicReview(row) {
  return {
    id: row.id,
    evidence_submission_id: row.evidence_submission_id,
    submission_version: row.submission_version,
    assessor_user_id: row.assessor_user_id,
    assessor_name: row.assessor_name,
    decision: row.decision,
    feedback: row.feedback,
    reviewed_at: row.reviewed_at,
  };
}

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

function createEvidenceReviewsRouter({ database, jwtSecret, evidenceStorage }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('assessor'));

  router.get('/programmes', async (request, response, next) => {
    try {
      const { rows } = await database.query(
        `SELECT p.id, p.name, a.id AS assignment_id,
           COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'active')::integer AS learner_count,
           COUNT(DISTINCT latest.id) FILTER (WHERE latest.status = 'SUBMITTED')::integer AS pending_reviews,
           COUNT(DISTINCT latest.id) FILTER (WHERE latest.status = 'APPROVED')::integer AS approved_count,
           COUNT(DISTINCT latest.id) FILTER (WHERE latest.status = 'CORRECTION_REQUIRED')::integer AS correction_count
         FROM programme_assessor_assignments a
         JOIN programmes p ON p.id = a.programme_id AND p.archived_at IS NULL
         LEFT JOIN enrolments e ON e.programme_id = p.id
         LEFT JOIN LATERAL (
           SELECT DISTINCT ON (s.enrolment_id, s.requirement_id) s.id, s.status
           FROM evidence_submissions s
           WHERE s.programme_id = p.id
           ORDER BY s.enrolment_id, s.requirement_id, s.version DESC
         ) latest ON TRUE
         WHERE a.assessor_user_id = $1 AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
         GROUP BY p.id, a.id
         ORDER BY p.name, p.id`,
        [request.auth.userId],
      );
      return response.json({ programmes: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/programmes/:programmeId/learners', async (request, response, next) => {
    const { programmeId } = request.params;
    if (!uuidPattern.test(programmeId)) return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `SELECT e.id AS enrolment_id, e.status AS enrolment_status, e.created_at AS enrolled_at,
           l.id AS learner_id, l.learner_reference, l.full_name
         FROM programme_assessor_assignments a
         JOIN programmes p ON p.id = a.programme_id AND p.archived_at IS NULL
         JOIN enrolments e ON e.programme_id = p.id AND e.status = 'active'
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
           AND l.archived_at IS NULL
         WHERE p.id = $1 AND a.assessor_user_id = $2
           AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
         ORDER BY l.full_name, l.id`,
        [programmeId, request.auth.userId],
      );
      if (!rows.length) {
        const { rows: accessRows } = await database.query(
          `SELECT a.id
           FROM programme_assessor_assignments a
           JOIN programmes p ON p.id = a.programme_id AND p.archived_at IS NULL
           WHERE p.id = $1 AND a.assessor_user_id = $2
             AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL`,
          [programmeId, request.auth.userId],
        );
        if (!accessRows[0]) return response.status(404).json({ error: 'Assigned programme not found.' });
      }
      return response.json({ learners: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/programmes/:programmeId/submissions', async (request, response, next) => {
    const { programmeId } = request.params;
    const status = request.query.status ?? 'all';
    if (!uuidPattern.test(programmeId)) return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    if (!['all', 'SUBMITTED', 'APPROVED', 'CORRECTION_REQUIRED', 'UNDER_REVIEW'].includes(status)) {
      return response.status(400).json({ error: 'Invalid evidence status filter.' });
    }
    try {
      const { rows } = await database.query(
        `WITH latest AS (
           SELECT DISTINCT ON (s.enrolment_id, s.requirement_id) s.*
           FROM evidence_submissions s
           WHERE s.programme_id = $1
           ORDER BY s.enrolment_id, s.requirement_id, s.version DESC
         )
         SELECT s.id, s.programme_id, s.enrolment_id, s.requirement_id,
           s.original_filename, s.mime_type, s.file_size, s.status, s.version,
           s.created_at, l.id AS learner_id, l.learner_reference, l.full_name AS learner_name,
           p.name AS programme_name, r.title AS requirement_title
         FROM latest s
         JOIN enrolments e ON e.id = s.enrolment_id AND e.provider_user_id = s.provider_user_id
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
         JOIN programmes p ON p.id = s.programme_id
         JOIN programme_evidence_requirements r ON r.id = s.requirement_id AND r.programme_id = s.programme_id
         WHERE p.id = $1 AND ($3 = 'all' OR s.status = $3)
           AND EXISTS (
             SELECT 1 FROM programme_assessor_assignments a
             WHERE a.programme_id = p.id AND a.assessor_user_id = $2
               AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
           )
         ORDER BY s.created_at DESC, l.full_name, r.title`,
        [programmeId, request.auth.userId, status],
      );
      if (!rows.length) {
        const { rows: accessRows } = await database.query(
          `SELECT a.id FROM programme_assessor_assignments a
           JOIN programmes p ON p.id = a.programme_id AND p.archived_at IS NULL
           WHERE a.programme_id = $1 AND a.assessor_user_id = $2
             AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL`,
          [programmeId, request.auth.userId],
        );
        if (!accessRows[0]) return response.status(404).json({ error: 'Assigned programme not found.' });
      }
      return response.json({ submissions: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/submissions/:submissionId', async (request, response, next) => {
    const { submissionId } = request.params;
    if (!uuidPattern.test(submissionId)) return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `SELECT s.id, s.programme_id, s.enrolment_id, s.requirement_id, s.submitted_by,
           s.original_filename, s.mime_type, s.file_size, s.status, s.version,
           s.created_at, l.id AS learner_id, l.learner_reference, l.full_name AS learner_name,
           p.name AS programme_name, r.title AS requirement_title, r.guidance
         FROM evidence_submissions s
         JOIN enrolments e ON e.id = s.enrolment_id AND e.provider_user_id = s.provider_user_id
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
         JOIN programmes p ON p.id = s.programme_id
         JOIN programme_evidence_requirements r ON r.id = s.requirement_id AND r.programme_id = s.programme_id
         WHERE s.id = $1 AND EXISTS (
           SELECT 1 FROM programme_assessor_assignments a
           WHERE a.programme_id = s.programme_id AND a.assessor_user_id = $2
             AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
         )`,
        [submissionId, request.auth.userId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Assigned submission not found.' });
      return response.json({ submission: rows[0] });
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
           SELECT 1 FROM programme_assessor_assignments a
           WHERE a.programme_id = s.programme_id AND a.assessor_user_id = $2
             AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
         )`,
        [submissionId, request.auth.userId],
      );
      const submission = rows[0];
      if (!submission) return response.status(404).json({ error: 'Assigned submission not found.' });
      if (submission.storage_provider !== evidenceStorage.provider) {
        return response.status(503).json({ error: 'This evidence file is not available from the configured storage adapter.' });
      }
      return sendFile(response, submission, await evidenceStorage.read(submission.storage_key));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/submissions/:submissionId/history', async (request, response, next) => {
    const { submissionId } = request.params;
    if (!uuidPattern.test(submissionId)) return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `SELECT version.id, version.programme_id, version.enrolment_id, version.requirement_id,
           version.original_filename, version.mime_type, version.file_size,
           version.status, version.version, version.created_at
         FROM evidence_submissions target
         JOIN evidence_submissions version
           ON version.provider_user_id = target.provider_user_id
           AND version.enrolment_id = target.enrolment_id
           AND version.requirement_id = target.requirement_id
         WHERE target.id = $1 AND EXISTS (
           SELECT 1 FROM programme_assessor_assignments a
           WHERE a.programme_id = target.programme_id AND a.assessor_user_id = $2
             AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
         )
         ORDER BY version.version DESC`,
        [submissionId, request.auth.userId],
      );
      if (!rows.length) return response.status(404).json({ error: 'Assigned submission not found.' });
      return response.json({ submissions: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/submissions/:submissionId/reviews', async (request, response, next) => {
    const { submissionId } = request.params;
    if (!uuidPattern.test(submissionId)) return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `SELECT r.id, r.evidence_submission_id, r.submission_version,
           r.assessor_user_id, assessor.full_name AS assessor_name,
           r.decision, r.feedback, r.reviewed_at
         FROM evidence_reviews r
         JOIN users assessor ON assessor.id = r.assessor_user_id
         JOIN evidence_submissions reviewed ON reviewed.id = r.evidence_submission_id
         JOIN evidence_submissions target ON target.id = $1
           AND target.enrolment_id = reviewed.enrolment_id
           AND target.requirement_id = reviewed.requirement_id
         WHERE EXISTS (
           SELECT 1 FROM programme_assessor_assignments a
           WHERE a.programme_id = target.programme_id AND a.assessor_user_id = $2
             AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
         )
         ORDER BY r.submission_version DESC, r.reviewed_at DESC`,
        [submissionId, request.auth.userId],
      );
      const { rows: accessRows } = await database.query(
        `SELECT s.id FROM evidence_submissions s
         WHERE s.id = $1 AND EXISTS (
           SELECT 1 FROM programme_assessor_assignments a
           WHERE a.programme_id = s.programme_id AND a.assessor_user_id = $2
             AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
         )`,
        [submissionId, request.auth.userId],
      );
      if (!accessRows[0]) return response.status(404).json({ error: 'Assigned submission not found.' });
      return response.json({ reviews: rows.map(publicReview) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/submissions/:submissionId/reviews', async (request, response, next) => {
    const { submissionId } = request.params;
    if (!uuidPattern.test(submissionId)) return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    const validated = validateReviewBody(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });

    let client;
    let transactionStarted = false;
    try {
      client = await database.connect();
      await client.query('BEGIN');
      transactionStarted = true;
      const { rows: identityRows } = await client.query(
        `SELECT enrolment_id, requirement_id
         FROM evidence_submissions WHERE id = $1`,
        [submissionId],
      );
      if (!identityRows[0]) throw new ReviewRequestError(404, 'Assigned submission not found.');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${identityRows[0].enrolment_id}:${identityRows[0].requirement_id}`],
      );

      const { rows: scopeRows } = await client.query(
        `SELECT s.id, s.programme_id, s.enrolment_id, s.requirement_id, s.status, s.version,
           a.id AS assignment_id
         FROM evidence_submissions s
         JOIN programme_assessor_assignments a ON a.programme_id = s.programme_id
           AND a.assessor_user_id = $2 AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
         WHERE s.id = $1
         FOR UPDATE OF s, a`,
        [submissionId, request.auth.userId],
      );
      const scope = scopeRows[0];
      if (!scope) throw new ReviewRequestError(404, 'Assigned submission not found.');

      const { rows: latestRows } = await client.query(
        `SELECT id, status FROM evidence_submissions
         WHERE enrolment_id = $1 AND requirement_id = $2
         ORDER BY version DESC LIMIT 1`,
        [scope.enrolment_id, scope.requirement_id],
      );
      if (latestRows[0]?.id !== scope.id) {
        throw new ReviewRequestError(409, 'Only the latest evidence version can be reviewed.', 'STALE_SUBMISSION');
      }
      if (scope.status !== 'SUBMITTED') {
        throw new ReviewRequestError(409, 'Only submitted evidence can be reviewed.', 'SUBMISSION_NOT_REVIEWABLE');
      }

      const { rows: reviewRows } = await client.query(
        `INSERT INTO evidence_reviews (
           id, evidence_submission_id, submission_version, programme_id,
           assignment_id, assessor_user_id, decision, feedback
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, evidence_submission_id, submission_version,
           assessor_user_id, decision, feedback, reviewed_at`,
        [
          randomUUID(),
          scope.id,
          scope.version,
          scope.programme_id,
          scope.assignment_id,
          request.auth.userId,
          validated.value.decision,
          validated.value.feedback,
        ],
      );
      const updatedStatus = validated.value.decision === 'APPROVED' ? 'APPROVED' : 'CORRECTION_REQUIRED';
      const { rows: updatedRows } = await client.query(
        `UPDATE evidence_submissions SET status = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'SUBMITTED' RETURNING id`,
        [updatedStatus, scope.id],
      );
      if (!updatedRows[0]) {
        throw new ReviewRequestError(409, 'Evidence has already been reviewed.', 'SUBMISSION_NOT_REVIEWABLE');
      }
      await client.query('COMMIT');
      transactionStarted = false;
      return response.status(201).json({
        review: { ...reviewRows[0], assessor_name: request.user.fullName },
        submission_status: updatedStatus,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Evidence review rollback failed:', rollbackError.code || rollbackError.name);
        }
      }
      if (error instanceof ReviewRequestError) {
        const body = { error: error.message };
        if (error.code) body.code = error.code;
        return response.status(error.status).json(body);
      }
      if (error.code === '23505') {
        return response.status(409).json({ error: 'This evidence version has already been reviewed.' });
      }
      return next(error);
    } finally {
      client?.release();
    }
  });

  return router;
}

module.exports = { createEvidenceReviewsRouter, publicReview, validateReviewBody };