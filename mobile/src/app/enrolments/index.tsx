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
      {!loading && !error ? (
        <View className="flex-row flex-wrap gap-3">
          {enrolments.map((enrolment) => (
            <Link key={enrolment.id} href={routeHref(`/enrolments/${enrolment.id}`)} asChild>
              <Pressable accessibilityRole="button" className="min-w-[260px] flex-1 gap-3 rounded-2xl border border-l-4 border-border border-l-emerald-600 bg-white p-5 shadow-sm shadow-primary/5 active:opacity-90">
                <View className="gap-1">
                  <Text className="text-[10px] font-extrabold text-muted">ACTIVE ENROLMENT</Text>
                  <Text className="text-lg font-extrabold text-ink">{enrolment.learner_name}</Text>
                  <Text className="text-xs text-muted">{enrolment.learner_reference}</Text>
                </View>
                <View className="border-t border-border pt-3">
                  <Text className="text-sm font-semibold text-primary">{enrolment.programme_name}</Text>
                  <Text className="mt-2 text-xs font-bold text-primary">View enrolment ›</Text>
                </View>
              </Pressable>
            </Link>
          ))}
        </View>
      ) : null}
    </Page>
  );
}
