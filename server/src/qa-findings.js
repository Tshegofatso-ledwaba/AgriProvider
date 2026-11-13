const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const findingStatuses = ['OPEN', 'RESPONSE_SUBMITTED', 'VERIFIED', 'CLOSED'];
const listFilters = new Set(['all', 'OVERDUE', ...findingStatuses]);
const optionKinds = new Set(['CATEGORY', 'SEVERITY']);

// Explicit workflow. Anything not listed here is rejected by the server.
const transitions = {
  respond: {
    role: 'provider', from: 'OPEN', to: 'RESPONSE_SUBMITTED', event: 'PROVIDER_RESPONSE_SUBMITTED',
    set: 'provider_response = $4, responded_by = $2, responded_at = NOW()',
    wrongState: 'Only an open corrective action can receive a response.',
  },
  verify: {
    role: 'qa', from: 'RESPONSE_SUBMITTED', to: 'VERIFIED', event: 'FINDING_VERIFIED',
    set: 'verification_comments = $4, verified_by = $2, verified_at = NOW()',
    wrongState: 'Only a submitted provider response can be verified.',
  },
  return: {
    role: 'qa', from: 'RESPONSE_SUBMITTED', to: 'OPEN', event: 'RESPONSE_RETURNED',
    set: 'provider_response = NULL, responded_by = NULL, responded_at = NULL',
    wrongState: 'Only a submitted provider response can be returned for further action.',
  },
  close: {
    role: 'qa', from: 'VERIFIED', to: 'CLOSED', event: 'FINDING_CLOSED',
    set: 'closure_comments = $4, closed_by = $2, closed_at = NOW()',
    wrongState: 'Only a verified corrective action can be closed.',
  },
};

class FindingRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value, label, { required = true, max = 4000 } = {}) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim() && !required)) {
    if (required) return { error: `${label} is required.` };
    return { value: null };
  }
  if (typeof value !== 'string' || !value.trim()) return { error: `${label} is required.` };
  if (value.trim().length > max) return { error: `${label} must be ${max.toLocaleString('en-ZA')} characters or fewer.` };
  return { value: value.trim() };
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function validateDueDate(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !datePattern.test(value)) {
    return { error: 'Due date must use the YYYY-MM-DD format.' };
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { error: 'Due date must be a real calendar date.' };
  }
  if (value < todayUtc()) return { error: 'Due date cannot be in the past.' };
  return { value };
}

function validateOptionalOptionId(value, label) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !uuidPattern.test(value)) return { error: `${label} must be a UUID.` };
  return { value };
}

function validateCreateFindingBody(body) {
  const allowed = ['qaReviewId', 'finding', 'correctiveAction', 'categoryId', 'severityId', 'dueDate'];
  if (!isObject(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: `Provide only ${allowed.join(', ')}.` };
  }
  if (typeof body.qaReviewId !== 'string' || !uuidPattern.test(body.qaReviewId)) {
    return { error: 'QA review ID must be a UUID.' };
  }
  const finding = cleanText(body.finding, 'Finding');
  if (finding.error) return finding;
  const correctiveAction = cleanText(body.correctiveAction, 'Corrective action');
  if (correctiveAction.error) return correctiveAction;
  const categoryId = validateOptionalOptionId(body.categoryId, 'Category');
  if (categoryId.error) return categoryId;
  const severityId = validateOptionalOptionId(body.severityId, 'Severity');
  if (severityId.error) return severityId;
  const dueDate = validateDueDate(body.dueDate);
  if (dueDate.error) return dueDate;
  return {
    value: {
      qaReviewId: body.qaReviewId,
      finding: finding.value,
      correctiveAction: correctiveAction.value,
      categoryId: categoryId.value,
      severityId: severityId.value,
      dueDate: dueDate.value,
    },
  };
}

function validateCommentsBody(body, field, label) {
  if (!isObject(body) || Object.keys(body).length !== 1 || !(field in body)) {
    return { error: `Provide only ${field}.` };
  }
  return cleanText(body[field], label);
}

function validateOptionBody(body, { partial = false } = {}) {
  if (!isObject(body)) return { error: 'Provide a JSON object.' };
  const allowed = partial ? ['label', 'isActive'] : ['kind', 'label'];
  if (Object.keys(body).some((key) => !allowed.includes(key)) || Object.keys(body).length === 0) {
    return { error: `Provide only ${allowed.join(' and ')}.` };
  }
  const value = {};
  if (!partial) {
    if (!optionKinds.has(body.kind)) return { error: 'Kind must be CATEGORY or SEVERITY.' };
    value.kind = body.kind;
  }
  if (!partial || 'label' in body) {
    const label = cleanText(body.label, 'Label', { max: 80 });
    if (label.error) return label;
    value.label = label.value;
  }
  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') return { error: 'isActive must be true or false.' };
    value.isActive = body.isActive;
  }
  return { value };
}

function parsePaging(query) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    return { error: 'Limit must be 1–100 and offset must be zero or greater.' };
  }
  return { limit, offset };
}

const overdueSql = `(f.due_date IS NOT NULL AND f.status IN ('OPEN', 'RESPONSE_SUBMITTED') AND f.due_date < CURRENT_DATE)`;

// Deliberately excludes the QA review's internal comments; only the finding,
// corrective action, and the provider/QA exchange are returned.
const findingSelect = `SELECT f.id, f.status, f.finding, f.corrective_action,
    to_char(f.due_date, 'YYYY-MM-DD') AS due_date, ${overdueSql} AS is_overdue,
    f.created_at, f.updated_at, f.provider_response, f.responded_at,
    f.verification_comments, f.verified_at, f.closure_comments, f.closed_at,
    f.programme_id, p.name AS programme_name, f.provider_user_id, provider.full_name AS provider_name,
    f.qa_user_id, qa.full_name AS qa_name, f.qa_review_id, qr.decision AS qa_decision,
    s.id AS submission_id, s.version AS submission_version, r.title AS requirement_title,
    l.full_name AS learner_name, l.learner_reference,
    f.category_option_id, category.label AS category_label,
    f.severity_option_id, severity.label AS severity_label
  FROM qa_findings f
  JOIN programmes p ON p.id = f.programme_id
  JOIN users provider ON provider.id = f.provider_user_id
  JOIN users qa ON qa.id = f.qa_user_id
  JOIN qa_reviews qr ON qr.id = f.qa_review_id
  JOIN evidence_submissions s ON s.id = qr.evidence_submission_id AND s.version = qr.submission_version
  JOIN enrolments e ON e.id = s.enrolment_id
  JOIN learners l ON l.id = e.learner_id
  JOIN programme_evidence_requirements r ON r.id = s.requirement_id
  LEFT JOIN qa_finding_options category ON category.id = f.category_option_id
  LEFT JOIN qa_finding_options severity ON severity.id = f.severity_option_id`;

const qaScopeSql = (param) => `EXISTS (
  SELECT 1 FROM qa_programme_assignments scope
  WHERE scope.programme_id = f.programme_id AND scope.qa_user_id = ${param}
    AND scope.status = 'ACTIVE' AND scope.deactivated_at IS NULL
)`;
const providerScopeSql = (param) => `f.provider_user_id = ${param}`;

async function listFindings(database, request, response, scopeSql) {
  const status = request.query.status ?? 'all';
  const programmeId = request.query.programmeId;
  if (!listFilters.has(status)) return response.status(400).json({ error: 'Invalid finding status filter.' });
  if (programmeId !== undefined && !uuidPattern.test(programmeId)) {
    return response.status(400).json({ error: 'Programme ID must be a UUID.' });
  }
  const paging = parsePaging(request.query);
  if (paging.error) return response.status(400).json({ error: paging.error });

  const scopeValues = [request.auth.userId];
  const conditions = [scopeSql('$1')];
  if (programmeId) {
    scopeValues.push(programmeId);
    conditions.push(`f.programme_id = $${scopeValues.length}`);
  }
  const scopeWhere = conditions.join(' AND ');
  const filterConditions = [...conditions];
  if (status === 'OVERDUE') filterConditions.push(overdueSql);
  else if (status !== 'all') filterConditions.push(`f.status = '${status}'`);
  const filterWhere = filterConditions.join(' AND ');

  const { rows: summaryRows } = await database.query(
    `SELECT COUNT(*)::integer AS total,
       COUNT(*) FILTER (WHERE f.status = 'OPEN')::integer AS open,
       COUNT(*) FILTER (WHERE f.status = 'RESPONSE_SUBMITTED')::integer AS response_submitted,
       COUNT(*) FILTER (WHERE f.status = 'VERIFIED')::integer AS verified,
       COUNT(*) FILTER (WHERE f.status = 'CLOSED')::integer AS closed,
       COUNT(*) FILTER (WHERE ${overdueSql})::integer AS overdue
     FROM qa_findings f WHERE ${scopeWhere}`,
    scopeValues,
  );
  const { rows: countRows } = await database.query(
    `SELECT COUNT(*)::integer AS total FROM qa_findings f WHERE ${filterWhere}`,
    scopeValues,
  );
  const { rows } = await database.query(
    `${findingSelect}
     WHERE ${filterWhere}
     ORDER BY ${overdueSql} DESC, f.due_date ASC NULLS LAST, f.updated_at DESC, f.id
     LIMIT $${scopeValues.length + 1} OFFSET $${scopeValues.length + 2}`,
    [...scopeValues, paging.limit, paging.offset],
  );
  return response.json({
    findings: rows,
    summary: summaryRows[0],
    total: countRows[0]?.total ?? 0,
    limit: paging.limit,
    offset: paging.offset,
  });
}

async function loadFinding(database, findingId, userId, scopeSql) {
  const { rows } = await database.query(
    `${findingSelect} WHERE f.id = $2 AND ${scopeSql('$1')}`,
    [userId, findingId],
  );
  if (!rows[0]) return null;
  const { rows: events } = await database.query(
    `SELECT ev.id, ev.event_type, ev.actor_role, actor.full_name AS actor_name,
       ev.comments, ev.created_at
     FROM qa_finding_events ev
     JOIN users actor ON actor.id = ev.actor_user_id
     WHERE ev.finding_id = $1
     ORDER BY ev.created_at, ev.id`,
    [findingId],
  );
  return { finding: rows[0], events };
}

async function withTransaction(database, work) {
  const client = await database.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    const result = await work(client);
    await client.query('COMMIT');
    started = false;
    return result;
  } catch (error) {
    if (started) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('QA finding rollback failed:', rollbackError.code || rollbackError.name);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function sendKnownError(error, response, next) {
  if (error instanceof FindingRequestError) {
    return response.status(error.status).json({ error: error.message });
  }
  return next(error);
}

async function applyTransition(database, request, response, next, action, scopeSql) {
  const { findingId } = request.params;
  const transition = transitions[action];
  if (!uuidPattern.test(findingId)) return response.status(400).json({ error: 'Finding ID must be a UUID.' });
  const field = action === 'respond' ? 'response' : 'comments';
  const label = action === 'respond' ? 'Response' : 'Comments';
  const validated = validateCommentsBody(request.body, field, label);
  if (validated.error) return response.status(400).json({ error: validated.error });

  try {
    await withTransaction(database, async (client) => {
      const { rows } = await client.query(
        `SELECT f.status FROM qa_findings f WHERE f.id = $2 AND ${scopeSql('$1')} FOR UPDATE OF f`,
        [request.auth.userId, findingId],
      );
      if (!rows[0]) throw new FindingRequestError(404, 'Finding not found in your scope.');
      if (rows[0].status !== transition.from) throw new FindingRequestError(409, transition.wrongState);
      await client.query(
        `UPDATE qa_findings SET status = $3, ${transition.set},
           updated_by = $2, updated_at = NOW()
         WHERE id = $1`,
        transition.set.includes('$4')
          ? [findingId, request.auth.userId, transition.to, validated.value]
          : [findingId, request.auth.userId, transition.to],
      );
      await client.query(
        `INSERT INTO qa_finding_events (finding_id, actor_user_id, actor_role, event_type, comments)
         VALUES ($1, $2, $3, $4, $5)`,
        [findingId, request.auth.userId, transition.role, transition.event, validated.value],
      );
    });
    return response.json(await loadFinding(database, findingId, request.auth.userId, scopeSql));
  } catch (error) {
    return sendKnownError(error, response, next);
  }
}

async function listActiveOptions(database) {
  const { rows } = await database.query(
    `SELECT id, kind, label FROM qa_finding_options
     WHERE is_active = TRUE ORDER BY kind, lower(label), id`,
  );
  return rows;
}

function createQaFindingsRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('qa'));

  router.get('/options', async (_request, response, next) => {
    try {
      return response.json({ options: await listActiveOptions(database) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      return await listFindings(database, request, response, qaScopeSql);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const validated = validateCreateFindingBody(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });
    const values = validated.value;
    try {
      const findingId = await withTransaction(database, async (client) => {
        const { rows } = await client.query(
          `SELECT qr.id, qr.programme_id, qr.assignment_id, p.provider_user_id
           FROM qa_reviews qr
           JOIN qa_programme_assignments a ON a.id = qr.assignment_id
             AND a.qa_user_id = $2 AND a.status = 'ACTIVE' AND a.deactivated_at IS NULL
           JOIN programmes p ON p.id = qr.programme_id
           WHERE qr.id = $1 AND qr.qa_user_id = $2
           FOR UPDATE OF qr`,
          [values.qaReviewId, request.auth.userId],
        );
        const review = rows[0];
        if (!review) {
          throw new FindingRequestError(404, 'QA review not found. Findings can be recorded only on your own QA reviews within your active programme scope.');
        }
        const optionIds = [values.categoryId, values.severityId].filter(Boolean);
        if (optionIds.length) {
          const { rows: optionRows } = await client.query(
            'SELECT id, kind FROM qa_finding_options WHERE id = ANY($1::uuid[]) AND is_active = TRUE',
            [optionIds],
          );
          const kinds = new Map(optionRows.map((row) => [row.id, row.kind]));
          if (values.categoryId && kinds.get(values.categoryId) !== 'CATEGORY') {
            throw new FindingRequestError(400, 'Select an active finding category.');
          }
          if (values.severityId && kinds.get(values.severityId) !== 'SEVERITY') {
            throw new FindingRequestError(400, 'Select an active severity.');
          }
        }
        const { rows: duplicateRows } = await client.query(
          `SELECT id FROM qa_findings
           WHERE qa_review_id = $1 AND status <> 'CLOSED' AND finding = $2 AND corrective_action = $3`,
          [values.qaReviewId, values.finding, values.correctiveAction],
        );
        if (duplicateRows[0]) {
          throw new FindingRequestError(409, 'An identical unresolved finding already exists for this QA review.');
        }
        const { rows: insertRows } = await client.query(
          `INSERT INTO qa_findings (
             qa_review_id, programme_id, assignment_id, qa_user_id, provider_user_id,
             finding, corrective_action, category_option_id, severity_option_id, due_date, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $4)
           RETURNING id`,
          [
            review.id, review.programme_id, review.assignment_id, request.auth.userId,
            review.provider_user_id, values.finding, values.correctiveAction,
            values.categoryId, values.severityId, values.dueDate,
          ],
        );
        await client.query(
          `INSERT INTO qa_finding_events (finding_id, actor_user_id, actor_role, event_type)
           VALUES ($1, $2, 'qa', 'FINDING_CREATED')`,
          [insertRows[0].id, request.auth.userId],
        );
        return insertRows[0].id;
      });
      return response.status(201).json(await loadFinding(database, findingId, request.auth.userId, qaScopeSql));
    } catch (error) {
      return sendKnownError(error, response, next);
    }
  });

  router.get('/:findingId', async (request, response, next) => {
    const { findingId } = request.params;
    if (!uuidPattern.test(findingId)) return response.status(400).json({ error: 'Finding ID must be a UUID.' });
    try {
      const result = await loadFinding(database, findingId, request.auth.userId, qaScopeSql);
      if (!result) return response.status(404).json({ error: 'Finding not found in your scope.' });
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  for (const action of ['verify', 'return', 'close']) {
    router.post(`/:findingId/${action}`, (request, response, next) => applyTransition(
      database, request, response, next, action, qaScopeSql,
    ));
  }

  return router;
}

function createProviderQaFindingsRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('provider'));

  router.get('/', async (request, response, next) => {
    try {
      return await listFindings(database, request, response, providerScopeSql);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:findingId', async (request, response, next) => {
    const { findingId } = request.params;
    if (!uuidPattern.test(findingId)) return response.status(400).json({ error: 'Finding ID must be a UUID.' });
    try {
      const result = await loadFinding(database, findingId, request.auth.userId, providerScopeSql);
      if (!result) return response.status(404).json({ error: 'Corrective action not found.' });
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:findingId/response', (request, response, next) => applyTransition(
    database, request, response, next, 'respond', providerScopeSql,
  ));

  return router;
}

function createQaFindingOptionsAdminRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('admin'));

  const optionColumns = `o.id, o.kind, o.label, o.is_active, o.created_at, o.updated_at,
    (SELECT COUNT(*)::integer FROM qa_findings f
      WHERE f.category_option_id = o.id OR f.severity_option_id = o.id) AS usage_count`;

  router.get('/', async (_request, response, next) => {
    try {
      const { rows } = await database.query(
        `SELECT ${optionColumns} FROM qa_finding_options o ORDER BY o.kind, o.is_active DESC, lower(o.label), o.id`,
      );
      return response.json({ options: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const validated = validateOptionBody(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });
    try {
      const { rows } = await database.query(
        `INSERT INTO qa_finding_options (kind, label, created_by, updated_by)
         VALUES ($1, $2, $3, $3)
         RETURNING id, kind, label, is_active, created_at, updated_at, 0 AS usage_count`,
        [validated.value.kind, validated.value.label, request.auth.userId],
      );
      return response.status(201).json({ option: rows[0] });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'An option with this label already exists.' });
      return next(error);
    }
  });

  router.patch('/:optionId', async (request, response, next) => {
    const { optionId } = request.params;
    if (!uuidPattern.test(optionId)) return response.status(400).json({ error: 'Option ID must be a UUID.' });
    const validated = validateOptionBody(request.body, { partial: true });
    if (validated.error) return response.status(400).json({ error: validated.error });
    try {
      const { rows } = await database.query(
        `UPDATE qa_finding_options o
         SET label = COALESCE($2, o.label), is_active = COALESCE($3, o.is_active),
           updated_by = $4, updated_at = NOW()
         WHERE o.id = $1
         RETURNING ${optionColumns}`,
        [optionId, validated.value.label ?? null, validated.value.isActive ?? null, request.auth.userId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Option not found.' });
      return response.json({ option: rows[0] });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'An option with this label already exists.' });
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createProviderQaFindingsRouter,
  createQaFindingOptionsAdminRouter,
  createQaFindingsRouter,
  transitions,
  validateCreateFindingBody,
  validateDueDate,
  validateOptionBody,
};
