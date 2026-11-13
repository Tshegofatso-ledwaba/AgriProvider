require('dotenv').config();

const { createApp } = require('./app');
const { createPool } = require('./database');

const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}

const defaultWebOrigins = [
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:8083',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:8082',
  'http://127.0.0.1:8083',
];
const webOrigin = process.env.WEB_ORIGIN
  || (process.env.NODE_ENV === 'production' ? undefined : defaultWebOrigins.join(','));
const database = createPool();
const app = createApp(database, { jwtSecret, webOrigin });
const server = app.listen(port, () => {
  console.log(`AgriProvider API listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    try {
      await database.end();
    } catch (error) {
      console.error('Database pool shutdown failed:', error.message);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
