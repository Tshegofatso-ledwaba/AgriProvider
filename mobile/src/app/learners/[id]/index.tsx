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
import { activateLearnerAccount, archiveLearner, getLearner, Learner } from '@/services/learners';

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
  const [invitation, setInvitation] = useState<{ token: string; expiresAt: string } | null>(null);

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

  const activateAccount = async () => {
    if (!credential || !id || !learner?.email) return;
    setBusy(true);
    setError('');
    try {
      const result = await activateLearnerAccount(credential, id);
      setLearner(result.learner);
      setInvitation(result.invitationToken && result.invitationExpiresAt
        ? { token: result.invitationToken, expiresAt: result.invitationExpiresAt }
        : null);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setBusy(false);
    }
  };

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
            <InfoRow label="Status" value={learner.status === 'active' ? 'Active record' : 'Archived'} />
            <InfoRow
              label="Sign-in access"
              value={learner.account_status === 'active'
                ? 'Linked to learner account'
                : invitation ? 'Setup code issued' : learner.email ? 'Setup available' : 'Email required'}
            />
            <InfoRow label="Registered" value={new Date(learner.created_at).toLocaleDateString()} />
            <InfoRow label="Phone" value={learner.phone || 'Not provided'} />
            <InfoRow label="Email" value={learner.email || 'Not provided'} />
          </View>
          {learner.email && learner.account_status !== 'active' ? (
            <View className="gap-2 rounded-2xl bg-selected p-5">
              <Text className="text-sm font-bold text-primary">Learner account setup</Text>
              <Text className="text-sm leading-5 text-muted">
                Generate a one-time setup code. Share it with the learner through your approved secure channel.
              </Text>
            </View>
          ) : null}
          {invitation ? (
            <View className="gap-2 rounded-2xl border border-primary/20 bg-white p-5">
              <Text className="text-sm font-bold text-ink">One-time learner setup code</Text>
              <Text selectable className="rounded-xl bg-surface p-3 font-mono text-sm text-primary">
                {invitation.token}
              </Text>
              <Text className="text-xs leading-5 text-muted">
                Expires {new Date(invitation.expiresAt).toLocaleString()}. This code can be used once to set the learner password.
              </Text>
            </View>
          ) : null}
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
              {learner.email && learner.account_status !== 'active' ? (
                <ActionButton
                  label={busy ? 'Creating setup code...' : invitation ? 'Create a new setup code' : 'Create learner setup code'}
                  onPress={() => void activateAccount()}
                  disabled={busy}
                />
              ) : null}
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
