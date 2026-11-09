import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Text, View } from 'react-native';

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
import { Enrolment, getEnrolment, updateEnrolmentStatus } from '@/services/enrolments';

export default function EnrolmentDetailsScreen() {
  return <ProviderOnly><EnrolmentDetails /></ProviderOnly>;
}

function EnrolmentDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { credential } = useAuth();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Enrolment details are unavailable. Return to the enrolment list and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setEnrolment(await getEnrolment(credential, id));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const changeStatus = async (status: 'active' | 'withdrawn') => {
    if (!credential || !id) return;
    setSaving(true);
    setError('');
    try {
      setEnrolment(await updateEnrolmentStatus(credential, id, status));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const confirmWithdraw = () => Alert.alert(
    'Withdraw enrolment?',
    'The enrolment will remain in history, but the learner will no longer be actively enrolled.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => void changeStatus('withdrawn') },
    ],
  );

  return (
    <Page>
      {loading ? <LoadingNotice label="Loading enrolment..." /> : null}
      {!loading && error && !enrolment ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && enrolment ? (
        <>
          <PageTitle title={enrolment.learner_name} subtitle={enrolment.learner_reference} />
          <View className="gap-3 rounded-2xl border border-border bg-white p-5">
            <DetailRow label="Programme" value={enrolment.programme_name} />
            <DetailRow label="Status" value={enrolment.status} />
            <DetailRow label="Enrolled" value={new Date(enrolment.created_at).toLocaleDateString()} />
            <DetailRow label="Last updated" value={new Date(enrolment.updated_at).toLocaleDateString()} />
          </View>
          <ActionButton
            label="View evidence checklist"
            onPress={() => router.push(routeHref(`/enrolments/${enrolment.id}/evidence`))}
            variant="secondary"
          />
          {error ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
          {enrolment.status === 'active' ? (
            <ActionButton label="Withdraw enrolment" onPress={confirmWithdraw} disabled={saving} variant="danger" />
          ) : (
            <ActionButton label={saving ? 'Reactivating...' : 'Reactivate enrolment'} onPress={() => void changeStatus('active')} disabled={saving} />
          )}
        </>
      ) : null}
    </Page>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-sm font-bold text-muted">{label}</Text>
      <Text className="flex-1 text-right text-sm text-ink">{value}</Text>
    </View>
  );
}
