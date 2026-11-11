const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { after, before, test } = require('node:test');
const { createQaAdminRouter, createQaRouter } = require('../src/qa');

const jwtSecret = 'qa-test-secret-with-more-than-thirty-two-characters';
const providerId = randomUUID();
const providerBId = randomUUID();
const assessorId = randomUUID();
const qaId = randomUUID();
const qaBId = randomUUID();
const adminId = randomUUID();
const programmeId = randomUUID();
const programmeBId = randomUUID();
const learnerId = randomUUID();
const learnerBId = randomUUID();
const assignmentId = randomUUID();
const assignmentBId = randomUUID();
const submissionId = randomUUID();
const submissionBId = randomUUID();
const reviewedSubmissionId = randomUUID();
const assessmentReviewId = randomUUID();
const assessmentReviewBId = randomUUID();
const reviewedAssessmentId = randomUUID();
const fileBytes = Buffer.from('private test evidence');
const now = new Date().toISOString();

const users = [
  { id: providerId, email: 'provider-a@example.test', full_name: 'Provider A', role: 'provider', is_active: true },
  { id: providerBId, email: 'provider-b@example.test', full_name: 'Provider B', role: 'provider', is_active: true },
  { id: assessorId, email: 'assessor@example.test', full_name: 'Assessor A', role: 'assessor', is_active: true },
  { id: qaId, email: 'qa-a@example.test', full_name: 'QA Officer A', role: 'qa', is_active: true },
  { id: qaBId, email: 'qa-b@example.test', full_name: 'QA Officer B', role: 'qa', is_active: true },
  { id: adminId, email: 'admin@example.test', full_name: 'Administrator', role: 'admin', is_active: true },
];
const programmes = [
  { id: programmeId, name: 'Programme A', provider_user_id: providerId, provider_name: 'Provider A', archived_at: null },
  { id: programmeBId, name: 'Programme B', provider_user_id: providerBId, provider_name: 'Provider B', archived_at: null },
];
const learners = [
  { id: learnerId, full_name: 'Learner A', learner_reference: 'LRN-A', provider_user_id: providerId },
  { id: learnerBId, full_name: 'Learner B', learner_reference: 'LRN-B', provider_user_id: providerBId },
];
const assignments = [
  { id: assignmentId, programme_id: programmeId, qa_user_id: qaId, assigned_by: adminId, updated_by: adminId, status: 'ACTIVE', created_at: now, updated_at: now, deactivated_at: null },
  { id: assignmentBId, programme_id: programmeBId, qa_user_id: qaBId, assigned_by: adminId, updated_by: adminId, status: 'ACTIVE', created_at: now, updated_at: now, deactivated_at: null },
];
const submissions = [
  { id: submissionId, programme_id: programmeId, enrolment_id: randomUUID(), requirement_id: randomUUID(), provider_user_id: providerId, version: 1, status: 'APPROVED', original_filename: 'evidence-a.pdf', mime_type: 'application/pdf', file_size: fileBytes.length, storage_provider: 'qa-test-storage', storage_key: 'qa-a', created_at: now },
  { id: reviewedSubmissionId, programme_id: programmeId, enrolment_id: randomUUID(), requirement_id: randomUUID(), provider_user_id: providerId, version: 1, status: 'CORRECTION_REQUIRED', original_filename: 'evidence-b.pdf', mime_type: 'application/pdf', file_size: fileBytes.length, storage_provider: 'qa-test-storage', storage_key: 'qa-b', created_at: now },
  { id: submissionBId, programme_id: programmeBId, enrolment_id: randomUUID(), requirement_id: randomUUID(), provider_user_id: providerBId, version: 1, status: 'APPROVED', original_filename: 'evidence-c.pdf', mime_type: 'application/pdf', file_size: fileBytes.length, storage_provider: 'qa-test-storage', storage_key: 'qa-c', created_at: now },
];
const enrolments = [
  { id: submissions[0].enrolment_id, learner_id: learnerId, programme_id: programmeId, provider_user_id: providerId },
  { id: submissions[1].enrolment_id, learner_id: learnerId, programme_id: programmeId, provider_user_id: providerId },
  { id: submissions[2].enrolment_id, learner_id: learnerBId, programme_id: programmeBId, provider_user_id: providerBId },
];
const requirements = [
  { id: submissions[0].requirement_id, title: 'Requirement A', guidance: 'Guidance A' },
  { id: submissions[1].requirement_id, title: 'Requirement B', guidance: null },
  { id: submissions[2].requirement_id, title: 'Requirement C', guidance: null },
];
const assessmentReviews = [
  { id: assessmentReviewId, evidence_submission_id: submissionId, submission_version: 1, programme_id: programmeId, assessor_user_id: assessorId, decision: 'APPROVED', feedback: null, reviewed_at: now },
  { id: assessmentReviewBId, evidence_submission_id: reviewedSubmissionId, submission_version: 1, programme_id: programmeId, assessor_user_id: assessorId, decision: 'CORRECTION_REQUESTED', feedback: 'Please add the missing page.', reviewed_at: now },
  { id: reviewedAssessmentId, evidence_submission_id: submissionBId, submission_version: 1, programme_id: programmeBId, assessor_user_id: assessorId, decision: 'APPROVED', feedback: null, reviewed_at: now },
];
const qaReviews = [
  { id: randomUUID(), evidence_review_id: assessmentReviewBId, evidence_submission_id: reviewedSubmissionId, submission_version: 1, programme_id: programmeId, assignment_id: assignmentId, qa_user_id: qaId, decision: 'FURTHER_ACTION_REQUIRED', comments: 'Verify the correction request is clear.', reviewed_at: now },
];
let server;
let baseUrl;

function findCurrentRows(qaUserId) {
  const activeProgrammeIds = new Set(assignments
    .filter((item) => item.qa_user_id === qaUserId && item.status === 'ACTIVE' && item.deactivated_at === null)
    .map((item) => item.programme_id));
  const newestSubmissions = new Map();
  for (const submission of submissions) {
    const key = `${submission.enrolment_id}:${submission.requirement_id}`;
    if (!newestSubmissions.has(key) || newestSubmissions.get(key).version < submission.version) {
      newestSubmissions.set(key, submission);
    }
  }
  return [...newestSubmissions.values()].flatMap((submission) => {
    if (!activeProgrammeIds.has(submission.programme_id)) return [];
    const assessment = assessmentReviews
      .filter((item) => item.evidence_submission_id === submission.id && item.submission_version === submission.version)
      .sort((left, right) => right.reviewed_at.localeCompare(left.reviewed_at))[0];
    if (!assessment) return [];
    const programme = programmes.find((item) => item.id === submission.programme_id);
    const enrolment = enrolments.find((item) => item.id === submission.enrolment_id);
    const learner = learners.find((item) => item.id === enrolment.learner_id);
    const requirement = requirements.find((item) => item.id === submission.requirement_id);
    const assignment = assignments.find((item) => item.programme_id === submission.programme_id
      && item.qa_user_id === qaUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
    const qaReview = qaReviews.find((item) => item.evidence_review_id === assessment.id);
    return [{
      assessment_review_id: assessment.id,
      assessor_decision: assessment.decision,
      assessor_feedback: assessment.feedback,
      assessor_reviewed_at: assessment.reviewed_at,
      assessor_user_id: assessment.assessor_user_id,
      assessor_name: users.find((item) => item.id === assessment.assessor_user_id).full_name,
      submission_id: submission.id,
      submission_version: submission.version,
      submission_status: submission.status,
      original_filename: submission.original_filename,
      mime_type: submission.mime_type,
      file_size: submission.file_size,
      submitted_at: submission.created_at,
      enrolment_id: submission.enrolment_id,
      requirement_id: submission.requirement_id,
      learner_id: learner.id,
      learner_name: learner.full_name,
      learner_reference: learner.learner_reference,
      programme_id: programme.id,
      programme_name: programme.name,
      provider_user_id: programme.provider_user_id,
      provider_name: programme.provider_name,
      requirement_title: requirement.title,
      guidance: requirement.guidance,
      assignment_id: assignment.id,
      qa_review_id: qaReview?.id ?? null,
      qa_decision: qaReview?.decision ?? null,
      qa_comments: qaReview?.comments ?? null,
      qa_reviewed_at: qaReview?.reviewed_at ?? null,
      qa_status: qaReview?.decision ?? 'AWAITING_REVIEW',
    }];
  });
}

const evidenceStorage = {
  provider: 'qa-test-storage',
  async read(key) {
    if (!key.startsWith('qa-')) throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
    return fileBytes;
  },
};

const database = {
  async query(sql, values = []) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };

    if (sql.includes('FROM users') && sql.includes('WHERE id = $1 AND is_active = TRUE')) {
      const user = users.find((item) => item.id === values[0] && item.is_active);
      return { rows: user ? [{ id: user.id, email: user.email, full_name: user.full_name, role: user.role }] : [], rowCount: user ? 1 : 0 };
    }
    if (sql.includes("WHERE role = 'qa'")) {
      const rows = users.filter((item) => item.role === 'qa' && item.is_active)
        .map(({ id, full_name, email }) => ({ id, full_name, email }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM qa_programme_assignments assignment') && sql.includes('JOIN users administrator')) {
      const rows = assignments.map((item) => ({
        ...item,
        programme_name: programmes.find((value) => value.id === item.programme_id)?.name,
        provider_name: programmes.find((value) => value.id === item.programme_id)?.provider_name,
        qa_name: users.find((value) => value.id === item.qa_user_id)?.full_name,
        qa_email: users.find((value) => value.id === item.qa_user_id)?.email,
        assigned_by_name: users.find((value) => value.id === item.assigned_by)?.full_name,
      }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('INSERT INTO qa_programme_assignments')) {
      const [programmeIdValue, qaUserIdValue, adminUserId] = values;
      const programme = programmes.find((item) => item.id === programmeIdValue && item.archived_at === null);
      const officer = users.find((item) => item.id === qaUserIdValue && item.role === 'qa' && item.is_active);
      if (!programme || !officer) return { rows: [], rowCount: 0 };
      if (assignments.some((item) => item.programme_id === programmeIdValue && item.qa_user_id === qaUserIdValue
        && item.status === 'ACTIVE' && item.deactivated_at === null)) {
        throw Object.assign(new Error('Duplicate QA assignment'), { code: '23505' });
      }
      const assignment = {
        id: randomUUID(), programme_id: programmeIdValue, qa_user_id: qaUserIdValue,
        assigned_by: adminUserId, updated_by: adminUserId, status: 'ACTIVE',
        created_at: now, updated_at: now, deactivated_at: null,
      };
      assignments.push(assignment);
      return { rows: [{ ...assignment }], rowCount: 1 };
    }
    if (sql.includes('UPDATE qa_programme_assignments')) {
      const assignment = assignments.find((item) => item.id === values[1]);
      if (!assignment) return { rows: [], rowCount: 0 };
      const [status, , actorId] = values;
      if (status === 'ACTIVE' && assignments.some((item) => item.id !== assignment.id
        && item.programme_id === assignment.programme_id && item.qa_user_id === assignment.qa_user_id
        && item.status === 'ACTIVE' && item.deactivated_at === null)) {
        throw Object.assign(new Error('Duplicate QA assignment'), { code: '23505' });
      }
      assignment.status = status;
      assignment.updated_by = actorId;
      assignment.updated_at = new Date().toISOString();
      assignment.deactivated_at = status === 'INACTIVE' ? assignment.deactivated_at ?? assignment.updated_at : null;
      return { rows: [{ ...assignment }], rowCount: 1 };
    }
    if (sql.includes('FROM qa_programme_assignments assignment') && sql.includes('WHERE assignment.qa_user_id = $1')) {
      const qaUserId = values[0];
      const rows = assignments.filter((item) => item.qa_user_id === qaUserId && item.status === 'ACTIVE' && item.deactivated_at === null)
        .map((item) => {
          const programme = programmes.find((value) => value.id === item.programme_id);
          return { id: programme.id, name: programme.name, provider_name: programme.provider_name, assignment_id: item.id };
        });
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('WITH latest_assessments')) {
      const qaUserId = values[0];
      let rows = findCurrentRows(qaUserId);
      if (sql.includes('COUNT(*) FILTER (WHERE qa_status')) {
        const summary = {
          total: rows.length,
          awaiting_review: rows.filter((item) => item.qa_status === 'AWAITING_REVIEW').length,
          verified: rows.filter((item) => item.qa_status === 'VERIFIED').length,
          further_action_required: rows.filter((item) => item.qa_status === 'FURTHER_ACTION_REQUIRED').length,
          not_verified: rows.filter((item) => item.qa_status === 'NOT_VERIFIED').length,
        };
        return { rows: [summary], rowCount: 1 };
      }
      if (sql.includes('WHERE submission_id = $2')) {
        rows = rows.filter((item) => item.submission_id === values[1]);
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('COUNT(*)::integer AS total')) {
        if (sql.includes('qa_status = $2')) rows = rows.filter((item) => item.qa_status === values[1]);
        if (sql.includes('programme_id = $2')) rows = rows.filter((item) => item.programme_id === values[1]);
        if (sql.includes('lower(learner_name) LIKE')) {
          const search = values.find((value) => typeof value === 'string' && value.startsWith('%'))?.slice(1, -1).toLowerCase() ?? '';
          rows = rows.filter((item) => item.learner_name.toLowerCase().includes(search)
            || item.programme_name.toLowerCase().includes(search)
            || item.requirement_title.toLowerCase().includes(search));
        }
        return { rows: [{ total: rows.length }], rowCount: 1 };
      }
      let valueIndex = 1;
      if (sql.includes('qa_status = $2')) rows = rows.filter((item) => item.qa_status === values[valueIndex++]);
      if (sql.includes('programme_id = $')) rows = rows.filter((item) => item.programme_id === values[valueIndex++]);
      if (sql.includes('lower(learner_name) LIKE')) {
        const search = values[valueIndex++].slice(1, -1).toLowerCase();
        rows = rows.filter((item) => item.learner_name.toLowerCase().includes(search)
          || item.programme_name.toLowerCase().includes(search)
          || item.requirement_title.toLowerCase().includes(search));
      }
      const limit = values[values.length - 2];
      const offset = values[values.length - 1];
      rows.sort((a, b) => b.assessor_reviewed_at.localeCompare(a.assessor_reviewed_at));
      rows = rows.slice(offset, offset + limit);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT ar.id AS assessment_review_id')) {
      const [targetId, qaUserId] = values;
      const target = submissions.find((item) => item.id === targetId);
      const assignment = target && assignments.find((item) => item.programme_id === target.programme_id
        && item.qa_user_id === qaUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      if (!target || !assignment) return { rows: [], rowCount: 0 };
      const rows = submissions.filter((item) => item.enrolment_id === target.enrolment_id
        && item.requirement_id === target.requirement_id).flatMap((submission) => {
        const assessment = assessmentReviews.find((item) => item.evidence_submission_id === submission.id
          && item.submission_version === submission.version);
        if (!assessment) return [];
        const qaReview = qaReviews.find((item) => item.evidence_review_id === assessment.id);
        return [{
          assessment_review_id: assessment.id,
          assessor_decision: assessment.decision,
          assessor_feedback: assessment.feedback,
          assessor_reviewed_at: assessment.reviewed_at,
          submission_version: submission.version,
          submission_id: submission.id,
          submission_status: submission.status,
          original_filename: submission.original_filename,
          mime_type: submission.mime_type,
          file_size: submission.file_size,
          submitted_at: submission.created_at,
          qa_review_id: qaReview?.id ?? null,
          qa_decision: qaReview?.decision ?? null,
          qa_comments: qaReview?.comments ?? null,
          qa_reviewed_at: qaReview?.reviewed_at ?? null,
        }];
      });
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('SELECT s.storage_key, s.storage_provider')) {
      const [submissionIdValue, qaUserId] = values;
      const submission = submissions.find((item) => item.id === submissionIdValue);
      const assignment = submission && assignments.find((item) => item.programme_id === submission.programme_id
        && item.qa_user_id === qaUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      const hasAssessment = assessmentReviews.some((item) => item.evidence_submission_id === submissionIdValue);
      return { rows: submission && assignment && hasAssessment ? [{
        storage_key: submission.storage_key,
        storage_provider: submission.storage_provider,
        original_filename: submission.original_filename,
        mime_type: submission.mime_type,
      }] : [], rowCount: submission && assignment && hasAssessment ? 1 : 0 };
    }
    if (sql.includes('SELECT s.id AS submission_id, s.version, s.enrolment_id')) {
      const [submissionIdValue, qaUserId] = values;
      const submission = submissions.find((item) => item.id === submissionIdValue);
      if (!submission) return { rows: [], rowCount: 0 };
      const latest = submissions.filter((item) => item.enrolment_id === submission.enrolment_id
        && item.requirement_id === submission.requirement_id).sort((a, b) => b.version - a.version)[0];
      const assessment = assessmentReviews.find((item) => item.evidence_submission_id === submission.id
        && item.submission_version === submission.version);
      const assignment = assignments.find((item) => item.programme_id === submission.programme_id
        && item.qa_user_id === qaUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      const rows = latest?.id === submission.id && assessment && assignment ? [{
        submission_id: submission.id,
        version: submission.version,
        enrolment_id: submission.enrolment_id,
        requirement_id: submission.requirement_id,
        programme_id: submission.programme_id,
        assessment_review_id: assessment.id,
        assignment_id: assignment.id,
      }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('SELECT id FROM qa_reviews WHERE evidence_review_id = $1')) {
      const review = qaReviews.find((item) => item.evidence_review_id === values[0]);
      return { rows: review ? [{ id: review.id }] : [], rowCount: review ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO qa_reviews')) {
      const [id, evidenceReviewId, evidenceSubmissionId, version, programmeIdValue, qaAssignmentId, qaUserId, decision, comments] = values;
      if (qaReviews.some((item) => item.evidence_review_id === evidenceReviewId)) {
        throw Object.assign(new Error('Duplicate QA review'), { code: '23505' });
      }
      const review = {
        id,
        evidence_review_id: evidenceReviewId,
        evidence_submission_id: evidenceSubmissionId,
        submission_version: version,
        programme_id: programmeIdValue,
        assignment_id: qaAssignmentId,
        qa_user_id: qaUserId,
        decision,
        comments,
        reviewed_at: new Date().toISOString(),
      };
      qaReviews.push(review);
      return { rows: [{ ...review }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL in QA test: ${sql}`);
  },
  async connect() {
    return { query: this.query.bind(this), release() {} };
  },
};

const app = express();
app.use(express.json());
app.use('/api/admin', createQaAdminRouter({ database, jwtSecret }));
app.use('/api/qa', createQaRouter({ database, jwtSecret, evidenceStorage }));

function tokenFor(id, role) {
  return jwt.sign({ role }, jwtSecret, {
    subject: id,
    audience: 'agriprovider-app',
    issuer: 'agriprovider-api',
    expiresIn: '1h',
  });
}

function headers(id, role) {
  return { authorization: `Bearer ${tokenFor(id, role)}` };
}

function request(method, url, id, role, body) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...headers(id, role),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('QA dashboard is limited to programmes actively assigned to the signed-in QA Officer', async () => {
  const response = await request('GET', '/api/qa/dashboard', qaId, 'qa');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.scopeConfigured, true);
  assert.deepEqual(body.programmes.map((item) => item.id), [programmeId]);
  assert.deepEqual(body.summary, {
    total: 2,
    awaiting_review: 1,
    verified: 0,
    further_action_required: 1,
    not_verified: 0,
  });
  assert.ok(body.reviews.every((item) => item.programme_id === programmeId));
  assert.equal(body.reviews.some((item) => item.submission_id === submissionBId), false);
});

test('QA Officer can record a separate immutable outcome without changing the assessor decision', async () => {
  const response = await request('POST', `/api/qa/submissions/${submissionId}/reviews`, qaId, 'qa', {
    decision: 'VERIFIED',
    comments: 'The assessor record and evidence version are complete for this QA check.',
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.qaReview.decision, 'VERIFIED');
  assert.equal(body.qaReview.evidence_review_id, assessmentReviewId);
  assert.equal(body.qaReview.submission_version, 1);
  assert.equal(assessmentReviews.find((item) => item.id === assessmentReviewId).decision, 'APPROVED');

  const duplicate = await request('POST', `/api/qa/submissions/${submissionId}/reviews`, qaId, 'qa', {
    decision: 'NOT_VERIFIED', comments: 'A later attempted edit must be rejected.',
  });
  assert.equal(duplicate.status, 409);
});

test('unassigned QA Officers cannot read or review another programme', async () => {
  const read = await request('GET', '/api/qa/dashboard', qaBId, 'qa');
  const body = await read.json();
  assert.equal(read.status, 200);
  assert.equal(body.scopeConfigured, true);
  assert.deepEqual(body.programmes.map((item) => item.id), [programmeBId]);

  const write = await request('POST', `/api/qa/submissions/${submissionId}/reviews`, qaBId, 'qa', {
    decision: 'VERIFIED', comments: 'Should not be accepted.',
  });
  assert.equal(write.status, 404);
});

test('only administrators can assign QA scope and duplicate active assignments are rejected', async () => {
  const denied = await request('GET', '/api/admin/qa-officers', qaId, 'qa');
  assert.equal(denied.status, 403);

  const duplicate = await request('POST', '/api/admin/qa-assignments', adminId, 'admin', {
    programmeId,
    qaUserId: qaId,
  });
  assert.equal(duplicate.status, 409);

  const created = await request('POST', '/api/admin/qa-assignments', adminId, 'admin', {
    programmeId: programmeBId,
    qaUserId: qaId,
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).assignment.qa_user_id, qaId);
});

test('QA review validation requires a supported outcome and non-empty comments', async () => {
  const invalid = await request('POST', `/api/qa/submissions/${submissionId}/reviews`, qaId, 'qa', {
    decision: 'APPROVED', comments: 'Invalid outcome.'
  });
  assert.equal(invalid.status, 400);
});
