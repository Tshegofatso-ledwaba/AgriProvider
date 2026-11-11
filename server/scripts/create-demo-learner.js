const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const learnerPassword = process.env.DEMO_LEARNER_PASSWORD;
  const passwordBytes = Buffer.byteLength(learnerPassword || '', 'utf8');
  if (passwordBytes < 12 || passwordBytes > 72) {
    throw new Error('Set DEMO_LEARNER_PASSWORD to a value between 12 and 72 UTF-8 bytes.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const provider = await client.query(
      'SELECT id FROM users WHERE email = $1 AND role = $2 LIMIT 1',
      ['provider@example.com', 'provider'],
    );

    if (!provider.rowCount) {
      throw new Error('Provider account not found. Create a provider account first.');
    }

    const providerUserId = provider.rows[0].id;
    const passwordHash = await bcrypt.hash(learnerPassword, 12);
    const learnerUserId = randomUUID();

    await client.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'learner')
       ON CONFLICT (email) DO NOTHING`,
      [learnerUserId, 'learner@example.com', 'Learner User', passwordHash],
    );

    const userRow = await client.query(
      'SELECT id FROM users WHERE email = $1 AND role = $2 LIMIT 1',
      ['learner@example.com', 'learner'],
    );

    if (!userRow.rowCount) {
      throw new Error('Learner account could not be created.');
    }

    const learnerId = randomUUID();
    const learnerReference = 'LRN-DEMO-001';

    await client.query(
      `INSERT INTO learners (id, provider_user_id, learner_reference, full_name, phone, email, learner_user_id)
       VALUES ($1, $2, $3, $4, NULL, $5, $6)
       ON CONFLICT (learner_user_id) DO NOTHING`,
      [learnerId, providerUserId, learnerReference, 'Learner User', 'learner@example.com', userRow.rows[0].id],
    );

    console.log('Demo learner account ready: learner@example.com');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Demo learner creation failed:', error.message);
  process.exit(1);
});
