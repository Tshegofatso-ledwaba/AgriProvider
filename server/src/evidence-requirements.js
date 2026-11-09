const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedFields = new Set(['title', 'guidance']);
const requirementColumns = 'id, programme_id, title, guidance, created_at, updated_at';

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRequirementBody(body, { partial = false } = {}) {
  if (!isObject(body)) {
    return { error: 'Request body must be a JSON object.' };
  }

  const keys = Object.keys(body);
  if (keys.some((key) => !allowedFields.has(key))) {
    return { error: 'Only title and guidance can be provided.' };
  }
  if (keys.length === 0 || (!partial && !Object.hasOwn(body, 'title'))) {
    return { error: partial ? 'Provide at least one field to update.' : 'A checklist title is required.' };
  }

  const value = {};
  if (Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0 || body.title.trim().length > 160) {
      return { error: 'Title must be between 1 and 160 characters.' };
    }
    value.title = body.title.trim();
  }
  if (Object.hasOwn(body, 'guidance')) {
    if (body.guidance !== null && typeof body.guidance !== 'string') {
      return { error: 'Guidance must be a string or null.' };
    }
    if (typeof body.guidance === 'string' && body.guidance.length > 2000) {
      return { error: 'Guidance must be 2000 characters or fewer.' };
    }
    value.guidance = typeof body.guidance === 'string' && body.guidance.trim()
      ? body.guidance.trim()
      : null;
  }

  return { value };
}

async function hasOwnedProgramme(database, programmeId, providerUserId) {
  const { rows } = await database.query(
    `SELECT id
     FROM programmes
     WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL`,
    [programmeId, providerUserId],
  );
  return rows.length > 0;
}

function createEvidenceRequirementsRouter({ database, jwtSecret }) {
  const router = Router({ mergeParams: true });
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  router.get('/', async (request, response, next) => {
    const { programmeId } = request.params;
    if (!uuidPattern.test(programmeId)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }

    try {
      if (!await hasOwnedProgramme(database, programmeId, request.auth.userId)) {
        return response.status(404).json({ error: 'Programme not found.' });
      }
      const { rows } = await database.query(
        `SELECT ${requirementColumns}
         FROM programme_evidence_requirements
         WHERE programme_id = $1 AND provider_user_id = $2 AND archived_at IS NULL
         ORDER BY created_at, id`,
        [programmeId, request.auth.userId],
      );
      return response.json({ requirements: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const { programmeId } = request.params;
    if (!uuidPattern.test(programmeId)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }
    const validated = validateRequirementBody(request.body);
    if (validated.error) {
      return response.status(400).json({ error: validated.error });
    }

    try {
      const { rows } = await database.query(
        `INSERT INTO programme_evidence_requirements
           (id, provider_user_id, programme_id, title, guidance, created_by, updated_by)
         SELECT $1, p.provider_user_id, p.id, $4, $5, $2, $2
         FROM programmes p
         WHERE p.id = $3 AND p.provider_user_id = $2 AND p.archived_at IS NULL
         RETURNING ${requirementColumns}`,
        [
          randomUUID(),
          request.auth.userId,
          programmeId,
          validated.value.title,
          validated.value.guidance ?? null,
        ],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Programme not found.' });
      }
      return response.status(201).json({ requirement: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (request, response, next) => {
    const { programmeId, id } = request.params;
    if (!uuidPattern.test(programmeId) || !uuidPattern.test(id)) {
      return response.status(400).json({ error: 'Programme and checklist IDs must be UUIDs.' });
    }

    try {
      const { rows } = await database.query(
        `SELECT ${requirementColumns}
         FROM programme_evidence_requirements
         WHERE id = $1 AND programme_id = $2 AND provider_user_id = $3 AND archived_at IS NULL
           AND EXISTS (
             SELECT 1 FROM programmes p
             WHERE p.id = $2 AND p.provider_user_id = $3 AND p.archived_at IS NULL
           )`,
        [id, programmeId, request.auth.userId],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Checklist item not found.' });
      }
      return response.json({ requirement: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', async (request, response, next) => {
    const { programmeId, id } = request.params;
    if (!uuidPattern.test(programmeId) || !uuidPattern.test(id)) {
      return response.status(400).json({ error: 'Programme and checklist IDs must be UUIDs.' });
    }
    const validated = validateRequirementBody(request.body, { partial: true });
    if (validated.error) {
      return response.status(400).json({ error: validated.error });
    }

    try {
      const { rows } = await database.query(
        `UPDATE programme_evidence_requirements
         SET title = COALESCE($1, title),
             guidance = CASE WHEN $2::boolean THEN $3::text ELSE guidance END,
             updated_by = $4,
             updated_at = NOW()
         WHERE id = $5 AND programme_id = $6 AND provider_user_id = $7 AND archived_at IS NULL
           AND EXISTS (
             SELECT 1 FROM programmes p
             WHERE p.id = $6 AND p.provider_user_id = $7 AND p.archived_at IS NULL
           )
         RETURNING ${requirementColumns}`,
        [
          validated.value.title ?? null,
          Object.hasOwn(validated.value, 'guidance'),
          validated.value.guidance ?? null,
          request.auth.userId,
          id,
          programmeId,
          request.auth.userId,
        ],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Checklist item not found.' });
      }
      return response.json({ requirement: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', async (request, response, next) => {
    const { programmeId, id } = request.params;
    if (!uuidPattern.test(programmeId) || !uuidPattern.test(id)) {
      return response.status(400).json({ error: 'Programme and checklist IDs must be UUIDs.' });
    }

    try {
      const { rows } = await database.query(
        `UPDATE programme_evidence_requirements
         SET archived_at = NOW(), updated_by = $3, updated_at = NOW()
         WHERE id = $1 AND programme_id = $2 AND provider_user_id = $3 AND archived_at IS NULL
           AND EXISTS (
             SELECT 1 FROM programmes p
             WHERE p.id = $2 AND p.provider_user_id = $3 AND p.archived_at IS NULL
           )
         RETURNING id`,
        [id, programmeId, request.auth.userId],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Checklist item not found.' });
      }
      return response.json({ message: 'Checklist item archived.' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createEvidenceRequirementsRouter, validateRequirementBody };
