import { isRecord, requestApi } from '@/services/api';

export type TrainingSession = {
  id: string;
  programme_id: string;
  title: string;
  starts_at: string;
  created_at: string;
  programme_name: string;
  enrolled_count: number;
  marked_count: number;
};

export type SessionDetails = {
  id: string;
  programme_id: string;
  title: string;
  starts_at: string;
  created_at: string;
  programme_name: string;
};

export type AttendanceStatus = 'present' | 'absent' | 'excused';

export type AttendanceRecord = {
  enrolment_id: string;
  learner_id: string;
  learner_reference: string;
  learner_name: string;
  status: AttendanceStatus | null;
  marked_by: string | null;
  marked_at: string | null;
};

export type AttendanceRegister = {
  session: {
    id: string;
    programme_id: string;
    title: string;
    starts_at: string;
    created_at: string;
  };
  records: AttendanceRecord[];
  summary: { present: number; absent: number; excused: number; unrecorded: number };
};

function isSession(value: unknown): value is TrainingSession {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.programme_id === 'string'
    && typeof value.title === 'string'
    && typeof value.starts_at === 'string'
    && typeof value.created_at === 'string'
    && typeof value.programme_name === 'string'
    && typeof value.enrolled_count === 'number'
    && typeof value.marked_count === 'number';
}

function isAttendanceRecord(value: unknown): value is AttendanceRecord {
  return isRecord(value)
    && typeof value.enrolment_id === 'string'
    && typeof value.learner_id === 'string'
    && typeof value.learner_reference === 'string'
    && typeof value.learner_name === 'string'
    && (value.status === null || value.status === 'present' || value.status === 'absent' || value.status === 'excused')
    && (typeof value.marked_by === 'string' || value.marked_by === null)
    && (typeof value.marked_at === 'string' || value.marked_at === null);
}

export async function listSessions(token: string, programmeId?: string): Promise<TrainingSession[]> {
  const query = programmeId ? `?programmeId=${encodeURIComponent(programmeId)}` : '';
  const payload = await requestApi(`/api/sessions${query}`, { token });
  if (!isRecord(payload) || !Array.isArray(payload.sessions) || !payload.sessions.every(isSession)) {
    throw new Error('The API returned an unexpected session list.');
  }
  return payload.sessions;
}

export async function getSession(token: string, id: string): Promise<SessionDetails> {
  const payload = await requestApi(`/api/sessions/${encodeURIComponent(id)}`, { token });
  if (!isRecord(payload) || !isRecord(payload.session)
    || typeof payload.session.id !== 'string'
    || typeof payload.session.programme_id !== 'string'
    || typeof payload.session.title !== 'string'
    || typeof payload.session.starts_at !== 'string'
    || typeof payload.session.programme_name !== 'string') {
    throw new Error('The API returned an unexpected session.');
  }
  return {
    id: payload.session.id,
    programme_id: payload.session.programme_id,
    title: payload.session.title,
    starts_at: payload.session.starts_at,
    created_at: typeof payload.session.created_at === 'string' ? payload.session.created_at : '',
    programme_name: payload.session.programme_name,
  };
}

export async function createSession(
  token: string,
  values: { programmeId: string; title: string; startsAt: string },
): Promise<{ id: string }> {
  const payload = await requestApi('/api/sessions', { method: 'POST', token, body: values });
  if (!isRecord(payload) || !isRecord(payload.session) || typeof payload.session.id !== 'string') {
    throw new Error('The API returned an unexpected session.');
  }
  return { id: payload.session.id };
}

export async function updateSession(
  token: string,
  id: string,
  values: { title: string; startsAt: string },
): Promise<void> {
  await requestApi(`/api/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: values });
}

export async function archiveSession(token: string, id: string): Promise<void> {
  await requestApi(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', token });
}

export async function getAttendance(token: string, id: string): Promise<AttendanceRegister> {
  const payload = await requestApi(`/api/sessions/${encodeURIComponent(id)}/attendance`, { token });
  if (!isRecord(payload) || !isRecord(payload.session) || !Array.isArray(payload.records)
    || !payload.records.every(isAttendanceRecord) || !isRecord(payload.summary)) {
    throw new Error('The API returned an unexpected attendance register.');
  }
  const { summary } = payload;
  if (typeof summary.present !== 'number' || typeof summary.absent !== 'number'
    || typeof summary.excused !== 'number' || typeof summary.unrecorded !== 'number') {
    throw new Error('The API returned an unexpected attendance summary.');
  }
  if (
    typeof payload.session.id !== 'string'
    || typeof payload.session.programme_id !== 'string'
    || typeof payload.session.title !== 'string'
    || typeof payload.session.starts_at !== 'string'
    || typeof payload.session.created_at !== 'string'
  ) {
    throw new Error('The API returned an unexpected session in the attendance register.');
  }
  return {
    session: {
      id: payload.session.id,
      programme_id: payload.session.programme_id,
      title: payload.session.title,
      starts_at: payload.session.starts_at,
      created_at: payload.session.created_at,
    },
    records: payload.records,
    summary: {
      present: summary.present,
      absent: summary.absent,
      excused: summary.excused,
      unrecorded: summary.unrecorded,
    },
  };
}

export async function saveAttendance(
  token: string,
  id: string,
  records: { enrolmentId: string; status: AttendanceStatus }[],
): Promise<void> {
  await requestApi(`/api/sessions/${encodeURIComponent(id)}/attendance`, {
    method: 'PUT',
    token,
    body: { records },
  });
}
