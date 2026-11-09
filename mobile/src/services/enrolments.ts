import { isRecord, requestApi } from '@/services/api';

export type Enrolment = {
  id: string;
  learner_id: string;
  programme_id: string;
  status: 'active' | 'withdrawn';
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  learner_reference: string;
  learner_name: string;
  programme_name: string;
};

function isEnrolment(value: unknown): value is Enrolment {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.learner_id === 'string'
    && typeof value.programme_id === 'string'
    && (value.status === 'active' || value.status === 'withdrawn')
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && typeof value.created_by === 'string'
    && typeof value.updated_by === 'string'
    && typeof value.learner_reference === 'string'
    && typeof value.learner_name === 'string'
    && typeof value.programme_name === 'string';
}

export async function listEnrolments(
  token: string,
  { learnerId, programmeId, status = 'active' }: {
    learnerId?: string;
    programmeId?: string;
    status?: 'active' | 'withdrawn' | 'all';
  } = {},
): Promise<{ enrolments: Enrolment[]; total: number }> {
  const query = new URLSearchParams({ status, limit: '100', offset: '0' });
  if (learnerId) query.set('learnerId', learnerId);
  if (programmeId) query.set('programmeId', programmeId);
  const payload = await requestApi(`/api/enrolments?${query}`, { token });
  if (!isRecord(payload) || !Array.isArray(payload.enrolments)
    || !payload.enrolments.every(isEnrolment) || typeof payload.total !== 'number') {
    throw new Error('The API returned an unexpected enrolment list.');
  }
  return { enrolments: payload.enrolments, total: payload.total };
}

export async function getEnrolment(token: string, id: string): Promise<Enrolment> {
  const payload = await requestApi(`/api/enrolments/${encodeURIComponent(id)}`, { token });
  if (!isRecord(payload) || !isEnrolment(payload.enrolment)) {
    throw new Error('The API returned an unexpected enrolment.');
  }
  return payload.enrolment;
}

export async function createEnrolment(
  token: string,
  values: { learnerId: string; programmeId: string },
): Promise<Enrolment> {
  const payload = await requestApi('/api/enrolments', { method: 'POST', token, body: values });
  if (!isRecord(payload) || !isEnrolment(payload.enrolment)) {
    throw new Error('The API returned an unexpected enrolment.');
  }
  return payload.enrolment;
}

export async function updateEnrolmentStatus(
  token: string,
  id: string,
  status: 'active' | 'withdrawn',
): Promise<Enrolment> {
  const payload = await requestApi(`/api/enrolments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    body: { status },
  });
  if (!isRecord(payload) || !isEnrolment(payload.enrolment)) {
    throw new Error('The API returned an unexpected enrolment.');
  }
  return payload.enrolment;
}
