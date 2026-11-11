import { File, Paths } from 'expo-file-system';
import { Linking, Platform } from 'react-native';

import { downloadPrivateFile, isRecord, requestApi } from '@/services/api';

export type QaDecision = 'VERIFIED' | 'FURTHER_ACTION_REQUIRED' | 'NOT_VERIFIED';
export type QaStatus = 'AWAITING_REVIEW' | QaDecision;

export type QaOfficer = {
  id: string;
  full_name: string;
  email: string;
};

export type QaProgrammeAssignment = {
  id: string;
  programme_id: string;
  programme_name: string;
  provider_name: string;
  qa_user_id: string;
  qa_name: string;
  qa_email: string;
  assigned_by: string;
  assigned_by_name: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
};

export type QaProgrammeScope = {
  id: string;
  name: string;
  provider_name: string;
  assignment_id: string;
};

export type QaDashboardReview = {
  assessment_review_id: string;
  assessor_decision: 'APPROVED' | 'CORRECTION_REQUESTED';
  assessor_feedback: string | null;
  assessor_reviewed_at: string;
  assessor_user_id: string;
  assessor_name: string;
  submission_id: string;
  submission_version: number;
  submission_status: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  submitted_at: string;
  enrolment_id: string;
  requirement_id: string;
  learner_id: string;
  learner_name: string;
  learner_reference: string;
  programme_id: string;
  programme_name: string;
  provider_user_id: string;
  provider_name: string;
  requirement_title: string;
  guidance: string | null;
  assignment_id: string;
  qa_review_id: string | null;
  qa_decision: QaDecision | null;
  qa_comments: string | null;
  qa_reviewed_at: string | null;
  qa_status: QaStatus;
};

export type QaDashboard = {
  programmes: QaProgrammeScope[];
  summary: {
    total: number;
    awaiting_review: number;
    verified: number;
    further_action_required: number;
    not_verified: number;
  };
  reviews: QaDashboardReview[];
  total: number;
  limit: number;
  offset: number;
  scopeConfigured: boolean;
};

export type QaReviewHistory = {
  assessment_review_id: string;
  assessor_decision: 'APPROVED' | 'CORRECTION_REQUESTED';
  assessor_feedback: string | null;
  assessor_reviewed_at: string;
  submission_version: number;
  submission_id: string;
  submission_status: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  submitted_at: string;
  qa_review_id: string | null;
  qa_decision: QaDecision | null;
  qa_comments: string | null;
  qa_reviewed_at: string | null;
};

export type QaSubmissionDetails = QaDashboardReview & {
  history: QaReviewHistory[];
};

function hasStrings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === 'string');
}

function isQaOfficer(value: unknown): value is QaOfficer {
  return isRecord(value) && hasStrings(value, ['id', 'full_name', 'email']);
}

function isQaAssignment(value: unknown): value is QaProgrammeAssignment {
  return isRecord(value)
    && hasStrings(value, [
      'id', 'programme_id', 'programme_name', 'provider_name', 'qa_user_id', 'qa_name',
      'qa_email', 'assigned_by', 'assigned_by_name', 'status', 'created_at', 'updated_at',
    ])
    && (value.status === 'ACTIVE' || value.status === 'INACTIVE')
    && (typeof value.deactivated_at === 'string' || value.deactivated_at === null);
}

function isQaProgramme(value: unknown): value is QaProgrammeScope {
  return isRecord(value) && hasStrings(value, ['id', 'name', 'provider_name', 'assignment_id']);
}

function isQaDecision(value: unknown): value is QaDecision {
  return value === 'VERIFIED' || value === 'FURTHER_ACTION_REQUIRED' || value === 'NOT_VERIFIED';
}

function isQaDashboardReview(value: unknown): value is QaDashboardReview {
  return isRecord(value)
    && hasStrings(value, [
      'assessment_review_id', 'assessor_decision', 'assessor_reviewed_at', 'assessor_user_id',
      'assessor_name', 'submission_id', 'submission_status', 'original_filename', 'mime_type',
      'submitted_at', 'enrolment_id', 'requirement_id', 'learner_id', 'learner_name',
      'learner_reference', 'programme_id', 'programme_name', 'provider_user_id', 'provider_name',
      'requirement_title', 'assignment_id', 'qa_status',
    ])
    && (value.assessor_decision === 'APPROVED' || value.assessor_decision === 'CORRECTION_REQUESTED')
    && (typeof value.assessor_feedback === 'string' || value.assessor_feedback === null)
    && typeof value.submission_version === 'number'
    && typeof value.file_size === 'number'
    && (typeof value.guidance === 'string' || value.guidance === null)
    && (typeof value.qa_review_id === 'string' || value.qa_review_id === null)
    && (isQaDecision(value.qa_decision) || value.qa_decision === null)
    && (typeof value.qa_comments === 'string' || value.qa_comments === null)
    && (typeof value.qa_reviewed_at === 'string' || value.qa_reviewed_at === null)
    && (value.qa_status === 'AWAITING_REVIEW' || isQaDecision(value.qa_status));
}

function isQaHistory(value: unknown): value is QaReviewHistory {
  return isRecord(value)
    && hasStrings(value, [
      'assessment_review_id', 'assessor_decision', 'assessor_reviewed_at', 'submission_status',
      'submission_id', 'original_filename', 'mime_type', 'submitted_at',
    ])
    && (value.assessor_decision === 'APPROVED' || value.assessor_decision === 'CORRECTION_REQUESTED')
    && (typeof value.assessor_feedback === 'string' || value.assessor_feedback === null)
    && typeof value.submission_version === 'number'
    && typeof value.file_size === 'number'
    && (typeof value.qa_review_id === 'string' || value.qa_review_id === null)
    && (isQaDecision(value.qa_decision) || value.qa_decision === null)
    && (typeof value.qa_comments === 'string' || value.qa_comments === null)
    && (typeof value.qa_reviewed_at === 'string' || value.qa_reviewed_at === null);
}

export async function listQaOfficers(token: string): Promise<QaOfficer[]> {
  const payload = await requestApi('/api/admin/qa-officers', { token });
  if (!isRecord(payload) || !Array.isArray(payload.qaOfficers) || !payload.qaOfficers.every(isQaOfficer)) {
    throw new Error('The API returned an unexpected QA Officer list.');
  }
  return payload.qaOfficers;
}

export async function listQaAssignments(token: string): Promise<QaProgrammeAssignment[]> {
  const payload = await requestApi('/api/admin/qa-assignments', { token });
  if (!isRecord(payload) || !Array.isArray(payload.assignments) || !payload.assignments.every(isQaAssignment)) {
    throw new Error('The API returned unexpected QA assignment history.');
  }
  return payload.assignments;
}

export async function createQaAssignment(token: string, programmeId: string, qaUserId: string) {
  const payload = await requestApi('/api/admin/qa-assignments', {
    method: 'POST', token, body: { programmeId, qaUserId },
  });
  if (!isRecord(payload) || !isRecord(payload.assignment) || typeof payload.assignment.id !== 'string') {
    throw new Error('The API returned an unexpected QA assignment.');
  }
  return payload.assignment;
}

export async function updateQaAssignment(token: string, assignmentId: string, status: 'ACTIVE' | 'INACTIVE') {
  const payload = await requestApi(`/api/admin/qa-assignments/${encodeURIComponent(assignmentId)}`, {
    method: 'PATCH', token, body: { status },
  });
  if (!isRecord(payload) || !isRecord(payload.assignment) || !isQaAssignmentSummary(payload.assignment)) {
    throw new Error('The API returned an unexpected QA assignment.');
  }
  return payload.assignment;
}

export async function getQaDashboard(
  token: string,
  filters: { status?: 'all' | QaStatus; programmeId?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<QaDashboard> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.programmeId) params.set('programmeId', filters.programmeId);
  if (filters.q) params.set('q', filters.q);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const payload = await requestApi(`/api/qa/dashboard${suffix}`, { token });
  if (!isRecord(payload) || !Array.isArray(payload.programmes) || !payload.programmes.every(isQaProgramme)
    || !isRecord(payload.summary) || !Array.isArray(payload.reviews) || !payload.reviews.every(isQaDashboardReview)
    || typeof payload.total !== 'number' || typeof payload.limit !== 'number' || typeof payload.offset !== 'number'
    || typeof payload.scopeConfigured !== 'boolean') {
    throw new Error('The API returned an unexpected QA dashboard.');
  }
  const summary = payload.summary;
  if (['total', 'awaiting_review', 'verified', 'further_action_required', 'not_verified']
    .some((key) => typeof summary[key] !== 'number')) {
    throw new Error('The API returned an unexpected QA summary.');
  }
  return payload as unknown as QaDashboard;
}

export async function getQaSubmission(token: string, submissionId: string): Promise<QaSubmissionDetails> {
  const payload = await requestApi(`/api/qa/submissions/${encodeURIComponent(submissionId)}`, { token });
  if (!isRecord(payload) || !isRecord(payload.submission) || !isQaDashboardReview(payload.submission)
    || !Array.isArray(payload.history) || !payload.history.every(isQaHistory)) {
    throw new Error('The API returned unexpected QA assessment details.');
  }
  return { ...payload.submission, history: payload.history };
}

export async function recordQaReview(
  token: string,
  submissionId: string,
  values: { decision: QaDecision; comments: string },
) {
  const payload = await requestApi(`/api/qa/submissions/${encodeURIComponent(submissionId)}/reviews`, {
    method: 'POST', token, body: values,
  });
  if (!isRecord(payload) || !isRecord(payload.qaReview) || typeof payload.qaReview.id !== 'string') {
    throw new Error('The API returned an unexpected QA outcome.');
  }
  return payload.qaReview;
}

export function qaFilePath(submissionId: string) {
  return `/api/qa/submissions/${encodeURIComponent(submissionId)}/file`;
}

export async function previewQaEvidence(
  token: string,
  submission: Pick<QaDashboardReview, 'submission_id' | 'mime_type' | 'original_filename'>,
): Promise<void> {
  const bytes = await downloadPrivateFile(qaFilePath(submission.submission_id), token);
  if (Platform.OS === 'web') {
    const blobBytes = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(blobBytes).set(bytes);
    const url = URL.createObjectURL(new Blob([blobBytes], { type: submission.mime_type }));
    try {
      await Linking.openURL(url);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    return;
  }

  const extension = submission.mime_type === 'application/pdf'
    ? 'pdf'
    : submission.mime_type === 'image/png' ? 'png' : 'jpg';
  const file = new File(Paths.cache, `qa-review-${submission.submission_id}.${extension}`);
  await file.write(bytes);
  if (await File.canPreview(file)) {
    await file.preview({ title: submission.original_filename });
    return;
  }
  if (file.exists) file.delete();
  throw new Error('This device cannot preview the selected evidence file.');
}

function isQaAssignmentSummary(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'programme_id', 'qa_user_id', 'assigned_by', 'status', 'created_at', 'updated_at'])
    && (value.status === 'ACTIVE' || value.status === 'INACTIVE')
    && (typeof value.deactivated_at === 'string' || value.deactivated_at === null);
}
