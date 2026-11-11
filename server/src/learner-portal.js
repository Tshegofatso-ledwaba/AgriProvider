const { Router } = require('express');
const { authenticate, requireRole } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createLearnerPortalRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret), requireRole('learner'));

  async function findLearner(request) {
    const { rows } = await database.query(
      `SELECT l.id, l.learner_reference, l.full_name, l.email, l.phone
       FROM learners l
       WHERE l.learner_user_id = $1
         OR (l.learner_user_id IS NULL AND LOWER(l.email) = LOWER($2))
       ORDER BY l.id
       LIMIT 2`,
      [request.auth.userId, request.user.email],
    );
    if (rows.length > 1) {
      const error = new Error('More than one learner profile is linked to this account. Contact your training provider.');
      error.status = 409;
      throw error;
    }
    return rows[0] ?? null;
  }

  async function listProgrammes(learnerId) {
    const { rows } = await database.query(
      `SELECT p.id, p.name, p.description, e.status, e.id AS enrolment_id,
         e.created_at AS enrolled_at, provider.full_name AS provider_name
       FROM enrolments e
       JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
       JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
       JOIN users provider ON provider.id = p.provider_user_id
       WHERE l.id = $1
       ORDER BY e.created_at DESC, p.name ASC`,
      [learnerId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      providerName: row.provider_name,
      status: row.status,
      enrolmentId: row.enrolment_id,
      enrolledAt: row.enrolled_at,
    }));
  }

  async function getAttendance(learnerId) {
    const [summaryResult, recentResult] = await Promise.all([
      database.query(
        `SELECT COUNT(*)::integer AS recorded,
           COUNT(*) FILTER (WHERE a.status = 'present')::integer AS present,
           COUNT(*) FILTER (WHERE a.status = 'absent')::integer AS absent,
           COUNT(*) FILTER (WHERE a.status = 'excused')::integer AS excused
         FROM attendance_records a
         JOIN enrolments e ON e.id = a.enrolment_id AND e.provider_user_id = a.provider_user_id
         WHERE e.learner_id = $1`,
        [learnerId],
      ),
      database.query(
        `SELECT a.session_id, s.title, p.name AS programme_name, s.starts_at,
           a.status, a.updated_at AS marked_at
         FROM attendance_records a
         JOIN enrolments e ON e.id = a.enrolment_id AND e.provider_user_id = a.provider_user_id
         JOIN training_sessions s ON s.id = a.session_id AND s.provider_user_id = a.provider_user_id
         JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
         WHERE e.learner_id = $1
         ORDER BY s.starts_at DESC, a.updated_at DESC
         LIMIT 10`,
        [learnerId],
      ),
    ]);
    const summary = summaryResult.rows[0] ?? {};
    return {
      summary: {
        recorded: Number(summary.recorded ?? 0),
        present: Number(summary.present ?? 0),
        absent: Number(summary.absent ?? 0),
        excused: Number(summary.excused ?? 0),
      },
      recent: recentResult.rows.map((row) => ({
        sessionId: row.session_id,
        title: row.title,
        programmeName: row.programme_name,
        startsAt: row.starts_at,
        status: row.status,
        markedAt: row.marked_at,
      })),
    };
  }

  async function listEvidence(learnerId) {
    const { rows } = await database.query(
      `SELECT e.id AS enrolment_id, e.status AS enrolment_status,
         p.id AS programme_id, p.name AS programme_name,
         r.id AS requirement_id, r.title AS requirement_title, r.guidance,
         s.id AS submission_id, s.original_filename, s.status AS submission_status,
         s.version, s.created_at AS submitted_at,
         review.id AS review_id, review.assessor_name, review.decision,
         review.feedback, review.reviewed_at
       FROM enrolments e
       JOIN learners l ON l.id = e.learner_id AND l.provider_user_id = e.provider_user_id
       JOIN programmes p ON p.id = e.programme_id AND p.provider_user_id = e.provider_user_id
       JOIN programme_evidence_requirements r
         ON r.provider_user_id = e.provider_user_id AND r.programme_id = e.programme_id
         AND r.archived_at IS NULL
       LEFT JOIN evidence_submissions s
         ON s.provider_user_id = e.provider_user_id AND s.enrolment_id = e.id
         AND s.requirement_id = r.id
       LEFT JOIN LATERAL (
         SELECT assessor.full_name AS assessor_name, review_row.id, review_row.decision,
           review_row.feedback, review_row.reviewed_at
         FROM evidence_reviews review_row
         JOIN users assessor ON assessor.id = review_row.assessor_user_id
         WHERE review_row.evidence_submission_id = s.id
           AND review_row.submission_version = s.version
         ORDER BY review_row.reviewed_at DESC
         LIMIT 1
       ) review ON true
       WHERE l.id = $1
       ORDER BY e.created_at DESC, r.created_at, r.id, s.version DESC`,
      [learnerId],
    );
    const items = new Map();
    for (const row of rows) {
      const key = `${row.enrolment_id}:${row.requirement_id}`;
      let item = items.get(key);
      if (!item) {
        item = {
          enrolmentId: row.enrolment_id,
          enrolmentStatus: row.enrolment_status,
          programmeId: row.programme_id,
          programmeName: row.programme_name,
          requirementId: row.requirement_id,
          title: row.requirement_title,
          guidance: row.guidance,
          status: 'NOT_SUBMITTED',
          submissions: [],
        };
        items.set(key, item);
      }
      if (!row.submission_id) continue;

      const submission = {
        id: row.submission_id,
        filename: row.original_filename,
        status: row.submission_status,
        version: row.version,
        submittedAt: row.submitted_at,
        review: row.review_id ? {
          assessorName: row.assessor_name,
          decision: row.decision,
          feedback: row.feedback,
          reviewedAt: row.reviewed_at,
        } : null,
      };
      item.submissions.push(submission);
      if (item.submissions.length === 1) {
        item.status = row.submission_status;
      }
    }
    return [...items.values()];
  }

  router.get('/dashboard', async (request, response, next) => {
    try {
      const learner = await findLearner(request);
      if (!learner) {
        return response.status(404).json({ error: 'No learner profile is linked to this account.' });
      }

      const [programmes, attendance, evidence] = await Promise.all([
        listProgrammes(learner.id),
        getAttendance(learner.id),
        listEvidence(learner.id),
      ]);
      const evidenceSummary = {
        total: evidence.length,
        notSubmitted: evidence.filter((item) => item.status === 'NOT_SUBMITTED').length,
        awaitingAssessment: evidence.filter((item) => ['SUBMITTED', 'UNDER_REVIEW'].includes(item.status)).length,
        approved: evidence.filter((item) => item.status === 'APPROVED').length,
        correctionsRequired: evidence.filter((item) => item.status === 'CORRECTION_REQUIRED').length,
      };
      const recentActivity = [
        ...attendance.recent.map((record) => ({
          type: 'attendance',
          description: `Attendance recorded as ${record.status}`,
          programmeName: record.programmeName,
          detail: record.title,
          occurredAt: record.markedAt ?? record.startsAt,
          status: record.status,
        })),
        ...evidence.flatMap((item) => item.submissions.flatMap((submission) => [
          {
            type: 'evidence',
            description: submission.version > 1 ? 'Evidence resubmitted' : 'Evidence submitted',
            programmeName: item.programmeName,
            detail: item.title,
            occurredAt: submission.submittedAt,
            status: submission.status,
          },
          ...(submission.review ? [{
            type: 'assessment',
            description: submission.review.decision === 'APPROVED'
              ? 'Evidence approved'
              : 'Corrections requested',
            programmeName: item.programmeName,
            detail: item.title,
            occurredAt: submission.review.reviewedAt,
            status: submission.review.decision,
          }] : []),
        ])),
      ].filter((activity) => activity.occurredAt)
        .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
        .slice(0, 8);

      return response.json({
        learner: {
          id: learner.id,
          learnerReference: learner.learner_reference,
          fullName: learner.full_name,
          email: learner.email,
          phone: learner.phone,
        },
        programmes,
        attendance: {
          summary: attendance.summary,
          recent: attendance.recent,
        },
        evidence,
        evidenceSummary,
        recentActivity,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/programmes', async (request, response, next) => {
    try {
      const learner = await findLearner(request);
      if (!learner) {
        return response.status(404).json({ error: 'No learner profile is linked to this account.' });
      }
      return response.json({ programmes: await listProgrammes(learner.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/programmes/:id', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Programme ID must be a UUID.' });
    }

    try {
      const learner = await findLearner(request);
      if (!learner) {
        return response.status(404).json({ error: 'No learner profile is linked to this account.' });
      }
      const programmes = await listProgrammes(learner.id);
      const programme = programmes.find((item) => item.id === request.params.id);
      if (!programme) {
        return response.status(404).json({ error: 'Programme not found for this learner account.' });
      }
      return response.json({ programme });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createLearnerPortalRouter };
