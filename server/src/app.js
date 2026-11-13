const express = require('express');
const cors = require('cors');
const { createAuthRouter } = require('./auth');
const { createAssessorAssignmentsRouter } = require('./assessor-assignments');
const { createEnrolmentsRouter } = require('./enrolments');
const { createEvidenceRequirementsRouter } = require('./evidence-requirements');
const { createEvidenceReviewsRouter } = require('./evidence-reviews');
const { createEvidenceSubmissionsRouter } = require('./evidence-submissions');
const { createLocalEvidenceStorage } = require('./storage/local-evidence-storage');
const { createLearnerPortalRouter } = require('./learner-portal');
const { createLearnersRouter } = require('./learners');
const { createProgrammesRouter } = require('./programmes');
const { createQaAdminRouter, createQaRouter } = require('./qa');
const {
  createProviderQaFindingsRouter,
  createQaFindingOptionsAdminRouter,
  createQaFindingsRouter,
} = require('./qa-findings');
const { createSessionsRouter } = require('./sessions');
const {
  createAssessorAssessmentSchedulesRouter,
  createProviderAssessmentSchedulesRouter,
} = require('./assessment-schedules');
const { createAssessorCalendarRouter, createProviderCalendarRouter } = require('./calendar');
const { createNotificationsRouter } = require('./notifications');
const {
  createCertificateAdminRouter,
  createCertificateVerificationRouter,
  createLearnerCertificatesRouter,
  createProviderCertificateRouter,
  createQaCertificateRouter,
} = require('./certificates');
const { isDatabaseConnectionError } = require('./database');

function normalizeWebOrigins(webOriginInput) {
  const rawValues = Array.isArray(webOriginInput)
    ? webOriginInput
    : typeof webOriginInput === 'string'
      ? webOriginInput.split(',')
      : [];

  return rawValues
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      let parsedOrigin;
      try {
        parsedOrigin = new URL(value);
      } catch {
        throw new Error('WEB_ORIGIN must be a valid origin URL.');
      }
      if (parsedOrigin.origin !== value) {
        throw new Error('WEB_ORIGIN must contain only an origin, without a path.');
      }
      if (process.env.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') {
        throw new Error('WEB_ORIGIN must use HTTPS in production.');
      }
      return parsedOrigin.origin;
    });
}

function isLocalDevOrigin(origin) {
  if (typeof origin !== 'string' || !origin.trim()) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin);
}

function isExpoDevOrigin(origin) {
  if (typeof origin !== 'string' || !origin.trim()) return false;
  return /^(https?:\/\/)?([a-z0-9-]+\.)*(on\.)?expo\.(app|dev)$/i.test(origin)
    || /^https:\/\/([a-z0-9-]+\.)*on\.expo\.app$/i.test(origin)
    || /^https:\/\/([a-z0-9-]+\.)*expo\.app$/i.test(origin)
    || /^https:\/\/([a-z0-9-]+\.)*expo\.dev$/i.test(origin);
}

function createApp(database, { jwtSecret, evidenceStorage, webOrigin }) {
  const configuredWebOrigins = normalizeWebOrigins(webOrigin ?? process.env.WEB_ORIGIN);
  const allowedWebOrigins = new Set(configuredWebOrigins);
  const isAllowedOrigin = (origin) => Boolean(origin && (
    allowedWebOrigins.has(origin)
    || isLocalDevOrigin(origin)
    || isExpoDevOrigin(origin)
  ));
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
  if (process.env.NODE_ENV === 'production' && configuredWebOrigins.length === 0) {
    throw new Error('WEB_ORIGIN must be configured in production.');
  }
  const app = express();
  const corsOrigin = (configuredWebOrigins.length > 0 || process.env.NODE_ENV !== 'production')
    ? (origin, callback) => {
        if (!origin || isAllowedOrigin(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      }
    : false;

  app.use(cors({
    origin: corsOrigin,
    credentials: true,
    allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'X-Auth-Mode'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  }));
  app.use('/api', (request, response, next) => {
    if (request.get('x-auth-mode') === 'cookie'
      && !isAllowedOrigin(request.get('origin') || '')) {
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
  app.use('/api/certificates', createCertificateVerificationRouter({ database }));
  app.use('/api/admin', createCertificateAdminRouter({ database, jwtSecret, evidenceStorage: configuredEvidenceStorage }));
  app.use('/api/admin/qa-finding-options', createQaFindingOptionsAdminRouter({ database, jwtSecret }));
  app.use('/api/admin', createAssessorAssignmentsRouter({ database, jwtSecret }));
  app.use('/api/admin', createQaAdminRouter({ database, jwtSecret }));
  app.use('/api/assessor/assessment-schedules', createAssessorAssessmentSchedulesRouter({ database, jwtSecret }));
  app.use('/api/assessor/calendar', createAssessorCalendarRouter({ database, jwtSecret }));
  app.use('/api/assessor', createEvidenceReviewsRouter({ database, jwtSecret, evidenceStorage: configuredEvidenceStorage }));
  app.use('/api/learner', createLearnerPortalRouter({ database, jwtSecret }));
  app.use('/api/learner/certificates', createLearnerCertificatesRouter({ database, jwtSecret, evidenceStorage: configuredEvidenceStorage }));
  app.use('/api/qa/certification', createQaCertificateRouter({ database, jwtSecret }));
  app.use('/api/qa/findings', createQaFindingsRouter({ database, jwtSecret }));
  app.use('/api/provider/qa-findings', createProviderQaFindingsRouter({ database, jwtSecret }));
  app.use('/api/qa', createQaRouter({ database, jwtSecret, evidenceStorage: configuredEvidenceStorage }));
  app.use('/api/notifications', createNotificationsRouter({ database, jwtSecret }));
  app.use('/api/enrolments', createEnrolmentsRouter({ database, jwtSecret }));
  app.use('/api/assessment-schedules', createProviderAssessmentSchedulesRouter({ database, jwtSecret }));
  app.use('/api/calendar', createProviderCalendarRouter({ database, jwtSecret }));
  app.use('/api', createEvidenceSubmissionsRouter({
    database,
    jwtSecret,
    evidenceStorage: configuredEvidenceStorage,
  }));
  app.use(
    '/api/programmes/:programmeId/evidence-requirements',
    createEvidenceRequirementsRouter({ database, jwtSecret }),
  );
  app.use('/api/programmes', createProviderCertificateRouter({ database, jwtSecret }));
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
    if (error.status === 409) {
      return response.status(409).json({ error: error.message });
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
