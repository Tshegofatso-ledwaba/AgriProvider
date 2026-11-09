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
import { archiveProgramme, getProgramme, Programme } from '@/services/programmes';

export default function ProgrammeDetailsScreen() {
  return (
    <ProviderOnly>
      <ProgrammeDetails />
    </ProviderOnly>
  );
}

function ProgrammeDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { credential } = useAuth();
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadProgramme = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Programme details are unavailable. Return to the programme list and try again.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [programmeRecord, enrolmentResult] = await Promise.all([
        getProgramme(credential, id),
        listEnrolments(credential, { programmeId: id, status: 'all' }),
      ]);
      setProgramme(programmeRecord);
      setEnrolments(enrolmentResult.enrolments);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => {
    void loadProgramme();
  }, [loadProgramme]));

  const archive = async () => {
    if (!credential || !id) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await archiveProgramme(credential, id);
      router.replace(routeHref('/programmes'));
    } catch (requestError) {
      setError(apiErrorText(requestError));
      setBusy(false);
    }
  };

  const confirmArchive = () => {
    Alert.alert('Archive programme?', 'It will be removed from your active programme list.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void archive() },
    ]);
  };

  return (
    <Page>
      {loading ? <LoadingNotice label="Loading programme..." /> : null}
      {!loading && error && !programme ? (
        <ErrorNotice message={error} onRetry={() => void loadProgramme()} />
      ) : null}
      {!loading && programme ? (
        <>
          <PageTitle title={programme.name} subtitle="Programme details" />
          <View className="gap-3 rounded-2xl border border-border bg-white p-5">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted">Description</Text>
            <Text className="text-base leading-6 text-ink">
              {programme.description || 'No description added.'}
            </Text>
          </View>
          <View className="gap-3 rounded-2xl border border-border bg-white p-5">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-base font-bold text-ink">Enrolled learners</Text>
              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(routeHref(`/enrolments/new?programmeId=${programme.id}`))}>
                  <Text className="text-sm font-bold text-primary">Enrol learner</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(routeHref(`/sessions?programmeId=${programme.id}`))}>
                  <Text className="text-sm font-bold text-primary">Sessions</Text>
                </Pressable>
              </View>
            </View>
            {enrolments.length === 0 ? (
              <Text className="text-sm text-muted">No learner enrolments recorded.</Text>
            ) : enrolments.map((enrolment) => (
              <Pressable
                key={enrolment.id}
                accessibilityRole="button"
                className="gap-1 rounded-xl bg-surface p-3"
                onPress={() => router.push(routeHref(`/enrolments/${enrolment.id}`))}>
                <Text className="font-bold text-ink">{enrolment.learner_name}</Text>
                <Text className="text-xs text-muted">{enrolment.learner_reference} · {enrolment.status}</Text>
              </Pressable>
            ))}
          </View>
          <ActionButton
            label="Manage evidence checklist"
            onPress={() => router.push(routeHref(`/programmes/${programme.id}/evidence-requirements`))}
            variant="secondary"
          />
          {error ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
          <ActionButton
            label="Edit programme"
            onPress={() => router.push(routeHref(`/programmes/${programme.id}/edit`))}
          />
          <ActionButton label="Archive programme" onPress={confirmArchive} variant="danger" disabled={busy} />
        </>
      ) : null}
    </Page>
  );
}
