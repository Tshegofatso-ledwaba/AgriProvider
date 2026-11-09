const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enrolmentColumns = `e.id, e.learner_id, e.programme_id, e.status, e.created_at, e.updated_at,
  e.created_by, e.updated_by, l.learner_reference, l.full_name AS learner_name,
  p.name AS programme_name`;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateCreateBody(body) {
  if (!isObject(body)) return { error: 'Request body must be a JSON object.' };
  if (Object.keys(body).some((key) => !['learnerId', 'programmeId'].includes(key))) {
    return { error: 'Only learnerId and programmeId can be provided.' };
  }
  if (!uuidPattern.test(body.learnerId ?? '') || !uuidPattern.test(body.programmeId ?? '')) {
    return { error: 'Learner ID and programme ID must be UUIDs.' };
  }
  return { value: { learnerId: body.learnerId, programmeId: body.programmeId } };
}

function createEnrolmentsRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  router.get('/', async (request, response, next) => {
    const { learnerId, programmeId } = request.query;
    const status = request.query.status ?? 'active';
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (learnerId !== undefined && !uuidPattern.test(learnerId)) {
      return response.status(400).json({ error: 'Learner ID must be a UUID.' });
    }
    if (programmeId !== undefined && !uuidPattern.test(programmeId)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }
    if (!['active', 'withdrawn', 'all'].includes(status)) {
      return response.status(400).json({ error: 'Status must be active, withdrawn, or all.' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100
      || !Number.isInteger(offset) || offset < 0) {
      return response.status(400).json({ error: 'Limit must be 1–100 and offset must be zero or greater.' });
    }

    const values = [request.auth.userId];
    const conditions = ['e.provider_user_id = $1'];
    if (status !== 'all') {
      values.push(status);
      conditions.push(`e.status = $${values.length}`);
    }
    for (const [field, value] of [['learner_id', learnerId], ['programme_id', programmeId]]) {
      if (value !== undefined) {
        values.push(value);
        conditions.push(`e.${field} = $${values.length}`);
      }
    }
    const filters = conditions.join(' AND ');
    const filterValues = [...values];
    values.push(limit, offset);

    try {
      const { rows: countRows } = await database.query(
        `SELECT COUNT(*)::integer AS total
         FROM enrolments e
         WHERE ${filters}`,
        filterValues,
      );
      const { rows } = await database.query(
        `SELECT ${enrolmentColumns}
         FROM enrolments e
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
         JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
         WHERE ${filters}
         ORDER BY e.created_at DESC, e.id
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return response.json({ enrolments: rows, total: countRows[0].total, limit, offset });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const validated = validateCreateBody(request.body);
    if (validated.error) {
      return response.status(400).json({ error: validated.error });
    }

    try {
      const { rows } = await database.query(
        `WITH inserted AS (
           INSERT INTO enrolments (
             id, provider_user_id, learner_id, programme_id, created_by, updated_by
           )
           SELECT $1, $2, l.id, p.id, $2, $2
           FROM learners l
           JOIN programmes p ON p.provider_user_id = l.provider_user_id
           WHERE l.id = $3 AND p.id = $4
             AND l.provider_user_id = $2
             AND l.archived_at IS NULL AND p.archived_at IS NULL
           RETURNING *
         )
         SELECT ${enrolmentColumns}
         FROM inserted e
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
         JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id`,
        [
          randomUUID(),
          request.auth.userId,
          validated.value.learnerId,
          validated.value.programmeId,
        ],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Active learner or programme not found.' });
      }
      return response.status(201).json({ enrolment: rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return response.status(409).json({ error: 'This learner already has an active enrolment in the programme.' });
      }
      return next(error);
    }
  });

  router.get('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Enrolment ID must be a UUID.' });
    }
    try {
      const { rows } = await database.query(
        `SELECT ${enrolmentColumns}
         FROM enrolments e
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
         JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
         WHERE e.id = $1 AND e.provider_user_id = $2`,
        [request.params.id, request.auth.userId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Enrolment not found.' });
      return response.json({ enrolment: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Enrolment ID must be a UUID.' });
    }
    if (!isObject(request.body) || Object.keys(request.body).length !== 1
      || !['active', 'withdrawn'].includes(request.body.status)) {
      return response.status(400).json({ error: 'Provide only a valid active or withdrawn status.' });
    }
    try {
      const { rows } = await database.query(
        `WITH updated AS (
           UPDATE enrolments
           SET status = $1, updated_by = $2, updated_at = NOW()
           WHERE id = $3 AND provider_user_id = $2
             AND (
               $1 <> 'active'
               OR EXISTS (
                 SELECT 1
                 FROM learners l
                 JOIN programmes p ON p.provider_user_id = l.provider_user_id
                 WHERE l.id = enrolments.learner_id
                   AND p.id = enrolments.programme_id
                   AND l.provider_user_id = enrolments.provider_user_id
                   AND l.archived_at IS NULL
                   AND p.archived_at IS NULL
               )
             )
           RETURNING *
         )
         SELECT ${enrolmentColumns}
         FROM updated e
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
         JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id`,
        [request.body.status, request.auth.userId, request.params.id],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Enrolment not found or its learner/programme is archived.' });
      return response.json({ enrolment: rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return response.status(409).json({ error: 'An active enrolment already exists for this learner and programme.' });
      }
      return next(error);
    }
  });

  return router;
}

module.exports = { createEnrolmentsRouter, validateCreateBody };
