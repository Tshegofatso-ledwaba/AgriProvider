const { Pool } = require('pg');

const databaseConnectionErrorCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  '57P01',
  '57P02',
  '57P03',
]);

function isDatabaseConnectionError(error) {
  if (databaseConnectionErrorCodes.has(error.code)) {
    return true;
  }
  return Array.isArray(error.errors) && error.errors.some(isDatabaseConnectionError);
}

function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  return new Pool({
    connectionString,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
}

module.exports = { createPool, isDatabaseConnectionError };
