import { Platform } from 'react-native';

import { isRecord, requestApi } from '@/services/api';

export type LearnerProgramme = {
  id: string;
  name: string;
  description: string | null;
  providerName: string;
  status: 'active' | 'withdrawn';
  enrolmentId: string;
  enrolledAt: string;
};

export type LearnerAttendanceRecord = {
  sessionId: string;
  title: string;
  programmeName: string;
  startsAt: string;
  status: 'present' | 'absent' | 'excused';
  markedAt: string;
};

export type LearnerEvidenceSubmission = {
  id: string;
  filename: string;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'CORRECTION_REQUIRED' | 'APPROVED';
  version: number;
  submittedAt: string;
  review: {
    assessorName: string;
    decision: 'APPROVED' | 'CORRECTION_REQUESTED';
    feedback: string | null;
    reviewedAt: string;
  } | null;
};

export type LearnerEvidenceRequirement = {
  enrolmentId: string;
  enrolmentStatus: 'active' | 'withdrawn';
  programmeId: string;
  programmeName: string;
  requirementId: string;
  title: string;
  guidance: string | null;
  status: 'NOT_SUBMITTED' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CORRECTION_REQUIRED' | 'APPROVED';
  submissions: LearnerEvidenceSubmission[];
};

export type LearnerActivity = {
  type: 'attendance' | 'evidence' | 'assessment';
  description: string;
  programmeName: string;
  detail: string;
  occurredAt: string;
  status: string;
};

export type LearnerDashboard = {
  learner: {
    id: string;
    learnerReference: string;
    fullName: string;
    email: string | null;
    phone: string | null;
  };
  programmes: LearnerProgramme[];
  attendance: {
    summary: { recorded: number; present: number; absent: number; excused: number };
    recent: LearnerAttendanceRecord[];
  };
  evidence: LearnerEvidenceRequirement[];
  evidenceSummary: {
    total: number;
    notSubmitted: number;
    awaitingAssessment: number;
    approved: number;
    correctionsRequired: number;
  };
  recentActivity: LearnerActivity[];
};

function isProgramme(value: unknown): value is LearnerProgramme {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && (typeof value.description === 'string' || value.description === null)
    && typeof value.providerName === 'string'
    && (value.status === 'active' || value.status === 'withdrawn')
    && typeof value.enrolmentId === 'string'
    && typeof value.enrolledAt === 'string';
}

function isAttendanceRecord(value: unknown): value is LearnerAttendanceRecord {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && typeof value.title === 'string'
    && typeof value.programmeName === 'string'
    && typeof value.startsAt === 'string'
    && (value.status === 'present' || value.status === 'absent' || value.status === 'excused')
    && typeof value.markedAt === 'string';
}

function isEvidenceSubmission(value: unknown): value is LearnerEvidenceSubmission {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.filename === 'string'
    && ['SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED'].includes(String(value.status))
    && typeof value.version === 'number'
    && typeof value.submittedAt === 'string'
    && (value.review === null || (
      isRecord(value.review)
      && typeof value.review.assessorName === 'string'
      && (value.review.decision === 'APPROVED' || value.review.decision === 'CORRECTION_REQUESTED')
      && (typeof value.review.feedback === 'string' || value.review.feedback === null)
      && typeof value.review.reviewedAt === 'string'
    ));
}

function isEvidenceRequirement(value: unknown): value is LearnerEvidenceRequirement {
  return isRecord(value)
    && typeof value.enrolmentId === 'string'
    && (value.enrolmentStatus === 'active' || value.enrolmentStatus === 'withdrawn')
    && typeof value.programmeId === 'string'
    && typeof value.programmeName === 'string'
    && typeof value.requirementId === 'string'
    && typeof value.title === 'string'
    && (typeof value.guidance === 'string' || value.guidance === null)
    && ['NOT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED'].includes(String(value.status))
    && Array.isArray(value.submissions)
    && value.submissions.every(isEvidenceSubmission);
}

function isActivity(value: unknown): value is LearnerActivity {
  return isRecord(value)
    && (value.type === 'attendance' || value.type === 'evidence' || value.type === 'assessment')
    && typeof value.description === 'string'
    && typeof value.programmeName === 'string'
    && typeof value.detail === 'string'
    && typeof value.occurredAt === 'string'
    && typeof value.status === 'string';
}

function isLearnerDashboard(value: unknown): value is LearnerDashboard {
  if (!isRecord(value) || !isRecord(value.learner) || !isRecord(value.attendance)
    || !isRecord(value.evidenceSummary)) return false;
  const { learner, attendance, evidenceSummary } = value;
  const attendanceSummary = isRecord(attendance.summary) ? attendance.summary : null;
  if (!attendanceSummary) return false;
  return typeof learner.id === 'string'
    && typeof learner.learnerReference === 'string'
    && typeof learner.fullName === 'string'
    && (typeof learner.email === 'string' || learner.email === null)
    && (typeof learner.phone === 'string' || learner.phone === null)
    && Array.isArray(value.programmes) && value.programmes.every(isProgramme)
    && ['recorded', 'present', 'absent', 'excused']
      .every((key) => typeof attendanceSummary[key] === 'number')
    && Array.isArray(attendance.recent) && attendance.recent.every(isAttendanceRecord)
    && Array.isArray(value.evidence) && value.evidence.every(isEvidenceRequirement)
    && ['total', 'notSubmitted', 'awaitingAssessment', 'approved', 'correctionsRequired']
      .every((key) => typeof evidenceSummary[key] === 'number')
    && Array.isArray(value.recentActivity) && value.recentActivity.every(isActivity);
}

export async function getLearnerDashboard(credential: string): Promise<LearnerDashboard> {
  const payload = await requestApi('/api/learner/dashboard', {
    token: credential,
    authMode: Platform.OS === 'web' ? 'cookie' : undefined,
  });
  if (!isLearnerDashboard(payload)) {
    throw new Error('The learner dashboard returned an unexpected response.');
  }
  return payload;
}
