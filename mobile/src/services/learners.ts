import { isRecord, requestApi } from '@/services/api';

export type Learner = {
  id: string;
  learner_reference: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  learner_user_id: string | null;
  account_status: 'active' | 'pending';
  linked_account: {
    id: string;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
  } | null;
  created_at: string;
  updated_at: string;
  status: 'active' | 'archived';
};

function isLearner(value: unknown): value is Learner {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.learner_reference === 'string'
    && typeof value.full_name === 'string'
    && (typeof value.phone === 'string' || value.phone === null)
    && (typeof value.email === 'string' || value.email === null)
    && (typeof value.learner_user_id === 'string' || value.learner_user_id === null)
    && (value.account_status === 'active' || value.account_status === 'pending')
    && (value.linked_account === null || (
      isRecord(value.linked_account)
      && typeof value.linked_account.id === 'string'
      && typeof value.linked_account.email === 'string'
      && typeof value.linked_account.full_name === 'string'
      && typeof value.linked_account.role === 'string'
      && typeof value.linked_account.is_active === 'boolean'
    ))
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && (value.status === 'active' || value.status === 'archived');
}

export async function listLearners(
  token: string,
  { q = '', status = 'active', limit = 50, offset = 0 }: {
    q?: string;
    status?: 'active' | 'archived' | 'all';
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ learners: Learner[]; total: number }> {
  const query = new URLSearchParams({ q, status, limit: String(limit), offset: String(offset) });
  const payload = await requestApi(`/api/learners?${query}`, { token });
  if (
    !isRecord(payload)
    || !Array.isArray(payload.learners)
    || !payload.learners.every(isLearner)
    || typeof payload.total !== 'number'
  ) {
    throw new Error('The API returned an unexpected learner list.');
  }
  return { learners: payload.learners, total: payload.total };
}

export async function getLearner(token: string, id: string): Promise<Learner> {
  const payload = await requestApi(`/api/learners/${encodeURIComponent(id)}`, { token });
  if (!isRecord(payload) || !isLearner(payload.learner)) {
    throw new Error('The API returned an unexpected learner.');
  }
  return payload.learner;
}

export async function createLearner(
  token: string,
  values: { fullName: string; phone: string | null; email: string | null; confirmPossibleDuplicate?: boolean },
): Promise<Learner> {
  const payload = await requestApi('/api/learners', { method: 'POST', token, body: values });
  if (!isRecord(payload) || !isLearner(payload.learner)) {
    throw new Error('The API returned an unexpected learner.');
  }
  return payload.learner;
}

export async function updateLearner(
  token: string,
  id: string,
  values: { fullName: string; phone: string | null; email: string | null; confirmPossibleDuplicate?: boolean },
): Promise<Learner> {
  const payload = await requestApi(`/api/learners/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    body: values,
  });
  if (!isRecord(payload) || !isLearner(payload.learner)) {
    throw new Error('The API returned an unexpected learner.');
  }
  return payload.learner;
}

export async function activateLearnerAccount(
  token: string,
  id: string,
): Promise<{ learner: Learner; invitationToken?: string; invitationExpiresAt?: string }> {
  const payload = await requestApi(`/api/learners/${encodeURIComponent(id)}/activate-account`, {
    method: 'POST',
    token,
  });
  if (!isRecord(payload) || !isLearner(payload.learner)
    || (payload.invitationToken !== undefined && typeof payload.invitationToken !== 'string')
    || (payload.invitationExpiresAt !== undefined && typeof payload.invitationExpiresAt !== 'string')) {
    throw new Error('The API returned an unexpected learner activation response.');
  }
  return {
    learner: payload.learner,
    invitationToken: payload.invitationToken as string | undefined,
    invitationExpiresAt: payload.invitationExpiresAt as string | undefined,
  };
}

export async function archiveLearner(token: string, id: string): Promise<void> {
  await requestApi(`/api/learners/${encodeURIComponent(id)}`, { method: 'DELETE', token });
}
