const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const attendanceStatuses = new Set(['present', 'absent', 'excused']);
const sessionColumns = 'id, programme_id, title, starts_at, created_by, updated_by, created_at, updated_at, archived_at';
const attendanceColumns = `a.id, a.session_id, a.enrolment_id, a.status, a.marked_by, a.created_at, a.updated_at,
  e.learner_id, l.learner_reference, l.full_name AS learner_name`;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateDate(value) {
  return typeof value === 'string' && datePattern.test(value) && Number.isFinite(Date.parse(value));
}

function validateSessionBody(body, { partial = false } = {}) {
  if (!isObject(body)) return { error: 'Request body must be a JSON object.' };
  const allowedFields = partial ? ['title', 'startsAt'] : ['programmeId', 'title', 'startsAt'];
  if (Object.keys(body).some((key) => !allowedFields.includes(key))) {
    return { error: `Only ${allowedFields.join(', ')} can be provided.` };
  }
  const keys = Object.keys(body);
  if (keys.length === 0 || (!partial && !['programmeId', 'title', 'startsAt'].every((key) => Object.hasOwn(body, key)))) {
    return { error: partial ? 'Provide at least one session field to update.' : 'Programme, title, and start time are required.' };
  }

  const value = {};
  if (Object.hasOwn(body, 'programmeId')) {
    if (!uuidPattern.test(body.programmeId ?? '')) return { error: 'Programme ID must be a UUID.' };
    value.programmeId = body.programmeId;
  }
  if (Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 160) {
      return { error: 'Title must be between 1 and 160 characters.' };
    }
    value.title = body.title.trim();
  }
  if (Object.hasOwn(body, 'startsAt')) {
    if (!validateDate(body.startsAt)) {
      return { error: 'Start time must be a valid ISO 8601 date and include a timezone.' };
    }
    value.startsAt = new Date(body.startsAt).toISOString();
  }
  return { value };
}

function validateAttendanceBody(body) {
  if (!isObject(body) || Object.keys(body).length !== 1 || !Array.isArray(body.records)) {
    return { error: 'Provide only a records array.' };
  }
  if (body.records.length < 1 || body.records.length > 100) {
    return { error: 'Provide between 1 and 100 attendance records.' };
  }
  const seen = new Set();
  const records = [];
  for (const record of body.records) {
    if (!isObject(record) || Object.keys(record).some((key) => !['enrolmentId', 'status'].includes(key))
      || !uuidPattern.test(record.enrolmentId ?? '')
      || !attendanceStatuses.has(record.status)) {
      return { error: 'Each record must contain a UUID enrolmentId and a present, absent, or excused status.' };
    }
    if (seen.has(record.enrolmentId)) {
      return { error: 'An enrolment may only appear once per attendance submission.' };
    }
    seen.add(record.enrolmentId);
    records.push({
      id: randomUUID(),
      enrolment_id: record.enrolmentId,
      status: record.status,
    });
  }
  return { value: records };
}

function createSessionsRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  router.get('/', async (request, response, next) => {
    const programmeId = request.query.programmeId;
    if (programmeId !== undefined && !uuidPattern.test(programmeId)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }
    try {
      const values = [request.auth.userId];
      const programmeFilter = programmeId ? 'AND s.programme_id = $2' : '';
      if (programmeId) values.push(programmeId);
      const { rows } = await database.query(
        `SELECT s.id, s.programme_id, s.title, s.starts_at, s.created_at,
           p.name AS programme_name,
           COUNT(DISTINCT e.id)::integer AS enrolled_count,
           COUNT(DISTINCT a.id)::integer AS marked_count
         FROM training_sessions s
         JOIN programmes p ON p.id = s.programme_id AND p.provider_user_id = s.provider_user_id
         LEFT JOIN enrolments e ON e.provider_user_id = s.provider_user_id
           AND e.programme_id = s.programme_id AND e.status = 'active'
         LEFT JOIN attendance_records a ON a.session_id = s.id AND a.enrolment_id = e.id
         WHERE s.provider_user_id = $1 AND s.archived_at IS NULL ${programmeFilter}
         GROUP BY s.id, p.name
         ORDER BY s.starts_at DESC, s.id`,
        values,
      );
      return response.json({ sessions: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const validated = validateSessionBody(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });

    try {
      const { rows } = await database.query(
        `INSERT INTO training_sessions (
           id, provider_user_id, programme_id, title, starts_at, created_by, updated_by
         )
         SELECT $1, p.provider_user_id, p.id, $4, $5, $2, $2
         FROM programmes p
         WHERE p.id = $3 AND p.provider_user_id = $2 AND p.archived_at IS NULL
         RETURNING ${sessionColumns}`,
        [
          randomUUID(),
          request.auth.userId,
          validated.value.programmeId,
          validated.value.title,
          validated.value.startsAt,
        ],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Active programme not found.' });
      return response.status(201).json({ session: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/attendance', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) return response.status(400).json({ error: 'Session ID must be a UUID.' });
    try {
      const { rows: sessionRows } = await database.query(
        `SELECT ${sessionColumns}
         FROM training_sessions
         WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL`,
        [request.params.id, request.auth.userId],
      );
      if (!sessionRows[0]) return response.status(404).json({ error: 'Session not found.' });
      const { rows } = await database.query(
        `SELECT e.id AS enrolment_id, e.learner_id, l.learner_reference,
           l.full_name AS learner_name, a.status, a.marked_by, a.updated_at AS marked_at
         FROM enrolments e
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
         LEFT JOIN attendance_records a ON a.session_id = $1 AND a.enrolment_id = e.id
           AND a.provider_user_id = e.provider_user_id
         WHERE e.provider_user_id = $2 AND e.programme_id = $3 AND e.status = 'active'
         ORDER BY lower(l.full_name), e.id`,
        [request.params.id, request.auth.userId, sessionRows[0].programme_id],
      );
      const summary = { present: 0, absent: 0, excused: 0, unrecorded: 0 };
      for (const row of rows) {
        if (row.status) summary[row.status] += 1;
        else summary.unrecorded += 1;
      }
      return response.json({ session: sessionRows[0], records: rows, summary });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:id/attendance', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) return response.status(400).json({ error: 'Session ID must be a UUID.' });
    const validated = validateAttendanceBody(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });
    try {
      const { rows } = await database.query(
        `WITH session AS (
           SELECT id, provider_user_id, programme_id
           FROM training_sessions
           WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL
         ),
         input AS (
           SELECT * FROM jsonb_to_recordset($3::jsonb)
             AS record(id uuid, enrolment_id uuid, status text)
         ),
         valid AS (
           SELECT input.*
           FROM input
           JOIN session s ON TRUE
           JOIN enrolments e ON e.id = input.enrolment_id
             AND e.provider_user_id = s.provider_user_id
             AND e.programme_id = s.programme_id
             AND e.status = 'active'
         ),
         saved AS (
           INSERT INTO attendance_records (
             id, provider_user_id, programme_id, session_id, enrolment_id, status, marked_by
           )
           SELECT input.id, s.provider_user_id, s.programme_id, s.id, input.enrolment_id, input.status, $2
           FROM valid input
           JOIN session s ON TRUE
           WHERE (SELECT COUNT(*) FROM valid) = (SELECT COUNT(*) FROM input)
           ON CONFLICT (session_id, enrolment_id)
           DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, updated_at = NOW()
           RETURNING *
         )
         SELECT ${attendanceColumns}
         FROM saved a
         JOIN enrolments e ON e.id = a.enrolment_id AND e.provider_user_id = a.provider_user_id
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id`,
        [request.params.id, request.auth.userId, JSON.stringify(validated.value)],
      );
      if (rows.length !== validated.value.length) {
        const { rows: sessionRows } = await database.query(
          `SELECT id FROM training_sessions WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL`,
          [request.params.id, request.auth.userId],
        );
        if (!sessionRows[0]) return response.status(404).json({ error: 'Session not found.' });
        return response.status(400).json({ error: 'Attendance contains an enrolment that is not active in this session programme.' });
      }
      return response.json({ records: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) return response.status(400).json({ error: 'Session ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `SELECT s.id, s.programme_id, s.title, s.starts_at, s.created_by, s.updated_by,
           s.created_at, s.updated_at, s.archived_at, p.name AS programme_name
         FROM training_sessions s
         JOIN programmes p ON p.id = s.programme_id AND p.provider_user_id = s.provider_user_id
         WHERE s.id = $1 AND s.provider_user_id = $2`,
        [request.params.id, request.auth.userId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Session not found.' });
      return response.json({ session: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) return response.status(400).json({ error: 'Session ID must be a UUID.' });
    const validated = validateSessionBody(request.body, { partial: true });
    if (validated.error) return response.status(400).json({ error: validated.error });
    const fields = Object.entries(validated.value);
    const assignments = fields.map(([field], index) => {
      const column = field === 'startsAt' ? 'starts_at' : field === 'programmeId' ? 'programme_id' : field;
      return `${column} = $${index + 1}`;
    });
    const values = fields.map(([, value]) => value);
    values.push(request.auth.userId, request.params.id);
    const idPosition = values.length;
    try {
      const { rows } = await database.query(
        `UPDATE training_sessions s
         SET ${assignments.join(', ')}, updated_by = $${values.length - 1}, updated_at = NOW()
         WHERE s.id = $${idPosition} AND s.provider_user_id = $${values.length - 1}
           AND s.archived_at IS NULL
         RETURNING ${sessionColumns}`,
        values,
      );
      if (!rows[0]) return response.status(404).json({ error: 'Session or active programme not found.' });
      return response.json({ session: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) return response.status(400).json({ error: 'Session ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `UPDATE training_sessions
         SET archived_at = NOW(), updated_at = NOW(), updated_by = $2
         WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL
         RETURNING id`,
        [request.params.id, request.auth.userId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Session not found.' });
      return response.json({ message: 'Session archived.' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  attendanceStatuses,
  createSessionsRouter,
  validateAttendanceBody,
  validateSessionBody,
};
