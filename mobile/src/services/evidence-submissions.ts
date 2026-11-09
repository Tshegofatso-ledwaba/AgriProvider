import { File, Paths } from 'expo-file-system';

import {
  downloadFile,
  isRecord,
  requestApi,
  UploadAsset,
  uploadFile,
} from '@/services/api';

export type EvidenceStatus =
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'CORRECTION_REQUIRED'
  | 'APPROVED';

export type EvidenceSubmission = {
  id: string;
  programme_id: string;
  enrolment_id: string;
  requirement_id: string;
  submitted_by: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  status: Exclude<EvidenceStatus, 'NOT_SUBMITTED'>;
  version: number;
  created_at: string;
  updated_at: string;
  latest_review?: EvidenceReview | null;
};

export type EvidenceReview = {
  id: string;
  submission_version: number;
  assessor_name: string;
  decision: 'APPROVED' | 'CORRECTION_REQUESTED';
  feedback: string | null;
  reviewed_at: string;
};

export type EnrolmentEvidenceItem = {
  requirement_id: string;
  requirement_title: string;
  guidance: string | null;
  status: EvidenceStatus;
  latest_submission: EvidenceSubmission | null;
};

export type EvidenceCompletion = {
  total_required: number;
  not_submitted: number;
  submitted: number;
  awaiting_review: number;
  approved: number;
  correction_required: number;
};

function isSubmission(value: unknown): value is EvidenceSubmission {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.submission_version === 'number'
    && typeof value.assessor_name === 'string'
    && typeof value.programme_id === 'string'
    && typeof value.enrolment_id === 'string'
    && typeof value.requirement_id === 'string'
    && typeof value.submitted_by === 'string'
    && typeof value.original_filename === 'string'
    && typeof value.mime_type === 'string'
    && typeof value.file_size === 'number'
    && typeof value.status === 'string'
    && ['SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED'].includes(value.status)
    && typeof value.version === 'number'
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && (value.latest_review === undefined || value.latest_review === null || isEvidenceReview(value.latest_review));
}

function isEvidenceReview(value: unknown): value is EvidenceReview {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.decision === 'APPROVED' || value.decision === 'CORRECTION_REQUESTED')
    && (typeof value.feedback === 'string' || value.feedback === null)
    && typeof value.reviewed_at === 'string';
}

function isEvidenceItem(value: unknown): value is EnrolmentEvidenceItem {
  return isRecord(value)
    && typeof value.requirement_id === 'string'
    && typeof value.requirement_title === 'string'
    && (typeof value.guidance === 'string' || value.guidance === null)
    && typeof value.status === 'string'
    && ['NOT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED'].includes(value.status)
    && (value.latest_submission === null || isSubmission(value.latest_submission));
}

function isCompletion(value: unknown): value is EvidenceCompletion {
  return isRecord(value)
    && ['total_required', 'not_submitted', 'submitted', 'awaiting_review', 'approved', 'correction_required']
      .every((key) => typeof value[key] === 'number');
}

export async function listEnrolmentEvidence(
  token: string,
  enrolmentId: string,
): Promise<{ requirements: EnrolmentEvidenceItem[]; completion: EvidenceCompletion }> {
  const payload = await requestApi(
    `/api/enrolments/${encodeURIComponent(enrolmentId)}/evidence-submissions`,
    { token },
  );
  if (!isRecord(payload) || !Array.isArray(payload.requirements)
    || !payload.requirements.every(isEvidenceItem) || !isCompletion(payload.completion)) {
    throw new Error('The API returned an unexpected evidence checklist.');
  }
  return { requirements: payload.requirements, completion: payload.completion };
}

export async function submitEvidence(
  token: string,
  enrolmentId: string,
  requirementId: string,
  file: UploadAsset,
  onProgress: (progress: number) => void,
): Promise<EvidenceSubmission> {
  const path = `/api/enrolments/${encodeURIComponent(enrolmentId)}`
    + `/evidence-requirements/${encodeURIComponent(requirementId)}/submissions`;
  const payload = await uploadFile(path, token, file, onProgress);
  if (!isRecord(payload) || !isSubmission(payload.submission)) {
    throw new Error('The API returned an unexpected evidence submission.');
  }
  return payload.submission;
}

export type EvidenceHistory = {
  submissions: EvidenceSubmission[];
  reviews: EvidenceReview[];
};

export async function getEvidenceHistory(
  token: string,
  submissionId: string,
): Promise<EvidenceHistory> {
  const payload = await requestApi(
    `/api/evidence-submissions/${encodeURIComponent(submissionId)}/history`,
    { token },
  );
  if (!isRecord(payload) || !Array.isArray(payload.submissions)
    || !payload.submissions.every(isSubmission)
    || !Array.isArray(payload.reviews) || !payload.reviews.every(isEvidenceReview)) {
    throw new Error('The API returned an unexpected submission history.');
  }
  return { submissions: payload.submissions, reviews: payload.reviews };
}

export async function previewEvidence(token: string, submission: EvidenceSubmission): Promise<void> {
  const bytes = await downloadFile(
    `/api/evidence-submissions/${encodeURIComponent(submission.id)}/file`,
    token,
  );
  const extension = submission.mime_type === 'application/pdf'
    ? 'pdf'
    : submission.mime_type === 'image/png' ? 'png' : 'jpg';
  const file = new File(Paths.cache, `evidence-${submission.id}.${extension}`);
  await file.write(bytes);
  if (await File.canPreview(file)) {
    await file.preview({ title: submission.original_filename });
  } else {
    if (file.exists) file.delete();
    throw new Error('This device cannot preview the selected evidence file.');
  }
}
