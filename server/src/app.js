const express = require('express');
const cors = require('cors');
const { createAuthRouter } = require('./auth');
const { createAssessorAssignmentsRouter } = require('./assessor-assignments');
const { createEnrolmentsRouter } = require('./enrolments');
const { createEvidenceRequirementsRouter } = require('./evidence-requirements');
const { createEvidenceReviewsRouter } = require('./evidence-reviews');
const { createEvidenceSubmissionsRouter } = require('./evidence-submissions');
const { createLocalEvidenceStorage } = require('./storage/local-evidence-storage');
const { createLearnersRouter } = require('./learners');
const { createProgrammesRouter } = require('./programmes');
const { createSessionsRouter } = require('./sessions');
const { isDatabaseConnectionError } = require('./database');

function createApp(database, { jwtSecret, evidenceStorage, webOrigin }) {
  const configuredWebOrigin = webOrigin ?? process.env.WEB_ORIGIN;
  if (configuredWebOrigin) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(configuredWebOrigin);
    } catch {
      throw new Error('WEB_ORIGIN must be a valid origin URL.');
    }
    if (parsedOrigin.origin !== configuredWebOrigin) {
      throw new Error('WEB_ORIGIN must contain only an origin, without a path.');
    }
    if (process.env.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') {
      throw new Error('WEB_ORIGIN must use HTTPS in production.');
    }
  }
  const configuredEvidenceStorage = evidenceStorage ?? createLocalEvidenceStorage();
  const hasStorageAdapter = typeof configuredEvidenceStorage.provider === 'string'
    && typeof configuredEvidenceStorage.save === 'function'
    && typeof configuredEvidenceStorage.read === 'function'
    && typeof configuredEvidenceStorage.delete === 'function';
  if (!hasStorageAdapter) {
    throw new Error('Evidence storage adapter must provide provider, save, read, and delete.');
  }
  if (process.env.NODE_ENV === 'production'
    && (!evidenceStorage || configuredEvidenceStorage.provider === 'local-development')) {
    throw new Error('Production requires an explicitly configured private evidence storage adapter.');
  }
  if (process.env.NODE_ENV === 'production' && !configuredWebOrigin) {
    throw new Error('WEB_ORIGIN must be configured in production.');
  }
  const app = express();

  app.use(cors({
    origin: configuredWebOrigin || false,
    credentials: true,
    allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'X-Auth-Mode'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  }));
  app.use('/api', (request, response, next) => {
    if (request.get('x-auth-mode') === 'cookie'
      && (!configuredWebOrigin || request.get('origin') !== configuredWebOrigin)) {
      return response.status(403).json({ error: 'This web session origin is not allowed.' });
    }
    return next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/auth', createAuthRouter({
    database,
    jwtSecret,
    secureCookies: process.env.NODE_ENV === 'production',
  }));
  app.use('/api/admin', createAssessorAssignmentsRouter({ database, jwtSecret }));
  app.use('/api/assessor', createEvidenceReviewsRouter({ database, jwtSecret, evidenceStorage: configuredEvidenceStorage }));
  app.use('/api/enrolments', createEnrolmentsRouter({ database, jwtSecret }));
  app.use('/api', createEvidenceSubmissionsRouter({
    database,
    jwtSecret,
    evidenceStorage: configuredEvidenceStorage,
  }));
  app.use(
    '/api/programmes/:programmeId/evidence-requirements',
    createEvidenceRequirementsRouter({ database, jwtSecret }),
  );
  app.use('/api/learners', createLearnersRouter({ database, jwtSecret }));
  app.use('/api/programmes', createProgrammesRouter({ database, jwtSecret }));
  app.use('/api/sessions', createSessionsRouter({ database, jwtSecret }));

  app.get('/health', async (_request, response) => {
    try {
      await database.query('SELECT 1');
      response.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      console.error('Database health check failed:', error.code || error.name);
      response.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use((error, _request, response, next) => {
    if (response.headersSent) {
      return next(error);
    }

    if (error.status === 400) {
      return response.status(400).json({ error: 'Invalid JSON body.' });
    }
    if (error.status === 413) {
      return response.status(413).json({ error: 'Request body is too large.' });
    }
    if (isDatabaseConnectionError(error)) {
      console.error('Database connection unavailable:', error.code || error.name);
      return response.status(503).json({ error: 'The service is temporarily unavailable. Please try again.' });
    }

    console.error('Unhandled API error:', { name: error.name, code: error.code });
    return response.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
