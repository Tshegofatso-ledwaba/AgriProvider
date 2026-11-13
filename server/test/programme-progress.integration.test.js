const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { test } = require('node:test');
const { programmeProgressQuery } = require('../src/programmes');

const databaseUrl = process.env.AGRI_TEST_DATABASE_URL;

test('programme progress query aggregates real PostgreSQL workflow records', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  const providerId = randomUUID();
  const programmeId = randomUUID();
  const activeLearnerOne = randomUUID();
  const activeLearnerTwo = randomUUID();
  const withdrawnLearner = randomUUID();
  const activeEnrolmentOne = randomUUID();
  const activeEnrolmentTwo = randomUUID();
  const withdrawnEnrolment = randomUUID();
  const sessionId = randomUUID();
  const requirementOne = randomUUID();
  const requirementTwo = randomUUID();
  const now = new Date().toISOString();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, 'Synthetic progress test', 'not-a-login-hash', 'provider')`,
      [providerId, `${providerId}@example.test`],
    );
    await client.query(
      `INSERT INTO programmes (id, provider_user_id, name)
       VALUES ($1, $2, 'Synthetic progress test')`,
      [programmeId, providerId],
    );
    for (const [learnerId, reference, name] of [
      [activeLearnerOne, `LRN-${randomUUID()}`, 'Synthetic active learner one'],
      [activeLearnerTwo, `LRN-${randomUUID()}`, 'Synthetic active learner two'],
      [withdrawnLearner, `LRN-${randomUUID()}`, 'Synthetic withdrawn learner'],
    ]) {
      await client.query(
        `INSERT INTO learners (id, provider_user_id, learner_reference, full_name)
         VALUES ($1, $2, $3, $4)`,
        [learnerId, providerId, reference, name],
      );
    }
    for (const [enrolmentId, learnerId, status] of [
      [activeEnrolmentOne, activeLearnerOne, 'active'],
      [activeEnrolmentTwo, activeLearnerTwo, 'active'],
      [withdrawnEnrolment, withdrawnLearner, 'withdrawn'],
    ]) {
      await client.query(
        `INSERT INTO enrolments (
           id, provider_user_id, learner_id, programme_id, status, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $2, $2)`,
        [enrolmentId, providerId, learnerId, programmeId, status],
      );
    }
    await client.query(
      `INSERT INTO training_sessions (
         id, provider_user_id, programme_id, title, starts_at, created_by, updated_by
       ) VALUES ($1, $2, $3, 'Synthetic session', $4, $2, $2)`,
      [sessionId, providerId, programmeId, now],
    );
    for (const [enrolmentId, status] of [
      [activeEnrolmentOne, 'present'],
      [activeEnrolmentTwo, 'excused'],
    ]) {
      await client.query(
        `INSERT INTO attendance_records (
           id, provider_user_id, programme_id, session_id, enrolment_id, status, marked_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $2)`,
        [randomUUID(), providerId, programmeId, sessionId, enrolmentId, status],
      );
    }
    for (const [requirementId, title] of [
      [requirementOne, 'Synthetic requirement one'],
      [requirementTwo, 'Synthetic requirement two'],
    ]) {
      await client.query(
        `INSERT INTO programme_evidence_requirements (
           id, provider_user_id, programme_id, title, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $2, $2)`,
        [requirementId, providerId, programmeId, title],
      );
    }
    const submissions = [
      [activeEnrolmentOne, requirementOne, 1, 'APPROVED'],
      [activeEnrolmentOne, requirementOne, 2, 'CORRECTION_REQUIRED'],
      [activeEnrolmentOne, requirementTwo, 1, 'SUBMITTED'],
      [activeEnrolmentTwo, requirementOne, 1, 'UNDER_REVIEW'],
      [withdrawnEnrolment, requirementTwo, 1, 'APPROVED'],
    ];
    for (const [enrolmentId, requirementId, version, status] of submissions) {
      await client.query(
        `INSERT INTO evidence_submissions (
           id, provider_user_id, programme_id, enrolment_id, requirement_id, submitted_by,
           original_filename, mime_type, file_size, sha256, storage_provider, storage_key,
           status, version
         ) VALUES ($1, $2, $3, $4, $5, $2, 'synthetic.pdf', 'application/pdf', 8,
           $6, 'integration-test', $7, $8, $9)`,
        [
          randomUUID(), providerId, programmeId, enrolmentId, requirementId,
          'a'.repeat(64), randomUUID(), status, version,
        ],
      );
    }

    const result = await client.query(programmeProgressQuery, [programmeId, providerId]);
    assert.deepEqual(result.rows[0], {
      programme_id: programmeId,
      active_enrolments: 2,
      withdrawn_enrolments: 1,
      active_sessions: 1,
      attendance_recorded: 2,
      attendance_present: 1,
      attendance_absent: 0,
      attendance_excused: 1,
      evidence_requirements: 2,
      evidence_slots: 4,
      evidence_not_submitted: 1,
      evidence_submitted: 1,
      evidence_awaiting_review: 1,
      evidence_approved: 0,
      evidence_correction_required: 1,
    });

    const outOfScope = await client.query(programmeProgressQuery, [programmeId, randomUUID()]);
    assert.equal(outOfScope.rowCount, 0);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  }
});
