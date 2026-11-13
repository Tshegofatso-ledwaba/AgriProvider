const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const scheduleStatuses = new Set(['all', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'OVERDUE']);
const maxRangeDays = 93;

class ScheduleRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDateTime(value) {
  return typeof value === 'string' && dateTimePattern.test(value) && Number.isFinite(Date.parse(value));
}

function optionalText(body, key, label, max, value) {
  if (!Object.hasOwn(body, key)) return null;
  const raw = body[key];
  if (raw === null || (typeof raw === 'string' && !raw.trim())) {
    value[key] = null;
    return null;
  }
  if (typeof raw !== 'string' || raw.trim().length > max) return `${label} must be ${max} characters or fewer.`;
  value[key] = raw.trim();
  return null;
}

function validateScheduleBody(body, { partial = false } = {}) {
  if (!isObject(body)) return { error: 'Request body must be a JSON object.' };
  const allowed = partial
    ? ['assessorUserId', 'title', 'startsAt', 'endsAt', 'location', 'notes']
    : ['programmeId', 'enrolmentId', 'assessorUserId', 'title', 'startsAt', 'endsAt', 'location', 'notes'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: `Only ${allowed.join(', ')} can be provided.` };
  }
  if (partial && Object.keys(body).length === 0) return { error: 'Provide at least one field to change.' };
  if (!partial && !['programmeId', 'assessorUserId', 'title', 'startsAt'].every((key) => Object.hasOwn(body, key))) {
    return { error: 'Programme, assessor, title, and start time are required.' };
  }

  const value = {};
  for (const key of ['programmeId', 'assessorUserId']) {
    if (Object.hasOwn(body, key)) {
      if (typeof body[key] !== 'string' || !uuidPattern.test(body[key])) return { error: `${key} must be a UUID.` };
      value[key] = body[key];
    }
  }
  if (Object.hasOwn(body, 'enrolmentId')) {
    if (body.enrolmentId === null || body.enrolmentId === '') value.enrolmentId = null;
    else if (typeof body.enrolmentId !== 'string' || !uuidPattern.test(body.enrolmentId)) return { error: 'enrolmentId must be a UUID or null.' };
    else value.enrolmentId = body.enrolmentId;
  }
  if (Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 160) {
      return { error: 'Title must be between 1 and 160 characters.' };
    }
    value.title = body.title.trim();
  }
  if (Object.hasOwn(body, 'startsAt')) {
    if (!validDateTime(body.startsAt)) return { error: 'Start time must be a valid ISO 8601 date and include a timezone.' };
    value.startsAt = new Date(body.startsAt).toISOString();
  }
  if (Object.hasOwn(body, 'endsAt')) {
    if (body.endsAt === null || body.endsAt === '') value.endsAt = null;
    else if (!validDateTime(body.endsAt)) return { error: 'End time must be a valid ISO 8601 date and include a timezone.' };
    else value.endsAt = new Date(body.endsAt).toISOString();
  }
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    return { error: 'End time must be after the start time.' };
  }
  const textError = optionalText(body, 'location', 'Location', 160, value)
    || optionalText(body, 'notes', 'Notes', 2000, value);
  if (textError) return { error: textError };
  return { value };
}

function validateCommentBody(body, { required }) {
  if (body === undefined || (isObject(body) && Object.keys(body).length === 0)) {
    return required ? { error: 'A reason is required.' } : { value: null };
  }
  if (!isObject(body) || Object.keys(body).some((key) => key !== 'comments')) return { error: 'Provide only comments.' };
  const comments = typeof body.comments === 'string' ? body.comments.trim() : '';
  if (body.comments !== undefined && body.comments !== null && typeof body.comments !== 'string') {
    return { error: 'Comments must be text.' };
  }
  if (!comments) return required ? { error: 'A reason is required.' } : { value: null };
  if (comments.length > 2000) return { error: 'Comments must be 2,000 characters or fewer.' };
  return { value: comments };
}

function parseRange(query) {
  const { from, to } = query;
  if (from === undefined && to === undefined) return { value: null };
  if (!validDateTime(from) || !validDateTime(to)) {
    return { error: 'from and to must both be ISO 8601 date-times that include a timezone.' };
  }
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (end <= start) return { error: 'to must be after from.' };
  if (end - start > maxRangeDays * 86_400_000) return { error: `The date range may not exceed ${maxRangeDays} days.` };
  return { value: { from: new Date(start).toISOString(), to: new Date(end).toISOString() } };
}

const overdueSql = `(a.status = 'SCHEDULED' AND COALESCE(a.ends_at, a.starts_at) < NOW())`;

function isMissingSchemaError(error) {
  return Boolean(error) && (
    error.code === '42P01'
    || error.code === '42703'
    || /relation .* does not exist/i.test(error.message || '')
    || /table .* does not exist/i.test(error.message || '')
    || /column .* does not exist/i.test(error.message || '')
  );
}

const scheduleSelect = `SELECT a.id, a.programme_id, p.name AS programme_name, a.provider_user_id,
    provider.full_name AS provider_name, a.enrolment_id, l.id AS learner_id, l.full_name AS learner_name,
    l.learner_reference, a.assessor_user_id, assessor.full_name AS assessor_name, a.title,
    a.starts_at, a.ends_at, a.location, a.notes, a.status, a.created_at, a.updated_at,
    a.completed_at, a.cancelled_at, ${overdueSql} AS is_overdue
  FROM assessment_schedules a
  JOIN programmes p ON p.id = a.programme_id
  JOIN users provider ON provider.id = a.provider_user_id
  JOIN users assessor ON assessor.id = a.assessor_user_id
  LEFT JOIN enrolments e ON e.id = a.enrolment_id
  LEFT JOIN learners l ON l.id = e.learner_id`;

async function listSchedules(database, scopeSql, userId, query) {
  const status = query.status ?? 'all';
  if (!scheduleStatuses.has(status)) throw new ScheduleRequestError(400, 'Invalid assessment status filter.');
  if (query.programmeId !== undefined && !uuidPattern.test(query.programmeId)) {
    throw new ScheduleRequestError(400, 'Programme ID must be a UUID.');
  }
  const range = parseRange(query);
  if (range.error) throw new ScheduleRequestError(400, range.error);

  const values = [userId];
  const conditions = [scopeSql];
  if (query.programmeId) {
    values.push(query.programmeId);
    conditions.push(`a.programme_id = $${values.length}`);
  }
  if (range.value) {
    values.push(range.value.from, range.value.to);
    conditions.push(`a.starts_at >= $${values.length - 1} AND a.starts_at < $${values.length}`);
  }
  if (status === 'OVERDUE') conditions.push(overdueSql);
  else if (status !== 'all') {
    values.push(status);
    conditions.push(`a.status = $${values.length}`);
  }
  try {
    const { rows } = await database.query(
      `${scheduleSelect} WHERE ${conditions.join(' AND ')}
       ORDER BY a.starts_at ${range.value ? 'ASC' : 'DESC'}, a.id
       LIMIT 200`,
      values,
    );
    return rows;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return [];
  }
}

async function loadSchedule(database, scheduleId, scopeSql, userId) {
  let rows = [];
  try {
    ({ rows } = await database.query(
      `${scheduleSelect} WHERE a.id = $2 AND ${scopeSql}`,
      [userId, scheduleId],
    ));
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return null;
  }
  if (!rows[0]) return null;
  const schedule = rows[0];
  let events = [];
  try {
    ({ rows: events } = await database.query(
      `SELECT ev.id, ev.event_type, ev.actor_role, actor.full_name AS actor_name,
         ev.previous_values, ev.new_values, ev.comments, ev.created_at
       FROM assessment_schedule_events ev
       JOIN users actor ON actor.id = ev.actor_user_id
       WHERE ev.schedule_id = $1
       ORDER BY ev.created_at, ev.id`,
      [scheduleId],
    ));
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    events = [];
  }
  let evidence = [];
  if (schedule.enrolment_id) {
    // Latest version per requirement for the scheduled learner, with its most
    // recent immutable assessor decision (if any). Read-only context.
    const { rows: evidenceRows } = await database.query(
      `SELECT r.id AS requirement_id, r.title AS requirement_title,
         latest.id AS submission_id, latest.version AS submission_version,
         latest.status AS submission_status, latest.created_at AS submitted_at,
         review.decision AS assessor_decision, review.reviewed_at
       FROM programme_evidence_requirements r
       LEFT JOIN LATERAL (
         SELECT s.id, s.version, s.status, s.created_at
         FROM evidence_submissions s
         WHERE s.enrolment_id = $1 AND s.requirement_id = r.id
         ORDER BY s.version DESC LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT er.decision, er.reviewed_at
         FROM evidence_reviews er
         WHERE er.evidence_submission_id = latest.id AND er.submission_version = latest.version
         ORDER BY er.reviewed_at DESC LIMIT 1
       ) review ON TRUE
       WHERE r.programme_id = $2 AND r.archived_at IS NULL
       ORDER BY r.created_at, r.id`,
      [schedule.enrolment_id, schedule.programme_id],
    );
    evidence = evidenceRows;
  }
  return { schedule, events, evidence };
}

async function withTransaction(database, work) {
  const client = await database.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    const result = await work(client);
    await client.query('COMMIT');
    started = false;
    return result;
  } catch (error) {
    if (started) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Assessment schedule rollback failed:', rollbackError.code || rollbackError.name);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function handleError(error, response, next) {
  if (error instanceof ScheduleRequestError) return response.status(error.status).json({ error: error.message });
  if (error.code === '23514') return response.status(400).json({ error: 'End time must be after the start time.' });
  return next(error);
}

async function findActiveAssignment(client, programmeId, assessorUserId) {
  const { rows } = await client.query(
    `SELECT a.id FROM programme_assessor_assignments a
     JOIN users u ON u.id = a.assessor_user_id AND u.role = 'assessor' AND u.is_active = TRUE
     WHERE a.programme_id = $1 AND a.assessor_user_id = $2
       AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL`,
    [programmeId, assessorUserId],
  );
  if (!rows[0]) {
    throw new ScheduleRequestError(400, 'The selected assessor is not actively assigned to this programme. An administrator manages assessor assignments.');
  }
  return rows[0].id;
}

const providerScope = 'a.provider_user_id = $1';
const assessorScope = 'a.assessor_user_id = $1';
const editableFields = {
  title: 'title', startsAt: 'starts_at', endsAt: 'ends_at', location: 'location', notes: 'notes',
};

function createProviderAssessmentSchedulesRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  router.get('/assessors', async (request, response, next) => {
    const { programmeId } = request.query;
    if (!uuidPattern.test(programmeId ?? '')) return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    try {
      const { rows } = await database.query(
        `SELECT u.id, u.full_name
         FROM programme_assessor_assignments a
         JOIN programmes p ON p.id = a.programme_id AND p.provider_user_id = $2
         JOIN users u ON u.id = a.assessor_user_id AND u.is_active = TRUE
         WHERE a.programme_id = $1 AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
         ORDER BY u.full_name, u.id`,
        [programmeId, request.auth.userId],
      );
      return response.json({ assessors: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      return response.json({ schedules: await listSchedules(database, providerScope, request.auth.userId, request.query) });
    } catch (error) {
      return handleError(error, response, next);
    }
  });

  router.post('/', async (request, response, next) => {
    const validated = validateScheduleBody(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });
    const values = validated.value;
    try {
      const scheduleId = await withTransaction(database, async (client) => {
        const { rows: programmeRows } = await client.query(
          'SELECT id FROM programmes WHERE id = $1 AND provider_user_id = $2 AND archived_at IS NULL',
          [values.programmeId, request.auth.userId],
        );
        if (!programmeRows[0]) throw new ScheduleRequestError(404, 'Active programme not found.');
        if (values.enrolmentId) {
          const { rows: enrolmentRows } = await client.query(
            `SELECT id FROM enrolments
             WHERE id = $1 AND programme_id = $2 AND provider_user_id = $3 AND status = 'active'`,
            [values.enrolmentId, values.programmeId, request.auth.userId],
          );
          if (!enrolmentRows[0]) throw new ScheduleRequestError(400, 'The learner must have an active enrolment in this programme.');
        }
        const assignmentId = await findActiveAssignment(client, values.programmeId, values.assessorUserId);
        const { rows } = await client.query(
          `INSERT INTO assessment_schedules (
             provider_user_id, programme_id, enrolment_id, assessor_assignment_id, assessor_user_id,
             title, starts_at, ends_at, location, notes, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $1, $1)
           RETURNING id, title, starts_at, ends_at, location, assessor_user_id`,
          [
            request.auth.userId, values.programmeId, values.enrolmentId ?? null, assignmentId,
            values.assessorUserId, values.title, values.startsAt, values.endsAt ?? null,
            values.location ?? null, values.notes ?? null,
          ],
        );
        const { id, ...snapshot } = rows[0];
        await client.query(
          `INSERT INTO assessment_schedule_events (schedule_id, actor_user_id, actor_role, event_type, new_values)
           VALUES ($1, $2, 'provider', 'SCHEDULED', $3)`,
          [id, request.auth.userId, JSON.stringify(snapshot)],
        );
        return id;
      });
      return response.status(201).json(await loadSchedule(database, scheduleId, providerScope, request.auth.userId));
    } catch (error) {
      return handleError(error, response, next);
    }
  });

  router.get('/:scheduleId', async (request, response, next) => {
    if (!uuidPattern.test(request.params.scheduleId)) return response.status(400).json({ error: 'Schedule ID must be a UUID.' });
    try {
      const result = await loadSchedule(database, request.params.scheduleId, providerScope, request.auth.userId);
      if (!result) return response.status(404).json({ error: 'Assessment schedule not found.' });
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:scheduleId', async (request, response, next) => {
    const { scheduleId } = request.params;
    if (!uuidPattern.test(scheduleId)) return response.status(400).json({ error: 'Schedule ID must be a UUID.' });
    const validated = validateScheduleBody(request.body, { partial: true });
    if (validated.error) return response.status(400).json({ error: validated.error });
    try {
      await withTransaction(database, async (client) => {
        const { rows } = await client.query(
          `SELECT id, programme_id, assessor_user_id, title, starts_at, ends_at, location, notes, status
           FROM assessment_schedules WHERE id = $1 AND provider_user_id = $2 FOR UPDATE`,
          [scheduleId, request.auth.userId],
        );
        const current = rows[0];
        if (!current) throw new ScheduleRequestError(404, 'Assessment schedule not found.');
        if (current.status !== 'SCHEDULED') {
          throw new ScheduleRequestError(409, 'Only a scheduled assessment can be changed. Completed and cancelled assessments are kept as history.');
        }
        const sets = [];
        const params = [scheduleId, request.auth.userId];
        const previous = {};
        const next = {};
        for (const [field, column] of Object.entries(editableFields)) {
          if (!Object.hasOwn(validated.value, field)) continue;
          const incoming = validated.value[field];
          const existing = current[column] instanceof Date ? current[column].toISOString() : current[column];
          if (incoming === existing) continue;
          params.push(incoming);
          sets.push(`${column} = $${params.length}`);
          previous[column] = existing;
          next[column] = incoming;
        }
        if (validated.value.assessorUserId && validated.value.assessorUserId !== current.assessor_user_id) {
          const assignmentId = await findActiveAssignment(client, current.programme_id, validated.value.assessorUserId);
          params.push(validated.value.assessorUserId, assignmentId);
          sets.push(`assessor_user_id = $${params.length - 1}`, `assessor_assignment_id = $${params.length}`);
          previous.assessor_user_id = current.assessor_user_id;
          next.assessor_user_id = validated.value.assessorUserId;
        }
        if (!sets.length) throw new ScheduleRequestError(400, 'No changes were provided.');
        await client.query(
          `UPDATE assessment_schedules SET ${sets.join(', ')}, updated_by = $2, updated_at = NOW() WHERE id = $1`,
          params,
        );
        await client.query(
          `INSERT INTO assessment_schedule_events (
             schedule_id, actor_user_id, actor_role, event_type, previous_values, new_values
           ) VALUES ($1, $2, 'provider', 'RESCHEDULED', $3, $4)`,
          [scheduleId, request.auth.userId, JSON.stringify(previous), JSON.stringify(next)],
        );
      });
      return response.json(await loadSchedule(database, scheduleId, providerScope, request.auth.userId));
    } catch (error) {
      return handleError(error, response, next);
    }
  });

  router.post('/:scheduleId/cancel', async (request, response, next) => {
    const { scheduleId } = request.params;
    if (!uuidPattern.test(scheduleId)) return response.status(400).json({ error: 'Schedule ID must be a UUID.' });
    const validated = validateCommentBody(request.body, { required: true });
    if (validated.error) return response.status(400).json({ error: validated.error });
    try {
      await withTransaction(database, async (client) => {
        const { rows } = await client.query(
          'SELECT status FROM assessment_schedules WHERE id = $1 AND provider_user_id = $2 FOR UPDATE',
          [scheduleId, request.auth.userId],
        );
        if (!rows[0]) throw new ScheduleRequestError(404, 'Assessment schedule not found.');
        if (rows[0].status !== 'SCHEDULED') throw new ScheduleRequestError(409, 'Only a scheduled assessment can be cancelled.');
        await client.query(
          `UPDATE assessment_schedules SET status = 'CANCELLED', cancelled_at = NOW(),
             updated_by = $2, updated_at = NOW() WHERE id = $1`,
          [scheduleId, request.auth.userId],
        );
        await client.query(
          `INSERT INTO assessment_schedule_events (schedule_id, actor_user_id, actor_role, event_type, comments)
           VALUES ($1, $2, 'provider', 'CANCELLED', $3)`,
          [scheduleId, request.auth.userId, validated.value],
        );
      });
      return response.json(await loadSchedule(database, scheduleId, providerScope, request.auth.userId));
    } catch (error) {
      return handleError(error, response, next);
    }
  });

  return router;
}

function createAssessorAssessmentSchedulesRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('assessor'));

  router.get('/', async (request, response, next) => {
    try {
      return response.json({ schedules: await listSchedules(database, assessorScope, request.auth.userId, request.query) });
    } catch (error) {
      return handleError(error, response, next);
    }
  });

  router.get('/:scheduleId', async (request, response, next) => {
    if (!uuidPattern.test(request.params.scheduleId)) return response.status(400).json({ error: 'Schedule ID must be a UUID.' });
    try {
      const result = await loadSchedule(database, request.params.scheduleId, assessorScope, request.auth.userId);
      if (!result) return response.status(404).json({ error: 'Assessment schedule not found.' });
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:scheduleId/complete', async (request, response, next) => {
    const { scheduleId } = request.params;
    if (!uuidPattern.test(scheduleId)) return response.status(400).json({ error: 'Schedule ID must be a UUID.' });
    const validated = validateCommentBody(request.body, { required: false });
    if (validated.error) return response.status(400).json({ error: validated.error });
    try {
      await withTransaction(database, async (client) => {
        const { rows } = await client.query(
          `SELECT a.status, a.starts_at <= NOW() AS has_started,
             EXISTS (
               SELECT 1 FROM programme_assessor_assignments assignment
               WHERE assignment.programme_id = a.programme_id AND assignment.assessor_user_id = a.assessor_user_id
                 AND assignment.status = 'ACTIVE' AND assignment.deactivated_at IS NULL
             ) AS still_assigned
           FROM assessment_schedules a
           WHERE a.id = $1 AND a.assessor_user_id = $2
           FOR UPDATE OF a`,
          [scheduleId, request.auth.userId],
        );
        const current = rows[0];
        if (!current) throw new ScheduleRequestError(404, 'Assessment schedule not found.');
        if (!current.still_assigned) throw new ScheduleRequestError(403, 'Your assignment to this programme is no longer active.');
        if (current.status !== 'SCHEDULED') throw new ScheduleRequestError(409, 'Only a scheduled assessment can be marked completed.');
        if (!current.has_started) throw new ScheduleRequestError(409, 'An assessment cannot be marked completed before its start time.');
        await client.query(
          `UPDATE assessment_schedules SET status = 'COMPLETED', completed_at = NOW(),
             updated_by = $2, updated_at = NOW() WHERE id = $1`,
          [scheduleId, request.auth.userId],
        );
        await client.query(
          `INSERT INTO assessment_schedule_events (schedule_id, actor_user_id, actor_role, event_type, comments)
           VALUES ($1, $2, 'assessor', 'COMPLETED', $3)`,
          [scheduleId, request.auth.userId, validated.value],
        );
      });
      return response.json(await loadSchedule(database, scheduleId, assessorScope, request.auth.userId));
    } catch (error) {
      return handleError(error, response, next);
    }
  });

  return router;
}

module.exports = {
  createAssessorAssessmentSchedulesRouter,
  createProviderAssessmentSchedulesRouter,
  listSchedules,
  parseRange,
  validateCommentBody,
  validateScheduleBody,
};
