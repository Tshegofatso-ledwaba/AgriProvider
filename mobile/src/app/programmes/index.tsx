import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
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
import { listProgrammes, Programme } from '@/services/programmes';

export default function ProgrammesScreen() {
  return (
    <ProviderOnly>
      <ProgrammeList />
    </ProviderOnly>
  );
}

function ProgrammeList() {
  const { credential } = useAuth();
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadProgrammes = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again to view programmes.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      setProgrammes(await listProgrammes(credential));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => {
    void loadProgrammes();
  }, [loadProgrammes]));

  return (
    <Page>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <PageTitle title="Programmes" subtitle="Manage the programmes owned by your provider account." />
        </View>
        <Link href={routeHref('/programmes/new')} asChild>
          <Pressable accessibilityRole="button" className="rounded-xl bg-primary px-4 py-3">
            <Text className="text-sm font-bold text-white">Add new</Text>
          </Pressable>
        </Link>
      </View>

      {loading ? <LoadingNotice label="Loading your programmes..." /> : null}
      {!loading && error ? (
        <ErrorNotice message={error} onRetry={() => void loadProgrammes()} />
      ) : null}
      {!loading && !error && programmes.length === 0 ? (
        <EmptyNotice
          title="No programmes yet"
          message="Create your first programme to start organising your provider's training."
          action={
            <Link href={routeHref('/programmes/new')} asChild>
              <Pressable accessibilityRole="button" className="mt-2 rounded-xl bg-primary px-5 py-3">
                <Text className="text-sm font-bold text-white">Create a programme</Text>
              </Pressable>
            </Link>
          }
        />
      ) : null}
      {!loading && !error ? (
        <View className="flex-row flex-wrap gap-3">
          {programmes.map((programme) => (
            <Link key={programme.id} href={routeHref(`/programmes/${programme.id}`)} asChild>
              <Pressable
                accessibilityRole="button"
                className="min-w-[260px] flex-1 gap-3 rounded-2xl border border-l-4 border-border border-l-primary bg-white p-5 shadow-sm shadow-primary/5 active:opacity-90">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="flex-1 text-lg font-extrabold text-ink">{programme.name}</Text>
                  <Text className="rounded-full bg-selected px-2.5 py-1 text-[10px] font-bold text-primary">Programme</Text>
                </View>
                <Text className="text-sm leading-5 text-muted" numberOfLines={3}>
                  {programme.description || 'No description added.'}
                </Text>
                <Text className="text-xs font-bold text-primary">View details ›</Text>
              </Pressable>
            </Link>
          ))}
        </View>
      ) : null}
    </Page>
  );
}
