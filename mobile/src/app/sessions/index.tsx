import { useCallback, useState } from 'react';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  ProviderOnly,
  routeHref,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { listSessions, TrainingSession } from '@/services/sessions';

export default function SessionsScreen() {
  return <ProviderOnly><SessionList /></ProviderOnly>;
}

function SessionList() {
  const { programmeId } = useLocalSearchParams<{ programmeId?: string }>();
  const { credential } = useAuth();
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again to view training sessions.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setSessions(await listSessions(credential, programmeId));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, programmeId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Page>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <PageTitle
            title="Training sessions"
            subtitle={programmeId ? 'Sessions for the selected programme.' : 'Schedule sessions and record attendance for enrolled learners.'}
          />
        </View>
        <Link href={routeHref('/sessions/new')} asChild>
          <Pressable accessibilityRole="button" className="rounded-xl bg-primary px-4 py-3">
            <Text className="text-sm font-bold text-white">Schedule</Text>
          </Pressable>
        </Link>
      </View>
      {loading ? <LoadingNotice label="Loading training sessions..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && sessions.length === 0 ? (
        <EmptyNotice
          title="No sessions scheduled"
          message="Create a session for one of your programmes to start recording attendance."
          action={
            <Link href={routeHref('/sessions/new')} asChild>
              <Pressable accessibilityRole="button" className="mt-2 rounded-xl bg-primary px-5 py-3">
                <Text className="text-sm font-bold text-white">Schedule a session</Text>
              </Pressable>
            </Link>
          }
        />
      ) : null}
      {!loading && !error && sessions.map((session) => (
        <Link key={session.id} href={routeHref(`/sessions/${session.id}`)} asChild>
          <Pressable accessibilityRole="button" className="gap-2 rounded-2xl border border-border bg-white p-5 active:opacity-80">
            <Text className="text-lg font-bold text-ink">{session.title}</Text>
            <Text className="text-sm font-semibold text-primary">{session.programme_name}</Text>
            <Text className="text-sm text-muted">{new Date(session.starts_at).toLocaleString()}</Text>
            <Text className="text-xs text-muted">
              {session.marked_count} of {session.enrolled_count} enrolled learners marked
            </Text>
          </Pressable>
        </Link>
      ))}
    </Page>
  );
}
