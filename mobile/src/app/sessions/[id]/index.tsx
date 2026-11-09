import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';

import {
  ActionButton,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  ProviderOnly,
  routeHref,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  archiveSession,
  AttendanceRegister,
  AttendanceStatus,
  getAttendance,
  getSession,
  saveAttendance,
  SessionDetails,
} from '@/services/sessions';

const attendanceOptions: AttendanceStatus[] = ['present', 'absent', 'excused'];

export default function SessionDetailsScreen() {
  return <ProviderOnly><SessionDetailsPage /></ProviderOnly>;
}

function SessionDetailsPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { credential } = useAuth();
  const [session, setSession] = useState<SessionDetails | null>(null);
  const [register, setRegister] = useState<AttendanceRegister | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Session details are unavailable. Return to the session list and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [sessionDetail, attendance] = await Promise.all([
        getSession(credential, id),
        getAttendance(credential, id),
      ]);
      setSession(sessionDetail);
      setRegister(attendance);
      setStatuses(Object.fromEntries(attendance.records.map((record) => [
        record.enrolment_id,
        record.status,
      ])));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const submitAttendance = async () => {
    if (!credential || !id || !register) {
      setError('Attendance could not be saved because the session is unavailable.');
      return;
    }
    const records = Object.entries(statuses)
      .filter((entry): entry is [string, AttendanceStatus] => entry[1] !== null)
      .map(([enrolmentId, status]) => ({ enrolmentId, status }));
    if (records.length === 0) {
      setError('Choose an attendance status for at least one learner.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await saveAttendance(credential, id, records);
      setSuccess('Attendance saved.');
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!credential || !id) return;
    setSaving(true);
    setError('');
    try {
      await archiveSession(credential, id);
      router.replace(routeHref('/sessions'));
    } catch (requestError) {
      setError(apiErrorText(requestError));
      setSaving(false);
    }
  };

  const confirmArchive = () => Alert.alert(
    'Archive session?',
    'The session will be hidden from active lists. Previously recorded attendance will remain in the database.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void archive() },
    ],
  );

  if (loading) return <Page><LoadingNotice label="Loading session and attendance..." /></Page>;
  if (error && (!session || !register)) {
    return <Page><ErrorNotice message={error} onRetry={() => void load()} /></Page>;
  }
  if (!session || !register) return null;

  return (
    <Page>
      <PageTitle title={session.title} subtitle={`${session.programme_name} · ${new Date(session.starts_at).toLocaleString()}`} />
      <View className="flex-row flex-wrap gap-2">
        {attendanceOptions.map((status) => (
          <SummaryPill key={status} label={status} count={register.summary[status]} />
        ))}
        <SummaryPill label="unrecorded" count={register.summary.unrecorded} />
      </View>
      {register.records.length === 0 ? (
        <View className="gap-2 rounded-2xl border border-dashed border-border bg-white p-5">
          <Text className="text-base font-bold text-ink">No active enrolments</Text>
          <Text className="text-sm leading-5 text-muted">
            Enrol learners in this programme before taking attendance.
          </Text>
        </View>
      ) : register.records.map((record) => (
        <View key={record.enrolment_id} className="gap-3 rounded-2xl border border-border bg-white p-4">
          <View className="gap-1">
            <Text className="font-bold text-ink">{record.learner_name}</Text>
            <Text className="text-xs text-muted">{record.learner_reference}</Text>
            {record.marked_at ? (
              <Text className="text-xs text-muted">Last recorded {new Date(record.marked_at).toLocaleString()}</Text>
            ) : null}
          </View>
          <View className="flex-row flex-wrap gap-2">
            {attendanceOptions.map((status) => (
              <Pressable
                key={status}
                accessibilityRole="button"
                accessibilityState={{ selected: statuses[record.enrolment_id] === status }}
                className={`rounded-full px-3 py-2 ${
                  statuses[record.enrolment_id] === status ? 'bg-primary' : 'bg-selected'
                }`}
                onPress={() => setStatuses((current) => ({ ...current, [record.enrolment_id]: status }))}>
                <Text className={`text-xs font-bold capitalize ${
                  statuses[record.enrolment_id] === status ? 'text-white' : 'text-primary'
                }`}>{status}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {error ? <Text className="text-sm leading-5 text-danger" accessibilityRole="alert">{error}</Text> : null}
      {success ? <Text className="text-sm font-semibold text-primary" accessibilityRole="alert">{success}</Text> : null}
      {register.records.length > 0 ? (
        <ActionButton
          label={saving ? 'Saving attendance...' : 'Save attendance'}
          onPress={() => void submitAttendance()}
          disabled={saving}
        />
      ) : null}
      <ActionButton
        label="Edit session"
        onPress={() => router.push(routeHref(`/sessions/${session.id}/edit`))}
        disabled={saving}
        variant="secondary"
      />
      <ActionButton label="Archive session" onPress={confirmArchive} disabled={saving} variant="danger" />
    </Page>
  );
}

function SummaryPill({ label, count }: { label: string; count: number }) {
  return (
    <View className="flex-row items-center gap-2 rounded-full bg-selected px-3 py-2">
      <Text className="text-xs font-bold capitalize text-primary">{label}</Text>
      <Text className="text-xs font-extrabold text-ink">{count}</Text>
    </View>
  );
}
