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
import { Enrolment, listEnrolments } from '@/services/enrolments';

export default function EnrolmentsScreen() {
  return <ProviderOnly><EnrolmentList /></ProviderOnly>;
}

function EnrolmentList() {
  const { credential } = useAuth();
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadEnrolments = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again to view enrolments.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await listEnrolments(credential);
      setEnrolments(result.enrolments);
      setTotal(result.total);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => {
    void loadEnrolments();
  }, [loadEnrolments]));

  return (
    <Page>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <PageTitle title="Enrolments" subtitle="Active learner-programme relationships for your provider account." />
        </View>
        <Link href={routeHref('/enrolments/new')} asChild>
          <Pressable accessibilityRole="button" className="rounded-xl bg-primary px-4 py-3">
            <Text className="text-sm font-bold text-white">Enrol learner</Text>
          </Pressable>
        </Link>
      </View>
      {!loading && !error ? <Text className="text-sm text-muted">{total} active enrolments</Text> : null}
      {loading ? <LoadingNotice label="Loading enrolments..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void loadEnrolments()} /> : null}
      {!loading && !error && enrolments.length === 0 ? (
        <EmptyNotice
          title="No active enrolments"
          message="Enrol an active learner in one of your active programmes to see the relationship here."
          action={
            <Link href={routeHref('/enrolments/new')} asChild>
              <Pressable accessibilityRole="button" className="mt-2 rounded-xl bg-primary px-5 py-3">
                <Text className="text-sm font-bold text-white">Create an enrolment</Text>
              </Pressable>
            </Link>
          }
        />
      ) : null}
      {!loading && !error && enrolments.map((enrolment) => (
        <Link key={enrolment.id} href={routeHref(`/enrolments/${enrolment.id}`)} asChild>
          <Pressable accessibilityRole="button" className="gap-2 rounded-2xl border border-border bg-white p-5 active:opacity-80">
            <Text className="text-lg font-bold text-ink">{enrolment.learner_name}</Text>
            <Text className="text-sm text-muted">{enrolment.learner_reference}</Text>
            <Text className="text-sm font-semibold text-primary">{enrolment.programme_name}</Text>
          </Pressable>
        </Link>
      ))}
    </Page>
  );
}
