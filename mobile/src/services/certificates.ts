import { Platform } from 'react-native';

import { downloadPrivateFile, isRecord, requestApi } from '@/services/api';

export type CertificateType = 'MILESTONE' | 'FINAL';
export type CertificateDecision = 'APPROVED' | 'REJECTED';
export type AttendanceCondition = { sessionId: string; acceptedStatuses: ('present' | 'absent' | 'excused')[] };
export type CertificateRule = {
  key: string;
  type: CertificateType;
  title: string;
  requiredEvidenceRequirementIds: string[];
  requiredAssessmentRequirementIds: string[];
  attendanceRequirements: AttendanceCondition[];
};
export type CertificateCriteria = { certificates: CertificateRule[] };

export type EligibilityConfiguration = {
  id: string;
  programme_id: string;
  programme_name?: string;
  provider_name?: string;
  version: number;
  criteria: CertificateCriteria;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'INACTIVE';
  created_at: string;
  submitted_at?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
};

export type EligibilityBlocker = { code: string; message: string; requirementId?: string; sessionId?: string };

export type QaEligibilityItem = {
  enrolmentId: string;
  learnerName: string;
  learnerReference: string;
  credentialKey: string;
  credentialType: CertificateType;
  credentialTitle: string;
  blockers: EligibilityBlocker[];
  latestReview: { id: string; decision: CertificateDecision; comments: string; reviewed_at: string } | null;
};

export type QaEligibilityDashboard = {
  configuration: { id: string; version: number } | null;
  reviews: QaEligibilityItem[];
};

export type EligibilityReview = {
  id: string;
  learner_id: string;
  learner_name: string;
  learner_reference: string;
  enrolment_id: string;
  programme_id: string;
  programme_name: string;
  credential_key: string;
  credential_type: CertificateType;
  credential_title: string;
  decision: CertificateDecision;
  blockers: EligibilityBlocker[];
  comments: string;
  reviewed_at: string;
  qa_name: string;
  authorization_id: string | null;
  authorization_decision: CertificateDecision | null;
  authorization_comments: string | null;
  decided_at: string | null;
};

export type CertificateRecord = {
  id: string;
  learner_id?: string;
  learner_name?: string;
  learner_reference?: string;
  credential_key: string;
  certificate_type: CertificateType;
  certificate_title: string;
  programme_id: string;
  programme_name: string;
  verification_reference: string;
  issued_at: string;
  issuer_name: string;
  issuer_title: string;
  status: 'ISSUED' | 'REVOKED' | 'SUPERSEDED';
  revoked_at?: string | null;
  revocation_reason?: string | null;
  file_size: number;
};

export type CertificateVerification = {
  valid: boolean;
  status: 'ISSUED' | 'REVOKED' | 'SUPERSEDED';
  verificationReference: string;
  certificateType: CertificateType;
  certificateTitle: string;
  programmeName: string;
  issuedAt: string;
};

export type ProviderCertificateStatus = {
  enrolmentId: string;
  learnerId: string;
  learnerName: string;
  learnerReference: string;
  credentialKey: string;
  credentialType: CertificateType;
  credentialTitle: string;
  blockers: EligibilityBlocker[];
  qaDecision: CertificateDecision | null;
  qaReviewedAt: string | null;
  certificate: {
    id: string;
    verification_reference: string;
    status: 'ISSUED' | 'REVOKED' | 'SUPERSEDED';
    issued_at: string;
    revoked_at: string | null;
  } | null;
};

function isCertificateRule(value: unknown): value is CertificateRule {
  return isRecord(value)
    && typeof value.key === 'string'
    && (value.type === 'MILESTONE' || value.type === 'FINAL')
    && typeof value.title === 'string'
    && Array.isArray(value.requiredEvidenceRequirementIds)
    && value.requiredEvidenceRequirementIds.every((id) => typeof id === 'string')
    && Array.isArray(value.requiredAssessmentRequirementIds)
    && value.requiredAssessmentRequirementIds.every((id) => typeof id === 'string')
    && Array.isArray(value.attendanceRequirements)
    && value.attendanceRequirements.every((condition) => isRecord(condition)
      && typeof condition.sessionId === 'string'
      && Array.isArray(condition.acceptedStatuses)
      && condition.acceptedStatuses.every((status) => ['present', 'absent', 'excused'].includes(String(status))));
}

function isCriteria(value: unknown): value is CertificateCriteria {
  return isRecord(value) && Array.isArray(value.certificates) && value.certificates.every(isCertificateRule);
}

function isConfiguration(value: unknown): value is EligibilityConfiguration {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.programme_id === 'string'
    && typeof value.version === 'number'
    && isCriteria(value.criteria)
    && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'INACTIVE'].includes(String(value.status))
    && typeof value.created_at === 'string';
}

function isBlocker(value: unknown): value is EligibilityBlocker {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

function isQaEligibilityItem(value: unknown): value is QaEligibilityItem {
  return isRecord(value)
    && typeof value.enrolmentId === 'string'
    && typeof value.learnerName === 'string'
    && typeof value.learnerReference === 'string'
    && typeof value.credentialKey === 'string'
    && (value.credentialType === 'MILESTONE' || value.credentialType === 'FINAL')
    && typeof value.credentialTitle === 'string'
    && Array.isArray(value.blockers) && value.blockers.every(isBlocker)
    && (value.latestReview === null || (isRecord(value.latestReview)
      && typeof value.latestReview.id === 'string'
      && (value.latestReview.decision === 'APPROVED' || value.latestReview.decision === 'REJECTED')
      && typeof value.latestReview.comments === 'string'
      && typeof value.latestReview.reviewed_at === 'string'));
}

function isEligibilityReview(value: unknown): value is EligibilityReview {
  return isRecord(value)
    && ['id', 'learner_id', 'learner_name', 'learner_reference', 'enrolment_id', 'programme_id',
      'programme_name', 'credential_key', 'credential_title', 'comments', 'reviewed_at', 'qa_name']
      .every((key) => typeof value[key] === 'string')
    && (value.credential_type === 'MILESTONE' || value.credential_type === 'FINAL')
    && (value.decision === 'APPROVED' || value.decision === 'REJECTED')
    && Array.isArray(value.blockers) && value.blockers.every(isBlocker)
    && (typeof value.authorization_id === 'string' || value.authorization_id === null)
    && (value.authorization_decision === 'APPROVED' || value.authorization_decision === 'REJECTED' || value.authorization_decision === null)
    && (typeof value.authorization_comments === 'string' || value.authorization_comments === null)
    && (typeof value.decided_at === 'string' || value.decided_at === null);
}

function isCertificate(value: unknown): value is CertificateRecord {
  return isRecord(value)
    && ['id', 'credential_key', 'certificate_title', 'programme_id', 'programme_name',
      'verification_reference', 'issued_at', 'issuer_name', 'issuer_title']
      .every((key) => typeof value[key] === 'string')
    && (value.certificate_type === 'MILESTONE' || value.certificate_type === 'FINAL')
    && ['ISSUED', 'REVOKED', 'SUPERSEDED'].includes(String(value.status))
    && typeof value.file_size === 'number';
}

function isProviderCertificateStatus(value: unknown): value is ProviderCertificateStatus {
  return isRecord(value)
    && ['enrolmentId', 'learnerId', 'learnerName', 'learnerReference', 'credentialKey', 'credentialTitle']
      .every((key) => typeof value[key] === 'string')
    && (value.credentialType === 'MILESTONE' || value.credentialType === 'FINAL')
    && Array.isArray(value.blockers) && value.blockers.every(isBlocker)
    && (value.qaDecision === 'APPROVED' || value.qaDecision === 'REJECTED' || value.qaDecision === null)
    && (typeof value.qaReviewedAt === 'string' || value.qaReviewedAt === null)
    && (value.certificate === null || (isRecord(value.certificate)
      && typeof value.certificate.id === 'string'
      && typeof value.certificate.verification_reference === 'string'
      && ['ISSUED', 'REVOKED', 'SUPERSEDED'].includes(String(value.certificate.status))
      && typeof value.certificate.issued_at === 'string'
      && (typeof value.certificate.revoked_at === 'string' || value.certificate.revoked_at === null)));
}

function authOptions(token: string) {
  return { token, authMode: Platform.OS === 'web' ? 'cookie' as const : undefined };
}

export async function listProviderCertificateConfigurations(token: string, programmeId: string) {
  const payload = await requestApi(`/api/programmes/${encodeURIComponent(programmeId)}/eligibility-configurations`, authOptions(token));
  if (!isRecord(payload) || !Array.isArray(payload.configurations) || !payload.configurations.every(isConfiguration)) {
    throw new Error('The API returned an unexpected certificate rule history.');
  }
  return payload.configurations;
}

export async function listProviderCertificateStatus(token: string, programmeId: string) {
  const payload = await requestApi(`/api/programmes/${encodeURIComponent(programmeId)}/certificate-status`, authOptions(token));
  if (!isRecord(payload)
    || !(payload.configuration === null || (isRecord(payload.configuration)
      && typeof payload.configuration.id === 'string' && typeof payload.configuration.version === 'number'))
    || !Array.isArray(payload.eligibility) || !payload.eligibility.every(isProviderCertificateStatus)) {
    throw new Error('The API returned unexpected certificate eligibility status.');
  }
  return payload as unknown as { configuration: { id: string; version: number } | null; eligibility: ProviderCertificateStatus[] };
}

export async function createProviderCertificateConfiguration(token: string, programmeId: string, criteria: CertificateCriteria) {
  const payload = await requestApi(`/api/programmes/${encodeURIComponent(programmeId)}/eligibility-configurations`, {
    ...authOptions(token), method: 'POST', body: { criteria },
  });
  if (!isRecord(payload) || !isConfiguration(payload.configuration)) throw new Error('The API returned an unexpected certificate rule version.');
  return payload.configuration;
}

export async function submitProviderCertificateConfiguration(token: string, programmeId: string, configurationId: string) {
  const payload = await requestApi(`/api/programmes/${encodeURIComponent(programmeId)}/eligibility-configurations/${encodeURIComponent(configurationId)}/submit`, {
    ...authOptions(token), method: 'POST', body: {},
  });
  if (!isRecord(payload) || !isRecord(payload.configuration) || typeof payload.configuration.id !== 'string') {
    throw new Error('The API returned an unexpected certificate rule submission.');
  }
  return payload.configuration;
}

export async function listAdminCertificateConfigurations(token: string, status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const payload = await requestApi(`/api/admin/eligibility-configurations${query}`, authOptions(token));
  if (!isRecord(payload) || !Array.isArray(payload.configurations) || !payload.configurations.every(isConfiguration)) {
    throw new Error('The API returned an unexpected certificate rule list.');
  }
  return payload.configurations;
}

export async function decideAdminCertificateConfiguration(token: string, id: string, decision: 'approve' | 'reject', reason?: string) {
  const payload = await requestApi(`/api/admin/eligibility-configurations/${encodeURIComponent(id)}/${decision}`, {
    ...authOptions(token), method: 'POST', body: decision === 'reject' ? { reason } : {},
  });
  if (!isRecord(payload) || !isRecord(payload.configuration) || typeof payload.configuration.id !== 'string') {
    throw new Error('The API returned an unexpected certificate rule decision.');
  }
  return payload.configuration;
}

export async function getQaCertificateEligibility(token: string, programmeId: string): Promise<QaEligibilityDashboard> {
  const payload = await requestApi(`/api/qa/certification/eligibility?programmeId=${encodeURIComponent(programmeId)}`, authOptions(token));
  if (!isRecord(payload)
    || !(payload.configuration === null || (isRecord(payload.configuration)
      && typeof payload.configuration.id === 'string' && typeof payload.configuration.version === 'number'))
    || !Array.isArray(payload.reviews) || !payload.reviews.every(isQaEligibilityItem)) {
    throw new Error('The API returned unexpected certificate eligibility reviews.');
  }
  return payload as unknown as QaEligibilityDashboard;
}

export async function recordQaCertificateEligibility(token: string, values: {
  enrolmentId: string;
  credentialKey: string;
  decision: CertificateDecision;
  comments: string;
}) {
  const payload = await requestApi('/api/qa/certification/eligibility-reviews', {
    ...authOptions(token), method: 'POST', body: values,
  });
  if (!isRecord(payload) || !isRecord(payload.review) || typeof payload.review.id !== 'string') {
    throw new Error('The API returned an unexpected QA eligibility record.');
  }
  return payload.review;
}

export async function listAdminEligibilityReviews(token: string, decision?: CertificateDecision) {
  const query = decision ? `?decision=${decision}` : '';
  const payload = await requestApi(`/api/admin/eligibility-reviews${query}`, authOptions(token));
  if (!isRecord(payload) || !Array.isArray(payload.reviews) || !payload.reviews.every(isEligibilityReview)) {
    throw new Error('The API returned an unexpected eligibility review list.');
  }
  return payload.reviews;
}

export async function decideAdminEligibility(token: string, reviewId: string, values: {
  decision: CertificateDecision;
  comments?: string;
  supersedesCertificateId?: string;
}) {
  const payload = await requestApi(`/api/admin/eligibility-reviews/${encodeURIComponent(reviewId)}/decision`, {
    ...authOptions(token), method: 'POST', body: values,
  });
  if (!isRecord(payload) || !isRecord(payload.authorization)) {
    throw new Error('The API returned an unexpected certificate authorization.');
  }
  return payload;
}

export async function listAdminCertificates(token: string, status?: CertificateRecord['status']) {
  const query = status ? `?status=${status}` : '';
  const payload = await requestApi(`/api/admin/certificates${query}`, authOptions(token));
  if (!isRecord(payload) || !Array.isArray(payload.certificates) || !payload.certificates.every(isCertificate)) {
    throw new Error('The API returned an unexpected certificate list.');
  }
  return payload.certificates;
}

export async function revokeCertificate(token: string, certificateId: string, reason: string) {
  const payload = await requestApi(`/api/admin/certificates/${encodeURIComponent(certificateId)}/revoke`, {
    ...authOptions(token), method: 'POST', body: { reason },
  });
  if (!isRecord(payload) || !isRecord(payload.certificate) || typeof payload.certificate.id !== 'string') {
    throw new Error('The API returned an unexpected certificate revocation.');
  }
  return payload.certificate;
}

export async function verifyCertificate(reference: string): Promise<CertificateVerification> {
  const payload = await requestApi(`/api/certificates/verify/${encodeURIComponent(reference)}`);
  if (!isRecord(payload)
    || typeof payload.valid !== 'boolean'
    || !['ISSUED', 'REVOKED', 'SUPERSEDED'].includes(String(payload.status))
    || typeof payload.verificationReference !== 'string'
    || (payload.certificateType !== 'MILESTONE' && payload.certificateType !== 'FINAL')
    || typeof payload.certificateTitle !== 'string'
    || typeof payload.programmeName !== 'string'
    || typeof payload.issuedAt !== 'string'
    || Object.hasOwn(payload, 'learnerName')
    || Object.hasOwn(payload, 'learnerEmail')) {
    throw new Error('The certificate verification service returned an unexpected response.');
  }
  return payload as unknown as CertificateVerification;
}

export async function listLearnerCertificates(token: string): Promise<CertificateRecord[]> {
  const payload = await requestApi('/api/learner/certificates', authOptions(token));
  if (!isRecord(payload) || !Array.isArray(payload.certificates) || !payload.certificates.every(isCertificate)) {
    throw new Error('The API returned an unexpected learner certificate history.');
  }
  return payload.certificates;
}

export async function downloadLearnerCertificate(token: string, certificateId: string) {
  return downloadPrivateFile(`/api/learner/certificates/${encodeURIComponent(certificateId)}/file`, token);
}
