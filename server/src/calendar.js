const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');
const { listSchedules, parseRange } = require('./assessment-schedules');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMissingSchemaError(error) {
  return Boolean(error) && (
    error.code === '42P01'
    || error.code === '42703'
    || /relation .* does not exist/i.test(error.message || '')
    || /table .* does not exist/i.test(error.message || '')
    || /column .* does not exist/i.test(error.message || '')
  );
}

function requireRange(query) {
  const range = parseRange(query);
  if (range.error) return range;
  if (!range.value) return { error: 'from and to are required.' };
  return range;
}

function createProviderCalendarRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  router.get('/', async (request, response, next) => {
    const range = requireRange(request.query);
    if (range.error) return response.status(400).json({ error: range.error });
    const { programmeId } = request.query;
    if (programmeId !== undefined && !uuidPattern.test(programmeId)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }
    try {
      const values = [request.auth.userId, range.value.from, range.value.to];
      if (programmeId) values.push(programmeId);
      const { rows: sessions } = await database.query(
        `SELECT s.id, s.programme_id, p.name AS programme_name, s.title, s.starts_at, s.ends_at, s.venue,
           (SELECT COUNT(*) FROM enrolments e
             WHERE e.programme_id = s.programme_id AND e.provider_user_id = s.provider_user_id
               AND e.status = 'active')::integer AS enrolled_count,
           (SELECT COUNT(*) FROM attendance_records a WHERE a.session_id = s.id)::integer AS marked_count
         FROM training_sessions s
         JOIN programmes p ON p.id = s.programme_id AND p.provider_user_id = s.provider_user_id
         WHERE s.provider_user_id = $1 AND s.archived_at IS NULL
           AND s.starts_at >= $2 AND s.starts_at < $3
           ${programmeId ? 'AND s.programme_id = $4' : ''}
         ORDER BY s.starts_at, s.id`,
        values,
      );
      const assessments = await listSchedules(database, 'a.provider_user_id = $1', request.auth.userId, {
        from: range.value.from, to: range.value.to, programmeId,
      });
      return response.json({ range: range.value, sessions, assessments });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function createAssessorCalendarRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('assessor'));

  router.get('/', async (request, response, next) => {
    const range = requireRange(request.query);
    if (range.error) return response.status(400).json({ error: range.error });
    try {
      const { rows: sessions } = await database.query(
        `SELECT s.id, s.programme_id, p.name AS programme_name, s.title, s.starts_at, s.ends_at, s.venue
         FROM training_sessions s
         JOIN programmes p ON p.id = s.programme_id AND p.provider_user_id = s.provider_user_id
         JOIN programme_assessor_assignments assignment ON assignment.programme_id = s.programme_id
           AND assignment.assessor_user_id = $1 AND assignment.status = 'ACTIVE' AND assignment.deactivated_at IS NULL
         WHERE s.archived_at IS NULL AND s.starts_at >= $2 AND s.starts_at < $3
         ORDER BY s.starts_at, s.id`,
        [request.auth.userId, range.value.from, range.value.to],
      );
      const assessments = await listSchedules(database, 'a.assessor_user_id = $1', request.auth.userId, range.value);
      return response.json({ range: range.value, sessions, assessments });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

// Learner timetable. Attendance is shown only as recorded by the provider:
// a past session without a record is "not recorded", never "missed".
// Assessment notes are internal to the provider/assessor and are not returned.
async function getLearnerCalendar(database, learnerId, range, { limit } = {}) {
  const limitSql = limit ? `LIMIT ${Number(limit)}` : '';
  let sessions = [];
  try {
    const { rows } = await database.query(
      `SELECT s.id, s.programme_id, p.name AS programme_name, s.title, s.starts_at, s.ends_at, s.venue,
         a.status AS attendance_status
       FROM enrolments e
       JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
       JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
       JOIN training_sessions s ON s.programme_id = e.programme_id
         AND s.provider_user_id = e.provider_user_id AND s.archived_at IS NULL
       LEFT JOIN attendance_records a ON a.session_id = s.id AND a.enrolment_id = e.id
       WHERE l.id = $1 AND (e.status = 'active' OR a.id IS NOT NULL)
         AND s.starts_at >= $2 AND s.starts_at < $3
       ORDER BY s.starts_at, s.id
       ${limitSql}`,
      [learnerId, range.from, range.to],
    );
    sessions = rows;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    const { rows } = await database.query(
      `SELECT s.id, s.programme_id, p.name AS programme_name, s.title, s.starts_at,
         a.status AS attendance_status
       FROM enrolments e
       JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
       JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
       JOIN training_sessions s ON s.programme_id = e.programme_id
         AND s.provider_user_id = e.provider_user_id AND s.archived_at IS NULL
       LEFT JOIN attendance_records a ON a.session_id = s.id AND a.enrolment_id = e.id
       WHERE l.id = $1 AND (e.status = 'active' OR a.id IS NOT NULL)
         AND s.starts_at >= $2 AND s.starts_at < $3
       ORDER BY s.starts_at, s.id
       ${limitSql}`,
      [learnerId, range.from, range.to],
    );
    sessions = rows;
  }
  let assessments = [];
  try {
    const { rows } = await database.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (a.id) a.id, a.programme_id, p.name AS programme_name, a.title,
           a.starts_at, a.ends_at, a.location, a.status, assessor.full_name AS assessor_name,
           (a.enrolment_id IS NOT NULL) AS is_individual
         FROM assessment_schedules a
         JOIN programmes p ON p.id = a.programme_id
         JOIN users assessor ON assessor.id = a.assessor_user_id
         JOIN enrolments e ON e.programme_id = a.programme_id AND e.provider_user_id = a.provider_user_id
           AND (a.enrolment_id = e.id OR (a.enrolment_id IS NULL AND e.status = 'active'))
         JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
         WHERE l.id = $1 AND a.starts_at >= $2 AND a.starts_at < $3
         ORDER BY a.id
       ) items
       ORDER BY starts_at, id
       ${limitSql}`,
      [learnerId, range.from, range.to],
    );
    assessments = rows;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }
  return { sessions, assessments };
}

module.exports = {
  createAssessorCalendarRouter,
  createProviderCalendarRouter,
  getLearnerCalendar,
  requireRange,
};
