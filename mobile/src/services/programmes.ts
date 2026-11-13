import { isRecord, requestApi } from '@/services/api';

export type Programme = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type ProgrammeProgress = {
  programme_id: string;
  active_enrolments: number;
  withdrawn_enrolments: number;
  active_sessions: number;
  attendance_recorded: number;
  attendance_present: number;
  attendance_absent: number;
  attendance_excused: number;
  evidence_requirements: number;
  evidence_slots: number;
  evidence_not_submitted: number;
  evidence_submitted: number;
  evidence_awaiting_review: number;
  evidence_approved: number;
  evidence_correction_required: number;
};

function isProgramme(value: unknown): value is Programme {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && (typeof value.description === 'string' || value.description === null)
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string';
}

function isProgrammeProgress(value: unknown): value is ProgrammeProgress {
  return isRecord(value)
    && typeof value.programme_id === 'string'
    && [
      'active_enrolments',
      'withdrawn_enrolments',
      'active_sessions',
      'attendance_recorded',
      'attendance_present',
      'attendance_absent',
      'attendance_excused',
      'evidence_requirements',
      'evidence_slots',
      'evidence_not_submitted',
      'evidence_submitted',
      'evidence_awaiting_review',
      'evidence_approved',
      'evidence_correction_required',
    ].every((key) => typeof value[key] === 'number');
}

export async function listProgrammes(token: string): Promise<Programme[]> {
  const payload = await requestApi('/api/programmes', { token });
  if (!isRecord(payload) || !Array.isArray(payload.programmes) || !payload.programmes.every(isProgramme)) {
    throw new Error('The API returned an unexpected programme list.');
  }
  return payload.programmes;
}

export async function getProgramme(token: string, id: string): Promise<Programme> {
  const payload = await requestApi(`/api/programmes/${encodeURIComponent(id)}`, { token });
  if (!isRecord(payload) || !isProgramme(payload.programme)) {
    throw new Error('The API returned an unexpected programme.');
  }
  return payload.programme;
}

export async function getProgrammeProgress(token: string, id: string): Promise<ProgrammeProgress> {
  const payload = await requestApi(`/api/programmes/${encodeURIComponent(id)}/progress`, { token });
  if (!isRecord(payload) || !isProgrammeProgress(payload.progress)) {
    throw new Error('The API returned an unexpected programme activity summary.');
  }
  return payload.progress;
}

export async function createProgramme(
  token: string,
  values: { name: string; description: string | null },
): Promise<Programme> {
  const payload = await requestApi('/api/programmes', {
    method: 'POST',
    token,
    body: values,
  });
  if (!isRecord(payload) || !isProgramme(payload.programme)) {
    throw new Error('The API returned an unexpected programme.');
  }
  return payload.programme;
}

export async function updateProgramme(
  token: string,
  id: string,
  values: { name: string; description: string | null },
): Promise<Programme> {
  const payload = await requestApi(`/api/programmes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    body: values,
  });
  if (!isRecord(payload) || !isProgramme(payload.programme)) {
    throw new Error('The API returned an unexpected programme.');
  }
  return payload.programme;
}

export async function archiveProgramme(token: string, id: string): Promise<void> {
  await requestApi(`/api/programmes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
  });
}
