import { File, Paths } from 'expo-file-system';

import { downloadFile, isRecord, requestApi } from '@/services/api';

export type AssessorProgramme = {
  id: string;
  name: string;
  assignment_id: string;
  learner_count: number;
  pending_reviews: number;
  approved_count: number;
  correction_count: number;
};

export type AssessorLearner = {
  enrolment_id: string;
  enrolment_status: string;
  enrolled_at: string;
  learner_id: string;
  learner_reference: string;
  full_name: string;
};

export type AssessorSubmission = {
  id: string;
  programme_id: string;
  enrolment_id: string;
  requirement_id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'CORRECTION_REQUIRED' | 'APPROVED';
  version: number;
  created_at: string;
  learner_id: string;
  learner_reference: string;
  learner_name: string;
  programme_name: string;
  requirement_title: string;
};

export type AssessorSubmissionDetails = AssessorSubmission & {
  submitted_by: string;
  guidance: string | null;
};

export type AssessorSubmissionVersion = Pick<AssessorSubmission,
  'id' | 'programme_id' | 'enrolment_id' | 'requirement_id' | 'original_filename'
  | 'mime_type' | 'file_size' | 'status' | 'version' | 'created_at'>;

export type EvidenceReview = {
  id: string;
  evidence_submission_id: string;
  submission_version: number;
  assessor_user_id: string;
  assessor_name: string;
  decision: 'APPROVED' | 'CORRECTION_REQUESTED';
  feedback: string | null;
  reviewed_at: string;
};

function hasStrings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === 'string');
}

function isProgramme(value: unknown): value is AssessorProgramme {
  return isRecord(value)
    && hasStrings(value, ['id', 'name', 'assignment_id'])
    && ['learner_count', 'pending_reviews', 'approved_count', 'correction_count']
      .every((key) => typeof value[key] === 'number');
}

function isLearner(value: unknown): value is AssessorLearner {
  return isRecord(value)
    && hasStrings(value, ['enrolment_id', 'enrolment_status', 'enrolled_at', 'learner_id', 'learner_reference', 'full_name']);
}

function isSubmission(value: unknown): value is AssessorSubmission {
  return isRecord(value)
    && hasStrings(value, [
      'id', 'programme_id', 'enrolment_id', 'requirement_id', 'original_filename', 'mime_type',
      'status', 'created_at', 'learner_id', 'learner_reference', 'learner_name', 'programme_name', 'requirement_title',
    ])
    && typeof value.status === 'string'
    && ['SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED'].includes(value.status)
    && typeof value.file_size === 'number'
    && typeof value.version === 'number';
}

function isReview(value: unknown): value is EvidenceReview {
  return isRecord(value)
    && hasStrings(value, [
      'id', 'evidence_submission_id', 'assessor_user_id', 'assessor_name', 'reviewed_at',
    ])
    && typeof value.submission_version === 'number'
    && (value.decision === 'APPROVED' || value.decision === 'CORRECTION_REQUESTED')
    && (typeof value.feedback === 'string' || value.feedback === null);
}

export async function listAssignedProgrammes(token: string): Promise<AssessorProgramme[]> {
  const payload = await requestApi('/api/assessor/programmes', { token });
  if (!isRecord(payload) || !Array.isArray(payload.programmes) || !payload.programmes.every(isProgramme)) {
    throw new Error('The API returned an unexpected assigned-programme list.');
  }
  return payload.programmes;
}

export async function listProgrammeLearners(token: string, programmeId: string): Promise<AssessorLearner[]> {
  const payload = await requestApi(`/api/assessor/programmes/${encodeURIComponent(programmeId)}/learners`, { token });
  if (!isRecord(payload) || !Array.isArray(payload.learners) || !payload.learners.every(isLearner)) {
    throw new Error('The API returned an unexpected learner list.');
  }
  return payload.learners;
}

export async function listProgrammeSubmissions(
  token: string,
  programmeId: string,
  status: 'all' | AssessorSubmission['status'] = 'all',
): Promise<AssessorSubmission[]> {
  const payload = await requestApi(
    `/api/assessor/programmes/${encodeURIComponent(programmeId)}/submissions?status=${encodeURIComponent(status)}`,
    { token },
  );
  if (!isRecord(payload) || !Array.isArray(payload.submissions) || !payload.submissions.every(isSubmission)) {
    throw new Error('The API returned an unexpected evidence queue.');
  }
  return payload.submissions;
}

export async function getAssessorSubmission(
  token: string,
  submissionId: string,
): Promise<AssessorSubmissionDetails> {
  const payload = await requestApi(`/api/assessor/submissions/${encodeURIComponent(submissionId)}`, { token });
  if (!isRecord(payload) || !isRecord(payload.submission)
    || typeof payload.submission.submitted_by !== 'string'
    || !(typeof payload.submission.guidance === 'string' || payload.submission.guidance === null)) {
    throw new Error('The API returned unexpected evidence details.');
  }
  if (!isSubmission(payload.submission)) throw new Error('The API returned unexpected evidence details.');
  return payload.submission as AssessorSubmissionDetails;
}

export async function getReviewHistory(token: string, submissionId: string): Promise<EvidenceReview[]> {
  const payload = await requestApi(`/api/assessor/submissions/${encodeURIComponent(submissionId)}/reviews`, { token });
  if (!isRecord(payload) || !Array.isArray(payload.reviews) || !payload.reviews.every(isReview)) {
    throw new Error('The API returned unexpected review history.');
  }
  return payload.reviews;
}

export async function getAssessorSubmissionHistory(
  token: string,
  submissionId: string,
): Promise<AssessorSubmissionVersion[]> {
  const payload = await requestApi(`/api/assessor/submissions/${encodeURIComponent(submissionId)}/history`, { token });
  if (!isRecord(payload) || !Array.isArray(payload.submissions) || !payload.submissions.every(isSubmissionVersion)) {
    throw new Error('The API returned unexpected submission versions.');
  }
  return payload.submissions;
}

export async function reviewEvidence(
  token: string,
  submissionId: string,
  values: { decision: EvidenceReview['decision']; feedback?: string },
): Promise<{ review: EvidenceReview; submission_status: AssessorSubmission['status'] }> {
  const payload = await requestApi(`/api/assessor/submissions/${encodeURIComponent(submissionId)}/reviews`, {
    method: 'POST',
    token,
    body: values,
  });
  if (!isRecord(payload) || !isReview(payload.review) || typeof payload.submission_status !== 'string'
    || !['APPROVED', 'CORRECTION_REQUIRED'].includes(payload.submission_status)) {
    throw new Error('The API returned an unexpected evidence decision.');
  }
  return {
    review: payload.review,
    submission_status: payload.submission_status as AssessorSubmission['status'],
  };
}

export async function previewAssessorEvidence(
  token: string,
  submission: Pick<AssessorSubmission, 'id' | 'mime_type' | 'original_filename'>,
): Promise<void> {
  const bytes = await downloadFile(
    `/api/assessor/submissions/${encodeURIComponent(submission.id)}/file`,
    token,
  );
  const extension = submission.mime_type === 'application/pdf'
    ? 'pdf'
    : submission.mime_type === 'image/png' ? 'png' : 'jpg';
  const file = new File(Paths.cache, `evidence-review-${submission.id}.${extension}`);
  await file.write(bytes);
  if (await File.canPreview(file)) {
    await file.preview({ title: submission.original_filename });
  } else {
    if (file.exists) file.delete();
    throw new Error('This device cannot preview the selected evidence file.');
  }
}

function isSubmissionVersion(value: unknown): value is AssessorSubmissionVersion {
  return isRecord(value)
    && hasStrings(value, [
      'id', 'programme_id', 'enrolment_id', 'requirement_id', 'original_filename',
      'mime_type', 'status', 'created_at',
    ])
    && typeof value.file_size === 'number'
    && typeof value.version === 'number';
}