// End-to-end QA findings / corrective-action workflow against real PostgreSQL.
// Every request runs inside one outer transaction that is rolled back, so only
// synthetic records are created and nothing persists.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { test } = require('node:test');
const { createApp } = require('../src/app');

const databaseUrl = process.env.AGRI_TEST_DATABASE_URL;
const jwtSecret = 'qa-findings-integration-secret-with-32-plus-chars';
const migrationName = '202611130001_extend_qa_findings_workflow.sql';

function transactionalDatabase(client) {
  let depth = 0;
  // Serialise access: one physical connection is shared by all requests.
  let queue = Promise.resolve();
  const run = (text, values) => {
    const next = queue.then(() => client.query(text, values));
    queue = next.catch(() => {});
    return next;
  };
  // Top-level pool queries autocommit in production; emulate that with a
  // savepoint so an expected constraint error does not abort the outer test transaction.
  const autonomous = (text, values) => {
    const next = queue.then(async () => {
      await client.query('SAVEPOINT pool_query');
      try {
        const result = await client.query(text, values);
        await client.query('RELEASE SAVEPOINT pool_query');
        return result;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT pool_query');
        throw error;
      }
    });
    queue = next.catch(() => {});
    return next;
  };
  return {
    query: autonomous,
    connect: async () => ({
      query(text, values) {
        if (text === 'BEGIN') return run(`SAVEPOINT nested_${++depth}`);
        if (text === 'COMMIT') return run(`RELEASE SAVEPOINT nested_${depth--}`);
        if (text === 'ROLLBACK') return run(`ROLLBACK TO SAVEPOINT nested_${depth--}`);
        return run(text, values);
      },
      release() {},
    }),
  };
}

function tokenFor(id, role) {
  return jwt.sign({ role }, jwtSecret, {
    subject: id, audience: 'agriprovider-app', issuer: 'agriprovider-api', expiresIn: '10m',
  });
}

test('QA findings workflow enforces scope, transitions, history, notifications, and audit', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  let server;
  const ids = Object.fromEntries([
    'admin', 'provider', 'providerB', 'qa', 'qaB', 'assessor', 'learnerUser', 'programme', 'learner',
    'enrolment', 'requirement', 'submission', 'assessorAssignment', 'qaAssignment', 'assessmentReview', 'qaReview',
  ].map((key) => [key, randomUUID()]));

  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migrationName]);
    if (rowCount === 0) {
      await client.query(await fs.readFile(path.join(__dirname, '..', 'migrations', migrationName), 'utf8'));
    }

    const people = [
      ['admin', 'admin'], ['provider', 'provider'], ['providerB', 'provider'], ['qa', 'qa'],
      ['qaB', 'qa'], ['assessor', 'assessor'], ['learnerUser', 'learner'],
    ];
    for (const [key, role] of people) {
      await client.query(
        `INSERT INTO users (id, email, full_name, password_hash, role)
         VALUES ($1, $2, $3, 'not-a-login-hash', $4)`,
        [ids[key], `${ids[key]}@example.test`, `Synthetic ${key}`, role],
      );
    }
    await client.query(
      `INSERT INTO programmes (id, provider_user_id, name) VALUES ($1, $2, 'Synthetic findings programme')`,
      [ids.programme, ids.provider],
    );
    await client.query(
      `INSERT INTO learners (id, provider_user_id, learner_reference, full_name, email, learner_user_id)
       VALUES ($1, $2, $3, 'Synthetic findings learner', $4, $5)`,
      [ids.learner, ids.provider, `LRN-${randomUUID()}`, `${ids.learnerUser}@example.test`, ids.learnerUser],
    );
    await client.query(
      `INSERT INTO enrolments (id, provider_user_id, learner_id, programme_id, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'active', $2, $2)`,
      [ids.enrolment, ids.provider, ids.learner, ids.programme],
    );
    await client.query(
      `INSERT INTO programme_evidence_requirements (id, provider_user_id, programme_id, title, created_by, updated_by)
       VALUES ($1, $2, $3, 'Synthetic findings requirement', $2, $2)`,
      [ids.requirement, ids.provider, ids.programme],
    );
    await client.query(
      `INSERT INTO programme_assessor_assignments (id, programme_id, assessor_user_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)`,
      [ids.assessorAssignment, ids.programme, ids.assessor, ids.admin],
    );
    await client.query(
      `INSERT INTO qa_programme_assignments (id, programme_id, qa_user_id, assigned_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)`,
      [ids.qaAssignment, ids.programme, ids.qa, ids.admin],
    );
    await client.query(
      `INSERT INTO evidence_submissions (
         id, provider_user_id, programme_id, enrolment_id, requirement_id, submitted_by,
         original_filename, mime_type, file_size, sha256, storage_provider, storage_key, status, version
       ) VALUES ($1, $2, $3, $4, $5, $2, 'synthetic.pdf', 'application/pdf', 8, $6,
         'integration-test', $7, 'APPROVED', 1)`,
      [ids.submission, ids.provider, ids.programme, ids.enrolment, ids.requirement, 'c'.repeat(64), randomUUID()],
    );
    await client.query(
      `INSERT INTO evidence_reviews (
         id, evidence_submission_id, submission_version, programme_id, assignment_id, assessor_user_id, decision
       ) VALUES ($1, $2, 1, $3, $4, $5, 'APPROVED')`,
      [ids.assessmentReview, ids.submission, ids.programme, ids.assessorAssignment, ids.assessor],
    );
    await client.query(
      `INSERT INTO qa_reviews (
         id, evidence_review_id, evidence_submission_id, submission_version,
         programme_id, assignment_id, qa_user_id, decision, comments
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, 'FURTHER_ACTION_REQUIRED', 'Internal QA note not for providers')`,
      [ids.qaReview, ids.assessmentReview, ids.submission, ids.programme, ids.qaAssignment, ids.qa],
    );

    const evidenceStorage = { provider: 'integration-test', save() {}, read() {}, delete() {} };
    const app = createApp(transactionalDatabase(client), { jwtSecret, evidenceStorage, webOrigin: 'http://localhost:8081' });
    server = app.listen(0);
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const call = async (role, method, url, body) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${tokenFor(ids[role], people.find(([key]) => key === role)[1])}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json() };
    };

    // Administrator-configured options; no values are pre-seeded.
    const category = await call('admin', 'POST', '/api/admin/qa-finding-options', { kind: 'CATEGORY', label: `Synthetic category ${ids.admin}` });
    assert.equal(category.status, 201);
    const severity = await call('admin', 'POST', '/api/admin/qa-finding-options', { kind: 'SEVERITY', label: `Synthetic severity ${ids.admin}` });
    assert.equal(severity.status, 201);
    assert.equal((await call('admin', 'POST', '/api/admin/qa-finding-options', { kind: 'SEVERITY', label: ` synthetic SEVERITY ${ids.admin} ` })).status, 409);
    assert.equal((await call('qa', 'POST', '/api/admin/qa-finding-options', { kind: 'CATEGORY', label: 'Nope' })).status, 403);
    assert.equal((await call('provider', 'GET', '/api/admin/qa-finding-options')).status, 403);
    const qaOptions = await call('qa', 'GET', '/api/qa/findings/options');
    assert.ok(qaOptions.body.options.some((option) => option.id === category.body.option.id));

    // Finding creation and validation.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const createBody = {
      qaReviewId: ids.qaReview,
      finding: 'Assessment record lacks the signed observation sheet.',
      correctiveAction: 'Upload the signed observation sheet and confirm the assessor sign-off.',
      categoryId: category.body.option.id,
      severityId: severity.body.option.id,
      dueDate: tomorrow,
    };
    assert.equal((await call('qa', 'POST', '/api/qa/findings', { ...createBody, categoryId: severity.body.option.id })).status, 400);
    assert.equal((await call('qa', 'POST', '/api/qa/findings', { ...createBody, dueDate: '2020-01-01' })).status, 400);
    assert.equal((await call('qa', 'POST', '/api/qa/findings', { ...createBody, extra: true })).status, 400);
    assert.equal((await call('qaB', 'POST', '/api/qa/findings', createBody)).status, 404);
    assert.equal((await call('provider', 'POST', '/api/qa/findings', createBody)).status, 403);
    const created = await call('qa', 'POST', '/api/qa/findings', createBody);
    assert.equal(created.status, 201);
    const findingId = created.body.finding.id;
    assert.equal(created.body.finding.status, 'OPEN');
    assert.equal(created.body.finding.due_date, tomorrow);
    assert.equal(created.body.finding.category_label, category.body.option.label);
    assert.equal((await call('qa', 'POST', '/api/qa/findings', createBody)).status, 409);

    // Scope boundaries.
    assert.equal((await call('qaB', 'GET', `/api/qa/findings/${findingId}`)).status, 404);
    assert.equal((await call('providerB', 'GET', `/api/provider/qa-findings/${findingId}`)).status, 404);
    assert.equal((await call('providerB', 'POST', `/api/provider/qa-findings/${findingId}/response`, { response: 'x' })).status, 404);
    assert.equal((await call('learnerUser', 'GET', '/api/qa/findings')).status, 403);
    assert.equal((await call('learnerUser', 'GET', `/api/provider/qa-findings/${findingId}`)).status, 403);
    assert.equal((await call('assessor', 'GET', '/api/provider/qa-findings')).status, 403);

    // Provider view excludes internal QA review comments.
    const providerList = await call('provider', 'GET', '/api/provider/qa-findings');
    assert.equal(providerList.status, 200);
    assert.equal(providerList.body.summary.open, 1);
    assert.equal(JSON.stringify(providerList.body).includes('Internal QA note'), false);

    // Invalid transitions are rejected.
    assert.equal((await call('qa', 'POST', `/api/qa/findings/${findingId}/verify`, { comments: 'Too early' })).status, 409);
    assert.equal((await call('qa', 'POST', `/api/qa/findings/${findingId}/close`, { comments: 'Too early' })).status, 409);
    assert.equal((await call('provider', 'POST', `/api/provider/qa-findings/${findingId}/response`, { response: '  ' })).status, 400);

    // Respond -> return (reopen) -> respond -> verify -> close.
    const firstResponse = 'Observation sheet uploaded as evidence version 2.';
    let step = await call('provider', 'POST', `/api/provider/qa-findings/${findingId}/response`, { response: firstResponse });
    assert.equal(step.status, 200);
    assert.equal(step.body.finding.status, 'RESPONSE_SUBMITTED');
    assert.equal((await call('provider', 'POST', `/api/provider/qa-findings/${findingId}/response`, { response: 'Again' })).status, 409);

    step = await call('qa', 'POST', `/api/qa/findings/${findingId}/return`, { comments: 'The sheet is not signed. Please resubmit.' });
    assert.equal(step.status, 200);
    assert.equal(step.body.finding.status, 'OPEN');
    assert.equal(step.body.finding.provider_response, null);
    assert.ok(step.body.events.some((event) => event.event_type === 'PROVIDER_RESPONSE_SUBMITTED' && event.comments === firstResponse));

    step = await call('provider', 'POST', `/api/provider/qa-findings/${findingId}/response`, { response: 'Signed sheet uploaded.' });
    assert.equal(step.body.finding.status, 'RESPONSE_SUBMITTED');
    step = await call('qa', 'POST', `/api/qa/findings/${findingId}/verify`, { comments: 'Signed sheet confirmed.' });
    assert.equal(step.body.finding.status, 'VERIFIED');
    step = await call('qa', 'POST', `/api/qa/findings/${findingId}/close`, { comments: 'Corrective action complete.' });
    assert.equal(step.status, 200);
    assert.equal(step.body.finding.status, 'CLOSED');
    assert.equal((await call('qa', 'POST', `/api/qa/findings/${findingId}/close`, { comments: 'Twice' })).status, 409);
    assert.deepEqual(
      step.body.events.map((event) => event.event_type).sort(),
      ['FINDING_CLOSED', 'FINDING_CREATED', 'FINDING_VERIFIED', 'PROVIDER_RESPONSE_SUBMITTED', 'PROVIDER_RESPONSE_SUBMITTED', 'RESPONSE_RETURNED'],
    );

    // Overdue is derived from the due date, never stored.
    const second = await call('qa', 'POST', '/api/qa/findings', { ...createBody, finding: 'Second synthetic finding.', categoryId: null, severityId: null, dueDate: null });
    assert.equal(second.status, 201);
    await client.query("UPDATE qa_findings SET due_date = CURRENT_DATE - 1 WHERE id = $1", [second.body.finding.id]);
    const overdue = await call('qa', 'GET', '/api/qa/findings?status=OVERDUE');
    assert.deepEqual(overdue.body.findings.map((item) => item.id), [second.body.finding.id]);
    assert.equal(overdue.body.summary.overdue, 1);

    // Notifications reach the provider and the linked learner (closure only).
    const { rows: notifications } = await client.query(
      'SELECT recipient_user_id, event_type, action_path FROM notifications WHERE related_entity_id = $1',
      [findingId],
    );
    const providerEvents = notifications.filter((row) => row.recipient_user_id === ids.provider).map((row) => row.event_type);
    for (const eventType of ['qa.corrective_action_required', 'qa.corrective_action_returned', 'qa.corrective_action_verified', 'qa.corrective_action_closed']) {
      assert.ok(providerEvents.includes(eventType), eventType);
    }
    assert.deepEqual(
      notifications.filter((row) => row.recipient_user_id === ids.learnerUser).map((row) => row.event_type),
      ['qa.status_updated'],
    );
    assert.ok(notifications.every((row) => [ids.provider, ids.learnerUser, ids.qa].includes(row.recipient_user_id)));

    // Audit attributes provider responses to the provider, and findings cannot be deleted.
    const { rows: auditRows } = await client.query(
      `SELECT actor_user_id, actor_role FROM audit_events
       WHERE entity_type = 'qa_findings' AND entity_id = $1 AND 'status' = ANY(changed_fields)`,
      [findingId],
    );
    assert.ok(auditRows.some((row) => row.actor_user_id === ids.provider && row.actor_role === 'provider'));
    assert.ok(auditRows.some((row) => row.actor_user_id === ids.qa && row.actor_role === 'qa'));
    await client.query('SAVEPOINT delete_attempt');
    await assert.rejects(client.query('DELETE FROM qa_findings WHERE id = $1', [findingId]), /cannot be deleted/);
    await client.query('ROLLBACK TO SAVEPOINT delete_attempt');
  } finally {
    if (server) {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    }
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  }
});
