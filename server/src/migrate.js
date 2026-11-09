require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('./database');

async function applyMigrations(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationDirectory = path.join(__dirname, '..', 'migrations');
  const files = (await fs.readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const applied = [];

  for (const file of files) {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT name FROM schema_migrations WHERE name = $1',
        [file],
      );

      if (existing.rowCount > 0) {
        await client.query('COMMIT');
        continue;
      }

      const sql = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return applied;
}

async function main() {
  const database = createPool();
  try {
    const applied = await applyMigrations(database);
    console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'No pending migrations.');
  } finally {
    await database.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Database migration failed:', { name: error.name, code: error.code });
    process.exitCode = 1;
  });
}

module.exports = { applyMigrations };
