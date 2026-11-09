const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedFields = new Set(['fullName', 'phone', 'email', 'confirmPossibleDuplicate']);
const learnerColumns = 'id, learner_reference, full_name, phone, email, created_at, updated_at, archived_at';
const learnerListColumns = 'id, learner_reference, full_name, created_at, updated_at, archived_at';
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateLearnerBody(body, { partial = false } = {}) {
  if (!isObject(body)) {
    return { error: 'Request body must be a JSON object.' };
  }

  const keys = Object.keys(body);
  if (keys.some((key) => !allowedFields.has(key))) {
    return { error: 'Only fullName, phone, email, and confirmPossibleDuplicate can be provided.' };
  }
  const editableKeys = keys.filter((key) => key !== 'confirmPossibleDuplicate');
  if (editableKeys.length === 0 || (!partial && !Object.hasOwn(body, 'fullName'))) {
    return { error: partial ? 'Provide at least one learner field to update.' : 'A full name is required.' };
  }
  if (Object.hasOwn(body, 'confirmPossibleDuplicate') && body.confirmPossibleDuplicate !== true) {
    return { error: 'confirmPossibleDuplicate must be true when provided.' };
  }

  const value = {};
  if (Object.hasOwn(body, 'fullName')) {
    if (typeof body.fullName !== 'string' || body.fullName.trim().length === 0 || body.fullName.trim().length > 120) {
      return { error: 'Full name must be between 1 and 120 characters.' };
    }
    value.fullName = body.fullName.trim();
  }

  for (const field of ['phone', 'email']) {
    if (!Object.hasOwn(body, field)) {
      continue;
    }
    const raw = body[field];
    if (raw !== null && typeof raw !== 'string') {
      return { error: `${field} must be a string or null.` };
    }
    const normalized = typeof raw === 'string' ? raw.trim() : '';
    if (field === 'phone' && normalized && (
      normalized.length > 32 || !/^[+0-9().\-\s]+$/.test(normalized) || !/\d/.test(normalized)
    )) {
      return { error: 'Phone must contain a valid phone number of at most 32 characters.' };
    }
    if (field === 'email' && normalized && !validEmail(normalized)) {
      return { error: 'Email must be a valid email address of at most 254 characters.' };
    }
    value[field] = normalized ? (field === 'email' ? normalized.toLowerCase() : normalized) : null;
  }

  return { value, confirmPossibleDuplicate: body.confirmPossibleDuplicate === true };
}

function mapLearner(row, { includeContact = true } = {}) {
  return {
    id: row.id,
    learner_reference: row.learner_reference,
    full_name: row.full_name,
    phone: includeContact ? row.phone : null,
    email: includeContact ? row.email : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.archived_at ? 'archived' : 'active',
  };
}

async function hasLikelyDuplicate(database, providerUserId, value, learnerId = null) {
  const { rows } = await database.query(
    `SELECT EXISTS (
       SELECT 1
       FROM learners
       WHERE provider_user_id = $1
         AND archived_at IS NULL
         AND ($5::uuid IS NULL OR id <> $5::uuid)
         AND (
           lower(full_name) = lower($2)
           OR ($3::text IS NOT NULL AND lower(email) = lower($3))
           OR ($4::text IS NOT NULL AND phone = $4)
         )
     ) AS duplicate`,
    [providerUserId, value.fullName, value.email ?? null, value.phone ?? null, learnerId],
  );
  return rows[0]?.duplicate === true;
}

function duplicateResponse(response) {
  return response.status(409).json({
    error: 'A learner with matching name or contact details may already exist. Review the existing list before continuing.',
    code: 'POSSIBLE_DUPLICATE',
  });
}

function createLearnersRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  router.get('/', async (request, response, next) => {
    const search = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const status = request.query.status ?? 'active';
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (search.length > 100) {
      return response.status(400).json({ error: 'Search must be 100 characters or fewer.' });
    }
    if (!['active', 'archived', 'all'].includes(status)) {
      return response.status(400).json({ error: 'Status must be active, archived, or all.' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100
      || !Number.isInteger(offset) || offset < 0) {
      return response.status(400).json({ error: 'Limit must be 1–100 and offset must be zero or greater.' });
    }

    const values = [request.auth.userId];
    const conditions = ['provider_user_id = $1'];
    if (status === 'active') {
      conditions.push('archived_at IS NULL');
    } else if (status === 'archived') {
      conditions.push('archived_at IS NOT NULL');
    }
    if (search) {
      values.push(`${search.toLowerCase()}%`);
      conditions.push(`(lower(full_name) LIKE $${values.length} OR lower(learner_reference) LIKE $${values.length})`);
    }
    const filterValues = [...values];
    const where = conditions.join(' AND ');
    values.push(limit, offset);

    try {
      const { rows: countRows } = await database.query(
        `SELECT COUNT(*)::integer AS total
         FROM learners
         WHERE ${where}`,
        filterValues,
      );
      const { rows } = await database.query(
        `SELECT ${learnerListColumns}
         FROM learners
         WHERE ${where}
         ORDER BY created_at DESC, id
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return response.json({
        learners: rows.map((row) => mapLearner(row, { includeContact: false })),
        total: countRows[0].total,
        limit,
        offset,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const validated = validateLearnerBody(request.body);
    if (validated.error) {
      return response.status(400).json({ error: validated.error });
    }

    try {
      const duplicate = await hasLikelyDuplicate(
        database,
        request.auth.userId,
        validated.value,
      );
      if (duplicate && !validated.confirmPossibleDuplicate) {
        return duplicateResponse(response);
      }

      const { rows } = await database.query(
        `INSERT INTO learners (id, provider_user_id, learner_reference, full_name, phone, email)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${learnerColumns}`,
        [
          randomUUID(),
          request.auth.userId,
          `LRN-${randomUUID().toUpperCase()}`,
          validated.value.fullName,
          validated.value.phone ?? null,
          validated.value.email ?? null,
        ],
      );
      return response.status(201).json({ learner: mapLearner(rows[0]) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Learner ID must be a UUID.' });
    }

    try {
      const { rows } = await database.query(
        `SELECT ${learnerColumns}
         FROM learners
        WHERE id = $1 AND provider_user_id = $2`,
        [request.params.id, request.auth.userId],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Learner not found.' });
      }
      return response.json({ learner: mapLearner(rows[0]) });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Learner ID must be a UUID.' });
    }
    const validated = validateLearnerBody(request.body, { partial: true });
    if (validated.error) {
      return response.status(400).json({ error: validated.error });
    }

    try {
      const { rows: currentRows } = await database.query(
        `SELECT ${learnerColumns}
         FROM learners
         WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL`,
        [request.params.id, request.auth.userId],
      );
      const current = currentRows[0];
      if (!current) {
        return response.status(404).json({ error: 'Learner not found.' });
      }

      const prospective = {
        fullName: validated.value.fullName ?? current.full_name,
        email: Object.hasOwn(validated.value, 'email') ? validated.value.email : current.email,
        phone: Object.hasOwn(validated.value, 'phone') ? validated.value.phone : current.phone,
      };
      const duplicate = await hasLikelyDuplicate(
        database,
        request.auth.userId,
        prospective,
        request.params.id,
      );
      if (duplicate && !validated.confirmPossibleDuplicate) {
        return duplicateResponse(response);
      }

      const fields = Object.entries(validated.value);
      const assignments = fields.map(([field], index) => {
        const column = field === 'fullName' ? 'full_name' : field;
        return `${column} = $${index + 1}`;
      });
      const values = fields.map(([, value]) => value);
      values.push(request.params.id, request.auth.userId);
      const { rows } = await database.query(
        `UPDATE learners
         SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length - 1} AND provider_user_id = $${values.length} AND archived_at IS NULL
         RETURNING ${learnerColumns}`,
        values,
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Learner not found.' });
      }
      return response.json({ learner: mapLearner(rows[0]) });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Learner ID must be a UUID.' });
    }

    try {
      const { rows } = await database.query(
        `WITH archived AS (
           UPDATE learners
           SET archived_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL
           RETURNING id, provider_user_id
         ),
         withdrawn AS (
           UPDATE enrolments e
           SET status = 'withdrawn', updated_by = $2, updated_at = NOW()
           FROM archived a
           WHERE e.learner_id = a.id AND e.provider_user_id = a.provider_user_id
             AND e.status = 'active'
           RETURNING e.id
         )
         SELECT id FROM archived`,
        [request.params.id, request.auth.userId],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Learner not found.' });
      }
      return response.json({ message: 'Learner archived.' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createLearnersRouter, validateLearnerBody };
