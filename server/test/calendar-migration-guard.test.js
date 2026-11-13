const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getLearnerCalendar } = require('../src/calendar');

test('learner calendar returns empty data when the schedule schema is not installed yet', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM assessment_schedules')) {
        const error = new Error('relation "assessment_schedules" does not exist');
        error.code = '42P01';
        throw error;
      }
      if (sql.includes('s.ends_at') || sql.includes('s.venue')) {
        const error = new Error('column s.ends_at does not exist');
        error.code = '42703';
        throw error;
      }
      return { rows: [] };
    },
  };

  const result = await getLearnerCalendar(database, '11111111-1111-4111-8111-111111111111', {
    from: '2026-11-13T00:00:00.000Z',
    to: '2026-11-20T00:00:00.000Z',
  });

  assert.deepEqual(result.sessions, []);
  assert.deepEqual(result.assessments, []);
});
