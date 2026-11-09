import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  ActionButton,
  ErrorNotice,
  LoadingNotice,
  navigateBack,
  Page,
  PageTitle,
  routeHref,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { createEnrolment } from '@/services/enrolments';
import { Learner, listLearners } from '@/services/learners';
import { listProgrammes, Programme } from '@/services/programmes';

export function EnrolmentEditor() {
  const { learnerId, programmeId } = useLocalSearchParams<{ learnerId?: string; programmeId?: string }>();
  const router = useRouter();
  const { credential } = useAuth();
  const [learners, setLearners] = useState<Learner[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [selectedLearner, setSelectedLearner] = useState(learnerId ?? '');
  const [selectedProgramme, setSelectedProgramme] = useState(programmeId ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadOptions = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again to create an enrolment.');
      return;
    }
    try {
      const [learnerResult, programmeResult] = await Promise.all([
        listLearners(credential, { limit: 100 }),
        listProgrammes(credential),
      ]);
      setLearners(learnerResult.learners);
      setProgrammes(programmeResult);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => {
    void loadOptions();
  }, [loadOptions]));

  const retry = async () => {
    setLoading(true);
    setError('');
    await loadOptions();
  };

  const submit = async () => {
    setError('');
    if (!selectedLearner || !selectedProgramme) {
      setError('Select both a learner and a programme.');
      return;
    }
    if (!credential) {
      setError('Your session is unavailable. Sign in again and retry.');
      return;
    }
    setSaving(true);
    try {
      const enrolment = await createEnrolment(credential, {
        learnerId: selectedLearner,
        programmeId: selectedProgramme,
      });
      router.replace(routeHref(`/enrolments/${enrolment.id}`));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Page><LoadingNotice label="Loading learners and programmes..." /></Page>;
  if (error && !learners.length && !programmes.length) {
    return <Page><ErrorNotice message={error} onRetry={() => void retry()} /></Page>;
  }

  return (
    <Page>
      <PageTitle title="Enrol a learner" subtitle="Connect an active learner to one of your active programmes." />
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">Choose a learner</Text>
        {learners.length === 0 ? (
          <Text className="text-sm text-muted">Register a learner before creating an enrolment.</Text>
        ) : learners.map((learner) => (
          <Pressable
            key={learner.id}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedLearner === learner.id }}
            className={`gap-1 rounded-xl border p-4 ${
              selectedLearner === learner.id ? 'border-primary bg-selected' : 'border-border bg-white'
            }`}
            onPress={() => setSelectedLearner(learner.id)}>
            <Text className="font-bold text-ink">{learner.full_name}</Text>
            <Text className="text-xs text-muted">{learner.learner_reference}</Text>
          </Pressable>
        ))}
      </View>
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">Choose a programme</Text>
        {programmes.length === 0 ? (
          <Text className="text-sm text-muted">Create a programme before enrolling a learner.</Text>
        ) : programmes.map((programme) => (
          <Pressable
            key={programme.id}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedProgramme === programme.id }}
            className={`rounded-xl border p-4 ${
              selectedProgramme === programme.id ? 'border-primary bg-selected' : 'border-border bg-white'
            }`}
            onPress={() => setSelectedProgramme(programme.id)}>
            <Text className="font-bold text-ink">{programme.name}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text className="text-sm leading-5 text-danger" accessibilityRole="alert">{error}</Text> : null}
      <ActionButton
        label={saving ? 'Enrolling...' : 'Create enrolment'}
        onPress={() => void submit()}
        disabled={saving || !learners.length || !programmes.length}
      />
      <ActionButton
        label="Cancel"
        onPress={() => navigateBack(
          router,
          learnerId
            ? `/learners/${encodeURIComponent(learnerId)}`
            : programmeId
              ? `/programmes/${encodeURIComponent(programmeId)}`
              : '/enrolments',
        )}
        disabled={saving}
        variant="secondary"
      />
    </Page>
  );
}
