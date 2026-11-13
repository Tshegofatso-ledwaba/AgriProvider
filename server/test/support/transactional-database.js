// Shared harness for PostgreSQL integration tests: every query (including the
// app's own transactions) runs on one connection inside an outer transaction
// that the test rolls back, so only synthetic rows exist and nothing persists.
const fs = require('node:fs/promises');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const jwtSecret = 'integration-test-secret-with-more-than-32-characters';

function transactionalDatabase(client) {
  let depth = 0;
  let queue = Promise.resolve();
  const enqueue = (work) => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };
  const run = (text, values) => enqueue(() => client.query(text, values));
  // Top-level pool queries autocommit in production; a savepoint keeps an
  // expected constraint error from aborting the outer test transaction.
  const autonomous = (text, values) => enqueue(async () => {
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

async function applyMigrationIfPending(client, name) {
  const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  if (rowCount === 0) {
    await client.query(await fs.readFile(path.join(__dirname, '..', '..', 'migrations', name), 'utf8'));
  }
}

function tokenFor(id, role) {
  return jwt.sign({ role }, jwtSecret, {
    subject: id, audience: 'agriprovider-app', issuer: 'agriprovider-api', expiresIn: '10m',
  });
}

function apiClient(baseUrl, roleOf) {
  return async (who, method, url, body) => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenFor(who, roleOf(who))}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
}

module.exports = { apiClient, applyMigrationIfPending, jwtSecret, tokenFor, transactionalDatabase };
