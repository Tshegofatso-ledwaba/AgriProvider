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
import { Enrolment, listEnrolments } from '@/services/enrolments';
import { archiveLearner, getLearner, Learner } from '@/services/learners';

export default function LearnerDetailsScreen() {
  return <ProviderOnly><LearnerDetails /></ProviderOnly>;
}

function LearnerDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { credential } = useAuth();
  const [learner, setLearner] = useState<Learner | null>(null);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadLearner = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Learner details are unavailable. Return to the learner list and try again.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [learnerRecord, enrolmentResult] = await Promise.all([
        getLearner(credential, id),
        listEnrolments(credential, { learnerId: id, status: 'all' }),
      ]);
      setLearner(learnerRecord);
      setEnrolments(enrolmentResult.enrolments);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => {
    void loadLearner();
  }, [loadLearner]));

  const archive = async () => {
    if (!credential || !id) return;
    setBusy(true);
    setError('');
    try {
      await archiveLearner(credential, id);
      router.replace(routeHref('/learners'));
    } catch (requestError) {
      setError(apiErrorText(requestError));
      setBusy(false);
    }
  };

  const confirmArchive = () => {
    Alert.alert('Archive learner?', 'The record will be hidden from active learner lists. Historical workflow records will be retained.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void archive() },
    ]);
  };

  return (
    <Page>
      {loading ? <LoadingNotice label="Loading learner..." /> : null}
      {!loading && error && !learner ? <ErrorNotice message={error} onRetry={() => void loadLearner()} /> : null}
      {!loading && learner ? (
        <>
          <PageTitle title={learner.full_name} subtitle={`Learner reference ${learner.learner_reference}`} />
          <View className="gap-3 rounded-2xl border border-border bg-white p-5">
            <InfoRow label="Status" value={learner.status} />
            <InfoRow label="Registered" value={new Date(learner.created_at).toLocaleDateString()} />
            <InfoRow label="Phone" value={learner.phone || 'Not provided'} />
            <InfoRow label="Email" value={learner.email || 'Not provided'} />
          </View>
          <View className="gap-2 rounded-2xl bg-selected p-5">
            <Text className="text-sm font-bold text-primary">Workflow progress</Text>
            <Text className="text-sm leading-5 text-muted">
              Attendance and evidence summaries will appear here as those workflow phases become available.
            </Text>
          </View>
          <View className="gap-3 rounded-2xl border border-border bg-white p-5">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-base font-bold text-ink">Programme enrolments</Text>
              {learner.status === 'active' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(routeHref(`/enrolments/new?learnerId=${learner.id}`))}>
                  <Text className="text-sm font-bold text-primary">Enrol</Text>
                </Pressable>
              ) : null}
            </View>
            {enrolments.length === 0 ? (
              <Text className="text-sm text-muted">No enrolments recorded.</Text>
            ) : enrolments.map((enrolment) => (
              <Pressable
                key={enrolment.id}
                accessibilityRole="button"
                className="gap-1 rounded-xl bg-surface p-3"
                onPress={() => router.push(routeHref(`/enrolments/${enrolment.id}`))}>
                <Text className="font-bold text-ink">{enrolment.programme_name}</Text>
                <Text className="text-xs capitalize text-muted">{enrolment.status}</Text>
              </Pressable>
            ))}
          </View>
          {error ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
          {learner.status === 'active' ? (
            <>
              <ActionButton label="Edit learner" onPress={() => router.push(routeHref(`/learners/${learner.id}/edit`))} />
              <ActionButton label="Archive learner" onPress={confirmArchive} variant="danger" disabled={busy} />
            </>
          ) : (
            <Text className="text-sm text-muted">This record is archived and cannot be edited.</Text>
          )}
        </>
      ) : null}
    </Page>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-sm font-bold text-muted">{label}</Text>
      <Text className="flex-1 text-right text-sm text-ink">{value}</Text>
    </View>
  );
}
