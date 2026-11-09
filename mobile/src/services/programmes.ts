import { isRecord, requestApi } from '@/services/api';

export type Programme = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

function isProgramme(value: unknown): value is Programme {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && (typeof value.description === 'string' || value.description === null)
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string';
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
