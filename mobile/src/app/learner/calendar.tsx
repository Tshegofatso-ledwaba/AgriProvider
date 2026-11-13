import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  LearnerOnly,
  Page,
  PageTitle,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  getLearnerCalendar,
  LearnerCalendar,
  LearnerCalendarAssessment,
  LearnerCalendarSession,
} from '@/services/learner-calendar';

export default function LearnerCalendarScreen() {
  return (
    <LearnerOnly>
      <LearnerTimetable />
    </LearnerOnly>
  );
}

function LearnerTimetable() {
  const { credential } = useAuth();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [calendar, setCalendar] = useState<LearnerCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your learner session is unavailable. Sign in again to view your timetable.');
      return;
    }
    const from = startOfMonth(month);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    setLoading(true);
    setError('');
    try {
      setCalendar(await getLearnerCalendar(credential, from.toISOString(), to.toISOString()));
    } catch (requestError) {
      setCalendar(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, month]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const items = calendar ? [
    ...calendar.sessions.map((session) => ({ kind: 'session' as const, key: `session-${session.id}`, item: session })),
    ...calendar.assessments.map((assessment) => ({ kind: 'assessment' as const, key: `assessment-${assessment.id}`, item: assessment })),
  ].sort((left, right) => Date.parse(left.item.starts_at) - Date.parse(right.item.starts_at)) : [];

  return (
    <Page onRefresh={() => void load()} refreshing={loading}>
      <PageTitle title="Training timetable" subtitle="Your scheduled training sessions and assessments." />
      <View className="flex-row items-center justify-between gap-2 rounded-2xl border border-border bg-white p-3 shadow-sm shadow-primary/5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          className="min-h-10 min-w-10 items-center justify-center rounded-xl bg-surface active:opacity-70"
          onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>
          <Text className="text-xl font-bold text-primary">‹</Text>
        </Pressable>
        <Text className="flex-1 text-center text-base font-extrabold text-ink">
          {month.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to current month"
          className="min-h-10 justify-center rounded-xl px-3 active:opacity-70"
          onPress={() => setMonth(startOfMonth(new Date()))}>
          <Text className="text-xs font-bold text-primary">Today</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          className="min-h-10 min-w-10 items-center justify-center rounded-xl bg-surface active:opacity-70"
          onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>
          <Text className="text-xl font-bold text-primary">›</Text>
        </Pressable>
      </View>

      {loading ? <LoadingNotice label="Loading your timetable..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyNotice
          title="No activities this month"
          message="Scheduled sessions and assessments for your linked programmes will appear here. Attendance without a recorded provider entry is shown as not recorded, not missed."
        />
      ) : null}
      {!loading && !error && items.length > 0 ? (
        <View className="gap-3">
          {items.map((entry) => entry.kind === 'session'
            ? <SessionCard key={entry.key} session={entry.item} />
            : <AssessmentCard key={entry.key} assessment={entry.item} />)}
        </View>
      ) : null}
    </Page>
  );
}

function SessionCard({ session }: { session: LearnerCalendarSession }) {
  const attendance = session.attendance_status ? capitalize(session.attendance_status) : 'Not recorded';
  return (
    <View className="gap-3 rounded-2xl border border-l-4 border-border border-l-primary bg-white p-5 shadow-sm shadow-primary/5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-[10px] font-extrabold text-primary">TRAINING SESSION</Text>
          <Text className="text-base font-extrabold text-ink">{session.title}</Text>
        </View>
        <StatusLabel label={attendance} tone={session.attendance_status ? 'sage' : 'plain'} />
      </View>
      <Text className="text-sm font-semibold text-primary">{session.programme_name}</Text>
      <Text className="text-sm text-muted">{formatDateTime(session.starts_at)}{session.ends_at ? ` - ${formatTime(session.ends_at)}` : ''}</Text>
      {session.venue ? <Text className="text-xs text-muted">Location · {session.venue}</Text> : null}
    </View>
  );
}

function AssessmentCard({ assessment }: { assessment: LearnerCalendarAssessment }) {
  const status = assessment.status === 'SCHEDULED'
    ? 'Scheduled'
    : assessment.status === 'COMPLETED' ? 'Completed' : 'Cancelled';
  return (
    <View className="gap-3 rounded-2xl border border-l-4 border-border border-l-amber-400 bg-white p-5 shadow-sm shadow-primary/5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-[10px] font-extrabold text-amber-900">ASSESSMENT</Text>
          <Text className="text-base font-extrabold text-ink">{assessment.title}</Text>
        </View>
        <StatusLabel label={status} tone={assessment.status === 'SCHEDULED' ? 'amber' : 'plain'} />
      </View>
      <Text className="text-sm font-semibold text-primary">{assessment.programme_name}</Text>
      <Text className="text-sm text-muted">{formatDateTime(assessment.starts_at)}{assessment.ends_at ? ` - ${formatTime(assessment.ends_at)}` : ''}</Text>
      <Text className="text-xs text-muted">Assessor · {assessment.assessor_name}</Text>
      {assessment.location ? <Text className="text-xs text-muted">Location · {assessment.location}</Text> : null}
    </View>
  );
}

function StatusLabel({ label, tone }: { label: string; tone: 'sage' | 'amber' | 'plain' }) {
  const style = tone === 'sage'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-border bg-surface text-muted';
  return (
    <View className={`rounded-full border px-2.5 py-1 ${style}`}>
      <Text className="text-[10px] font-extrabold">{label}</Text>
    </View>
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}