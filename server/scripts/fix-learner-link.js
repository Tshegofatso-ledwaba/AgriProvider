const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      ALTER TABLE learners
        ADD COLUMN IF NOT EXISTS learner_user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS learners_learner_user_idx
        ON learners (learner_user_id)
        WHERE learner_user_id IS NOT NULL;
    `);

    console.log('Learner user link column and index are ready.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Fix failed:', error.message);
  process.exit(1);
});
