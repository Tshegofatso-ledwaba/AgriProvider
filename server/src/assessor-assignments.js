const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateAssignmentBody(body) {
  if (!isObject(body) || Object.keys(body).some((key) => !['programmeId', 'assessorUserId'].includes(key))) {
    return { error: 'Provide only programmeId and assessorUserId.' };
  }
  if (!uuidPattern.test(body.programmeId ?? '') || !uuidPattern.test(body.assessorUserId ?? '')) {
    return { error: 'Programme and assessor IDs must be UUIDs.' };
  }
  return { value: { programmeId: body.programmeId, assessorUserId: body.assessorUserId } };
}

function createAssessorAssignmentsRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('admin'));

  router.get('/assessors', async (_request, response, next) => {
    try {
      const { rows } = await database.query(
        `SELECT id, full_name, email
         FROM users
         WHERE role = 'assessor' AND is_active = TRUE
         ORDER BY full_name, email`,
      );
      return response.json({ assessors: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/programmes', async (_request, response, next) => {
    try {
      const { rows } = await database.query(
        `SELECT p.id, p.name, p.provider_user_id, u.full_name AS provider_name
         FROM programmes p
         JOIN users u ON u.id = p.provider_user_id
         WHERE p.archived_at IS NULL
         ORDER BY p.name, p.id`,
      );
      return response.json({ programmes: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/assessor-assignments', async (_request, response, next) => {
    try {
      const { rows } = await database.query(
        `SELECT a.id, a.programme_id, p.name AS programme_name,
           a.assessor_user_id, assessor.full_name AS assessor_name, assessor.email AS assessor_email,
           a.created_by, administrator.full_name AS created_by_name,
           a.status, a.created_at, a.updated_at, a.deactivated_at
         FROM programme_assessor_assignments a
         JOIN programmes p ON p.id = a.programme_id
         JOIN users assessor ON assessor.id = a.assessor_user_id
         JOIN users administrator ON administrator.id = a.created_by
         ORDER BY a.created_at DESC, a.id`,
      );
      return response.json({ assignments: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/assessor-assignments', async (request, response, next) => {
    const validated = validateAssignmentBody(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });

    try {
      const { rows } = await database.query(
        `INSERT INTO programme_assessor_assignments (
           id, programme_id, assessor_user_id, created_by
         )
         SELECT $1, p.id, assessor.id, $4
         FROM programmes p
         JOIN users assessor ON assessor.id = $3
           AND assessor.role = 'assessor' AND assessor.is_active = TRUE
         WHERE p.id = $2 AND p.archived_at IS NULL
         RETURNING id, programme_id, assessor_user_id, created_by,
           status, created_at, updated_at, deactivated_at`,
        [
          randomUUID(),
          validated.value.programmeId,
          validated.value.assessorUserId,
          request.auth.userId,
        ],
      );
      if (!rows[0]) {
        return response.status(404).json({ error: 'Active programme or assessor not found.' });
      }
      return response.status(201).json({ assignment: rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return response.status(409).json({
          error: 'This assessor is already actively assigned to the programme.',
          code: 'ACTIVE_ASSIGNMENT_EXISTS',
        });
      }
      return next(error);
    }
  });

  router.patch('/assessor-assignments/:assignmentId', async (request, response, next) => {
    if (!uuidPattern.test(request.params.assignmentId)) {
      return response.status(400).json({ error: 'Assignment ID must be a UUID.' });
    }
    const body = request.body;
    const statusUpdate = isObject(body) && Object.keys(body).length === 1
      && ['ACTIVE', 'INACTIVE'].includes(body.status);
    const assessorUpdate = isObject(body) && Object.keys(body).length === 1
      && uuidPattern.test(body.assessorUserId ?? '');
    if (!statusUpdate && !assessorUpdate) {
      return response.status(400).json({ error: 'Provide an ACTIVE or INACTIVE status, or a valid assessorUserId to reassign.' });
    }

    if (assessorUpdate) {
      let client;
      let transactionStarted = false;
      try {
        client = await database.connect();
        await client.query('BEGIN');
        transactionStarted = true;
        const { rows: assignmentRows } = await client.query(
          `SELECT id, programme_id, assessor_user_id, status
           FROM programme_assessor_assignments
           WHERE id = $1 FOR UPDATE`,
          [request.params.assignmentId],
        );
        const current = assignmentRows[0];
        if (!current) throw Object.assign(new Error('Assignment not found'), { status: 404 });
        if (current.status !== 'ACTIVE') {
          throw Object.assign(new Error('Only active assignments can be reassigned.'), { status: 409 });
        }
        const { rows: assessorRows } = await client.query(
          `SELECT id FROM users WHERE id = $1 AND role = 'assessor' AND is_active = TRUE`,
          [body.assessorUserId],
        );
        if (!assessorRows[0]) throw Object.assign(new Error('Active assessor not found.'), { status: 404 });
        if (current.assessor_user_id === body.assessorUserId) {
          throw Object.assign(new Error('Choose a different assessor to reassign this programme.'), { status: 400 });
        }
        const { rows: newRows } = await client.query(
          `INSERT INTO programme_assessor_assignments (
             id, programme_id, assessor_user_id, created_by
           ) VALUES ($1, $2, $3, $4)
           RETURNING id, programme_id, assessor_user_id, created_by,
             status, created_at, updated_at, deactivated_at`,
          [randomUUID(), current.programme_id, body.assessorUserId, request.auth.userId],
        );
        const { rows: deactivatedRows } = await client.query(
          `UPDATE programme_assessor_assignments
           SET status = 'INACTIVE', deactivated_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'ACTIVE'
           RETURNING id`,
          [current.id],
        );
        if (!deactivatedRows[0]) throw Object.assign(new Error('Assignment changed before reassignment.'), { status: 409 });
        await client.query('COMMIT');
        transactionStarted = false;
        return response.json({ assignment: newRows[0], previous_assignment_id: current.id });
      } catch (error) {
        if (transactionStarted) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            console.error('Assessor reassignment rollback failed:', rollbackError.code || rollbackError.name);
          }
        }
        if (error.status) {
          const bodyResponse = { error: error.message };
          if (error.code === '23505') bodyResponse.code = 'ACTIVE_ASSIGNMENT_EXISTS';
          return response.status(error.status).json(bodyResponse);
        }
        if (error.code === '23505') {
          return response.status(409).json({
            error: 'This assessor is already actively assigned to the programme.',
            code: 'ACTIVE_ASSIGNMENT_EXISTS',
          });
        }
        return next(error);
      } finally {
        client?.release();
      }
    }

    try {
      const { rows } = await database.query(
        `UPDATE programme_assessor_assignments
         SET status = $1,
           deactivated_at = CASE WHEN $1 = 'INACTIVE' THEN COALESCE(deactivated_at, NOW()) ELSE NULL END,
           updated_at = NOW()
         WHERE id = $2
         RETURNING id, programme_id, assessor_user_id, created_by,
           status, created_at, updated_at, deactivated_at`,
        [body.status, request.params.assignmentId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Assessor assignment not found.' });
      return response.json({ assignment: rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return response.status(409).json({
          error: 'This assessor is already actively assigned to the programme.',
          code: 'ACTIVE_ASSIGNMENT_EXISTS',
        });
      }
      return next(error);
    }
  });

  return router;
}

module.exports = { createAssessorAssignmentsRouter, validateAssignmentBody };