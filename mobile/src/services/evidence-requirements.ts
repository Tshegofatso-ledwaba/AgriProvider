import { isRecord, requestApi } from '@/services/api';

export type EvidenceRequirement = {
  id: string;
  programme_id: string;
  title: string;
  guidance: string | null;
  created_at: string;
  updated_at: string;
};

function isEvidenceRequirement(value: unknown): value is EvidenceRequirement {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.programme_id === 'string'
    && typeof value.title === 'string'
    && (typeof value.guidance === 'string' || value.guidance === null)
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string';
}

function requirementPath(programmeId: string, requirementId?: string) {
  const base = `/api/programmes/${encodeURIComponent(programmeId)}/evidence-requirements`;
  return requirementId ? `${base}/${encodeURIComponent(requirementId)}` : base;
}

export async function listEvidenceRequirements(
  token: string,
  programmeId: string,
): Promise<EvidenceRequirement[]> {
  const payload = await requestApi(requirementPath(programmeId), { token });
  if (!isRecord(payload) || !Array.isArray(payload.requirements)
    || !payload.requirements.every(isEvidenceRequirement)) {
    throw new Error('The API returned an unexpected checklist.');
  }
  return payload.requirements;
}

export async function createEvidenceRequirement(
  token: string,
  programmeId: string,
  values: { title: string; guidance: string | null },
): Promise<EvidenceRequirement> {
  const payload = await requestApi(requirementPath(programmeId), {
    method: 'POST',
    token,
    body: values,
  });
  if (!isRecord(payload) || !isEvidenceRequirement(payload.requirement)) {
    throw new Error('The API returned an unexpected checklist item.');
  }
  return payload.requirement;
}

export async function updateEvidenceRequirement(
  token: string,
  programmeId: string,
  requirementId: string,
  values: { title: string; guidance: string | null },
): Promise<EvidenceRequirement> {
  const payload = await requestApi(requirementPath(programmeId, requirementId), {
    method: 'PATCH',
    token,
    body: values,
  });
  if (!isRecord(payload) || !isEvidenceRequirement(payload.requirement)) {
    throw new Error('The API returned an unexpected checklist item.');
  }
  return payload.requirement;
}

export async function archiveEvidenceRequirement(
  token: string,
  programmeId: string,
  requirementId: string,
): Promise<void> {
  await requestApi(requirementPath(programmeId, requirementId), {
    method: 'DELETE',
    token,
  });
}
