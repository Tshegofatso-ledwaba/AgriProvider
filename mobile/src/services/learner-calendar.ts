import { Platform } from 'react-native';

import { isRecord, requestApi } from '@/services/api';

export type LearnerCalendarSession = {
  id: string;
  programme_id: string;
  programme_name: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  venue: string | null;
  attendance_status: 'present' | 'absent' | 'excused' | null;
};

export type LearnerCalendarAssessment = {
  id: string;
  programme_id: string;
  programme_name: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  assessor_name: string;
  is_individual: boolean;
};

export type LearnerCalendar = {
  range: { from: string; to: string };
  sessions: LearnerCalendarSession[];
  assessments: LearnerCalendarAssessment[];
};

function isSession(value: unknown): value is LearnerCalendarSession {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.programme_id === 'string'
    && typeof value.programme_name === 'string'
    && typeof value.title === 'string'
    && typeof value.starts_at === 'string'
    && (typeof value.ends_at === 'string' || value.ends_at === null || value.ends_at === undefined)
    && (typeof value.venue === 'string' || value.venue === null || value.venue === undefined)
    && (value.attendance_status === null
      || value.attendance_status === 'present'
      || value.attendance_status === 'absent'
      || value.attendance_status === 'excused');
}

function isAssessment(value: unknown): value is LearnerCalendarAssessment {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.programme_id === 'string'
    && typeof value.programme_name === 'string'
    && typeof value.title === 'string'
    && typeof value.starts_at === 'string'
    && (typeof value.ends_at === 'string' || value.ends_at === null || value.ends_at === undefined)
    && (typeof value.location === 'string' || value.location === null)
    && ['SCHEDULED', 'COMPLETED', 'CANCELLED'].includes(String(value.status))
    && typeof value.assessor_name === 'string'
    && typeof value.is_individual === 'boolean';
}

function isLearnerCalendar(value: unknown): value is LearnerCalendar {
  return isRecord(value)
    && isRecord(value.range)
    && typeof value.range.from === 'string'
    && typeof value.range.to === 'string'
    && Array.isArray(value.sessions)
    && value.sessions.every(isSession)
    && Array.isArray(value.assessments)
    && value.assessments.every(isAssessment);
}

export async function getLearnerCalendar(
  credential: string,
  from: string,
  to: string,
): Promise<LearnerCalendar> {
  const query = new URLSearchParams({ from, to });
  const payload = await requestApi(`/api/learner/calendar?${query.toString()}`, {
    token: credential,
    authMode: Platform.OS === 'web' ? 'cookie' : undefined,
  });
  if (!isLearnerCalendar(payload)) {
    throw new Error('The learner timetable returned an unexpected response.');
  }
  return {
    ...payload,
    sessions: payload.sessions.map((session) => ({
      ...session,
      ends_at: session.ends_at ?? null,
      venue: session.venue ?? null,
    })),
    assessments: payload.assessments.map((assessment) => ({
      ...assessment,
      ends_at: assessment.ends_at ?? null,
    })),
  };
}