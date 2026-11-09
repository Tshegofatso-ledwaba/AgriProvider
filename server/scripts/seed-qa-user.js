require('dotenv').config({ path: 'c:/Users/student/Desktop/AgriProvider/server/.env' });
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const db = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const hash = await bcrypt.hash('Password123!', 12);
  const result = await db.query(
    `INSERT INTO users (id, email, full_name, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (email) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       is_active = TRUE
     RETURNING email, role`,
    [randomUUID(), 'qa@example.com', 'QA User', hash, 'qa'],
  );
  console.log('created', result.rows[0]);
  await db.end();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
