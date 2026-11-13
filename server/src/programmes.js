const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedFields = new Set(['name', 'description']);
const programmeColumns = 'id, name, description, created_at, updated_at';
const programmeProgressQuery = `WITH programme_scope AS (
  SELECT id, provider_user_id
  FROM programmes
  WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL
), active_enrolments AS (
  SELECT e.id, e.provider_user_id, e.programme_id
  FROM enrolments e
  JOIN programme_scope p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
  WHERE e.status = 'active'
), active_requirements AS (
  SELECT r.id, r.provider_user_id, r.programme_id
  FROM programme_evidence_requirements r
  JOIN programme_scope p ON p.id = r.programme_id AND p.provider_user_id = r.provider_user_id
  WHERE r.archived_at IS NULL
), latest_submissions AS (
  SELECT DISTINCT ON (s.enrolment_id, s.requirement_id)
    s.enrolment_id, s.requirement_id, s.status
  FROM evidence_submissions s
  JOIN active_enrolments e ON e.id = s.enrolment_id
    AND e.provider_user_id = s.provider_user_id AND e.programme_id = s.programme_id
  ORDER BY s.enrolment_id, s.requirement_id, s.version DESC
), evidence_slots AS (
  SELECT e.id AS enrolment_id, r.id AS requirement_id, s.status
  FROM active_enrolments e
  CROSS JOIN active_requirements r
  LEFT JOIN latest_submissions s ON s.enrolment_id = e.id AND s.requirement_id = r.id
)
SELECT p.id AS programme_id,
  (SELECT COUNT(*)::integer FROM enrolments e
   WHERE e.provider_user_id = p.provider_user_id AND e.programme_id = p.id AND e.status = 'active') AS active_enrolments,
  (SELECT COUNT(*)::integer FROM enrolments e
   WHERE e.provider_user_id = p.provider_user_id AND e.programme_id = p.id AND e.status = 'withdrawn') AS withdrawn_enrolments,
  (SELECT COUNT(*)::integer FROM training_sessions s
   WHERE s.provider_user_id = p.provider_user_id AND s.programme_id = p.id AND s.archived_at IS NULL) AS active_sessions,
  (SELECT COUNT(*)::integer FROM attendance_records a
   WHERE a.provider_user_id = p.provider_user_id AND a.programme_id = p.id) AS attendance_recorded,
  (SELECT COUNT(*) FILTER (WHERE a.status = 'present')::integer FROM attendance_records a
   WHERE a.provider_user_id = p.provider_user_id AND a.programme_id = p.id) AS attendance_present,
  (SELECT COUNT(*) FILTER (WHERE a.status = 'absent')::integer FROM attendance_records a
   WHERE a.provider_user_id = p.provider_user_id AND a.programme_id = p.id) AS attendance_absent,
  (SELECT COUNT(*) FILTER (WHERE a.status = 'excused')::integer FROM attendance_records a
   WHERE a.provider_user_id = p.provider_user_id AND a.programme_id = p.id) AS attendance_excused,
  (SELECT COUNT(*)::integer FROM active_requirements) AS evidence_requirements,
  (SELECT COUNT(*)::integer FROM evidence_slots) AS evidence_slots,
  (SELECT COUNT(*) FILTER (WHERE status IS NULL)::integer FROM evidence_slots) AS evidence_not_submitted,
  (SELECT COUNT(*) FILTER (WHERE status = 'SUBMITTED')::integer FROM evidence_slots) AS evidence_submitted,
  (SELECT COUNT(*) FILTER (WHERE status = 'UNDER_REVIEW')::integer FROM evidence_slots) AS evidence_awaiting_review,
  (SELECT COUNT(*) FILTER (WHERE status = 'APPROVED')::integer FROM evidence_slots) AS evidence_approved,
  (SELECT COUNT(*) FILTER (WHERE status = 'CORRECTION_REQUIRED')::integer FROM evidence_slots) AS evidence_correction_required
FROM programme_scope p`;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateProgrammeBody(body, { partial = false } = {}) {
  if (!isObject(body)) {
    return { error: 'Request body must be a JSON object.' };
  }

  const keys = Object.keys(body);
  if (keys.some((key) => !allowedFields.has(key))) {
    return { error: 'Only name and description can be provided.' };
  }
  if (keys.length === 0 || (!partial && !Object.hasOwn(body, 'name'))) {
    return { error: partial ? 'Provide at least one field to update.' : 'A programme name is required.' };
  }

  const result = {};
  if (Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.trim().length > 160) {
      return { error: 'Name must be between 1 and 160 characters.' };
    }
    result.name = body.name.trim();
  }

  if (Object.hasOwn(body, 'description')) {
    if (body.description !== null && typeof body.description !== 'string') {
      return { error: 'Description must be a string or null.' };
    }
    if (typeof body.description === 'string' && body.description.length > 2000) {
      return { error: 'Description must be 2000 characters or fewer.' };
    }
    result.description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null;
  }

  return { value: result };
}

function createProgrammesRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  router.get('/', async (request, response, next) => {
    try {
      const { rows } = await database.query(
        `SELECT ${programmeColumns}
         FROM programmes
         WHERE provider_user_id = $1 AND archived_at IS NULL
         ORDER BY created_at DESC`,
        [request.auth.userId],
      );
      return response.json({ programmes: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const validated = validateProgrammeBody(request.body);
    if (validated.error) {
      return response.status(400).json({ error: validated.error });
    }

    try {
      const { rows } = await database.query(
        `INSERT INTO programmes (id, provider_user_id, name, description)
         VALUES ($1, $2, $3, $4)
         RETURNING ${programmeColumns}`,
        [
          randomUUID(),
          request.auth.userId,
          validated.value.name,
          validated.value.description ?? null,
        ],
      );
      return response.status(201).json({ programme: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/progress', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }

    try {
      const { rows } = await database.query(
        programmeProgressQuery,
        [request.params.id, request.auth.userId],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Programme not found.' });
      }
      return response.json({ progress: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }

    try {
      const { rows } = await database.query(
        `SELECT ${programmeColumns}
         FROM programmes
         WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL`,
        [request.params.id, request.auth.userId],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Programme not found.' });
      }
      return response.json({ programme: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }

    const validated = validateProgrammeBody(request.body, { partial: true });
    if (validated.error) {
      return response.status(400).json({ error: validated.error });
    }

    const fields = Object.entries(validated.value);
    const assignments = fields.map(([field], index) => `${field} = $${index + 1}`);
    const values = fields.map(([, value]) => value);
    const idIndex = values.length + 1;
    values.push(request.params.id, request.auth.userId);

    try {
      const { rows } = await database.query(
        `UPDATE programmes
         SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = $${idIndex} AND provider_user_id = $${idIndex + 1} AND archived_at IS NULL
         RETURNING ${programmeColumns}`,
        values,
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Programme not found.' });
      }
      return response.json({ programme: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }

    try {
      const { rows } = await database.query(
        `UPDATE programmes
         SET archived_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL
         RETURNING id`,
        [request.params.id, request.auth.userId],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Programme not found.' });
      }
      return response.json({ message: 'Programme archived.' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createProgrammesRouter, programmeProgressQuery, validateProgrammeBody };
