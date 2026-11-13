const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { validateEvidenceFile } = require('../src/evidence-submissions');
const { validateCreateBody } = require('../src/enrolments');
const { validateRequirementBody } = require('../src/evidence-requirements');
const { validateLearnerBody } = require('../src/learners');
const { validateAttendanceBody, validateSessionBody } = require('../src/sessions');
const { roles, validPassword } = require('../src/auth');

test('administrator is a supported privileged role and not a public registration role', () => {
  assert.equal(roles.has('admin'), true);
});

test('learner role is available for secure sign-in and protected portal access', async () => {
  assert.equal(roles.has('learner'), true);
});

const jwtSecret = 'test-secret-with-more-than-thirty-two-characters';
const webOrigin = 'http://localhost:8081';
const users = [];
const programmes = [];
const learners = [];
const learnerInvitations = [];
const enrolments = [];
const trainingSessions = [];
const attendanceRecords = [];
const evidenceRequirements = [];
const evidenceSubmissions = [];
const assessorAssignments = [];
const evidenceReviews = [];
const evidenceFiles = new Map();
let databaseAvailable = true;
let programmesAvailable = true;
let learnersAvailable = true;
let sessionsAvailable = true;
let evidenceRequirementsAvailable = true;
let evidenceSubmissionsAvailable = true;
let evidenceInsertAvailable = true;
let evidenceStorageAvailable = true;
let transientLoginFailures = 0;
let server;
let baseUrl;
let registeredUser;
let accessToken;
const providerBId = randomUUID();
const assessorId = randomUUID();
const assessorBId = randomUUID();
const adminId = randomUUID();
const qaId = randomUUID();
const learnerId = randomUUID();
const learnerPassword = 'SecureLearnerPass123';
const evidenceStorage = {
  provider: 'test-storage',
  async save(buffer) {
    if (!evidenceStorageAvailable) throw new Error('Storage unavailable');
    const key = randomUUID();
    evidenceFiles.set(key, Buffer.from(buffer));
    return key;
  },
  async read(key) {
    if (!evidenceFiles.has(key)) throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
    return evidenceFiles.get(key);
  },
  async delete(key) {
    evidenceFiles.delete(key);
  },
};

for (const [id, role] of [
  [providerBId, 'provider'],
  [assessorId, 'assessor'],
  [assessorBId, 'assessor'],
  [adminId, 'admin'],
  [qaId, 'qa'],
  [learnerId, 'learner'],
]) {
  users.push({
    id,
    email: `${role}-${id}@example.com`,
    full_name: role,
    role,
    is_active: true,
    password_hash: role === 'learner' ? bcrypt.hashSync(learnerPassword, 12) : undefined,
  });
}

const database = {
  async query(sql, values = []) {
    if (sql === 'SELECT 1') {
      if (!databaseAvailable) {
        throw new Error('Database unavailable');
      }
      return { rows: [{ '?column?': 1 }] };
    }

    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK'
      || sql.includes('pg_advisory_xact_lock')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('WITH programme_scope AS')) {
      if (!programmesAvailable) throw new Error('Programme database unavailable');
      const [programmeId, providerUserId] = values;
      const programme = programmes.find((item) => item.id === programmeId
        && item.provider_user_id === providerUserId && item.archived_at === null);
      if (!programme) return { rows: [], rowCount: 0 };
      const programmeEnrolments = enrolments.filter((item) => item.programme_id === programmeId
        && item.provider_user_id === providerUserId);
      const activeEnrolments = programmeEnrolments.filter((item) => item.status === 'active');
      const programmeSessions = trainingSessions.filter((item) => item.programme_id === programmeId
        && item.provider_user_id === providerUserId && item.archived_at === null);
      const sessionIds = new Set(trainingSessions.filter((item) => item.programme_id === programmeId
        && item.provider_user_id === providerUserId).map((item) => item.id));
      const programmeAttendance = attendanceRecords.filter((item) => item.programme_id === programmeId
        && item.provider_user_id === providerUserId && sessionIds.has(item.session_id));
      const requirements = evidenceRequirements.filter((item) => item.programme_id === programmeId
        && item.provider_user_id === providerUserId && item.archived_at === null);
      const latestByPair = new Map();
      for (const submission of evidenceSubmissions.filter((item) => item.programme_id === programmeId
        && item.provider_user_id === providerUserId
        && activeEnrolments.some((enrolment) => enrolment.id === item.enrolment_id))) {
        const key = `${submission.enrolment_id}:${submission.requirement_id}`;
        if (!latestByPair.has(key) || latestByPair.get(key).version < submission.version) {
          latestByPair.set(key, submission);
        }
      }
      const slots = activeEnrolments.flatMap((enrolment) => requirements.map((requirement) => (
        latestByPair.get(`${enrolment.id}:${requirement.id}`)?.status ?? null
      )));
      const count = (predicate) => slots.filter(predicate).length;
      return {
        rows: [{
          programme_id: programmeId,
          active_enrolments: activeEnrolments.length,
          withdrawn_enrolments: programmeEnrolments.filter((item) => item.status === 'withdrawn').length,
          active_sessions: programmeSessions.length,
          attendance_recorded: programmeAttendance.length,
          attendance_present: programmeAttendance.filter((item) => item.status === 'present').length,
          attendance_absent: programmeAttendance.filter((item) => item.status === 'absent').length,
          attendance_excused: programmeAttendance.filter((item) => item.status === 'excused').length,
          evidence_requirements: requirements.length,
          evidence_slots: slots.length,
          evidence_not_submitted: count((status) => status === null),
          evidence_submitted: count((status) => status === 'SUBMITTED'),
          evidence_awaiting_review: count((status) => status === 'UNDER_REVIEW'),
          evidence_approved: count((status) => status === 'APPROVED'),
          evidence_correction_required: count((status) => status === 'CORRECTION_REQUIRED'),
        }],
        rowCount: 1,
      };
    }

    if (sql.includes('learner_account_invitations')) {
      if (sql.includes('SELECT i.id')) {
        const invitation = learnerInvitations.find((item) => item.token_hash === values[0]
          && item.consumed_at === null && item.revoked_at === null
          && new Date(item.expires_at) > new Date());
        const learner = invitation && learners.find((item) => item.id === invitation.learner_id
          && item.archived_at === null);
        return {
          rows: invitation && learner ? [{
            id: invitation.id,
            learner_id: learner.id,
            email: learner.email,
            full_name: learner.full_name,
            learner_user_id: learner.learner_user_id ?? null,
          }] : [],
          rowCount: invitation && learner ? 1 : 0,
        };
      }
      if (sql.includes('SET revoked_at = NOW()')) {
        const [learnerId] = values;
        for (const invitation of learnerInvitations.filter((item) => item.learner_id === learnerId
          && item.consumed_at === null && item.revoked_at === null)) {
          invitation.revoked_at = new Date().toISOString();
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO learner_account_invitations')) {
        const [id, learnerId, providerUserId, tokenHash] = values;
        const invitation = {
          id,
          learner_id: learnerId,
          provider_user_id: providerUserId,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          consumed_at: null,
          revoked_at: null,
        };
        learnerInvitations.push(invitation);
        return { rows: [{ expires_at: invitation.expires_at }], rowCount: 1 };
      }
      if (sql.includes('SET consumed_at = NOW()')) {
        const [id] = values;
        const invitation = learnerInvitations.find((item) => item.id === id
          && item.consumed_at === null && item.revoked_at === null);
        if (!invitation) return { rows: [], rowCount: 0 };
        invitation.consumed_at = new Date().toISOString();
        return { rows: [], rowCount: 1 };
      }
    }

    if (sql.includes('FROM learners l')
      && sql.includes('WHERE l.learner_user_id = $1')) {
      if (!learnersAvailable) throw new Error('Learner database unavailable');
      const [learnerUserId, email] = values;
      const rows = learners
        .filter((item) => item.learner_user_id === learnerUserId
          || (!item.learner_user_id && item.email?.toLowerCase() === email.toLowerCase()))
        .slice(0, 2)
        .map((item) => ({
          id: item.id,
          learner_reference: item.learner_reference,
          full_name: item.full_name,
          email: item.email,
          phone: item.phone,
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('JOIN users provider ON provider.id = p.provider_user_id')) {
      if (!learnersAvailable) throw new Error('Learner database unavailable');
      const [learnerId] = values;
      const rows = enrolments.filter((item) => item.learner_id === learnerId).map((enrolment) => {
        const programme = programmes.find((item) => item.id === enrolment.programme_id);
        const provider = users.find((item) => item.id === programme.provider_user_id);
        return {
          id: programme.id,
          name: programme.name,
          description: programme.description ?? null,
          status: enrolment.status,
          enrolment_id: enrolment.id,
          enrolled_at: enrolment.created_at,
          provider_name: provider?.full_name ?? 'Provider',
        };
      });
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('COUNT(*) FILTER (WHERE a.status =')) {
      if (!sessionsAvailable) throw new Error('Attendance database unavailable');
      const [learnerId] = values;
      const enrolmentIds = new Set(enrolments
        .filter((item) => item.learner_id === learnerId)
        .map((item) => item.id));
      const matching = attendanceRecords.filter((item) => enrolmentIds.has(item.enrolment_id));
      return {
        rows: [{
          recorded: matching.length,
          present: matching.filter((item) => item.status === 'present').length,
          absent: matching.filter((item) => item.status === 'absent').length,
          excused: matching.filter((item) => item.status === 'excused').length,
        }],
        rowCount: 1,
      };
    }

    if (sql.includes('SELECT a.session_id, s.title, p.name AS programme_name')) {
      if (!sessionsAvailable) throw new Error('Attendance database unavailable');
      const [learnerId] = values;
      const rows = attendanceRecords
        .filter((item) => enrolments.some((enrolment) => enrolment.id === item.enrolment_id
          && enrolment.learner_id === learnerId))
        .map((item) => {
          const session = trainingSessions.find((value) => value.id === item.session_id);
          const enrolment = enrolments.find((value) => value.id === item.enrolment_id);
          const programme = programmes.find((value) => value.id === enrolment.programme_id);
          return {
            session_id: item.session_id,
            title: session.title,
            programme_name: programme.name,
            starts_at: session.starts_at,
            status: item.status,
            marked_at: item.updated_at,
          };
        })
        .sort((left, right) => right.starts_at.localeCompare(left.starts_at))
        .slice(0, 10);
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('a.status AS attendance_status')
      && sql.includes('FROM enrolments e')
      && sql.includes('JOIN training_sessions s')) {
      if (!sessionsAvailable) throw new Error('Attendance database unavailable');
      const [learnerId, from, to] = values;
      const start = Date.parse(from);
      const end = Date.parse(to);
      const learnerEnrolments = enrolments.filter((item) => item.learner_id === learnerId
        && (item.status === 'active' || attendanceRecords.some((record) => record.enrolment_id === item.id)));
      const rows = trainingSessions
        .filter((session) => session.archived_at === null
          && Date.parse(session.starts_at) >= start
          && Date.parse(session.starts_at) < end
          && learnerEnrolments.some((item) => item.programme_id === session.programme_id))
        .map((session) => {
          const enrolment = learnerEnrolments.find((item) => item.programme_id === session.programme_id);
          const programme = programmes.find((item) => item.id === session.programme_id);
          const attendance = attendanceRecords.find((item) => item.session_id === session.id
            && item.enrolment_id === enrolment?.id);
          return {
            id: session.id,
            programme_id: session.programme_id,
            programme_name: programme.name,
            title: session.title,
            starts_at: session.starts_at,
            ends_at: session.ends_at ?? null,
            venue: session.venue ?? null,
            attendance_status: attendance?.status ?? null,
          };
        })
        .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('r.title AS requirement_title')
      && sql.includes('FROM enrolments e')
      && sql.includes('LEFT JOIN evidence_submissions s')) {
      if (!evidenceSubmissionsAvailable || !evidenceRequirementsAvailable) {
        throw new Error('Evidence database unavailable');
      }
      const [learnerId] = values;
      const rows = [];
      for (const enrolment of enrolments.filter((item) => item.learner_id === learnerId)) {
        const programme = programmes.find((item) => item.id === enrolment.programme_id);
        for (const requirement of evidenceRequirements.filter((item) => item.programme_id === programme.id
          && item.archived_at === null)) {
          const submissions = evidenceSubmissions.filter((item) => item.enrolment_id === enrolment.id
            && item.requirement_id === requirement.id).sort((left, right) => right.version - left.version);
          const versions = submissions.length ? submissions : [null];
          for (const submission of versions) {
            const review = submission && evidenceReviews.find((item) => item.evidence_submission_id === submission.id
              && item.submission_version === submission.version);
            rows.push({
              enrolment_id: enrolment.id,
              enrolment_status: enrolment.status,
              programme_id: programme.id,
              programme_name: programme.name,
              requirement_id: requirement.id,
              requirement_title: requirement.title,
              guidance: requirement.guidance,
              submission_id: submission?.id ?? null,
              original_filename: submission?.original_filename ?? null,
              submission_status: submission?.status ?? null,
              version: submission?.version ?? null,
              submitted_at: submission?.created_at ?? null,
              review_id: review?.id ?? null,
              assessor_name: users.find((item) => item.id === review?.assessor_user_id)?.full_name ?? null,
              decision: review?.decision ?? null,
              feedback: review?.feedback ?? null,
              reviewed_at: review?.reviewed_at ?? null,
            });
          }
        }
      }
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('COUNT(DISTINCT e.id)') && sql.includes('programme_assessor_assignments')) {
      const [assessorUserId] = values;
      const activeAssignments = assessorAssignments.filter((item) => item.assessor_user_id === assessorUserId
        && item.status === 'ACTIVE' && item.deactivated_at === null);
      const rows = activeAssignments.map((assignment) => {
        const programme = programmes.find((item) => item.id === assignment.programme_id);
        const programmeEnrolments = enrolments.filter((item) => item.programme_id === assignment.programme_id);
        const latestByRequirement = new Map();
        for (const submission of evidenceSubmissions.filter((item) => item.programme_id === assignment.programme_id)) {
          const key = `${submission.enrolment_id}:${submission.requirement_id}`;
          if (!latestByRequirement.has(key) || latestByRequirement.get(key).version < submission.version) {
            latestByRequirement.set(key, submission);
          }
        }
        const latest = [...latestByRequirement.values()];
        return {
          id: programme.id,
          name: programme.name,
          assignment_id: assignment.id,
          learner_count: programmeEnrolments.filter((item) => item.status === 'active').length,
          pending_reviews: latest.filter((item) => item.status === 'SUBMITTED').length,
          approved_count: latest.filter((item) => item.status === 'APPROVED').length,
          correction_count: latest.filter((item) => item.status === 'CORRECTION_REQUIRED').length,
        };
      });
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('SELECT e.id AS enrolment_id, e.status AS enrolment_status')) {
      const [programmeId, assessorUserId] = values;
      const hasAssignment = assessorAssignments.some((item) => item.programme_id === programmeId
        && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      const rows = hasAssignment ? enrolments.filter((item) => item.programme_id === programmeId
        && item.status === 'active').map((enrolment) => {
        const learner = learners.find((item) => item.id === enrolment.learner_id);
        return {
          enrolment_id: enrolment.id,
          enrolment_status: enrolment.status,
          enrolled_at: enrolment.created_at,
          learner_id: learner.id,
          learner_reference: learner.learner_reference,
          full_name: learner.full_name,
        };
      }) : [];
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('WITH latest AS')) {
      const [programmeId, assessorUserId, status] = values;
      const hasAssignment = assessorAssignments.some((item) => item.programme_id === programmeId
        && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      const latestByRequirement = new Map();
      for (const submission of evidenceSubmissions.filter((item) => item.programme_id === programmeId)) {
        const key = `${submission.enrolment_id}:${submission.requirement_id}`;
        if (!latestByRequirement.has(key) || latestByRequirement.get(key).version < submission.version) {
          latestByRequirement.set(key, submission);
        }
      }
      const rows = hasAssignment ? [...latestByRequirement.values()]
        .filter((item) => status === 'all' || item.status === status)
        .map((submission) => {
          const enrolment = enrolments.find((item) => item.id === submission.enrolment_id);
          const learner = learners.find((item) => item.id === enrolment?.learner_id);
          const programme = programmes.find((item) => item.id === submission.programme_id);
          const requirement = evidenceRequirements.find((item) => item.id === submission.requirement_id);
          return {
            id: submission.id,
            programme_id: submission.programme_id,
            enrolment_id: submission.enrolment_id,
            requirement_id: submission.requirement_id,
            original_filename: submission.original_filename,
            mime_type: submission.mime_type,
            file_size: submission.file_size,
            status: submission.status,
            version: submission.version,
            created_at: submission.created_at,
            learner_id: learner.id,
            learner_reference: learner.learner_reference,
            learner_name: learner.full_name,
            programme_name: programme.name,
            requirement_title: requirement.title,
          };
        }) : [];
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('FROM evidence_reviews r')
      && sql.includes('JOIN users assessor ON assessor.id = r.assessor_user_id')
      && (sql.includes('JOIN evidence_submissions reviewed') || sql.includes('WHERE s.provider_user_id = $1'))) {
      if (sql.includes('WHERE s.provider_user_id = $1')) {
        const [providerUserId, enrolmentId, requirementId] = values;
        const submissionIds = evidenceSubmissions.filter((item) => item.provider_user_id === providerUserId
          && item.enrolment_id === enrolmentId && item.requirement_id === requirementId).map((item) => item.id);
        const rows = evidenceReviews.filter((item) => submissionIds.includes(item.evidence_submission_id))
          .sort((left, right) => right.submission_version - left.submission_version)
          .map((review) => ({
            ...review,
            assessor_name: users.find((item) => item.id === review.assessor_user_id)?.full_name,
          }));
        return { rows, rowCount: rows.length };
      }
      const [submissionId, assessorUserId] = values;
      const submission = evidenceSubmissions.find((item) => item.id === submissionId);
      const hasAssignment = submission && assessorAssignments.some((item) => item.programme_id === submission.programme_id
        && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      const relatedSubmissionIds = submission ? evidenceSubmissions.filter((item) => item.enrolment_id === submission.enrolment_id
        && item.requirement_id === submission.requirement_id).map((item) => item.id) : [];
      const rows = hasAssignment ? evidenceReviews.filter((item) => relatedSubmissionIds.includes(item.evidence_submission_id))
        .sort((left, right) => right.submission_version - left.submission_version)
        .map((review) => ({ ...review, assessor_name: users.find((item) => item.id === review.assessor_user_id)?.full_name })) : [];
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('INSERT INTO evidence_reviews')) {
      const [id, submissionId, version, programmeId, assignmentId, reviewerId, decision, feedback] = values;
      if (evidenceReviews.some((item) => item.evidence_submission_id === submissionId
        && item.submission_version === version)) {
        throw Object.assign(new Error('Duplicate submission review'), { code: '23505' });
      }
      const review = {
        id,
        evidence_submission_id: submissionId,
        submission_version: version,
        programme_id: programmeId,
        assignment_id: assignmentId,
        assessor_user_id: reviewerId,
        decision,
        feedback,
        reviewed_at: new Date().toISOString(),
      };
      evidenceReviews.push(review);
      return { rows: [{ ...review }], rowCount: 1 };
    }

    if (sql.includes('UPDATE evidence_submissions SET status')) {
      const [status, submissionId] = values;
      const submission = evidenceSubmissions.find((item) => item.id === submissionId && item.status === 'SUBMITTED');
      if (!submission) return { rows: [], rowCount: 0 };
      submission.status = status;
      submission.updated_at = new Date().toISOString();
      return { rows: [{ id: submission.id }], rowCount: 1 };
    }

    if (sql.includes('SELECT enrolment_id, requirement_id')
      && sql.includes('FROM evidence_submissions WHERE id = $1')) {
      const submission = evidenceSubmissions.find((item) => item.id === values[0]);
      return {
        rows: submission ? [{ enrolment_id: submission.enrolment_id, requirement_id: submission.requirement_id }] : [],
        rowCount: submission ? 1 : 0,
      };
    }

    if (sql.includes('JOIN programme_assessor_assignments a') && sql.includes('FOR UPDATE OF s')) {
      const [submissionId, assessorUserId] = values;
      const submission = evidenceSubmissions.find((item) => item.id === submissionId);
      const assignment = submission && assessorAssignments.find((item) => item.programme_id === submission.programme_id
        && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      return {
        rows: submission && assignment ? [{ ...submission, assignment_id: assignment.id }] : [],
        rowCount: submission && assignment ? 1 : 0,
      };
    }

    if (sql.includes('WHERE enrolment_id = $1 AND requirement_id = $2')) {
      const [enrolmentId, requirementId] = values;
      const latest = evidenceSubmissions.filter((item) => item.enrolment_id === enrolmentId
        && item.requirement_id === requirementId).sort((left, right) => right.version - left.version)[0];
      return { rows: latest ? [{ id: latest.id, status: latest.status }] : [], rowCount: latest ? 1 : 0 };
    }

    if (sql.includes('SELECT a.id') && sql.includes('FROM programme_assessor_assignments a')
      && sql.includes('a.assessor_user_id = $2')) {
      const [programmeId, assessorUserId] = values;
      const assignment = assessorAssignments.find((item) => item.programme_id === programmeId
        && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      return { rows: assignment ? [{ id: assignment.id }] : [], rowCount: assignment ? 1 : 0 };
    }

    if (sql.includes('SELECT s.id FROM evidence_submissions s')) {
      const [submissionId, assessorUserId] = values;
      const submission = evidenceSubmissions.find((item) => item.id === submissionId);
      const assignment = submission && assessorAssignments.find((item) => item.programme_id === submission.programme_id
        && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      return { rows: submission && assignment ? [{ id: submission.id }] : [], rowCount: submission && assignment ? 1 : 0 };
    }

    if (sql.includes('SELECT s.storage_key, s.storage_provider')) {
      const [submissionId, assessorUserId] = values;
      const submission = evidenceSubmissions.find((item) => item.id === submissionId);
      const assignment = submission && assessorAssignments.find((item) => item.programme_id === submission.programme_id
        && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      const row = submission && assignment ? {
        storage_key: submission.storage_key,
        storage_provider: submission.storage_provider,
        original_filename: submission.original_filename,
        mime_type: submission.mime_type,
      } : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('FROM evidence_submissions s') && sql.includes('JOIN enrolments e')
      && sql.includes('WHERE s.id = $1')) {
      const [submissionId, assessorUserId] = values;
      const submission = evidenceSubmissions.find((item) => item.id === submissionId);
      const assignment = submission && assessorAssignments.find((item) => item.programme_id === submission.programme_id
        && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      if (!submission || !assignment) return { rows: [], rowCount: 0 };
      const enrolment = enrolments.find((item) => item.id === submission.enrolment_id);
      const learner = learners.find((item) => item.id === enrolment?.learner_id);
      const programme = programmes.find((item) => item.id === submission.programme_id);
      const requirement = evidenceRequirements.find((item) => item.id === submission.requirement_id);
      return {
        rows: [{
          ...submission,
          learner_id: learner.id,
          learner_reference: learner.learner_reference,
          learner_name: learner.full_name,
          programme_name: programme.name,
          requirement_title: requirement.title,
          guidance: requirement.guidance,
        }],
        rowCount: 1,
      };
    }

    if (sql.includes('FROM evidence_submissions target') && sql.includes('JOIN evidence_submissions version')) {
      const [submissionId, assessorUserId] = values;
      const target = evidenceSubmissions.find((item) => item.id === submissionId);
      const assignment = target && assessorAssignments.find((item) => item.programme_id === target.programme_id
        && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE' && item.deactivated_at === null);
      const rows = target && assignment ? evidenceSubmissions.filter((item) => item.enrolment_id === target.enrolment_id
        && item.requirement_id === target.requirement_id).sort((left, right) => right.version - left.version)
        .map(({ id, programme_id, enrolment_id, requirement_id, original_filename, mime_type, file_size, status, version, created_at }) => ({
          id, programme_id, enrolment_id, requirement_id, original_filename, mime_type, file_size, status, version, created_at,
        })) : [];
      return { rows, rowCount: rows.length };
    }

    if (sql.includes("WHERE role = 'assessor'")) {
      const rows = users.filter((item) => item.role === 'assessor' && item.is_active)
        .map(({ id, full_name, email }) => ({ id, full_name, email }));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('programme_assessor_assignments')) {
      if (sql.includes('SELECT id, programme_id, assessor_user_id, status') && sql.includes('FOR UPDATE')) {
        const assignment = assessorAssignments.find((item) => item.id === values[0]);
        return { rows: assignment ? [{ ...assignment }] : [], rowCount: assignment ? 1 : 0 };
      }

      if (sql.includes('INSERT INTO programme_assessor_assignments')) {
        const [id, programmeId, assessorUserId, createdBy] = values;
        const programme = programmes.find((item) => item.id === programmeId && item.archived_at === null);
        const assessor = users.find((item) => item.id === assessorUserId
          && item.role === 'assessor' && item.is_active);
        if (!programme || !assessor) return { rows: [], rowCount: 0 };
        if (assessorAssignments.some((item) => item.programme_id === programmeId
          && item.assessor_user_id === assessorUserId && item.status === 'ACTIVE')) {
          throw Object.assign(new Error('Duplicate active assignment'), { code: '23505' });
        }
        const now = new Date().toISOString();
        const assignment = {
          id,
          programme_id: programmeId,
          assessor_user_id: assessorUserId,
          created_by: createdBy,
          status: 'ACTIVE',
          created_at: now,
          updated_at: now,
          deactivated_at: null,
        };
        assessorAssignments.push(assignment);
        return { rows: [{ ...assignment }], rowCount: 1 };
      }

      if (sql.includes('UPDATE programme_assessor_assignments')) {
        const reassignmentDeactivation = sql.includes("SET status = 'INACTIVE'");
        const status = reassignmentDeactivation ? 'INACTIVE' : values[0];
        const id = reassignmentDeactivation ? values[0] : values[1];
        const assignment = assessorAssignments.find((item) => item.id === id);
        if (!assignment) return { rows: [], rowCount: 0 };
        if (status === 'ACTIVE' && assessorAssignments.some((item) => item.id !== id
          && item.programme_id === assignment.programme_id
          && item.assessor_user_id === assignment.assessor_user_id && item.status === 'ACTIVE')) {
          throw Object.assign(new Error('Duplicate active assignment'), { code: '23505' });
        }
        assignment.status = status;
        assignment.deactivated_at = status === 'INACTIVE' ? assignment.deactivated_at ?? new Date().toISOString() : null;
        assignment.updated_at = new Date().toISOString();
        return { rows: [{ ...assignment }], rowCount: 1 };
      }

      const rows = assessorAssignments.map((assignment) => {
        const programme = programmes.find((item) => item.id === assignment.programme_id);
        const assessor = users.find((item) => item.id === assignment.assessor_user_id);
        const administrator = users.find((item) => item.id === assignment.created_by);
        return {
          ...assignment,
          programme_name: programme?.name,
          assessor_name: assessor?.full_name,
          assessor_email: assessor?.email,
          created_by_name: administrator?.full_name,
        };
      });
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('FROM programmes p') && sql.includes('JOIN users u ON u.id = p.provider_user_id')) {
      const rows = programmes.filter((item) => item.archived_at === null).map((programme) => ({
        id: programme.id,
        name: programme.name,
        provider_user_id: programme.provider_user_id,
        provider_name: users.find((item) => item.id === programme.provider_user_id)?.full_name,
      }));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('evidence_submissions') || sql.includes('JOIN programme_evidence_requirements r')
      || sql.includes('SELECT id FROM enrolments')) {
      if (!evidenceSubmissionsAvailable) throw new Error('Evidence submissions database unavailable');

      if (sql.includes('FOR UPDATE OF e, r')) {
        const [enrolmentId, providerUserId, requirementId] = values;
        const enrolment = enrolments.find((item) => item.id === enrolmentId
          && item.provider_user_id === providerUserId
          && item.status === 'active');
        const requirement = evidenceRequirements.find((item) => item.id === requirementId
          && item.provider_user_id === providerUserId
          && item.programme_id === enrolment?.programme_id
          && item.archived_at === null);
        const learner = learners.find((item) => item.id === enrolment?.learner_id
          && item.provider_user_id === providerUserId
          && item.archived_at === null);
        const programme = programmes.find((item) => item.id === enrolment?.programme_id
          && item.provider_user_id === providerUserId
          && item.archived_at === null);
        return {
          rows: enrolment && requirement && learner && programme
            ? [{
              enrolment_id: enrolment.id,
              provider_user_id: providerUserId,
              programme_id: enrolment.programme_id,
              requirement_id: requirement.id,
            }]
            : [],
          rowCount: enrolment && requirement && learner && programme ? 1 : 0,
        };
      }

      if (sql.includes('INSERT INTO evidence_submissions')) {
        if (!evidenceInsertAvailable) throw new Error('Evidence insert unavailable');
        const [
          id, providerUserId, programmeId, enrolmentId, requirementId, submittedBy,
          originalFilename, mimeType, fileSize, sha256, storageProvider, storageKey, version,
        ] = values;
        const submission = {
          id,
          provider_user_id: providerUserId,
          programme_id: programmeId,
          enrolment_id: enrolmentId,
          requirement_id: requirementId,
          submitted_by: submittedBy,
          original_filename: originalFilename,
          mime_type: mimeType,
          file_size: fileSize,
          sha256,
          storage_provider: storageProvider,
          storage_key: storageKey,
          status: 'SUBMITTED',
          version,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        evidenceSubmissions.push(submission);
        return { rows: [{ ...submission }], rowCount: 1 };
      }

      if (sql.includes('SELECT id, enrolment_id, requirement_id, status, storage_provider, storage_key')) {
        const [id, providerUserId] = values;
        const submission = evidenceSubmissions.find((item) => item.id === id
          && item.provider_user_id === providerUserId);
        return { rows: submission ? [{ ...submission }] : [], rowCount: submission ? 1 : 0 };
      }

      if (sql.includes('SELECT id, status\n') && sql.includes('ORDER BY version DESC')) {
        const [providerUserId, enrolmentId, requirementId] = values;
        const latest = evidenceSubmissions
          .filter((item) => item.provider_user_id === providerUserId
            && item.enrolment_id === enrolmentId && item.requirement_id === requirementId)
          .sort((left, right) => right.version - left.version)[0];
        return { rows: latest ? [{ id: latest.id, status: latest.status }] : [], rowCount: latest ? 1 : 0 };
      }

      if (sql.includes('DELETE FROM evidence_submissions')) {
        const [id, providerUserId] = values;
        const index = evidenceSubmissions.findIndex((item) => item.id === id
          && item.provider_user_id === providerUserId);
        if (index < 0) return { rows: [], rowCount: 0 };
        evidenceSubmissions.splice(index, 1);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('FROM evidence_submissions') && sql.includes('ORDER BY version DESC')
        && sql.includes('LIMIT 1')) {
        const [providerUserId, enrolmentId, requirementId] = values;
        const previous = evidenceSubmissions
          .filter((item) => item.provider_user_id === providerUserId
            && item.enrolment_id === enrolmentId && item.requirement_id === requirementId)
          .sort((left, right) => right.version - left.version)[0];
        return { rows: previous ? [{ ...previous }] : [], rowCount: previous ? 1 : 0 };
      }

      if (sql.includes('SELECT id FROM enrolments')) {
        const [enrolmentId, providerUserId] = values;
        const found = enrolments.find((item) => item.id === enrolmentId
          && item.provider_user_id === providerUserId);
        return { rows: found ? [{ id: found.id }] : [], rowCount: found ? 1 : 0 };
      }

      if (sql.includes('LEFT JOIN LATERAL')) {
        const [enrolmentId, providerUserId] = values;
        const enrolment = enrolments.find((item) => item.id === enrolmentId
          && item.provider_user_id === providerUserId);
        if (!enrolment) return { rows: [], rowCount: 0 };
        const rows = evidenceRequirements
          .filter((item) => item.provider_user_id === providerUserId
            && item.programme_id === enrolment.programme_id && item.archived_at === null)
          .sort((left, right) => left.created_at.localeCompare(right.created_at))
          .map((requirement) => {
            const latest = evidenceSubmissions
              .filter((item) => item.provider_user_id === providerUserId
                && item.enrolment_id === enrolmentId && item.requirement_id === requirement.id)
              .sort((left, right) => right.version - left.version)[0];
            return {
              requirement_id: requirement.id,
              requirement_title: requirement.title,
              guidance: requirement.guidance,
              submission_id: latest?.id ?? null,
              programme_id: latest?.programme_id ?? null,
              enrolment_id: latest?.enrolment_id ?? null,
              submission_requirement_id: latest?.requirement_id ?? null,
              submitted_by: latest?.submitted_by ?? null,
              original_filename: latest?.original_filename ?? null,
              mime_type: latest?.mime_type ?? null,
              file_size: latest?.file_size ?? null,
              status: latest?.status ?? null,
              version: latest?.version ?? null,
              submitted_at: latest?.created_at ?? null,
              submission_updated_at: latest?.updated_at ?? null,
              review_id: evidenceReviews.find((review) => review.evidence_submission_id === latest?.id
                && review.submission_version === latest.version)?.id ?? null,
              submission_version: evidenceReviews.find((review) => review.evidence_submission_id === latest?.id
                && review.submission_version === latest.version)?.submission_version ?? null,
              assessor_name: evidenceReviews.find((review) => review.evidence_submission_id === latest?.id
                && review.submission_version === latest.version)?.assessor_name
                ?? users.find((item) => item.id === evidenceReviews.find((review) => review.evidence_submission_id === latest?.id
                  && review.submission_version === latest.version)?.assessor_user_id)?.full_name ?? null,
              review_decision: evidenceReviews.find((review) => review.evidence_submission_id === latest?.id
                && review.submission_version === latest.version)?.decision ?? null,
              review_feedback: evidenceReviews.find((review) => review.evidence_submission_id === latest?.id
                && review.submission_version === latest.version)?.feedback ?? null,
              reviewed_at: evidenceReviews.find((review) => review.evidence_submission_id === latest?.id
                && review.submission_version === latest.version)?.reviewed_at ?? null,
            };
          });
        return { rows, rowCount: rows.length };
      }

      if (sql.includes('SELECT enrolment_id, requirement_id') && sql.includes('provider_user_id = $2')) {
        const [id, providerUserId] = values;
        const target = evidenceSubmissions.find((item) => item.id === id
          && item.provider_user_id === providerUserId);
        return {
          rows: target ? [{ enrolment_id: target.enrolment_id, requirement_id: target.requirement_id }] : [],
          rowCount: target ? 1 : 0,
        };
      }

      if (sql.includes('ORDER BY version DESC')) {
        const [providerUserId, enrolmentId, requirementId] = values;
        const rows = evidenceSubmissions
          .filter((item) => item.provider_user_id === providerUserId
            && item.enrolment_id === enrolmentId && item.requirement_id === requirementId)
          .sort((left, right) => right.version - left.version)
          .map((item) => ({ ...item }));
        return { rows, rowCount: rows.length };
      }

      if (sql.includes('SELECT storage_key')) {
        const [id, providerUserId] = values;
        const submission = evidenceSubmissions.find((item) => item.id === id
          && item.provider_user_id === providerUserId);
        return {
          rows: submission ? [{
            storage_key: submission.storage_key,
            storage_provider: submission.storage_provider,
            original_filename: submission.original_filename,
            mime_type: submission.mime_type,
            file_size: submission.file_size,
          }] : [],
          rowCount: submission ? 1 : 0,
        };
      }

      const [id, providerUserId] = values;
      const submission = evidenceSubmissions.find((item) => item.id === id
        && item.provider_user_id === providerUserId);
      return { rows: submission ? [{ ...submission }] : [], rowCount: submission ? 1 : 0 };
    }

    if (sql.includes('jsonb_to_recordset')) {
      if (!sessionsAvailable) throw new Error('Attendance database unavailable');
      const [sessionId, providerUserId, recordsJson] = values;
      const session = trainingSessions.find((item) => item.id === sessionId
        && item.provider_user_id === providerUserId && item.archived_at === null);
      if (!session) return { rows: [], rowCount: 0 };
      const records = JSON.parse(recordsJson);
      const scoped = records.map((record) => ({
        record,
        enrolment: enrolments.find((item) => item.id === record.enrolment_id
          && item.provider_user_id === providerUserId
          && item.programme_id === session.programme_id
          && item.status === 'active'),
      }));
      if (scoped.some((item) => !item.enrolment)) return { rows: [], rowCount: 0 };
      const saved = scoped.map(({ record, enrolment }) => {
        let attendance = attendanceRecords.find((item) => item.session_id === sessionId
          && item.enrolment_id === record.enrolment_id);
        const now = new Date().toISOString();
        if (attendance) {
          attendance.status = record.status;
          attendance.marked_by = providerUserId;
          attendance.updated_at = now;
        } else {
          attendance = {
            id: record.id,
            provider_user_id: providerUserId,
            programme_id: session.programme_id,
            session_id: sessionId,
            enrolment_id: record.enrolment_id,
            status: record.status,
            marked_by: providerUserId,
            created_at: now,
            updated_at: now,
          };
          attendanceRecords.push(attendance);
        }
        const learner = learners.find((item) => item.id === enrolment.learner_id);
        return {
          ...attendance,
          learner_id: learner.id,
          learner_reference: learner.learner_reference,
          learner_name: learner.full_name,
        };
      });
      return { rows: saved, rowCount: saved.length };
    }

    if (sql.includes('FROM training_sessions') || sql.includes('INTO training_sessions') || sql.includes('UPDATE training_sessions')) {
      if (!sessionsAvailable) throw new Error('Session database unavailable');
      if (sql.includes('INSERT INTO training_sessions')) {
        const [id, providerUserId, programmeId, title, startsAt] = values;
        const programme = programmes.find((item) => item.id === programmeId
          && item.provider_user_id === providerUserId && item.archived_at === null);
        if (!programme) return { rows: [], rowCount: 0 };
        const now = new Date().toISOString();
        const session = {
          id,
          provider_user_id: providerUserId,
          programme_id: programmeId,
          title,
          starts_at: startsAt,
          created_by: providerUserId,
          updated_by: providerUserId,
          created_at: now,
          updated_at: now,
          archived_at: null,
          programme_name: programme.name,
        };
        trainingSessions.push(session);
        return { rows: [{ ...session }], rowCount: 1 };
      }

      if (sql.includes('GROUP BY s.id, p.name')) {
        const [providerUserId, programmeId] = values;
        const matching = trainingSessions.filter((item) => item.provider_user_id === providerUserId
          && item.archived_at === null
          && (!programmeId || item.programme_id === programmeId))
          .map((item) => {
            const programme = programmes.find((record) => record.id === item.programme_id);
            const enrolled = enrolments.filter((record) => record.provider_user_id === providerUserId
              && record.programme_id === item.programme_id && record.status === 'active');
            const marked = attendanceRecords.filter((record) => record.session_id === item.id
              && enrolled.some((enrolment) => enrolment.id === record.enrolment_id));
            return {
              id: item.id,
              programme_id: item.programme_id,
              title: item.title,
              starts_at: item.starts_at,
              created_at: item.created_at,
              programme_name: programme.name,
              enrolled_count: enrolled.length,
              marked_count: marked.length,
            };
          });
        return { rows: matching, rowCount: matching.length };
      }

      if (sql.includes('UPDATE training_sessions') && sql.includes('SET archived_at = NOW()')) {
        const session = trainingSessions.find((item) => item.id === values[0]
          && item.provider_user_id === values[1] && item.archived_at === null);
        if (!session) return { rows: [], rowCount: 0 };
        session.archived_at = new Date().toISOString();
        session.updated_by = values[1];
        return { rows: [{ id: session.id }], rowCount: 1 };
      }

      if (sql.includes('UPDATE training_sessions')) {
        const id = values[values.length - 1];
        const providerUserId = values[values.length - 2];
        const session = trainingSessions.find((item) => item.id === id
          && item.provider_user_id === providerUserId && item.archived_at === null);
        if (!session) return { rows: [], rowCount: 0 };
        const assignments = sql.split('SET ')[1].split(', updated_by')[0];
        for (const [, column, parameter] of assignments.matchAll(/([a-z_]+) = \$(\d+)/g)) {
          session[column] = values[Number(parameter) - 1];
        }
        session.updated_by = providerUserId;
        session.updated_at = new Date().toISOString();
        return { rows: [{ ...session }], rowCount: 1 };
      }

      const session = trainingSessions.find((item) => item.id === values[0]
        && item.provider_user_id === values[1]
        && (!sql.includes('archived_at IS NULL') || item.archived_at === null));
      if (!session) return { rows: [], rowCount: 0 };
      if (sql.includes('programme_name')) {
        const programme = programmes.find((item) => item.id === session.programme_id);
        return { rows: [{ ...session, programme_name: programme.name }], rowCount: 1 };
      }
      return { rows: [{ ...session }], rowCount: 1 };
    }

    if (sql.includes('LEFT JOIN attendance_records')) {
      if (!sessionsAvailable) throw new Error('Attendance database unavailable');
      const [sessionId, providerUserId, programmeId] = values;
      const matching = enrolments.filter((item) => item.provider_user_id === providerUserId
        && item.programme_id === programmeId && item.status === 'active')
        .map((enrolment) => {
          const learner = learners.find((item) => item.id === enrolment.learner_id);
          const attendance = attendanceRecords.find((item) => item.session_id === sessionId
            && item.enrolment_id === enrolment.id);
          return {
            enrolment_id: enrolment.id,
            learner_id: learner.id,
            learner_reference: learner.learner_reference,
            learner_name: learner.full_name,
            status: attendance?.status ?? null,
            marked_by: attendance?.marked_by ?? null,
            marked_at: attendance?.updated_at ?? null,
          };
        });
      return { rows: matching, rowCount: matching.length };
    }

    if (sql.includes('FROM enrolments') || sql.includes('INSERT INTO enrolments') || sql.includes('UPDATE enrolments')) {
      if (!learnersAvailable) {
        throw new Error('Enrolment database unavailable');
      }

      if (sql.includes('WITH inserted AS')) {
        const [id, providerUserId, learnerId, programmeId] = values;
        const learner = learners.find((item) => item.id === learnerId
          && item.provider_user_id === providerUserId && item.archived_at === null);
        const programme = programmes.find((item) => item.id === programmeId
          && item.provider_user_id === providerUserId && item.archived_at === null);
        if (!learner || !programme) return { rows: [], rowCount: 0 };
        if (enrolments.some((item) => item.provider_user_id === providerUserId
          && item.learner_id === learnerId && item.programme_id === programmeId && item.status === 'active')) {
          throw Object.assign(new Error('Duplicate active enrolment'), { code: '23505' });
        }
        const now = new Date().toISOString();
        const enrolment = {
          id,
          provider_user_id: providerUserId,
          learner_id: learnerId,
          programme_id: programmeId,
          status: 'active',
          created_by: providerUserId,
          updated_by: providerUserId,
          created_at: now,
          updated_at: now,
          learner_reference: learner.learner_reference,
          learner_name: learner.full_name,
          programme_name: programme.name,
        };
        enrolments.push(enrolment);
        return { rows: [{ ...enrolment }], rowCount: 1 };
      }

      if (sql.includes('WITH updated AS')) {
        const [status, providerUserId, id] = values;
        const enrolment = enrolments.find((item) => item.id === id
          && item.provider_user_id === providerUserId);
        if (!enrolment) return { rows: [], rowCount: 0 };
        if (status === 'active') {
          const learner = learners.find((item) => item.id === enrolment.learner_id);
          const programme = programmes.find((item) => item.id === enrolment.programme_id);
          if (!learner || learner.archived_at || !programme || programme.archived_at) {
            return { rows: [], rowCount: 0 };
          }
        }
        if (status === 'active' && enrolments.some((item) => item.id !== id
          && item.provider_user_id === providerUserId
          && item.learner_id === enrolment.learner_id
          && item.programme_id === enrolment.programme_id
          && item.status === 'active')) {
          throw Object.assign(new Error('Duplicate active enrolment'), { code: '23505' });
        }
        enrolment.status = status;
        enrolment.updated_by = providerUserId;
        enrolment.updated_at = new Date().toISOString();
        return { rows: [{ ...enrolment }], rowCount: 1 };
      }

      if (sql.includes('COUNT(*)::integer')) {
        const [providerUserId, ...filters] = values;
        const learnerMatch = sql.match(/e\.learner_id = \$(\d+)/);
        const programmeMatch = sql.match(/e\.programme_id = \$(\d+)/);
        const statusMatch = sql.match(/e\.status = \$(\d+)/);
        const matching = enrolments.filter((item) => item.provider_user_id === providerUserId
          && (!statusMatch || item.status === values[Number(statusMatch[1]) - 1])
          && (!learnerMatch || item.learner_id === values[Number(learnerMatch[1]) - 1])
          && (!programmeMatch || item.programme_id === values[Number(programmeMatch[1]) - 1]));
        return { rows: [{ total: matching.length }], rowCount: 1 };
      }

      if (sql.includes('ORDER BY e.created_at DESC')) {
        const providerUserId = values[0];
        const statusMatch = sql.match(/e\.status = \$(\d+)/);
        const learnerMatch = sql.match(/e\.learner_id = \$(\d+)/);
        const programmeMatch = sql.match(/e\.programme_id = \$(\d+)/);
        const matching = enrolments
          .filter((item) => item.provider_user_id === providerUserId
            && (!statusMatch || item.status === values[Number(statusMatch[1]) - 1])
            && (!learnerMatch || item.learner_id === values[Number(learnerMatch[1]) - 1])
            && (!programmeMatch || item.programme_id === values[Number(programmeMatch[1]) - 1]))
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .slice(values[values.length - 1], values[values.length - 1] + values[values.length - 2]);
        return { rows: matching.map((item) => ({ ...item })), rowCount: matching.length };
      }

      if (sql.includes('WHERE e.id = $1 AND e.provider_user_id = $2')) {
        const enrolment = enrolments.find((item) => item.id === values[0]
          && item.provider_user_id === values[1]);
        return { rows: enrolment ? [{ ...enrolment }] : [], rowCount: enrolment ? 1 : 0 };
      }
    }

    if (sql.includes('FROM learners') || sql.includes('INTO learners') || sql.includes('UPDATE learners')) {
      if (!learnersAvailable) {
        throw new Error('Learner database unavailable');
      }

      if (sql.includes('SELECT id, provider_user_id, full_name, email, learner_user_id')) {
        const [learnerId, providerUserId] = values;
        const learner = learners.find((item) => item.id === learnerId
          && item.provider_user_id === providerUserId
          && item.archived_at === null);
        return { rows: learner ? [{ ...learner, learner_user_id: learner.learner_user_id ?? null }] : [], rowCount: learner ? 1 : 0 };
      }

      if (sql.includes('SELECT id FROM learners WHERE learner_user_id = $1')) {
        const [learnerUserId, learnerId] = values;
        const linked = learners.find((item) => item.learner_user_id === learnerUserId
          && item.id !== learnerId && item.archived_at === null);
        return { rows: linked ? [{ id: linked.id }] : [], rowCount: linked ? 1 : 0 };
      }

      if (sql.includes('SET learner_user_id = $1, updated_at = NOW()')) {
        const [learnerUserId, learnerId, providerUserId] = values;
        const learner = learners.find((item) => item.id === learnerId
          && (!providerUserId || item.provider_user_id === providerUserId)
          && item.archived_at === null && !item.learner_user_id);
        if (!learner) return { rows: [], rowCount: 0 };
        learner.learner_user_id = learnerUserId;
        learner.updated_at = new Date().toISOString();
        return { rows: [{ ...learner }], rowCount: 1 };
      }

      if (sql.includes('SELECT EXISTS')) {
        const [providerUserId, fullName, email, phone, learnerId] = values;
        const duplicate = learners.some((item) => item.provider_user_id === providerUserId
          && item.archived_at === null
          && item.id !== learnerId
          && (
            item.full_name.toLowerCase() === fullName.toLowerCase()
            || (email !== null && email !== undefined && item.email?.toLowerCase() === email.toLowerCase())
            || (phone !== null && phone !== undefined && item.phone === phone)
          ));
        return { rows: [{ duplicate }], rowCount: 1 };
      }

      if (sql.includes('INSERT INTO learners')) {
        const [id, providerUserId, learnerReference, fullName, phone, email] = values;
        const learner = {
          id,
          provider_user_id: providerUserId,
          learner_reference: learnerReference,
          full_name: fullName,
          phone,
          email,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          archived_at: null,
        };
        learners.push(learner);
        return { rows: [{ ...learner }], rowCount: 1 };
      }

      if (sql.includes('UPDATE learners') && sql.includes('SET archived_at = NOW()')) {
        const learner = learners.find((item) => item.id === values[0]
          && item.provider_user_id === values[1]
          && item.archived_at === null);
        if (!learner) return { rows: [], rowCount: 0 };
        learner.archived_at = new Date().toISOString();
        learner.updated_at = learner.archived_at;
        for (const enrolment of enrolments) {
          if (enrolment.learner_id === learner.id
            && enrolment.provider_user_id === learner.provider_user_id
            && enrolment.status === 'active') {
            enrolment.status = 'withdrawn';
            enrolment.updated_by = learner.provider_user_id;
            enrolment.updated_at = learner.updated_at;
          }
        }
        return { rows: [{ id: learner.id }], rowCount: 1 };
      }

      if (sql.includes('UPDATE learners')) {
        const id = values[values.length - 2];
        const providerUserId = values[values.length - 1];
        const learner = learners.find((item) => item.id === id
          && item.provider_user_id === providerUserId
          && item.archived_at === null);
        if (!learner) return { rows: [], rowCount: 0 };
        const assignments = sql.split('SET ')[1].split(', updated_at')[0];
        for (const [, column, parameter] of assignments.matchAll(/([a-z_]+) = \$(\d+)/g)) {
          learner[column] = values[Number(parameter) - 1];
        }
        learner.updated_at = new Date().toISOString();
        return { rows: [{ ...learner }], rowCount: 1 };
      }

      if (sql.includes('COUNT(*)::integer')) {
        const [providerUserId, search] = values;
        const searchPrefix = typeof search === 'string' ? search.replace(/%$/, '') : null;
        const rows = learners.filter((item) => item.provider_user_id === providerUserId
          && (sql.includes('archived_at IS NULL') ? item.archived_at === null
            : sql.includes('archived_at IS NOT NULL') ? item.archived_at !== null : true)
          && (!searchPrefix || item.full_name.toLowerCase().startsWith(searchPrefix)
            || item.learner_reference.toLowerCase().startsWith(searchPrefix)));
        return { rows: [{ total: rows.length }], rowCount: 1 };
      }

      if (sql.includes('ORDER BY created_at DESC')) {
        const providerUserId = values[0];
        const search = typeof values[1] === 'string' ? values[1] : null;
        const searchPrefix = search?.replace(/%$/, '');
        const limit = values[values.length - 2];
        const offset = values[values.length - 1];
        const rows = learners
          .filter((item) => item.provider_user_id === providerUserId
            && (sql.includes('archived_at IS NULL') ? item.archived_at === null
              : sql.includes('archived_at IS NOT NULL') ? item.archived_at !== null : true)
            && (!searchPrefix || item.full_name.toLowerCase().startsWith(searchPrefix)
              || item.learner_reference.toLowerCase().startsWith(searchPrefix)))
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .slice(offset, offset + limit)
          .map(({ id, learner_reference, full_name, phone, email, created_at, updated_at, archived_at }) => ({
            id, learner_reference, full_name, phone, email, created_at, updated_at, archived_at,
          }));
        return { rows, rowCount: rows.length };
      }

      const learner = learners.find((item) => item.id === values[0]
        && item.provider_user_id === values[1]);
      if (!learner) return { rows: [], rowCount: 0 };
      return { rows: [{ ...learner }], rowCount: 1 };
    }

    if (!sql.includes('programme_evidence_requirements')
      && (sql.includes('FROM programmes') || sql.includes('INTO programmes') || sql.includes('UPDATE programmes'))) {
      if (!programmesAvailable) {
        throw new Error('Programme database unavailable');
      }

      if (sql.includes('INSERT INTO programmes')) {
        const [id, providerUserId, name, description] = values;
        const programme = {
          id,
          provider_user_id: providerUserId,
          name,
          description,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          archived_at: null,
        };
        programmes.push(programme);
        return { rows: [{ ...programme }], rowCount: 1 };
      }

      if (sql.includes('SET archived_at = NOW()')) {
        const programme = programmes.find(
          (item) => item.id === values[0]
            && item.provider_user_id === values[1]
            && item.archived_at === null,
        );
        if (!programme) {
          return { rows: [], rowCount: 0 };
        }
        programme.archived_at = new Date().toISOString();
        programme.updated_at = programme.archived_at;
        return { rows: [{ id: programme.id }], rowCount: 1 };
      }

      if (sql.includes('UPDATE programmes')) {
        const id = values[values.length - 2];
        const providerUserId = values[values.length - 1];
        const programme = programmes.find(
          (item) => item.id === id
            && item.provider_user_id === providerUserId
            && item.archived_at === null,
        );
        if (!programme) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('name = $1')) {
          programme.name = values[0];
        }
        if (sql.includes('description = $1')) {
          programme.description = values[0];
        } else if (sql.includes('description = $2')) {
          programme.description = values[1];
        }
        programme.updated_at = new Date().toISOString();
        return { rows: [{ ...programme }], rowCount: 1 };
      }

      if (sql.includes('provider_user_id = $1')) {
        const rows = programmes
          .filter((item) => item.provider_user_id === values[0] && item.archived_at === null)
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .map(({ id, name, description, created_at, updated_at }) => ({
            id, name, description, created_at, updated_at,
          }));
        return { rows, rowCount: rows.length };
      }

      const programme = programmes.find(
        (item) => item.id === values[0]
          && item.provider_user_id === values[1]
          && item.archived_at === null,
      );
      if (!programme) {
        return { rows: [], rowCount: 0 };
      }
      const { id, name, description, created_at, updated_at } = programme;
      return { rows: [{ id, name, description, created_at, updated_at }], rowCount: 1 };
    }

    if (sql.includes('programme_evidence_requirements')) {
      if (!evidenceRequirementsAvailable) {
        throw new Error('Evidence requirements database unavailable');
      }

      if (sql.includes('INSERT INTO programme_evidence_requirements')) {
        const [id, providerUserId, programmeId, title, guidance] = values;
        const programme = programmes.find((item) => item.id === programmeId
          && item.provider_user_id === providerUserId && item.archived_at === null);
        if (!programme) return { rows: [], rowCount: 0 };
        const now = new Date().toISOString();
        const requirement = {
          id,
          provider_user_id: providerUserId,
          programme_id: programmeId,
          title,
          guidance,
          created_by: providerUserId,
          updated_by: providerUserId,
          created_at: now,
          updated_at: now,
          archived_at: null,
        };
        evidenceRequirements.push(requirement);
        return { rows: [{ ...requirement }], rowCount: 1 };
      }

      if (sql.includes('UPDATE programme_evidence_requirements')) {
        const isArchive = sql.includes('SET archived_at = NOW()');
        const id = values[isArchive ? 0 : 4];
        const programmeId = values[isArchive ? 1 : 5];
        const providerUserId = values[isArchive ? 2 : 6];
        const requirement = evidenceRequirements.find((item) => item.id === id
          && item.programme_id === programmeId
          && item.provider_user_id === providerUserId
          && item.archived_at === null
          && programmes.some((programme) => programme.id === programmeId
            && programme.provider_user_id === providerUserId
            && programme.archived_at === null));
        if (!requirement) return { rows: [], rowCount: 0 };
        if (isArchive) {
          requirement.archived_at = new Date().toISOString();
          requirement.updated_by = providerUserId;
          requirement.updated_at = requirement.archived_at;
          return { rows: [{ id: requirement.id }], rowCount: 1 };
        }
        if (values[0] !== null) requirement.title = values[0];
        if (values[1]) requirement.guidance = values[2];
        requirement.updated_by = values[3];
        requirement.updated_at = new Date().toISOString();
        return { rows: [{ ...requirement }], rowCount: 1 };
      }

      const isList = sql.includes('ORDER BY created_at');
      const [first, second, third] = values;
      const programmeId = isList ? first : second;
      const providerUserId = isList ? second : third;
      const rows = evidenceRequirements
        .filter((item) => item.provider_user_id === providerUserId
          && item.archived_at === null
          && programmes.some((programme) => programme.id === item.programme_id
            && programme.provider_user_id === providerUserId
            && programme.archived_at === null)
          && (isList ? item.programme_id === programmeId
            : item.id === first && item.programme_id === programmeId))
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .map(({ id, programme_id, title, guidance, created_at, updated_at }) => ({
          id, programme_id, title, guidance, created_at, updated_at,
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('INSERT INTO users')) {
      if (users.some((user) => user.email === values[1])) {
        throw Object.assign(new Error('Duplicate email'), { code: '23505' });
      }

      const role = sql.includes("'learner'") ? 'learner' : 'provider';

      const user = {
        id: values[0],
        email: values[1],
        full_name: values[2],
        password_hash: values[3],
        role,
        is_active: true,
      };
      users.push(user);
      return { rows: [user], rowCount: 1 };
    }

    if (sql.includes('lower(email) = lower($1)') && sql.includes('FROM users')) {
      const [email] = values;
      const user = users.find((item) => item.email?.toLowerCase() === String(email).toLowerCase() && item.is_active);
      return { rows: user ? [{
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        is_active: user.is_active,
      }] : [], rowCount: user ? 1 : 0 };
    }

    if (sql.includes('WHERE email = $1')) {
      if (transientLoginFailures > 0) {
        transientLoginFailures -= 1;
        throw Object.assign(new Error('Database connection timed out'), { code: 'ETIMEDOUT' });
      }
      if (!databaseAvailable) {
        throw Object.assign(new Error('Database connection timed out'), { code: 'ETIMEDOUT' });
      }
      const user = users.find((item) => item.email === values[0] && item.is_active);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    if (sql.includes('SELECT id, provider_user_id, full_name, email, learner_user_id')
      && sql.includes('FROM learners')
      && sql.includes('WHERE id = $1 AND provider_user_id = $2')) {
      if (!learnersAvailable) throw new Error('Learner database unavailable');
      const [learnerId, providerUserId] = values;
      const learner = learners.find((item) => item.id === learnerId && item.provider_user_id === providerUserId);
      return { rows: learner ? [{ ...learner, learner_user_id: learner.learner_user_id ?? null }] : [], rowCount: learner ? 1 : 0 };
    }

    if (sql.includes('SELECT id FROM learners WHERE learner_user_id = $1')) {
      const [learnerUserId, learnerId] = values;
      const linked = learners.find((item) => item.learner_user_id === learnerUserId && item.id !== learnerId && item.archived_at === null);
      return { rows: linked ? [{ id: linked.id }] : [], rowCount: linked ? 1 : 0 };
    }

    if (sql.includes('UPDATE learners') && sql.includes('SET learner_user_id = $1, updated_at = NOW()')) {
      const [learnerUserId, learnerId, providerUserId] = values;
      const learner = learners.find((item) => item.id === learnerId && item.provider_user_id === providerUserId);
      if (!learner) return { rows: [], rowCount: 0 };
      learner.learner_user_id = learnerUserId;
      learner.updated_at = new Date().toISOString();
      return { rows: [{ ...learner, learner_user_id: learnerUserId }], rowCount: 1 };
    }

    // Learner timetable queries (covered against PostgreSQL in scheduling.integration.test.js).
    if (sql.includes('AS attendance_status') || sql.includes('AS is_individual')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('WHERE id = $1')) {
      const user = users.find((item) => item.id === values[0] && item.is_active);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    throw new Error(`Unexpected SQL in test: ${sql}`);
  },
  async connect() {
    return { query: this.query.bind(this), release() {} };
  },
};

function tokenFor(userId, role) {
  return jwt.sign({ role }, jwtSecret, {
    subject: userId,
    audience: 'agriprovider-app',
    issuer: 'agriprovider-api',
    expiresIn: '1h',
  });
}

function authHeaders(token = accessToken) {
  return { authorization: 'Bearer ' + token };
}

async function requestProgramme(path, { method = 'GET', token = accessToken, body } = {}) {
  const headers = token ? authHeaders(token) : {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  return fetch(`${baseUrl}/api/programmes${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function requestLearner(path, { method = 'GET', token = accessToken, body } = {}) {
  const headers = token ? authHeaders(token) : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}/api/learners${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function requestEnrolment(path, { method = 'GET', token = accessToken, body } = {}) {
  const headers = token ? authHeaders(token) : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}/api/enrolments${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function requestSession(path, { method = 'GET', token = accessToken, body } = {}) {
  const headers = token ? authHeaders(token) : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}/api/sessions${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function requestLearnerPortal(path, { token = tokenFor(learnerId, 'learner') } = {}) {
  return fetch(`${baseUrl}/api/learner${path}`, {
    headers: token ? authHeaders(token) : {},
  });
}

async function requestEvidenceRequirements(programmeId, path, {
  method = 'GET',
  token = accessToken,
  body,
} = {}) {
  const headers = token ? authHeaders(token) : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}/api/programmes/${programmeId}/evidence-requirements${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function requestEvidence(enrolmentId, pathname, {
  method = 'GET',
  token = accessToken,
  file,
} = {}) {
  const headers = token ? authHeaders(token) : {};
  let body;
  if (file) {
    body = new FormData();
    body.append('file', new Blob([file.buffer], { type: file.mimeType }), file.filename);
  }
  return fetch(`${baseUrl}${pathname.replace(':enrolmentId', enrolmentId)}`, {
    method,
    headers,
    body,
  });
}

async function createEvidenceFixture(token = accessToken) {
  const suffix = randomUUID();
  const programmeResponse = await requestProgramme('/', {
    method: 'POST',
    token,
    body: { name: `Evidence programme ${suffix}` },
  });
  const { programme } = await programmeResponse.json();
  const learnerResponse = await requestLearner('/', {
    method: 'POST',
    token,
    body: { fullName: `Evidence learner ${suffix}` },
  });
  const { learner } = await learnerResponse.json();
  const enrolmentResponse = await requestEnrolment('/', {
    method: 'POST',
    token,
    body: { learnerId: learner.id, programmeId: programme.id },
  });
  const { enrolment } = await enrolmentResponse.json();
  const requirementResponse = await requestEvidenceRequirements(programme.id, '/', {
    method: 'POST',
    token,
    body: { title: `Evidence item ${suffix}` },
  });
  const { requirement } = await requirementResponse.json();
  return { programme, learner, enrolment, requirement };
}

before(async () => {
  server = createApp(database, { jwtSecret, evidenceStorage, webOrigin }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('health endpoint confirms the API and database are available', async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
});

test('expo and localhost web origins are accepted for browser-to-API requests', async () => {
  for (const origin of [
    'https://demo-1234567890.on.expo.app',
    'http://localhost:8084',
    'http://127.0.0.1:8084',
  ]) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-auth-mode',
      },
    });

    assert.equal(response.status >= 200 && response.status < 300, true);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  }
});

test('password validation enforces bcrypt byte limits', () => {
  assert.equal(validPassword('a'.repeat(12)), true);
  assert.equal(validPassword('a'.repeat(72)), true);
  assert.equal(validPassword('a'.repeat(11)), false);
  assert.equal(validPassword('a'.repeat(73)), false);
  assert.equal(validPassword('€'.repeat(25)), false);
});

test('production app startup requires an explicitly configured private storage adapter', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(
      () => createApp(database, { jwtSecret }),
      /Production requires an explicitly configured private evidence storage adapter/,
    );
    assert.throws(
      () => createApp(database, {
        jwtSecret,
        evidenceStorage: {
          provider: 'local-development',
          async save() {},
          async read() {},
          async delete() {},
        },
      }),
      /Production requires an explicitly configured private evidence storage adapter/,
    );
    assert.throws(
      () => createApp(database, { jwtSecret, evidenceStorage }),
      /WEB_ORIGIN must be configured in production/,
    );
    assert.doesNotThrow(() => createApp(database, {
      jwtSecret,
      evidenceStorage,
      webOrigin: 'https://app.example.com',
    }));
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('evidence validator accepts only matching PDF, JPEG, and PNG signatures', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(validateEvidenceFile({
    originalname: 'photo.jpg',
    mimetype: 'image/jpeg',
    buffer: jpeg,
  }).value.mimeType, 'image/jpeg');
  assert.equal(validateEvidenceFile({
    originalname: 'photo.png',
    mimetype: 'image/png',
    buffer: png,
  }).value.mimeType, 'image/png');
  assert.match(validateEvidenceFile({
    originalname: 'photo.jpg',
    mimetype: 'image/png',
    buffer: jpeg,
  }).error, /content must match/);
});

test('registration creates a provider and ignores a client-supplied role', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: '  Test Provider  ',
      email: '  PROVIDER@example.com ',
      password: 'a secure password phrase',
      role: 'qa',
      accountType: 'admin',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.user.fullName, 'Test Provider');
  assert.equal(body.user.email, 'provider@example.com');
  assert.equal(body.user.role, 'provider');
  assert.equal(body.user.password_hash, undefined);
  assert.notEqual(users[0].password_hash, 'a secure password phrase');
  assert.equal(typeof body.accessToken, 'string');
  registeredUser = body.user;
  accessToken = body.accessToken;
});

test('administrators manage assessor assignments while other roles are denied', async () => {
  const programmeResponse = await requestProgramme('/', {
    method: 'POST',
    body: { name: `Assignment programme ${randomUUID()}` },
  });
  const { programme } = await programmeResponse.json();
  const adminToken = tokenFor(adminId, 'admin');
  const adminHeaders = authHeaders(adminToken);
  const assessorsResponse = await fetch(`${baseUrl}/api/admin/assessors`, { headers: adminHeaders });
  const assessorsBody = await assessorsResponse.json();
  assert.equal(assessorsResponse.status, 200);
  assert.equal(assessorsBody.assessors.length, 2);
  assert.ok(assessorsBody.assessors.every((item) => item.id === assessorId || item.id === assessorBId));

  const programmesResponse = await fetch(`${baseUrl}/api/admin/programmes`, { headers: adminHeaders });
  assert.equal(programmesResponse.status, 200);
  assert.ok((await programmesResponse.json()).programmes.some((item) => item.id === programme.id));

  const assignmentUrl = `${baseUrl}/api/admin/assessor-assignments`;
  const assignmentResponse = await fetch(assignmentUrl, {
    method: 'POST',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ programmeId: programme.id, assessorUserId: assessorId }),
  });
  assert.equal(assignmentResponse.status, 201);
  const { assignment } = await assignmentResponse.json();
  assert.equal(assignment.status, 'ACTIVE');
  assert.equal(assignment.created_by, adminId);

  const duplicate = await fetch(assignmentUrl, {
    method: 'POST',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ programmeId: programme.id, assessorUserId: assessorId }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'ACTIVE_ASSIGNMENT_EXISTS');

  const invalidAssessor = await fetch(assignmentUrl, {
    method: 'POST',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ programmeId: programme.id, assessorUserId: qaId }),
  });
  assert.equal(invalidAssessor.status, 404);

  const assignmentsResponse = await fetch(assignmentUrl, { headers: adminHeaders });
  const listed = (await assignmentsResponse.json()).assignments;
  assert.equal(assignmentsResponse.status, 200);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].assessor_name, 'assessor');

  const statusUrl = `${assignmentUrl}/${assignment.id}`;
  const inactive = await fetch(statusUrl, {
    method: 'PATCH',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'INACTIVE' }),
  });
  assert.equal((await inactive.json()).assignment.status, 'INACTIVE');
  const reactivated = await fetch(statusUrl, {
    method: 'PATCH',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'ACTIVE' }),
  });
  assert.equal((await reactivated.json()).assignment.status, 'ACTIVE');

  const reassigned = await fetch(statusUrl, {
    method: 'PATCH',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ assessorUserId: assessorBId }),
  });
  const reassignedBody = await reassigned.json();
  assert.equal(reassigned.status, 200);
  assert.equal(reassignedBody.previous_assignment_id, assignment.id);
  assert.equal(reassignedBody.assignment.assessor_user_id, assessorBId);
  assert.notEqual(reassignedBody.assignment.id, assignment.id);
  assert.equal(assessorAssignments.find((item) => item.id === assignment.id).status, 'INACTIVE');
  const previousAssessorProgrammes = await fetch(`${baseUrl}/api/assessor/programmes`, {
    headers: authHeaders(tokenFor(assessorId, 'assessor')),
  });
  assert.equal((await previousAssessorProgrammes.json()).programmes.some((item) => item.id === programme.id), false);
  const replacementAssessorProgrammes = await fetch(`${baseUrl}/api/assessor/programmes`, {
    headers: authHeaders(tokenFor(assessorBId, 'assessor')),
  });
  assert.equal((await replacementAssessorProgrammes.json()).programmes.some((item) => item.id === programme.id), true);

  for (const token of [accessToken, tokenFor(assessorId, 'assessor'), tokenFor(qaId, 'qa')]) {
    const denied = await fetch(`${baseUrl}/api/admin/assessors`, { headers: authHeaders(token) });
    assert.equal(denied.status, 403);
  }
  const unauthenticated = await fetch(`${baseUrl}/api/admin/assessors`);
  assert.equal(unauthenticated.status, 401);
  assert.equal((await requestProgramme(`/${programme.id}`, { method: 'DELETE' })).status, 200);
});

test('registration rejects duplicate emails and invalid passwords', async () => {
  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Another Provider',
      email: 'provider@example.com',
      password: 'a secure password phrase',
    }),
  });
  assert.equal(duplicate.status, 409);

  const invalid = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Another Provider',
      email: 'another@example.com',
      password: 'short',
    }),
  });
  assert.equal(invalid.status, 400);
});

test('login rejects invalid credentials without disclosing whether the email exists', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'provider@example.com', password: 'incorrect password' }),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: 'Email or password is incorrect.',
  });
});

test('login retries once after a transient database connection error', async () => {
  transientLoginFailures = 1;
  const originalConsoleWarn = console.warn;
  console.warn = () => {};

  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'provider@example.com',
        password: 'a secure password phrase',
        accountType: 'provider',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, registeredUser.id);
    assert.equal(transientLoginFailures, 0);
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('login issues a signed token and the current-user route validates it', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'provider@example.com',
      password: 'a secure password phrase',
      accountType: 'provider',
    }),
  });
  const loginBody = await login.json();
  assert.equal(login.status, 200);
  assert.equal(loginBody.user.id, registeredUser.id);

  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${loginBody.accessToken}` },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).user, registeredUser);
});

test('login rejects a valid account when it does not match the selected type', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'provider@example.com',
      password: 'a secure password phrase',
      accountType: 'admin',
    }),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: 'Email or password is incorrect.',
  });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('login rejects unsupported selected account types', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'provider@example.com',
      password: 'a secure password phrase',
      accountType: 'owner',
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Choose a supported sign-in type.' });
});

test('login returns a retryable service error when the database connection is unavailable', async () => {
  databaseAvailable = false;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};

  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'provider@example.com',
        password: 'a secure password phrase',
        accountType: 'provider',
      }),
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'The service is temporarily unavailable. Please try again.',
    });
  } finally {
    databaseAvailable = true;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
});

test('web login uses a protected cookie session and enforces the configured origin', async () => {
  const headers = {
    'content-type': 'application/json',
    'x-auth-mode': 'cookie',
    origin: webOrigin,
  };
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: 'provider@example.com',
      password: 'a secure password phrase',
    }),
  });
  const loginBody = await login.json();
  const setCookie = login.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';', 1)[0];

  assert.equal(login.status, 200);
  assert.equal(loginBody.user.id, registeredUser.id);
  assert.equal(loginBody.accessToken, undefined);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\/api/i);
  assert.equal(login.headers.get('access-control-allow-origin'), webOrigin);
  assert.equal(login.headers.get('access-control-allow-credentials'), 'true');

  const profile = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      'x-auth-mode': 'cookie',
      origin: webOrigin,
      cookie,
    },
  });
  assert.equal(profile.status, 200);
  assert.deepEqual((await profile.json()).user, registeredUser);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'x-auth-mode': 'cookie', origin: webOrigin },
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie') || '', /Expires=/i);

  const untrusted = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { ...headers, origin: 'https://untrusted.example' },
    body: JSON.stringify({
      email: 'provider@example.com',
      password: 'a secure password phrase',
    }),
  });
  assert.equal(untrusted.status, 403);
});

test('current-user route rejects missing or invalid tokens', async () => {
  const missing = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(missing.status, 401);

  const invalid = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: 'Bearer invalid-token' },
  });
  assert.equal(invalid.status, 401);
});

test('current-user route rejects accounts that are no longer active', async () => {
  const registeredAccount = users.find((user) => user.id === registeredUser.id);
  registeredAccount.is_active = false;
  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  registeredAccount.is_active = true;

  assert.equal(response.status, 401);
});

test('health endpoint reports database outages without exposing details', async () => {
  databaseAvailable = false;
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: 'unavailable',
      database: 'disconnected',
    });
  } finally {
    databaseAvailable = true;
    console.error = originalConsoleError;
  }
});

test('unknown routes return a not found response', async () => {
  const response = await fetch(`${baseUrl}/missing/${randomUUID()}`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});

test('programme listing returns an empty list for a provider with no programmes', async () => {
  const response = await requestProgramme('/', { token: tokenFor(providerBId, 'provider') });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { programmes: [] });
});

test('provider can create, list, retrieve, update, and archive an owned programme', async () => {
  const created = await requestProgramme('/', {
    method: 'POST',
    body: { name: '  Soil management  ', description: '  Field-based training  ' },
  });
  const createdBody = await created.json();

  assert.equal(created.status, 201);
  assert.equal(createdBody.programme.name, 'Soil management');
  assert.equal(createdBody.programme.description, 'Field-based training');
  assert.equal(typeof createdBody.programme.id, 'string');

  const listed = await requestProgramme('/');
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).programmes.length, 1);

  const retrieved = await requestProgramme(`/${createdBody.programme.id}`);
  assert.equal(retrieved.status, 200);
  assert.equal((await retrieved.json()).programme.id, createdBody.programme.id);

  const updated = await requestProgramme(`/${createdBody.programme.id}`, {
    method: 'PATCH',
    body: { name: 'Updated soil management', description: null },
  });
  assert.equal(updated.status, 200);
  const updatedProgramme = (await updated.json()).programme;
  assert.equal(updatedProgramme.name, 'Updated soil management');
  assert.equal(updatedProgramme.description, null);

  const archived = await requestProgramme(`/${createdBody.programme.id}`, { method: 'DELETE' });
  assert.equal(archived.status, 200);
  assert.deepEqual(await archived.json(), { message: 'Programme archived.' });
  assert.deepEqual((await (await requestProgramme('/')).json()).programmes, []);
});

test('programme endpoints reject invalid bodies and UUIDs', async () => {
  const missingName = await requestProgramme('/', { method: 'POST', body: { description: 'Text' } });
  assert.equal(missingName.status, 400);

  const blankName = await requestProgramme('/', { method: 'POST', body: { name: '  ' } });
  assert.equal(blankName.status, 400);

  const unknownField = await requestProgramme('/', {
    method: 'POST',
    body: { name: 'Valid', providerUserId: providerBId },
  });
  assert.equal(unknownField.status, 400);

  const emptyPatch = await requestProgramme(`/${randomUUID()}`, { method: 'PATCH', body: {} });
  assert.equal(emptyPatch.status, 400);

  const invalidId = await requestProgramme('/not-a-uuid');
  assert.equal(invalidId.status, 400);
});

test('programme progress reports current activity counts without inferring completion', async () => {
  const programmeId = randomUUID();
  const activeEnrolmentOne = randomUUID();
  const activeEnrolmentTwo = randomUUID();
  const withdrawnEnrolment = randomUUID();
  const sessionId = randomUUID();
  const archivedSessionId = randomUUID();
  const requirementOne = randomUUID();
  const requirementTwo = randomUUID();
  const now = new Date().toISOString();

  programmes.push({
    id: programmeId,
    provider_user_id: registeredUser.id,
    name: 'Progress summary programme',
    description: null,
    created_at: now,
    updated_at: now,
    archived_at: null,
  });
  enrolments.push(
    { id: activeEnrolmentOne, provider_user_id: registeredUser.id, programme_id: programmeId, status: 'active' },
    { id: activeEnrolmentTwo, provider_user_id: registeredUser.id, programme_id: programmeId, status: 'active' },
    { id: withdrawnEnrolment, provider_user_id: registeredUser.id, programme_id: programmeId, status: 'withdrawn' },
  );
  trainingSessions.push(
    { id: sessionId, provider_user_id: registeredUser.id, programme_id: programmeId, archived_at: null },
    { id: archivedSessionId, provider_user_id: registeredUser.id, programme_id: programmeId, archived_at: now },
  );
  attendanceRecords.push(
    { id: randomUUID(), provider_user_id: registeredUser.id, programme_id: programmeId, session_id: sessionId, status: 'present' },
    { id: randomUUID(), provider_user_id: registeredUser.id, programme_id: programmeId, session_id: archivedSessionId, status: 'excused' },
  );
  evidenceRequirements.push(
    { id: requirementOne, provider_user_id: registeredUser.id, programme_id: programmeId, archived_at: null, created_at: now },
    { id: requirementTwo, provider_user_id: registeredUser.id, programme_id: programmeId, archived_at: null, created_at: now },
  );
  evidenceSubmissions.push(
    { id: randomUUID(), provider_user_id: registeredUser.id, programme_id: programmeId, enrolment_id: activeEnrolmentOne, requirement_id: requirementOne, version: 1, status: 'APPROVED' },
    { id: randomUUID(), provider_user_id: registeredUser.id, programme_id: programmeId, enrolment_id: activeEnrolmentOne, requirement_id: requirementOne, version: 2, status: 'CORRECTION_REQUIRED' },
    { id: randomUUID(), provider_user_id: registeredUser.id, programme_id: programmeId, enrolment_id: activeEnrolmentOne, requirement_id: requirementTwo, version: 1, status: 'SUBMITTED' },
    { id: randomUUID(), provider_user_id: registeredUser.id, programme_id: programmeId, enrolment_id: activeEnrolmentTwo, requirement_id: requirementOne, version: 1, status: 'UNDER_REVIEW' },
    { id: randomUUID(), provider_user_id: registeredUser.id, programme_id: programmeId, enrolment_id: withdrawnEnrolment, requirement_id: requirementTwo, version: 1, status: 'APPROVED' },
  );

  const response = await requestProgramme(`/${programmeId}/progress`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).progress, {
    programme_id: programmeId,
    active_enrolments: 2,
    withdrawn_enrolments: 1,
    active_sessions: 1,
    attendance_recorded: 2,
    attendance_present: 1,
    attendance_absent: 0,
    attendance_excused: 1,
    evidence_requirements: 2,
    evidence_slots: 4,
    evidence_not_submitted: 1,
    evidence_submitted: 1,
    evidence_awaiting_review: 1,
    evidence_approved: 0,
    evidence_correction_required: 1,
  });

  const otherProvider = await requestProgramme(`/${programmeId}/progress`, {
    token: tokenFor(providerBId, 'provider'),
  });
  assert.equal(otherProvider.status, 404);
  const invalidId = await requestProgramme('/not-a-uuid/progress');
  assert.equal(invalidId.status, 400);
  const unauthenticated = await requestProgramme(`/${programmeId}/progress`, { token: null });
  assert.equal(unauthenticated.status, 401);

  const emptyProgrammeId = randomUUID();
  programmes.push({
    id: emptyProgrammeId,
    provider_user_id: registeredUser.id,
    name: 'Empty progress programme',
    description: null,
    created_at: now,
    updated_at: now,
    archived_at: null,
  });
  const empty = await requestProgramme(`/${emptyProgrammeId}/progress`);
  assert.equal(empty.status, 200);
  const emptyProgress = (await empty.json()).progress;
  assert.equal(emptyProgress.active_enrolments, 0);
  assert.equal(emptyProgress.active_sessions, 0);
  assert.equal(emptyProgress.evidence_slots, 0);
  assert.equal(emptyProgress.evidence_not_submitted, 0);
});

test('programme endpoints require authentication', async () => {
  const list = await requestProgramme('/', { token: null });
  const create = await requestProgramme('/', { method: 'POST', token: null, body: { name: 'Test' } });
  const retrieve = await requestProgramme(`/${randomUUID()}`, { token: null });
  const update = await requestProgramme(`/${randomUUID()}`, {
    method: 'PATCH',
    token: null,
    body: { name: 'Updated' },
  });
  const remove = await requestProgramme(`/${randomUUID()}`, { method: 'DELETE', token: null });

  for (const response of [list, create, retrieve, update, remove]) {
    assert.equal(response.status, 401);
  }
});

test('assessors and QA officers cannot use provider programme endpoints', async () => {
  const roleTokens = [
    tokenFor(assessorId, 'assessor'),
    tokenFor(qaId, 'qa'),
  ];

  for (const token of roleTokens) {
    const responses = [
      await requestProgramme('/', { token }),
      await requestProgramme('/', { method: 'POST', token, body: { name: 'Denied' } }),
      await requestProgramme(`/${randomUUID()}`, { token }),
      await requestProgramme(`/${randomUUID()}`, { method: 'PATCH', token, body: { name: 'Denied' } }),
      await requestProgramme(`/${randomUUID()}`, { method: 'DELETE', token }),
    ];
    for (const response of responses) {
      assert.equal(response.status, 403);
    }
  }
});

test('a provider cannot retrieve, update, or archive another provider programme', async () => {
  const created = await requestProgramme('/', {
    method: 'POST',
    token: tokenFor(providerBId, 'provider'),
    body: { name: 'Provider B programme' },
  });
  const { programme } = await created.json();

  const retrieve = await requestProgramme(`/${programme.id}`);
  const update = await requestProgramme(`/${programme.id}`, {
    method: 'PATCH',
    body: { name: 'Unauthorized update' },
  });
  const remove = await requestProgramme(`/${programme.id}`, { method: 'DELETE' });

  assert.equal(retrieve.status, 404);
  assert.equal(update.status, 404);
  assert.equal(remove.status, 404);

  const providerBList = await requestProgramme('/', { token: tokenFor(providerBId, 'provider') });
  assert.equal((await providerBList.json()).programmes[0].name, 'Provider B programme');
});

test('programme database failures return a safe server error', async () => {
  programmesAvailable = false;
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const response = await requestProgramme('/');

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
  } finally {
    programmesAvailable = true;
    console.error = originalConsoleError;
  }
});

test('programme migration defines owner relationship, constraints, timestamps, and active-list index', async () => {
  const migration = await fs.readFile(
    require.resolve('../migrations/202610300001_create_programmes.sql'),
    'utf8',
  );

  assert.match(migration, /CREATE TABLE programmes/);
  assert.match(migration, /id UUID PRIMARY KEY/);
  assert.match(migration, /provider_user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /char_length\(btrim\(name\)\) BETWEEN 1 AND 160/);
  assert.match(migration, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(migration, /updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(migration, /archived_at TIMESTAMPTZ/);
  assert.match(migration, /programmes_provider_active_created_idx/);
});

test('a provider can configure, list, update, retrieve, and archive programme checklist items', async () => {
  const programmeResponse = await requestProgramme('/', {
    method: 'POST',
    body: { name: `Checklist programme ${randomUUID()}` },
  });
  const { programme } = await programmeResponse.json();

  const empty = await requestEvidenceRequirements(programme.id, '/');
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).requirements, []);

  const created = await requestEvidenceRequirements(programme.id, '/', {
    method: 'POST',
    body: { title: 'Provider-defined item', guidance: 'Optional instructions' },
  });
  assert.equal(created.status, 201);
  const { requirement } = await created.json();
  assert.equal(requirement.title, 'Provider-defined item');
  assert.equal(requirement.guidance, 'Optional instructions');

  const listed = await requestEvidenceRequirements(programme.id, '/');
  assert.equal((await listed.json()).requirements[0].id, requirement.id);
  const retrieved = await requestEvidenceRequirements(programme.id, `/${requirement.id}`);
  assert.equal((await retrieved.json()).requirement.id, requirement.id);

  const updated = await requestEvidenceRequirements(programme.id, `/${requirement.id}`, {
    method: 'PATCH',
    body: { title: 'Updated item', guidance: null },
  });
  const updatedRequirement = (await updated.json()).requirement;
  assert.equal(updated.status, 200);
  assert.equal(updatedRequirement.title, 'Updated item');
  assert.equal(updatedRequirement.guidance, null);

  const archived = await requestEvidenceRequirements(programme.id, `/${requirement.id}`, {
    method: 'DELETE',
  });
  assert.equal(archived.status, 200);
  assert.deepEqual(await archived.json(), { message: 'Checklist item archived.' });
  assert.deepEqual((await (await requestEvidenceRequirements(programme.id, '/')).json()).requirements, []);
  assert.equal((await requestEvidenceRequirements(programme.id, `/${requirement.id}`)).status, 404);
});

test('checklist items validate input and enforce authentication, provider role, and ownership', async () => {
  assert.equal(validateRequirementBody({ title: ' ' }).error !== undefined, true);
  assert.equal(validateRequirementBody({ title: 'Valid', providerUserId: providerBId }).error !== undefined, true);
  assert.equal(validateRequirementBody({ title: 'Valid', guidance: 5 }).error !== undefined, true);
  assert.equal(validateRequirementBody({ title: 'Valid', guidance: 'x'.repeat(2001) }).error !== undefined, true);

  const invalidProgrammeId = await requestEvidenceRequirements('not-a-uuid', '/');
  assert.equal(invalidProgrammeId.status, 400);
  const programmeResponse = await requestProgramme('/', {
    method: 'POST',
    body: { name: `Checklist ownership ${randomUUID()}` },
  });
  const { programme } = await programmeResponse.json();
  const missingTitle = await requestEvidenceRequirements(programme.id, '/', {
    method: 'POST',
    body: { guidance: 'No title' },
  });
  assert.equal(missingTitle.status, 400);
  assert.equal((await requestEvidenceRequirements(programme.id, '/not-a-uuid')).status, 400);

  const created = await requestEvidenceRequirements(programme.id, '/', {
    method: 'POST',
    body: { title: 'Owned checklist item' },
  });
  const { requirement } = await created.json();
  const foreignProgrammeResponse = await requestProgramme('/', {
    method: 'POST',
    token: tokenFor(providerBId, 'provider'),
    body: { name: `Foreign checklist ${randomUUID()}` },
  });
  const { programme: foreignProgramme } = await foreignProgrammeResponse.json();

  assert.equal((await requestEvidenceRequirements(foreignProgramme.id, '/')).status, 404);
  assert.equal((await requestEvidenceRequirements(foreignProgramme.id, '/', {
    method: 'POST',
    body: { title: 'Not owned' },
  })).status, 404);
  for (const [method, body] of [
    ['GET', undefined],
    ['PATCH', { title: 'Unauthorized' }],
    ['DELETE', undefined],
  ]) {
    const response = await requestEvidenceRequirements(programme.id, `/${requirement.id}`, {
      method,
      token: tokenFor(providerBId, 'provider'),
      body,
    });
    assert.equal(response.status, 404);
  }

  assert.equal((await requestEvidenceRequirements(programme.id, '/', { token: null })).status, 401);
  for (const token of [tokenFor(assessorId, 'assessor'), tokenFor(qaId, 'qa')]) {
    assert.equal((await requestEvidenceRequirements(programme.id, '/', { token })).status, 403);
    assert.equal((await requestEvidenceRequirements(programme.id, '/', {
      method: 'POST',
      token,
      body: { title: 'Denied item' },
    })).status, 403);
  }
});

test('checklist item database failures return a safe server error', async () => {
  evidenceRequirementsAvailable = false;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const programmeResponse = await requestProgramme('/', {
      method: 'POST',
      body: { name: `Checklist failure ${randomUUID()}` },
    });
    const { programme } = await programmeResponse.json();
    const response = await requestEvidenceRequirements(programme.id, '/');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
  } finally {
    evidenceRequirementsAvailable = true;
    console.error = originalConsoleError;
  }
});

test('evidence requirement migration defines owner constraints, auditing, archival, and scoped index', async () => {
  const migration = await fs.readFile(
    require.resolve('../migrations/202610300005_create_programme_evidence_requirements.sql'),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE programme_evidence_requirements/);
  assert.match(migration, /FOREIGN KEY \(provider_user_id, programme_id\)/);
  assert.match(migration, /title TEXT NOT NULL CHECK/);
  assert.match(migration, /guidance TEXT CHECK/);
  assert.match(migration, /created_by UUID NOT NULL REFERENCES users\(id\)/);
  assert.match(migration, /updated_by UUID NOT NULL REFERENCES users\(id\)/);
  assert.match(migration, /archived_at TIMESTAMPTZ/);
  assert.match(migration, /programme_evidence_requirements_active_idx/);
});

test('valid evidence uploads are private, provider-scoped, versioned, and preserve history', async () => {
  const { enrolment, requirement } = await createEvidenceFixture();
  const firstFile = {
    filename: 'attendance.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\nfirst ${randomUUID()}`),
  };
  const firstResponse = await requestEvidence(
    enrolment.id,
    '/api/enrolments/:enrolmentId/evidence-requirements/' + requirement.id + '/submissions',
    { method: 'POST', file: firstFile },
  );
  assert.equal(firstResponse.status, 201);
  const firstBody = await firstResponse.json();
  const first = firstBody.submission;
  assert.equal(first.status, 'SUBMITTED');
  assert.equal(first.version, 1);
  assert.equal(first.original_filename, firstFile.filename);
  assert.equal(first.mime_type, firstFile.mimeType);
  assert.equal(first.file_size, firstFile.buffer.length);
  assert.equal(first.submitted_by, registeredUser.id);
  assert.equal(Object.hasOwn(first, 'storage_key'), false);

  const duplicate = await requestEvidence(
    enrolment.id,
    '/api/enrolments/:enrolmentId/evidence-requirements/' + requirement.id + '/submissions',
    { method: 'POST', file: firstFile },
  );
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'DUPLICATE_SUBMISSION');

  evidenceSubmissions.find((item) => item.id === first.id).status = 'CORRECTION_REQUIRED';
  const secondFile = { ...firstFile, buffer: Buffer.from(`%PDF-1.4\nsecond ${randomUUID()}`) };
  const secondResponse = await requestEvidence(
    enrolment.id,
    '/api/enrolments/:enrolmentId/evidence-requirements/' + requirement.id + '/submissions',
    { method: 'POST', file: secondFile },
  );
  assert.equal(secondResponse.status, 201);
  const second = (await secondResponse.json()).submission;
  assert.equal(second.version, 2);
  assert.equal(second.status, 'SUBMITTED');

  const historyResponse = await fetch(`${baseUrl}/api/evidence-submissions/${second.id}/history`, {
    headers: authHeaders(),
  });
  const historyBody = await historyResponse.json();
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(historyBody.submissions.map((item) => item.version), [2, 1]);

  const fileResponse = await fetch(`${baseUrl}/api/evidence-submissions/${first.id}/file`, {
    headers: authHeaders(),
  });
  assert.equal(fileResponse.status, 200);
  assert.equal(fileResponse.headers.get('content-type'), 'application/pdf');
  assert.match(fileResponse.headers.get('content-disposition'), /attachment/);
  assert.equal(fileResponse.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await fileResponse.arrayBuffer()), firstFile.buffer);

  const listing = await fetch(`${baseUrl}/api/enrolments/${enrolment.id}/evidence-submissions`, {
    headers: authHeaders(),
  });
  const listingBody = await listing.json();
  assert.equal(listing.status, 200);
  assert.equal(listingBody.completion.total_required, 1);
  assert.equal(listingBody.completion.not_submitted, 0);
  assert.equal(listingBody.completion.submitted, 1);
  assert.equal(listingBody.completion.approved, 0);
  assert.equal(listingBody.requirements[0].latest_submission.version, 2);
  assert.equal(listingBody.requirements[0].latest_submission.id, second.id);
  assert.equal(listingBody.requirements[0].latest_submission.programme_id, enrolment.programme_id);
  assert.equal(listingBody.requirements[0].latest_submission.enrolment_id, enrolment.id);
  assert.equal(listingBody.requirements[0].latest_submission.requirement_id, requirement.id);

  const detail = await fetch(`${baseUrl}/api/evidence-submissions/${second.id}`, {
    headers: authHeaders(),
  });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).submission.id, second.id);
});

test('evidence uploads reject invalid files, oversized files, missing auth, and invalid relationships', async () => {
  const { enrolment, requirement } = await createEvidenceFixture();
  const uploadPath = `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`;
  const invalidFile = await requestEvidence(enrolment.id, uploadPath, {
    method: 'POST',
    file: { filename: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not evidence') },
  });
  assert.equal(invalidFile.status, 400);

  const mismatchedMime = await requestEvidence(enrolment.id, uploadPath, {
    method: 'POST',
    file: { filename: 'wrong.png', mimeType: 'image/png', buffer: Buffer.from('%PDF-1.4\nwrong') },
  });
  assert.equal(mismatchedMime.status, 400);

  const oversized = await requestEvidence(enrolment.id, uploadPath, {
    method: 'POST',
    file: {
      filename: 'large.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024)]),
    },
  });
  assert.equal(oversized.status, 413);

  const unauthenticated = await requestEvidence(enrolment.id, uploadPath, {
    method: 'POST',
    token: null,
    file: { filename: 'valid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nvalid') },
  });
  assert.equal(unauthenticated.status, 401);

  const missingEnrolment = await requestEvidence(randomUUID(), uploadPath, {
    method: 'POST',
    file: { filename: 'valid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nmissing') },
  });
  assert.equal(missingEnrolment.status, 404);
  const invalidRequirement = await requestEvidence(enrolment.id, `/api/enrolments/:enrolmentId/evidence-requirements/${randomUUID()}/submissions`, {
    method: 'POST',
    file: { filename: 'valid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nmissing') },
  });
  assert.equal(invalidRequirement.status, 404);
  const invalidId = await requestEvidence('not-a-uuid', uploadPath, {
    method: 'POST',
    file: { filename: 'valid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nmissing') },
  });
  assert.equal(invalidId.status, 400);
});

test('evidence access is provider-scoped and approved evidence cannot be replaced', async () => {
  const { enrolment, requirement } = await createEvidenceFixture();
  const response = await requestEvidence(
    enrolment.id,
    `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`,
    {
      method: 'POST',
      file: { filename: 'private.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nprivate') },
    },
  );
  const { submission } = await response.json();

  const crossOwnerFile = await fetch(`${baseUrl}/api/evidence-submissions/${submission.id}/file`, {
    headers: authHeaders(tokenFor(providerBId, 'provider')),
  });
  assert.equal(crossOwnerFile.status, 404);
  const crossOwnerDetail = await fetch(`${baseUrl}/api/evidence-submissions/${submission.id}`, {
    headers: authHeaders(tokenFor(providerBId, 'provider')),
  });
  assert.equal(crossOwnerDetail.status, 404);
  const crossOwnerHistory = await fetch(`${baseUrl}/api/evidence-submissions/${submission.id}/history`, {
    headers: authHeaders(tokenFor(providerBId, 'provider')),
  });
  assert.equal(crossOwnerHistory.status, 404);

  const otherProvider = await createEvidenceFixture(tokenFor(providerBId, 'provider'));
  const providerBSubmission = await requestEvidence(
    otherProvider.enrolment.id,
    `/api/enrolments/:enrolmentId/evidence-requirements/${otherProvider.requirement.id}/submissions`,
    {
      method: 'POST',
      token: tokenFor(providerBId, 'provider'),
      file: { filename: 'other.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nother') },
    },
  );
  assert.equal(providerBSubmission.status, 201);
  const deniedUpload = await requestEvidence(
    otherProvider.enrolment.id,
    `/api/enrolments/:enrolmentId/evidence-requirements/${otherProvider.requirement.id}/submissions`,
    {
      method: 'POST',
      file: { filename: 'denied.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\ndenied') },
    },
  );
  assert.equal(deniedUpload.status, 404);
  assert.equal(evidenceSubmissions.at(-1).provider_user_id, providerBId);

  const storedSubmission = evidenceSubmissions.find((item) => item.id === submission.id);
  storedSubmission.status = 'APPROVED';
  const approvedReplacement = await requestEvidence(
    enrolment.id,
    `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`,
    {
      method: 'POST',
      file: { filename: 'replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nreplacement') },
    },
  );
  assert.equal(approvedReplacement.status, 409);
  assert.equal((await approvedReplacement.json()).code, 'EVIDENCE_APPROVED');

  storedSubmission.status = 'UNDER_REVIEW';
  const lockedReplacement = await requestEvidence(
    enrolment.id,
    `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`,
    {
      method: 'POST',
      file: { filename: 'locked.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\\nlocked') },
    },
  );
  assert.equal(lockedReplacement.status, 409);
  assert.equal((await lockedReplacement.json()).code, 'EVIDENCE_STATUS_LOCKED');
});

test('providers can delete only their latest unreviewed submission while retaining earlier history', async () => {
  const { enrolment, requirement } = await createEvidenceFixture();
  const uploadPath = `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`;
  const upload = async (filename) => requestEvidence(enrolment.id, uploadPath, {
    method: 'POST',
    file: { filename, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\\n${randomUUID()}`) },
  });
  const firstResponse = await upload('first.pdf');
  assert.equal(firstResponse.status, 201);
  evidenceSubmissions.at(-1).status = 'CORRECTION_REQUIRED';
  const secondResponse = await upload('second.pdf');
  const first = (await firstResponse.json()).submission;
  const second = (await secondResponse.json()).submission;

  const deniedOwner = await fetch(`${baseUrl}/api/evidence-submissions/${second.id}`, {
    method: 'DELETE',
    headers: authHeaders(tokenFor(providerBId, 'provider')),
  });
  assert.equal(deniedOwner.status, 404);

  const olderVersion = await fetch(`${baseUrl}/api/evidence-submissions/${first.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(olderVersion.status, 409);
  assert.equal((await olderVersion.json()).code, 'EVIDENCE_NOT_LATEST');

  const deleted = await fetch(`${baseUrl}/api/evidence-submissions/${second.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { message: 'Evidence submission deleted.' });
  assert.equal(evidenceFiles.has(evidenceSubmissions.find((item) => item.id === first.id).storage_key), true);
  assert.equal(evidenceSubmissions.some((item) => item.id === second.id), false);

  const history = await fetch(`${baseUrl}/api/evidence-submissions/${first.id}/history`, {
    headers: authHeaders(),
  });
  assert.deepEqual((await history.json()).submissions.map((item) => item.version), [1]);

  evidenceSubmissions.find((item) => item.id === first.id).status = 'APPROVED';
  const approvedDelete = await fetch(`${baseUrl}/api/evidence-submissions/${first.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(approvedDelete.status, 409);
  assert.equal((await approvedDelete.json()).code, 'EVIDENCE_APPROVED');

  const unauthenticated = await fetch(`${baseUrl}/api/evidence-submissions/${first.id}`, {
    method: 'DELETE',
  });
  assert.equal(unauthenticated.status, 401);
});

test('assigned assessors review exact versions and providers can resubmit only after correction feedback', async () => {
  const { programme, enrolment, requirement } = await createEvidenceFixture();
  const adminHeaders = authHeaders(tokenFor(adminId, 'admin'));
  const assignmentResponse = await fetch(`${baseUrl}/api/admin/assessor-assignments`, {
    method: 'POST',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ programmeId: programme.id, assessorUserId: assessorId }),
  });
  assert.equal(assignmentResponse.status, 201);

  const uploadPath = `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`;
  const upload = (filename) => requestEvidence(enrolment.id, uploadPath, {
    method: 'POST',
    file: { filename, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\\n${randomUUID()}`) },
  });
  const firstUpload = await upload('draft.pdf');
  assert.equal(firstUpload.status, 201);
  const firstSubmission = (await firstUpload.json()).submission;
  const assessorToken = tokenFor(assessorId, 'assessor');
  const assessorHeaders = authHeaders(assessorToken);

  const dashboard = await fetch(`${baseUrl}/api/assessor/programmes`, { headers: assessorHeaders });
  const dashboardBody = await dashboard.json();
  assert.equal(dashboard.status, 200);
  assert.ok(dashboardBody.programmes.some((item) => item.id === programme.id && item.pending_reviews === 1));

  const learnersResponse = await fetch(`${baseUrl}/api/assessor/programmes/${programme.id}/learners`, {
    headers: assessorHeaders,
  });
  assert.equal((await learnersResponse.json()).learners.length, 1);
  const queue = await fetch(`${baseUrl}/api/assessor/programmes/${programme.id}/submissions?status=SUBMITTED`, {
    headers: assessorHeaders,
  });
  assert.equal((await queue.json()).submissions[0].id, firstSubmission.id);

  const unassignedHeaders = authHeaders(tokenFor(assessorBId, 'assessor'));
  for (const suffix of [
    `/programmes/${programme.id}/learners`,
    `/programmes/${programme.id}/submissions`,
    `/submissions/${firstSubmission.id}`,
    `/submissions/${firstSubmission.id}/file`,
    `/submissions/${firstSubmission.id}/history`,
  ]) {
    const denied = await fetch(`${baseUrl}/api/assessor${suffix}`, { headers: unassignedHeaders });
    assert.equal(denied.status, 404);
  }
  const providerDecision = await fetch(`${baseUrl}/api/assessor/submissions/${firstSubmission.id}/reviews`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'APPROVED' }),
  });
  assert.equal(providerDecision.status, 403);

  const missingFeedback = await fetch(`${baseUrl}/api/assessor/submissions/${firstSubmission.id}/reviews`, {
    method: 'POST',
    headers: { ...assessorHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'CORRECTION_REQUESTED', feedback: '  ' }),
  });
  assert.equal(missingFeedback.status, 400);

  const blockedEarlyReplacement = await upload('too-early.pdf');
  assert.equal(blockedEarlyReplacement.status, 409);

  const correction = await fetch(`${baseUrl}/api/assessor/submissions/${firstSubmission.id}/reviews`, {
    method: 'POST',
    headers: { ...assessorHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'CORRECTION_REQUESTED', feedback: 'Please upload a clearer scan.' }),
  });
  const correctionBody = await correction.json();
  assert.equal(correction.status, 201);
  assert.equal(correctionBody.submission_status, 'CORRECTION_REQUIRED');
  assert.equal(correctionBody.review.submission_version, 1);

  const providerHistory = await fetch(`${baseUrl}/api/evidence-submissions/${firstSubmission.id}/history`, {
    headers: authHeaders(),
  });
  const providerHistoryBody = await providerHistory.json();
  assert.equal(providerHistory.status, 200);
  assert.equal(providerHistoryBody.reviews[0].feedback, 'Please upload a clearer scan.');
  assert.equal(providerHistoryBody.reviews[0].assessor_name, 'assessor');
  const providerChecklist = await fetch(`${baseUrl}/api/enrolments/${enrolment.id}/evidence-submissions`, {
    headers: authHeaders(),
  });
  const providerChecklistBody = await providerChecklist.json();
  assert.equal(providerChecklistBody.requirements[0].latest_submission.latest_review.feedback, 'Please upload a clearer scan.');

  const revisedUpload = await upload('revised.pdf');
  assert.equal(revisedUpload.status, 201);
  const revisedSubmission = (await revisedUpload.json()).submission;
  assert.equal(revisedSubmission.version, 2);

  const approval = await fetch(`${baseUrl}/api/assessor/submissions/${revisedSubmission.id}/reviews`, {
    method: 'POST',
    headers: { ...assessorHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'APPROVED' }),
  });
  assert.equal(approval.status, 201);
  assert.equal((await approval.json()).submission_status, 'APPROVED');

  const reviewHistory = await fetch(`${baseUrl}/api/assessor/submissions/${revisedSubmission.id}/reviews`, {
    headers: assessorHeaders,
  });
  const reviewHistoryBody = await reviewHistory.json();
  assert.deepEqual(reviewHistoryBody.reviews.map((item) => [item.submission_version, item.decision]), [
    [2, 'APPROVED'],
    [1, 'CORRECTION_REQUESTED'],
  ]);
  const versionHistory = await fetch(`${baseUrl}/api/assessor/submissions/${revisedSubmission.id}/history`, {
    headers: assessorHeaders,
  });
  assert.deepEqual((await versionHistory.json()).submissions.map((item) => item.version), [2, 1]);

  const approvedReplacement = await upload('after-approval.pdf');
  assert.equal(approvedReplacement.status, 409);
  assert.equal((await requestProgramme(`/${programme.id}`, { method: 'DELETE' })).status, 200);
});

test('assessors and QA officers cannot use provider evidence submission endpoints', async () => {
  const { enrolment, requirement } = await createEvidenceFixture();
  const submissionResponse = await requestEvidence(
    enrolment.id,
    `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`,
    {
      method: 'POST',
      file: { filename: 'role-check.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nrole check') },
    },
  );
  const { submission } = await submissionResponse.json();

  for (const token of [tokenFor(assessorId, 'assessor'), tokenFor(qaId, 'qa')]) {
    const listing = await fetch(`${baseUrl}/api/enrolments/${enrolment.id}/evidence-submissions`, {
      headers: authHeaders(token),
    });
    const detail = await fetch(`${baseUrl}/api/evidence-submissions/${submission.id}`, {
      headers: authHeaders(token),
    });
    const file = await fetch(`${baseUrl}/api/evidence-submissions/${submission.id}/file`, {
      headers: authHeaders(token),
    });
    const upload = await requestEvidence(
      enrolment.id,
      `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`,
      {
        token,
        method: 'POST',
        file: { filename: 'denied.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\ndenied') },
      },
    );
    assert.equal(listing.status, 403);
    assert.equal(detail.status, 403);
    assert.equal(file.status, 403);
    assert.equal(upload.status, 403);
  }
});

test('evidence completion counts each current checklist status without approving uploads', async () => {
  const { programme, learner, enrolment } = await createEvidenceFixture();
  const requirementRows = [];
  for (const title of ['Submitted', 'Awaiting review', 'Approved', 'Correction required']) {
    const response = await requestEvidenceRequirements(programme.id, '/', {
      method: 'POST',
      body: { title: `${title} ${randomUUID()}` },
    });
    requirementRows.push((await response.json()).requirement);
  }
  const checklist = await requestEvidenceRequirements(programme.id, '/');
  const allRequirements = (await checklist.json()).requirements;
  assert.equal(allRequirements.length, 5);

  for (const [index, requirement] of allRequirements.entries()) {
    if (index === 0) continue;
    const response = await requestEvidence(
      enrolment.id,
      `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`,
      {
        method: 'POST',
        file: {
          filename: `${index}.pdf`,
          mimeType: 'application/pdf',
          buffer: Buffer.from(`%PDF-1.4\n${index}-${randomUUID()}`),
        },
      },
    );
    assert.equal(response.status, 201);
  }
  const [submitted, underReview, approved, correction] = evidenceSubmissions.slice(-4);
  submitted.status = 'SUBMITTED';
  underReview.status = 'UNDER_REVIEW';
  approved.status = 'APPROVED';
  correction.status = 'CORRECTION_REQUIRED';

  const response = await fetch(`${baseUrl}/api/enrolments/${enrolment.id}/evidence-submissions`, {
    headers: authHeaders(),
  });
  const { completion, requirements } = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(completion, {
    total_required: 5,
    not_submitted: 1,
    submitted: 1,
    awaiting_review: 1,
    approved: 1,
    correction_required: 1,
  });
  assert.equal(requirements.find((item) => item.status === 'APPROVED').latest_submission.status, 'APPROVED');
  assert.equal(requirements.find((item) => item.status === 'SUBMITTED').latest_submission.status, 'SUBMITTED');
  assert.ok(submitted && learner);
  assert.equal(requirementRows.length, 4);
});

test('an enrolment with no active checklist items returns an empty list and zero completion counts', async () => {
  const { programme, enrolment, requirement } = await createEvidenceFixture();
  const archived = await requestEvidenceRequirements(programme.id, `/${requirement.id}`, {
    method: 'DELETE',
  });
  assert.equal(archived.status, 200);

  const response = await fetch(`${baseUrl}/api/enrolments/${enrolment.id}/evidence-submissions`, {
    headers: authHeaders(),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    requirements: [],
    completion: {
      total_required: 0,
      not_submitted: 0,
      submitted: 0,
      awaiting_review: 0,
      approved: 0,
      correction_required: 0,
    },
  });
});

test('storage and database failures clean up uploaded evidence and return safe errors', async () => {
  const { enrolment, requirement } = await createEvidenceFixture();
  const uploadPath = `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`;
  const file = (name) => ({
    filename: name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n${name}-${randomUUID()}`),
  });

  evidenceStorageAvailable = false;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const storageError = await requestEvidence(enrolment.id, uploadPath, {
      method: 'POST',
      file: file('storage-failure.pdf'),
    });
    assert.equal(storageError.status, 500);
  } finally {
    evidenceStorageAvailable = true;
    console.error = originalConsoleError;
  }

  const originalFileCount = evidenceFiles.size;
  evidenceInsertAvailable = false;
  console.error = () => {};
  try {
    const databaseError = await requestEvidence(enrolment.id, uploadPath, {
      method: 'POST',
      file: file('database-failure.pdf'),
    });
    assert.equal(databaseError.status, 500);
    assert.equal(evidenceFiles.size, originalFileCount);
  } finally {
    evidenceInsertAvailable = true;
    console.error = originalConsoleError;
  }

  evidenceSubmissionsAvailable = false;
  console.error = () => {};
  try {
    const listError = await fetch(`${baseUrl}/api/enrolments/${enrolment.id}/evidence-submissions`, {
      headers: authHeaders(),
    });
    assert.equal(listError.status, 500);
    assert.deepEqual(await listError.json(), { error: 'Internal server error' });
  } finally {
    evidenceSubmissionsAvailable = true;
    console.error = originalConsoleError;
  }
});

test('evidence submission migration defines provider-scoped versioned metadata and file constraints', async () => {
  const migration = await fs.readFile(
    require.resolve('../migrations/202610300006_create_evidence_submissions.sql'),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE evidence_submissions/);
  assert.match(migration, /FOREIGN KEY \(provider_user_id, programme_id, enrolment_id\)/);
  assert.match(migration, /FOREIGN KEY \(provider_user_id, programme_id, requirement_id\)/);
  assert.match(migration, /original_filename TEXT NOT NULL/);
  assert.match(migration, /mime_type TEXT NOT NULL/);
  assert.match(migration, /file_size BIGINT NOT NULL/);
  assert.match(migration, /storage_provider TEXT NOT NULL/);
  assert.match(migration, /storage_key TEXT NOT NULL/);
  assert.match(migration, /status IN \('SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED'\)/);
  assert.match(migration, /UNIQUE \(enrolment_id, requirement_id, version\)/);
  assert.match(migration, /evidence_submissions_enrolment_requirement_version_idx/);
});

test('assessor workflow migration preserves assignment and version-bound review history', async () => {
  const migration = await fs.readFile(
    require.resolve('../migrations/202611020001_create_assessor_assignments_and_evidence_reviews.sql'),
    'utf8',
  );
  assert.match(migration, /role IN \('provider', 'assessor', 'qa', 'admin', 'learner'\)/);
  assert.match(migration, /CREATE TABLE programme_assessor_assignments/);
  assert.match(migration, /programme_assessor_assignments_active_pair_unique/);
  assert.match(migration, /deactivated_at TIMESTAMPTZ/);
  assert.match(migration, /CREATE TABLE evidence_reviews/);
  assert.match(migration, /FOREIGN KEY \(evidence_submission_id, submission_version\)/);
  assert.match(migration, /FOREIGN KEY \(assignment_id, programme_id, assessor_user_id\)/);
  assert.match(migration, /UNIQUE \(evidence_submission_id, submission_version\)/);
  assert.match(migration, /CORRECTION_REQUESTED/);
});

test('learner registration, search, retrieval, update, and archive are provider-scoped', async () => {
  const created = await requestLearner('/', {
    method: 'POST',
    body: {
      fullName: '  Amina Example ',
      phone: '+27 11 123 4567',
      email: 'AMINA@example.com',
    },
  });
  const createdBody = await created.json();

  assert.equal(created.status, 201);
  assert.equal(createdBody.learner.full_name, 'Amina Example');
  assert.equal(createdBody.learner.email, 'amina@example.com');
  assert.match(createdBody.learner.learner_reference, /^LRN-/);
  assert.equal(createdBody.learner.status, 'active');
  assert.equal(createdBody.learner.phone, '+27 11 123 4567');

  const searched = await requestLearner('/?q=amina');
  const searchBody = await searched.json();
  assert.equal(searched.status, 200);
  assert.equal(searchBody.total, 1);
  assert.equal(searchBody.learners[0].id, createdBody.learner.id);
  assert.equal(searchBody.learners[0].phone, null);
  assert.equal(searchBody.learners[0].email, null);

  const retrieved = await requestLearner(`/${createdBody.learner.id}`);
  assert.equal(retrieved.status, 200);
  assert.equal((await retrieved.json()).learner.id, createdBody.learner.id);

  const updated = await requestLearner(`/${createdBody.learner.id}`, {
    method: 'PATCH',
    body: { fullName: 'Amina Updated', phone: null, email: null },
  });
  assert.equal(updated.status, 200);
  const updatedLearner = (await updated.json()).learner;
  assert.equal(updatedLearner.full_name, 'Amina Updated');
  assert.equal(updatedLearner.phone, null);
  assert.equal(updatedLearner.email, null);

  const archived = await requestLearner(`/${createdBody.learner.id}`, { method: 'DELETE' });
  assert.equal(archived.status, 200);
  assert.deepEqual(await archived.json(), { message: 'Learner archived.' });
  const activeList = await requestLearner('/');
  const activeBody = await activeList.json();
  assert.equal(activeBody.learners.some((item) => item.id === createdBody.learner.id), false);
  const archivedList = await requestLearner('/?status=archived');
  const archivedBody = await archivedList.json();
  assert.equal(archivedBody.learners.some((item) => item.id === createdBody.learner.id
    && item.status === 'archived'), true);
});

test('learner APIs reject invalid input, query parameters, and client-supplied ownership', async () => {
  assert.equal(validateLearnerBody({ fullName: 'Valid', nationalId: 'ignored' }).error !== undefined, true);
  assert.equal(validateLearnerBody({ fullName: ' ' }).error !== undefined, true);
  assert.equal(validateLearnerBody({ fullName: 'Valid', phone: 'no-phone' }).error !== undefined, true);
  assert.equal(validateLearnerBody({ fullName: 'Valid', email: 'invalid' }).error !== undefined, true);

  const missingName = await requestLearner('/', { method: 'POST', body: { email: 'person@example.com' } });
  assert.equal(missingName.status, 400);
  const unknownField = await requestLearner('/', {
    method: 'POST',
    body: { fullName: 'Valid', providerUserId: providerBId },
  });
  assert.equal(unknownField.status, 400);
  const invalidId = await requestLearner('/not-a-uuid');
  assert.equal(invalidId.status, 400);
  const invalidStatus = await requestLearner('/?status=deleted');
  assert.equal(invalidStatus.status, 400);
  const invalidLimit = await requestLearner('/?limit=500');
  assert.equal(invalidLimit.status, 400);
});

test('provider can create and activate a learner sign-in account from the linked learner profile', async () => {
  const created = await requestLearner('/', {
    method: 'POST',
    body: { fullName: 'Invited Learner', email: 'invited@example.com' },
  });
  const { learner } = await created.json();
  assert.equal(created.status, 201);

  const activated = await requestLearner(`/${learner.id}/activate-account`, { method: 'POST' });
  assert.equal(activated.status, 200, await activated.clone().text());
  const payload = await activated.json();
  assert.equal(payload.learner.id, learner.id);
  assert.equal(payload.learner.account_status, 'pending');
  assert.equal(payload.learner.linked_account, null);
  assert.match(payload.invitationToken, /^[0-9a-f]{64}$/);
  assert.ok(Date.parse(payload.invitationExpiresAt) > Date.now());
  assert.equal(learnerInvitations.some((item) => item.token_hash === payload.invitationToken), false);

  const renewed = await requestLearner(`/${learner.id}/activate-account`, { method: 'POST' });
  assert.equal(renewed.status, 200);
  const renewedPayload = await renewed.json();
  assert.notEqual(renewedPayload.invitationToken, payload.invitationToken);

  const revokedSetup = await fetch(`${baseUrl}/api/auth/learner-activation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: payload.invitationToken, password: learnerPassword }),
  });
  assert.equal(revokedSetup.status, 400);

  const invalidPassword = await fetch(`${baseUrl}/api/auth/learner-activation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: renewedPayload.invitationToken, password: 'short' }),
  });
  assert.equal(invalidPassword.status, 400);

  const renewedInvitation = learnerInvitations.find((item) => item.token_hash === createHash('sha256')
    .update(renewedPayload.invitationToken).digest('hex'));
  renewedInvitation.expires_at = new Date(Date.now() - 1000).toISOString();
  const expiredSetup = await fetch(`${baseUrl}/api/auth/learner-activation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: renewedPayload.invitationToken, password: learnerPassword }),
  });
  assert.equal(expiredSetup.status, 400);

  const refreshed = await requestLearner(`/${learner.id}/activate-account`, { method: 'POST' });
  assert.equal(refreshed.status, 200);
  const refreshedPayload = await refreshed.json();

  const setup = await fetch(`${baseUrl}/api/auth/learner-activation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: refreshedPayload.invitationToken, password: learnerPassword }),
  });
  assert.equal(setup.status, 201, await setup.clone().text());
  const setupBody = await setup.json();
  assert.equal(setupBody.user.email, 'invited@example.com');
  assert.equal(setupBody.user.role, 'learner');

  const learnerLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'invited@example.com',
      password: learnerPassword,
      accountType: 'learner',
    }),
  });
  assert.equal(learnerLogin.status, 200);
  const loginBody = await learnerLogin.json();
  assert.equal(loginBody.user.id, setupBody.user.id);
  const learnerDashboard = await requestLearnerPortal('/dashboard', { token: loginBody.accessToken });
  assert.equal(learnerDashboard.status, 200);
  assert.equal((await learnerDashboard.json()).learner.id, learner.id);

  const replay = await fetch(`${baseUrl}/api/auth/learner-activation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: refreshedPayload.invitationToken, password: learnerPassword }),
  });
  assert.equal(replay.status, 400);
});

test('learner account invitation migration stores expiring hashed codes and one open code per profile', async () => {
  const migration = await fs.readFile(
    require.resolve('../migrations/202611110001_create_learner_account_invitations.sql'),
    'utf8',
  );
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(migration, /consumed_at TIMESTAMPTZ/);
  assert.match(migration, /revoked_at TIMESTAMPTZ/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /WHERE consumed_at IS NULL AND revoked_at IS NULL/);
});

test('learner registration warns about likely duplicates and requires an explicit confirmation to continue', async () => {
  const first = await requestLearner('/', {
    method: 'POST',
    body: { fullName: 'Possible Duplicate', email: 'dupe@example.com' },
  });
  assert.equal(first.status, 201);

  const warning = await requestLearner('/', {
    method: 'POST',
    body: { fullName: 'possible duplicate' },
  });
  assert.equal(warning.status, 409);
  assert.equal((await warning.json()).code, 'POSSIBLE_DUPLICATE');

  const confirmed = await requestLearner('/', {
    method: 'POST',
    body: { fullName: 'possible duplicate', confirmPossibleDuplicate: true },
  });
  assert.equal(confirmed.status, 201);
});

test('learner routes require authentication and provider role', async () => {
  const unauthenticated = await requestLearner('/', { token: null });
  assert.equal(unauthenticated.status, 401);

  for (const token of [tokenFor(assessorId, 'assessor'), tokenFor(qaId, 'qa')]) {
    const list = await requestLearner('/', { token });
    const create = await requestLearner('/', { method: 'POST', token, body: { fullName: 'Denied' } });
    assert.equal(list.status, 403);
    assert.equal(create.status, 403);
  }
});

test('a provider cannot retrieve, update, or archive another provider learner', async () => {
  const created = await requestLearner('/', {
    method: 'POST',
    token: tokenFor(providerBId, 'provider'),
    body: { fullName: 'Provider B learner' },
  });
  const { learner } = await created.json();

  const retrieve = await requestLearner(`/${learner.id}`);
  const update = await requestLearner(`/${learner.id}`, {
    method: 'PATCH',
    body: { fullName: 'Unauthorized update' },
  });
  const remove = await requestLearner(`/${learner.id}`, { method: 'DELETE' });
  assert.equal(retrieve.status, 404);
  assert.equal(update.status, 404);
  assert.equal(remove.status, 404);

  const ownerList = await requestLearner('/?q=provider%20b', {
    token: tokenFor(providerBId, 'provider'),
  });
  assert.equal((await ownerList.json()).total, 1);
});

test('learner database failures return a safe server error', async () => {
  learnersAvailable = false;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await requestLearner('/');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
  } finally {
    learnersAvailable = true;
    console.error = originalConsoleError;
  }
});

test('learner migration defines ownership, minimal fields, archival, and scoped indexes', async () => {
  const migration = await fs.readFile(
    require.resolve('../migrations/202610300002_create_learners.sql'),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE learners/);
  assert.match(migration, /provider_user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /learner_reference TEXT NOT NULL/);
  assert.match(migration, /UNIQUE \(provider_user_id, learner_reference\)/);
  assert.match(migration, /full_name TEXT NOT NULL CHECK/);
  assert.match(migration, /phone TEXT CHECK/);
  assert.match(migration, /email TEXT CHECK/);
  assert.match(migration, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(migration, /archived_at TIMESTAMPTZ/);
  assert.match(migration, /learners_provider_active_created_idx/);
});

test('a provider can create, list, retrieve, withdraw, and reactivate an enrolment', async () => {
  for (let index = enrolments.length - 1; index >= 0; index -= 1) {
    if (enrolments[index].provider_user_id === registeredUser.id) enrolments.splice(index, 1);
  }
  const programmeResponse = await requestProgramme('/', {
    method: 'POST',
    body: { name: 'Enrolment test programme' },
  });
  const { programme } = await programmeResponse.json();
  const learnerResponse = await requestLearner('/', {
    method: 'POST',
    body: { fullName: `Enrolment test learner ${randomUUID()}` },
  });
  const { learner } = await learnerResponse.json();

  const empty = await requestEnrolment('/');
  assert.equal((await empty.json()).total, 0);

  const created = await requestEnrolment('/', {
    method: 'POST',
    body: { learnerId: learner.id, programmeId: programme.id },
  });
  const { enrolment } = await created.json();
  assert.equal(created.status, 201);
  assert.equal(enrolment.status, 'active');
  assert.equal(enrolment.learner_id, learner.id);
  assert.equal(enrolment.programme_id, programme.id);
  assert.equal(enrolment.learner_name, learner.full_name);
  assert.equal(enrolment.programme_name, programme.name);

  const listed = await requestEnrolment(`/?learnerId=${learner.id}`);
  assert.equal((await listed.json()).total, 1);
  const retrieved = await requestEnrolment(`/${enrolment.id}`);
  assert.equal((await retrieved.json()).enrolment.id, enrolment.id);

  const duplicate = await requestEnrolment('/', {
    method: 'POST',
    body: { learnerId: learner.id, programmeId: programme.id },
  });
  assert.equal(duplicate.status, 409);

  const withdrawn = await requestEnrolment(`/${enrolment.id}`, {
    method: 'PATCH',
    body: { status: 'withdrawn' },
  });
  assert.equal((await withdrawn.json()).enrolment.status, 'withdrawn');
  const reactivated = await requestEnrolment(`/${enrolment.id}`, {
    method: 'PATCH',
    body: { status: 'active' },
  });
  assert.equal((await reactivated.json()).enrolment.status, 'active');
});

test('enrolments validate identifiers and status and enforce provider roles and ownership', async () => {
  assert.equal(validateCreateBody({ learnerId: 'bad', programmeId: randomUUID() }).error !== undefined, true);
  const badBody = await requestEnrolment('/', {
    method: 'POST',
    body: { learnerId: randomUUID(), programmeId: randomUUID(), providerUserId: providerBId },
  });
  assert.equal(badBody.status, 400);
  const badStatus = await requestEnrolment(`/${randomUUID()}`, {
    method: 'PATCH',
    body: { status: 'approved' },
  });
  assert.equal(badStatus.status, 400);
  assert.equal((await requestEnrolment('/not-a-uuid')).status, 400);
  assert.equal((await requestEnrolment('/?status=approved')).status, 400);
  assert.equal((await requestEnrolment('/', { token: null })).status, 401);

  for (const token of [tokenFor(assessorId, 'assessor'), tokenFor(qaId, 'qa')]) {
    assert.equal((await requestEnrolment('/', { token })).status, 403);
  }

  const programmeResponse = await requestProgramme('/', {
    method: 'POST',
    token: tokenFor(providerBId, 'provider'),
    body: { name: 'Provider B enrolment programme' },
  });
  const learnerResponse = await requestLearner('/', {
    method: 'POST',
    token: tokenFor(providerBId, 'provider'),
    body: { fullName: `Provider B enrolment learner ${randomUUID()}` },
  });
  const { programme } = await programmeResponse.json();
  const { learner } = await learnerResponse.json();
  const crossOwnerCreate = await requestEnrolment('/', {
    method: 'POST',
    body: { learnerId: learner.id, programmeId: programme.id },
  });
  assert.equal(crossOwnerCreate.status, 404);
  const ownerEnrolmentResponse = await requestEnrolment('/', {
    method: 'POST',
    token: tokenFor(providerBId, 'provider'),
    body: { learnerId: learner.id, programmeId: programme.id },
  });
  const { enrolment } = await ownerEnrolmentResponse.json();
  assert.equal((await requestEnrolment(`/${enrolment.id}`)).status, 404);
  assert.equal((await requestEnrolment(`/${enrolment.id}`, {
    method: 'PATCH',
    body: { status: 'withdrawn' },
  })).status, 404);
  assert.equal((await requestEnrolment(`/${enrolment.id}`, { method: 'DELETE' })).status, 404);
});

test('enrolment migration enforces same-provider relationships and one active pair', async () => {
  const migration = await fs.readFile(
    require.resolve('../migrations/202610300003_create_enrolments.sql'),
    'utf8',
  );
  assert.match(migration, /UNIQUE \(provider_user_id, id\)/);
  assert.match(migration, /CREATE TABLE enrolments/);
  assert.match(migration, /FOREIGN KEY \(provider_user_id, learner_id\)/);
  assert.match(migration, /FOREIGN KEY \(provider_user_id, programme_id\)/);
  assert.match(migration, /CHECK \(status IN \('active', 'withdrawn'\)\)/);
  assert.match(migration, /enrolments_active_pair_unique/);
  assert.match(migration, /created_by UUID NOT NULL REFERENCES users\(id\)/);
  assert.match(migration, /updated_by UUID NOT NULL REFERENCES users\(id\)/);
});

test('a provider can schedule sessions and record present, absent, and excused attendance', async () => {
  const programmeResponse = await requestProgramme('/', {
    method: 'POST',
    body: { name: `Attendance programme ${randomUUID()}` },
  });
  const { programme } = await programmeResponse.json();
  const learnerOneResponse = await requestLearner('/', {
    method: 'POST',
    body: { fullName: `Attendance learner one ${randomUUID()}` },
  });
  const learnerTwoResponse = await requestLearner('/', {
    method: 'POST',
    body: { fullName: `Attendance learner two ${randomUUID()}` },
  });
  const { learner: learnerOne } = await learnerOneResponse.json();
  const { learner: learnerTwo } = await learnerTwoResponse.json();
  const enrolmentOneResponse = await requestEnrolment('/', {
    method: 'POST',
    body: { learnerId: learnerOne.id, programmeId: programme.id },
  });
  const enrolmentTwoResponse = await requestEnrolment('/', {
    method: 'POST',
    body: { learnerId: learnerTwo.id, programmeId: programme.id },
  });
  const { enrolment: enrolmentOne } = await enrolmentOneResponse.json();
  const { enrolment: enrolmentTwo } = await enrolmentTwoResponse.json();
  const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const created = await requestSession('/', {
    method: 'POST',
    body: { programmeId: programme.id, title: 'Field session', startsAt },
  });
  const { session } = await created.json();
  assert.equal(created.status, 201);
  assert.equal(session.title, 'Field session');
  assert.equal(session.programme_id, programme.id);

  const listed = await requestSession(`/?programmeId=${programme.id}`);
  const listedBody = await listed.json();
  assert.equal(listed.status, 200);
  assert.equal(listedBody.sessions[0].id, session.id);
  assert.equal(listedBody.sessions[0].enrolled_count, 2);

  const details = await requestSession(`/${session.id}`);
  assert.equal((await details.json()).session.id, session.id);
  const emptyRegister = await requestSession(`/${session.id}/attendance`);
  const emptyRegisterBody = await emptyRegister.json();
  assert.equal(emptyRegister.status, 200);
  assert.equal(emptyRegisterBody.summary.unrecorded, 2);

  const recorded = await requestSession(`/${session.id}/attendance`, {
    method: 'PUT',
    body: {
      records: [
        { enrolmentId: enrolmentOne.id, status: 'present' },
        { enrolmentId: enrolmentTwo.id, status: 'excused' },
      ],
    },
  });
  assert.equal(recorded.status, 200);
  assert.equal((await recorded.json()).records.length, 2);
  const register = await requestSession(`/${session.id}/attendance`);
  const registerBody = await register.json();
  assert.equal(registerBody.summary.present, 1);
  assert.equal(registerBody.summary.excused, 1);
  assert.equal(registerBody.summary.unrecorded, 0);

  const updated = await requestSession(`/${session.id}/attendance`, {
    method: 'PUT',
    body: { records: [{ enrolmentId: enrolmentOne.id, status: 'absent' }] },
  });
  assert.equal(updated.status, 200);
  const finalRegister = await requestSession(`/${session.id}/attendance`);
  assert.equal((await finalRegister.json()).summary.absent, 1);
});

test('session and attendance requests validate inputs and are provider-only', async () => {
  const validProgramme = randomUUID();
  assert.equal(validateSessionBody({
    programmeId: validProgramme,
    title: 'Test',
    startsAt: '2026-10-30T10:00:00',
  }).error !== undefined, true);
  assert.equal(validateAttendanceBody({
    records: [{ enrolmentId: randomUUID(), status: 'late' }],
  }).error !== undefined, true);
  assert.equal(validateAttendanceBody({
    records: [
      { enrolmentId: validProgramme, status: 'present' },
      { enrolmentId: validProgramme, status: 'absent' },
    ],
  }).error !== undefined, true);

  const invalidSession = await requestSession('/', {
    method: 'POST',
    body: { programmeId: validProgramme, title: 'No timezone', startsAt: '2026-10-30T10:00:00' },
  });
  assert.equal(invalidSession.status, 400);
  const invalidId = await requestSession('/not-a-uuid');
  assert.equal(invalidId.status, 400);
  assert.equal((await requestSession('/', { token: null })).status, 401);
  for (const token of [tokenFor(assessorId, 'assessor'), tokenFor(qaId, 'qa')]) {
    assert.equal((await requestSession('/', { token })).status, 403);
  }
});

test('a provider cannot create a session or change attendance outside their programme', async () => {
  const providerBProgrammeResponse = await requestProgramme('/', {
    method: 'POST',
    token: tokenFor(providerBId, 'provider'),
    body: { name: `Provider B session programme ${randomUUID()}` },
  });
  const { programme } = await providerBProgrammeResponse.json();
  const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const crossOwnerCreate = await requestSession('/', {
    method: 'POST',
    body: { programmeId: programme.id, title: 'Cross-provider session', startsAt },
  });
  assert.equal(crossOwnerCreate.status, 404);

  const ownSessionResponse = await requestSession('/', {
    method: 'POST',
    token: tokenFor(providerBId, 'provider'),
    body: { programmeId: programme.id, title: 'Provider B session', startsAt },
  });
  const { session } = await ownSessionResponse.json();
  assert.equal((await requestSession(`/${session.id}`)).status, 404);
  assert.equal((await requestSession(`/${session.id}`, {
    method: 'PATCH',
    body: { title: 'Unauthorized' },
  })).status, 404);
  assert.equal((await requestSession(`/${session.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await requestSession(`/${session.id}/attendance`)).status, 404);
});

test('session database failures return safe API errors', async () => {
  sessionsAvailable = false;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await requestSession('/');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
  } finally {
    sessionsAvailable = true;
    console.error = originalConsoleError;
  }
});

test('attendance migration defines provider-scoped foreign keys and unique session enrolments', async () => {
  const migration = await fs.readFile(
    require.resolve('../migrations/202610300004_create_attendance.sql'),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE training_sessions/);
  assert.match(migration, /UNIQUE \(provider_user_id, programme_id, id\)/);
  assert.match(migration, /CREATE TABLE attendance_records/);
  assert.match(migration, /FOREIGN KEY \(provider_user_id, programme_id, session_id\)/);
  assert.match(migration, /FOREIGN KEY \(provider_user_id, programme_id, enrolment_id\)/);
  assert.match(migration, /CHECK \(status IN \('present', 'absent', 'excused'\)\)/);
  assert.match(migration, /UNIQUE \(session_id, enrolment_id\)/);
  assert.match(migration, /marked_by UUID NOT NULL REFERENCES users\(id\)/);
});

test('learner dashboard returns only linked programme, attendance, and evidence records', async () => {
  const programmeResponse = await requestProgramme('/', {
    method: 'POST',
    body: { name: `Learner portal programme ${randomUUID()}`, description: 'Training programme details.' },
  });
  const { programme } = await programmeResponse.json();
  const learnerResponse = await requestLearner('/', {
    method: 'POST',
    body: { fullName: `Learner portal profile ${randomUUID()}` },
  });
  const { learner } = await learnerResponse.json();
  const linkedLearner = learners.find((item) => item.id === learner.id);
  linkedLearner.learner_user_id = learnerId;
  const enrolmentResponse = await requestEnrolment('/', {
    method: 'POST',
    body: { learnerId: learner.id, programmeId: programme.id },
  });
  const { enrolment } = await enrolmentResponse.json();
  const startsAt = new Date().toISOString();
  const sessionResponse = await requestSession('/', {
    method: 'POST',
    body: { programmeId: programme.id, title: 'Learner portal session', startsAt },
  });
  const { session } = await sessionResponse.json();
  const attendanceResponse = await requestSession(`/${session.id}/attendance`, {
    method: 'PUT',
    body: { records: [{ enrolmentId: enrolment.id, status: 'present' }] },
  });
  assert.equal(attendanceResponse.status, 200);

  const requirementResponse = await requestEvidenceRequirements(programme.id, '/', {
    method: 'POST',
    body: { title: 'Learner portal evidence', guidance: 'Submit the required document.' },
  });
  const { requirement } = await requirementResponse.json();
  const uploadResponse = await requestEvidence(
    enrolment.id,
    `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`,
    {
      method: 'POST',
      file: {
        filename: 'learner-evidence.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n${randomUUID()}`),
      },
    },
  );
  assert.equal(uploadResponse.status, 201);

  const response = await requestLearnerPortal('/dashboard');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.learner.id, learner.id);
  assert.equal(body.programmes.length, 1);
  assert.equal(body.programmes[0].name, programme.name);
  assert.equal(body.programmes[0].providerName, registeredUser.fullName);
  assert.equal(body.attendance.summary.recorded, 1);
  assert.equal(body.attendance.summary.present, 1);
  assert.equal(body.attendance.recent[0].title, session.title);
  assert.equal(body.evidence.length, 1);
  assert.equal(body.evidence[0].status, 'SUBMITTED');
  assert.equal(body.evidence[0].submissions[0].filename, 'learner-evidence.pdf');
  assert.equal(body.evidenceSummary.awaitingAssessment, 1);
  assert.ok(body.recentActivity.some((item) => item.description === 'Evidence submitted'));

  const rangeStart = new Date();
  rangeStart.setUTCDate(1);
  rangeStart.setUTCHours(0, 0, 0, 0);
  const rangeEnd = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth() + 1, 1));
  const calendarQuery = new URLSearchParams({ from: rangeStart.toISOString(), to: rangeEnd.toISOString() });
  const calendarResponse = await requestLearnerPortal(`/calendar?${calendarQuery}`);
  const calendarBody = await calendarResponse.json();
  assert.equal(calendarResponse.status, 200);
  assert.equal(calendarBody.sessions.length, 1);
  assert.equal(calendarBody.sessions[0].id, session.id);
  assert.equal(calendarBody.sessions[0].attendance_status, 'present');
  assert.deepEqual(calendarBody.assessments, []);
  const invalidCalendarRange = await requestLearnerPortal('/calendar?from=invalid&to=invalid');
  assert.equal(invalidCalendarRange.status, 400);

  const unrelatedProgramme = await requestLearnerPortal(`/programmes/${randomUUID()}`);
  assert.equal(unrelatedProgramme.status, 404);
  const assessorAccess = await requestLearnerPortal('/dashboard', {
    token: tokenFor(assessorId, 'assessor'),
  });
  assert.equal(assessorAccess.status, 403);
  const learnerToken = tokenFor(learnerId, 'learner');
  const attendanceWrite = await requestSession(`/${session.id}/attendance`, {
    method: 'PUT',
    token: learnerToken,
    body: { records: [{ enrolmentId: enrolment.id, status: 'absent' }] },
  });
  assert.equal(attendanceWrite.status, 403);
  const learnerUpload = await requestEvidence(
    enrolment.id,
    `/api/enrolments/:enrolmentId/evidence-requirements/${requirement.id}/submissions`,
    {
      method: 'POST',
      token: learnerToken,
      file: {
        filename: 'learner-replacement.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n${randomUUID()}`),
      },
    },
  );
  assert.equal(learnerUpload.status, 403);
});

test('archiving a learner withdraws active enrolments and preserves their history', async () => {
  const programmeResponse = await requestProgramme('/', {
    method: 'POST',
    body: { name: `Archived learner programme ${randomUUID()}` },
  });
  const { programme } = await programmeResponse.json();
  const learnerResponse = await requestLearner('/', {
    method: 'POST',
    body: { fullName: `Learner to archive ${randomUUID()}` },
  });
  const { learner } = await learnerResponse.json();
  const enrolmentResponse = await requestEnrolment('/', {
    method: 'POST',
    body: { learnerId: learner.id, programmeId: programme.id },
  });
  const { enrolment } = await enrolmentResponse.json();

  const archived = await requestLearner(`/${learner.id}`, { method: 'DELETE' });
  assert.equal(archived.status, 200);
  const history = await requestEnrolment(`/?learnerId=${learner.id}&status=all`);
  const historyBody = await history.json();
  assert.equal(historyBody.total, 1);
  assert.equal(historyBody.enrolments[0].id, enrolment.id);
  assert.equal(historyBody.enrolments[0].status, 'withdrawn');
  const reactivated = await requestEnrolment(`/${enrolment.id}`, {
    method: 'PATCH',
    body: { status: 'active' },
  });
  assert.equal(reactivated.status, 404);
});
