import { isRecord, requestApi } from '@/services/api';

export type FindingStatus = 'OPEN' | 'RESPONSE_SUBMITTED' | 'VERIFIED' | 'CLOSED';
export type FindingFilter = 'all' | 'OVERDUE' | FindingStatus;
export type FindingOptionKind = 'CATEGORY' | 'SEVERITY';

export type QaFinding = {
  id: string;
  status: FindingStatus;
  finding: string;
  corrective_action: string;
  due_date: string | null;
  is_overdue: boolean;
  created_at: string;
  updated_at: string;
  provider_response: string | null;
  responded_at: string | null;
  verification_comments: string | null;
  verified_at: string | null;
  closure_comments: string | null;
  closed_at: string | null;
  programme_id: string;
  programme_name: string;
  provider_user_id: string;
  provider_name: string;
  qa_user_id: string;
  qa_name: string;
  qa_review_id: string;
  qa_decision: string;
  submission_id: string;
  submission_version: number;
  requirement_title: string;
  learner_name: string;
  learner_reference: string;
  category_option_id: string | null;
  category_label: string | null;
  severity_option_id: string | null;
  severity_label: string | null;
};

export type QaFindingEvent = {
  id: string;
  event_type: 'FINDING_CREATED' | 'PROVIDER_RESPONSE_SUBMITTED' | 'RESPONSE_RETURNED' | 'FINDING_VERIFIED' | 'FINDING_CLOSED';
  actor_role: 'qa' | 'provider';
  actor_name: string;
  comments: string | null;
  created_at: string;
};

export type FindingSummary = {
  total: number;
  open: number;
  response_submitted: number;
  verified: number;
  closed: number;
  overdue: number;
};

export type FindingList = {
  findings: QaFinding[];
  summary: FindingSummary;
  total: number;
  limit: number;
  offset: number;
};

export type FindingDetail = { finding: QaFinding; events: QaFindingEvent[] };

export type FindingOption = { id: string; kind: FindingOptionKind; label: string };

export type ManagedFindingOption = FindingOption & {
  is_active: boolean;
  created_at: string;
  updated_at: string;
  usage_count: number;
};

const findingStatuses = new Set(['OPEN', 'RESPONSE_SUBMITTED', 'VERIFIED', 'CLOSED']);
const eventTypes = new Set([
  'FINDING_CREATED', 'PROVIDER_RESPONSE_SUBMITTED', 'RESPONSE_RETURNED', 'FINDING_VERIFIED', 'FINDING_CLOSED',
]);

const nullableString = (value: unknown) => typeof value === 'string' || value === null;
const hasStrings = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof value[key] === 'string');

function isFinding(value: unknown): value is QaFinding {
  return isRecord(value)
    && hasStrings(value, [
      'id', 'finding', 'corrective_action', 'created_at', 'updated_at', 'programme_id', 'programme_name',
      'provider_user_id', 'provider_name', 'qa_user_id', 'qa_name', 'qa_review_id', 'qa_decision',
      'submission_id', 'requirement_title', 'learner_name', 'learner_reference',
    ])
    && findingStatuses.has(value.status as string)
    && typeof value.is_overdue === 'boolean'
    && typeof value.submission_version === 'number'
    && [
      'due_date', 'provider_response', 'responded_at', 'verification_comments', 'verified_at',
      'closure_comments', 'closed_at', 'category_option_id', 'category_label', 'severity_option_id', 'severity_label',
    ].every((key) => nullableString(value[key]));
}

function isEvent(value: unknown): value is QaFindingEvent {
  return isRecord(value)
    && hasStrings(value, ['id', 'actor_name', 'created_at'])
    && eventTypes.has(value.event_type as string)
    && (value.actor_role === 'qa' || value.actor_role === 'provider')
    && nullableString(value.comments);
}

function isOption(value: unknown): value is FindingOption {
  return isRecord(value)
    && hasStrings(value, ['id', 'label'])
    && (value.kind === 'CATEGORY' || value.kind === 'SEVERITY');
}

function isManagedOption(value: unknown): value is ManagedFindingOption {
  if (!isOption(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return typeof record.is_active === 'boolean'
    && typeof record.usage_count === 'number'
    && hasStrings(record, ['created_at', 'updated_at']);
}

function parseList(payload: unknown): FindingList {
  if (!isRecord(payload) || !Array.isArray(payload.findings) || !payload.findings.every(isFinding)
    || !isRecord(payload.summary) || typeof payload.total !== 'number'
    || typeof payload.limit !== 'number' || typeof payload.offset !== 'number') {
    throw new Error('The API returned an unexpected corrective-action list.');
  }
  const summary = payload.summary;
  if (['total', 'open', 'response_submitted', 'verified', 'closed', 'overdue'].some((key) => typeof summary[key] !== 'number')) {
    throw new Error('The API returned an unexpected corrective-action summary.');
  }
  return payload as unknown as FindingList;
}

function parseDetail(payload: unknown): FindingDetail {
  if (!isRecord(payload) || !isFinding(payload.finding) || !Array.isArray(payload.events) || !payload.events.every(isEvent)) {
    throw new Error('The API returned an unexpected corrective-action record.');
  }
  return { finding: payload.finding, events: payload.events };
}

function listQuery(filters: { status?: FindingFilter; programmeId?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.programmeId) params.set('programmeId', filters.programmeId);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  return params.toString() ? `?${params.toString()}` : '';
}

const id = (value: string) => encodeURIComponent(value);

// QA Officer
export async function listQaFindings(token: string, filters: { status?: FindingFilter; programmeId?: string } = {}) {
  return parseList(await requestApi(`/api/qa/findings${listQuery(filters)}`, { token }));
}

export async function getQaFinding(token: string, findingId: string) {
  return parseDetail(await requestApi(`/api/qa/findings/${id(findingId)}`, { token }));
}

export async function listActiveFindingOptions(token: string): Promise<FindingOption[]> {
  const payload = await requestApi('/api/qa/findings/options', { token });
  if (!isRecord(payload) || !Array.isArray(payload.options) || !payload.options.every(isOption)) {
    throw new Error('The API returned unexpected finding options.');
  }
  return payload.options;
}

export async function createQaFinding(
  token: string,
  values: {
    qaReviewId: string;
    finding: string;
    correctiveAction: string;
    categoryId: string | null;
    severityId: string | null;
    dueDate: string | null;
  },
) {
  return parseDetail(await requestApi('/api/qa/findings', { method: 'POST', token, body: values }));
}

export async function transitionQaFinding(
  token: string,
  findingId: string,
  action: 'verify' | 'return' | 'close',
  comments: string,
) {
  return parseDetail(await requestApi(`/api/qa/findings/${id(findingId)}/${action}`, {
    method: 'POST', token, body: { comments },
  }));
}

// Provider
export async function listProviderFindings(token: string, filters: { status?: FindingFilter } = {}) {
  return parseList(await requestApi(`/api/provider/qa-findings${listQuery(filters)}`, { token }));
}

export async function getProviderFinding(token: string, findingId: string) {
  return parseDetail(await requestApi(`/api/provider/qa-findings/${id(findingId)}`, { token }));
}

export async function respondToFinding(token: string, findingId: string, response: string) {
  return parseDetail(await requestApi(`/api/provider/qa-findings/${id(findingId)}/response`, {
    method: 'POST', token, body: { response },
  }));
}

// Administrator
export async function listManagedFindingOptions(token: string): Promise<ManagedFindingOption[]> {
  const payload = await requestApi('/api/admin/qa-finding-options', { token });
  if (!isRecord(payload) || !Array.isArray(payload.options) || !payload.options.every(isManagedOption)) {
    throw new Error('The API returned unexpected finding options.');
  }
  return payload.options;
}

export async function createFindingOption(token: string, kind: FindingOptionKind, label: string) {
  const payload = await requestApi('/api/admin/qa-finding-options', { method: 'POST', token, body: { kind, label } });
  if (!isRecord(payload) || !isManagedOption(payload.option)) throw new Error('The API returned an unexpected option.');
  return payload.option;
}

export async function updateFindingOption(token: string, optionId: string, values: { label?: string; isActive?: boolean }) {
  const payload = await requestApi(`/api/admin/qa-finding-options/${id(optionId)}`, { method: 'PATCH', token, body: values });
  if (!isRecord(payload) || !isManagedOption(payload.option)) throw new Error('The API returned an unexpected option.');
  return payload.option;
}

export const findingStatusLabels: Record<FindingStatus, string> = {
  OPEN: 'Open',
  RESPONSE_SUBMITTED: 'Response submitted',
  VERIFIED: 'Verified',
  CLOSED: 'Closed',
};

export const findingEventLabels: Record<QaFindingEvent['event_type'], string> = {
  FINDING_CREATED: 'Finding recorded',
  PROVIDER_RESPONSE_SUBMITTED: 'Provider response submitted',
  RESPONSE_RETURNED: 'Response returned for further action',
  FINDING_VERIFIED: 'Corrective action verified',
  FINDING_CLOSED: 'Finding closed',
};
