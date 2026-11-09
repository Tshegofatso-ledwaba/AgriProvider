import { isRecord, requestApi } from '@/services/api';

export type AvailableAssessor = {
  id: string;
  full_name: string;
  email: string;
};

export type AssignableProgramme = {
  id: string;
  name: string;
  provider_user_id: string;
  provider_name: string;
};

export type AssessorAssignment = {
  id: string;
  programme_id: string;
  programme_name?: string;
  assessor_user_id: string;
  assessor_name?: string;
  assessor_email?: string;
  created_by: string;
  created_by_name?: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
};

function isAssessor(value: unknown): value is AvailableAssessor {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.full_name === 'string'
    && typeof value.email === 'string';
}

function isProgramme(value: unknown): value is AssignableProgramme {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.provider_user_id === 'string'
    && typeof value.provider_name === 'string';
}

function isAssignment(value: unknown): value is AssessorAssignment {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.programme_id === 'string'
    && typeof value.assessor_user_id === 'string'
    && typeof value.created_by === 'string'
    && (value.status === 'ACTIVE' || value.status === 'INACTIVE')
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && (typeof value.deactivated_at === 'string' || value.deactivated_at === null);
}

export async function listAvailableAssessors(token: string): Promise<AvailableAssessor[]> {
  const payload = await requestApi('/api/admin/assessors', { token });
  if (!isRecord(payload) || !Array.isArray(payload.assessors) || !payload.assessors.every(isAssessor)) {
    throw new Error('The API returned an unexpected assessor list.');
  }
  return payload.assessors;
}

export async function listAssignableProgrammes(token: string): Promise<AssignableProgramme[]> {
  const payload = await requestApi('/api/admin/programmes', { token });
  if (!isRecord(payload) || !Array.isArray(payload.programmes) || !payload.programmes.every(isProgramme)) {
    throw new Error('The API returned an unexpected programme list.');
  }
  return payload.programmes;
}

export async function listAssessorAssignments(token: string): Promise<AssessorAssignment[]> {
  const payload = await requestApi('/api/admin/assessor-assignments', { token });
  if (!isRecord(payload) || !Array.isArray(payload.assignments) || !payload.assignments.every(isAssignment)) {
    throw new Error('The API returned unexpected assessor assignments.');
  }
  return payload.assignments;
}

export async function createAssessorAssignment(
  token: string,
  programmeId: string,
  assessorUserId: string,
): Promise<AssessorAssignment> {
  const payload = await requestApi('/api/admin/assessor-assignments', {
    method: 'POST',
    token,
    body: { programmeId, assessorUserId },
  });
  if (!isRecord(payload) || !isAssignment(payload.assignment)) {
    throw new Error('The API returned an unexpected assessor assignment.');
  }
  return payload.assignment;
}

export async function updateAssessorAssignment(
  token: string,
  assignmentId: string,
  update: { status: AssessorAssignment['status'] } | { assessorUserId: string },
): Promise<AssessorAssignment> {
  const payload = await requestApi(`/api/admin/assessor-assignments/${encodeURIComponent(assignmentId)}`, {
    method: 'PATCH',
    token,
    body: update,
  });
  if (!isRecord(payload) || !isAssignment(payload.assignment)) {
    throw new Error('The API returned an unexpected assessor assignment.');
  }
  return payload.assignment;
}