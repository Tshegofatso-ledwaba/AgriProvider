const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { Router } = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('./middleware/authenticate');
const { createLocalEvidenceStorage } = require('./storage/local-evidence-storage');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxFileSize = 5 * 1024 * 1024;
const publicColumns = `id, programme_id, enrolment_id, requirement_id, submitted_by,
  original_filename, mime_type, file_size, status, version, created_at, updated_at`;

class EvidenceRequestError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function detectMimeType(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function validateEvidenceFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    return { error: 'Select a non-empty PDF, JPEG, or PNG file.' };
  }
  if (file.buffer.length > maxFileSize) {
    return { error: 'Evidence files must be 5 MB or smaller.' };
  }

  const mimeType = detectMimeType(file.buffer);
  if (!mimeType || (file.mimetype !== mimeType && file.mimetype !== 'application/octet-stream')) {
    return { error: 'File content must match a supported PDF, JPEG, or PNG type.' };
  }

  const originalFilename = path.posix
    .basename(String(file.originalname ?? '').replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!originalFilename || originalFilename.length > 255) {
    return { error: 'The original filename must be between 1 and 255 characters.' };
  }

  const extension = path.posix.extname(originalFilename).toLowerCase();
  const validExtensions = {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
  };
  if (!validExtensions[mimeType].includes(extension)) {
    return { error: 'The filename extension must match the detected file type.' };
  }

  return {
    value: {
      originalFilename,
      mimeType,
      fileSize: file.buffer.length,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      buffer: file.buffer,
    },
  };
}

function publicSubmission(row) {
  return {
    id: row.id,
    programme_id: row.programme_id,
    enrolment_id: row.enrolment_id,
    requirement_id: row.requirement_id,
    submitted_by: row.submitted_by,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    file_size: Number(row.file_size),
    status: row.status,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createEvidenceSubmissionsRouter({ database, jwtSecret, evidenceStorage = createLocalEvidenceStorage() }) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize, files: 1, fields: 0, parts: 1 },
  });
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  function parseUpload(request, response, next) {
    upload.single('file')(request, response, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return response.status(413).json({ error: 'Evidence files must be 5 MB or smaller.' });
      }
      if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.code === 'LIMIT_FIELD_COUNT'
        || error.code === 'LIMIT_PART_COUNT') {
        return response.status(400).json({ error: 'Upload one file using the file field only.' });
      }
      return next(error);
    });
  }

  router.post(
    '/enrolments/:enrolmentId/evidence-requirements/:requirementId/submissions',
    parseUpload,
    async (request, response, next) => {
      const { enrolmentId, requirementId } = request.params;
      if (!uuidPattern.test(enrolmentId) || !uuidPattern.test(requirementId)) {
        return response.status(400).json({ error: 'Enrolment and checklist IDs must be UUIDs.' });
      }
      const validated = validateEvidenceFile(request.file);
      if (validated.error) {
        return response.status(400).json({ error: validated.error });
      }

      let client;
      let transactionStarted = false;
      let storedKey;
      try {
        client = await database.connect();
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${enrolmentId}:${requirementId}`],
        );

        const { rows: scopeRows } = await client.query(
          `SELECT e.id AS enrolment_id, e.provider_user_id, e.programme_id, r.id AS requirement_id
           FROM enrolments e
           JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
           JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
           JOIN programme_evidence_requirements r
             ON r.provider_user_id = e.provider_user_id AND r.programme_id = e.programme_id
           WHERE e.id = $1 AND e.provider_user_id = $2 AND e.status = 'active'
             AND l.archived_at IS NULL AND p.archived_at IS NULL
             AND r.id = $3 AND r.archived_at IS NULL
           FOR UPDATE OF e, r`,
          [enrolmentId, request.auth.userId, requirementId],
        );
        if (!scopeRows[0]) {
          throw new EvidenceRequestError(404, 'Active enrolment or checklist item not found.');
        }

        const scope = scopeRows[0];
        const { rows: previousRows } = await client.query(
          `SELECT id, status, version, sha256
           FROM evidence_submissions
           WHERE provider_user_id = $1 AND enrolment_id = $2 AND requirement_id = $3
           ORDER BY version DESC
           LIMIT 1`,
          [request.auth.userId, enrolmentId, requirementId],
        );
        const previous = previousRows[0];
        if (previous?.sha256 === validated.value.sha256) {
          throw new EvidenceRequestError(409, 'This file is already the latest submission.', 'DUPLICATE_SUBMISSION');
        }
        if (previous && previous.status !== 'CORRECTION_REQUIRED') {
          const code = previous.status === 'APPROVED' ? 'EVIDENCE_APPROVED' : 'EVIDENCE_STATUS_LOCKED';
          throw new EvidenceRequestError(409, 'A revised version can only be submitted after corrections are requested.', code);
        }

        storedKey = await evidenceStorage.save(validated.value.buffer);
        const { rows } = await client.query(
          `INSERT INTO evidence_submissions (
             id, provider_user_id, programme_id, enrolment_id, requirement_id, submitted_by,
             original_filename, mime_type, file_size, sha256, storage_provider, storage_key,
             status, version
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'SUBMITTED', $13)
           RETURNING ${publicColumns}`,
          [
            randomUUID(),
            request.auth.userId,
            scope.programme_id,
            enrolmentId,
            requirementId,
            request.auth.userId,
            validated.value.originalFilename,
            validated.value.mimeType,
            validated.value.fileSize,
            validated.value.sha256,
            evidenceStorage.provider,
            storedKey,
            (previous?.version ?? 0) + 1,
          ],
        );
        await client.query('COMMIT');
        transactionStarted = false;
        storedKey = null;
        return response.status(201).json({ submission: publicSubmission(rows[0]) });
      } catch (error) {
        if (transactionStarted) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            console.error('Evidence submission rollback failed:', rollbackError.code || rollbackError.name);
          }
        }
        if (storedKey) {
          try {
            await evidenceStorage.delete(storedKey);
          } catch (cleanupError) {
            console.error('Failed evidence submission cleanup:', cleanupError.code || cleanupError.name);
          }
        }
        if (error instanceof EvidenceRequestError) {
          const body = { error: error.message };
          if (error.code) body.code = error.code;
          return response.status(error.status).json(body);
        }
        return next(error);
      } finally {
        client?.release();
      }
    },
  );

  router.get('/enrolments/:enrolmentId/evidence-submissions', async (request, response, next) => {
    const { enrolmentId } = request.params;
    if (!uuidPattern.test(enrolmentId)) {
      return response.status(400).json({ error: 'Enrolment ID must be a UUID.' });
    }

    try {
      const { rows: enrolments } = await database.query(
        `SELECT id FROM enrolments
         WHERE id = $1 AND provider_user_id = $2`,
        [enrolmentId, request.auth.userId],
      );
      if (!enrolments[0]) return response.status(404).json({ error: 'Enrolment not found.' });

      const { rows } = await database.query(
        `SELECT r.id AS requirement_id, r.title AS requirement_title, r.guidance,
           s.id AS submission_id, s.programme_id, s.enrolment_id, s.requirement_id AS submission_requirement_id,
           s.submitted_by, s.original_filename, s.mime_type, s.file_size,
           s.status, s.version, s.created_at AS submitted_at, s.updated_at AS submission_updated_at,
           review.id AS review_id, review.submission_version,
           review.assessor_name, review.decision AS review_decision,
           review.feedback AS review_feedback, review.reviewed_at
         FROM enrolments e
         JOIN programme_evidence_requirements r
           ON r.provider_user_id = e.provider_user_id AND r.programme_id = e.programme_id
           AND r.archived_at IS NULL
         LEFT JOIN LATERAL (
           SELECT latest.*
           FROM evidence_submissions latest
           WHERE latest.provider_user_id = e.provider_user_id
             AND latest.enrolment_id = e.id AND latest.requirement_id = r.id
           ORDER BY latest.version DESC
           LIMIT 1
         ) s ON true
         LEFT JOIN LATERAL (
           SELECT r.id, r.submission_version, assessor.full_name AS assessor_name,
             r.decision, r.feedback, r.reviewed_at
           FROM evidence_reviews r
           JOIN users assessor ON assessor.id = r.assessor_user_id
           WHERE r.evidence_submission_id = s.id AND r.submission_version = s.version
           ORDER BY r.reviewed_at DESC
           LIMIT 1
         ) review ON true
         WHERE e.id = $1 AND e.provider_user_id = $2
         ORDER BY r.created_at, r.id`,
        [enrolmentId, request.auth.userId],
      );
      const requirements = rows.map((row) => ({
        requirement_id: row.requirement_id,
        requirement_title: row.requirement_title,
        guidance: row.guidance,
        status: row.status ?? 'NOT_SUBMITTED',
        latest_submission: row.submission_id ? {
          id: row.submission_id,
          programme_id: row.programme_id,
          enrolment_id: row.enrolment_id,
          requirement_id: row.submission_requirement_id,
          submitted_by: row.submitted_by,
          original_filename: row.original_filename,
          mime_type: row.mime_type,
          file_size: Number(row.file_size),
          status: row.status,
          version: row.version,
          created_at: row.submitted_at,
          updated_at: row.submission_updated_at,
          latest_review: row.review_id ? {
            id: row.review_id,
            submission_version: row.submission_version,
            assessor_name: row.assessor_name,
            decision: row.review_decision,
            feedback: row.review_feedback,
            reviewed_at: row.reviewed_at,
          } : null,
        } : null,
      }));
      const completion = {
        total_required: requirements.length,
        not_submitted: requirements.filter((item) => item.status === 'NOT_SUBMITTED').length,
        submitted: requirements.filter((item) => item.status === 'SUBMITTED').length,
        awaiting_review: requirements.filter((item) => item.status === 'UNDER_REVIEW').length,
        approved: requirements.filter((item) => item.status === 'APPROVED').length,
        correction_required: requirements.filter((item) => item.status === 'CORRECTION_REQUIRED').length,
      };
      return response.json({ requirements, completion });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/evidence-submissions/:submissionId', async (request, response, next) => {
    if (!uuidPattern.test(request.params.submissionId)) {
      return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    }
    try {
      const { rows } = await database.query(
        `SELECT ${publicColumns}
         FROM evidence_submissions
         WHERE id = $1 AND provider_user_id = $2`,
        [request.params.submissionId, request.auth.userId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Submission not found.' });
      return response.json({ submission: publicSubmission(rows[0]) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/evidence-submissions/:submissionId/history', async (request, response, next) => {
    if (!uuidPattern.test(request.params.submissionId)) {
      return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    }
    try {
      const { rows: targetRows } = await database.query(
        `SELECT enrolment_id, requirement_id
         FROM evidence_submissions
         WHERE id = $1 AND provider_user_id = $2`,
        [request.params.submissionId, request.auth.userId],
      );
      if (!targetRows[0]) return response.status(404).json({ error: 'Submission not found.' });
      const { rows } = await database.query(
        `SELECT ${publicColumns}
         FROM evidence_submissions
         WHERE provider_user_id = $1 AND enrolment_id = $2 AND requirement_id = $3
         ORDER BY version DESC`,
        [request.auth.userId, targetRows[0].enrolment_id, targetRows[0].requirement_id],
      );
      const { rows: reviewRows } = await database.query(
        `SELECT r.id, r.evidence_submission_id, r.submission_version,
           r.assessor_user_id, assessor.full_name AS assessor_name,
           r.decision, r.feedback, r.reviewed_at
         FROM evidence_reviews r
         JOIN evidence_submissions s ON s.id = r.evidence_submission_id
         JOIN users assessor ON assessor.id = r.assessor_user_id
         WHERE s.provider_user_id = $1 AND s.enrolment_id = $2 AND s.requirement_id = $3
         ORDER BY r.submission_version DESC, r.reviewed_at DESC`,
        [request.auth.userId, targetRows[0].enrolment_id, targetRows[0].requirement_id],
      );
      return response.json({
        submissions: rows.map(publicSubmission),
        reviews: reviewRows.map((row) => ({
          id: row.id,
          evidence_submission_id: row.evidence_submission_id,
          submission_version: row.submission_version,
          assessor_user_id: row.assessor_user_id,
          assessor_name: row.assessor_name,
          decision: row.decision,
          feedback: row.feedback,
          reviewed_at: row.reviewed_at,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/evidence-submissions/:submissionId', async (request, response, next) => {
    const { submissionId } = request.params;
    if (!uuidPattern.test(submissionId)) {
      return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    }

    let client;
    let transactionStarted = false;
    try {
      client = await database.connect();
      await client.query('BEGIN');
      transactionStarted = true;
      const { rows: targetRows } = await client.query(
        `SELECT id, enrolment_id, requirement_id, status, storage_provider, storage_key
         FROM evidence_submissions
         WHERE id = $1 AND provider_user_id = $2
         FOR UPDATE`,
        [submissionId, request.auth.userId],
      );
      const target = targetRows[0];
      if (!target) {
        throw new EvidenceRequestError(404, 'Submission not found.');
      }

      const { rows: latestRows } = await client.query(
        `SELECT id, status
         FROM evidence_submissions
         WHERE provider_user_id = $1 AND enrolment_id = $2 AND requirement_id = $3
         ORDER BY version DESC
         LIMIT 1
         FOR UPDATE`,
        [request.auth.userId, target.enrolment_id, target.requirement_id],
      );
      const latest = latestRows[0];
      if (latest?.id !== target.id) {
        throw new EvidenceRequestError(409, 'Only the latest evidence submission can be deleted.', 'EVIDENCE_NOT_LATEST');
      }
      if (target.status !== 'SUBMITTED') {
        const code = target.status === 'APPROVED' ? 'EVIDENCE_APPROVED' : 'EVIDENCE_NOT_DELETABLE';
        throw new EvidenceRequestError(409, 'Only unreviewed submitted evidence can be deleted.', code);
      }
      if (target.storage_provider !== evidenceStorage.provider) {
        throw new EvidenceRequestError(503, 'This evidence file is not available from the configured storage adapter.');
      }

      await client.query(
        'DELETE FROM evidence_submissions WHERE id = $1 AND provider_user_id = $2',
        [submissionId, request.auth.userId],
      );
      await evidenceStorage.delete(target.storage_key);
      await client.query('COMMIT');
      transactionStarted = false;
      return response.json({ message: 'Evidence submission deleted.' });
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Evidence deletion rollback failed:', rollbackError.code || rollbackError.name);
        }
      }
      if (error instanceof EvidenceRequestError) {
        const body = { error: error.message };
        if (error.code) body.code = error.code;
        return response.status(error.status).json(body);
      }
      return next(error);
    } finally {
      client?.release();
    }
  });

  router.get('/evidence-submissions/:submissionId/file', async (request, response, next) => {
    if (!uuidPattern.test(request.params.submissionId)) {
      return response.status(400).json({ error: 'Submission ID must be a UUID.' });
    }
    try {
      const { rows } = await database.query(
        `SELECT storage_key, storage_provider, original_filename, mime_type, file_size
         FROM evidence_submissions
         WHERE id = $1 AND provider_user_id = $2`,
        [request.params.submissionId, request.auth.userId],
      );
      const submission = rows[0];
      if (!submission) return response.status(404).json({ error: 'Submission not found.' });
      if (submission.storage_provider !== evidenceStorage.provider) {
        return response.status(503).json({ error: 'This evidence file is not available from the configured storage adapter.' });
      }
      const content = await evidenceStorage.read(submission.storage_key);
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
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createEvidenceSubmissionsRouter,
  detectMimeType,
  maxFileSize,
  publicSubmission,
  validateEvidenceFile,
};
