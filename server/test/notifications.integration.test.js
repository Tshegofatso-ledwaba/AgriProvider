const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { test } = require('node:test');

const databaseUrl = process.env.AGRI_TEST_DATABASE_URL;

test('QA database triggers create notifications for assigned QA, provider, and linked learner', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  const providerId = randomUUID();
  const qaId = randomUUID();
  const assessorId = randomUUID();
  const learnerUserId = randomUUID();
  const programmeId = randomUUID();
  const learnerId = randomUUID();
  const enrolmentId = randomUUID();
  const requirementId = randomUUID();
  const submissionId = randomUUID();
  const assessorAssignmentId = randomUUID();
  const qaAssignmentId = randomUUID();
  const assessmentReviewId = randomUUID();
  const now = new Date().toISOString();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES
         ($1, $2, 'Synthetic QA provider', 'not-a-login-hash', 'provider'),
         ($3, $4, 'Synthetic QA officer', 'not-a-login-hash', 'qa'),
         ($5, $6, 'Synthetic assessor', 'not-a-login-hash', 'assessor'),
         ($7, $8, 'Synthetic learner', 'not-a-login-hash', 'learner')`,
      [
        providerId, `${providerId}@example.test`,
        qaId, `${qaId}@example.test`,
        assessorId, `${assessorId}@example.test`,
        learnerUserId, `${learnerUserId}@example.test`,
      ],
    );
    await client.query(
      `INSERT INTO programmes (id, provider_user_id, name)
       VALUES ($1, $2, 'Synthetic QA notifications')`,
      [programmeId, providerId],
    );
    await client.query(
      `INSERT INTO learners (id, provider_user_id, learner_reference, full_name, email, learner_user_id)
       VALUES ($1, $2, $3, 'Synthetic QA learner', $4, $5)`,
      [learnerId, providerId, `LRN-${randomUUID()}`, `${learnerUserId}@example.test`, learnerUserId],
    );
    await client.query(
      `INSERT INTO enrolments (
         id, provider_user_id, learner_id, programme_id, status, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, 'active', $2, $2)`,
      [enrolmentId, providerId, learnerId, programmeId],
    );
    await client.query(
      `INSERT INTO programme_evidence_requirements (
         id, provider_user_id, programme_id, title, created_by, updated_by
       ) VALUES ($1, $2, $3, 'Synthetic QA requirement', $2, $2)`,
      [requirementId, providerId, programmeId],
    );
    await client.query(
      `INSERT INTO programme_assessor_assignments (
         id, programme_id, assessor_user_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $4)`,
      [assessorAssignmentId, programmeId, assessorId, providerId],
    );
    await client.query(
      `INSERT INTO qa_programme_assignments (
         id, programme_id, qa_user_id, assigned_by, updated_by
       ) VALUES ($1, $2, $3, $4, $4)`,
      [qaAssignmentId, programmeId, qaId, providerId],
    );
    await client.query(
      `INSERT INTO evidence_submissions (
         id, provider_user_id, programme_id, enrolment_id, requirement_id, submitted_by,
         original_filename, mime_type, file_size, sha256, storage_provider, storage_key,
         status, version
       ) VALUES ($1, $2, $3, $4, $5, $2, 'synthetic.pdf', 'application/pdf', 8,
         $6, 'integration-test', $7, 'APPROVED', 1)`,
      [submissionId, providerId, programmeId, enrolmentId, requirementId, 'b'.repeat(64), randomUUID()],
    );
    await client.query(
      `INSERT INTO evidence_reviews (
         id, evidence_submission_id, submission_version, programme_id,
         assignment_id, assessor_user_id, decision
       ) VALUES ($1, $2, 1, $3, $4, $5, 'APPROVED')`,
      [assessmentReviewId, submissionId, programmeId, assessorAssignmentId, assessorId],
    );
    await client.query(
      `INSERT INTO qa_reviews (
         id, evidence_review_id, evidence_submission_id, submission_version,
         programme_id, assignment_id, qa_user_id, decision, comments
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, 'FURTHER_ACTION_REQUIRED', 'Synthetic QA integration comment')`,
      [randomUUID(), assessmentReviewId, submissionId, programmeId, qaAssignmentId, qaId],
    );

    const result = await client.query(
      `SELECT recipient_user_id, event_type, category
       FROM notifications
       WHERE recipient_user_id = ANY($1::uuid[])`,
      [[providerId, qaId, learnerUserId]],
    );
    const events = new Set(result.rows.map((row) => `${row.recipient_user_id}:${row.event_type}:${row.category}`));
    assert.ok(events.has(`${qaId}:qa.assignment_changed:qa`));
    assert.ok(events.has(`${qaId}:qa.assessment_ready:qa`));
    assert.ok(events.has(`${providerId}:qa.review_completed:qa`));
    assert.ok(events.has(`${learnerUserId}:qa.review_completed:qa`));
    assert.ok(result.rows.every((row) => [providerId, qaId, learnerUserId].includes(row.recipient_user_id)));
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  }
});
