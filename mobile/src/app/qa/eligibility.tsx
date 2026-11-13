import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  QaOnly,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { getQaDashboard } from '@/services/qa';
import {
  getQaCertificateEligibility,
  QaEligibilityDashboard,
  QaEligibilityItem,
  recordQaCertificateEligibility,
} from '@/services/certificates';

export default function QaEligibilityScreen() {
  return <QaOnly><QaEligibilityQueue /></QaOnly>;
}

function QaEligibilityQueue() {
  const { credential } = useAuth();
  const [dashboard, setDashboard] = useState<QaEligibilityDashboard | null>(null);
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your QA session is unavailable. Sign in again to review eligibility.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const scope = await getQaDashboard(credential, { limit: 1 });
      const programmeList = scope.programmes.map(({ id, name }) => ({ id, name }));
      setProgrammes(programmeList);
      const target = programmeList.find((programme) => programme.id === programmeId) ?? programmeList[0];
      if (!target) {
        setProgrammeId('');
        setDashboard(null);
        return;
      }
      setProgrammeId(target.id);
      setDashboard(await getQaCertificateEligibility(credential, target.id));
    } catch (requestError) {
      setDashboard(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, programmeId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const decide = async (item: QaEligibilityItem, decision: 'APPROVED' | 'REJECTED') => {
    if (!credential || busyKey) return;
    const key = `${item.enrolmentId}:${item.credentialKey}`;
    const note = comments[key]?.trim() ?? '';
    if (!note) {
      setError('Add a QA comment before recording the eligibility decision.');
      return;
    }
    setBusyKey(key);
    setError('');
    setSuccess('');
    try {
      await recordQaCertificateEligibility(credential, {
        enrolmentId: item.enrolmentId,
        credentialKey: item.credentialKey,
        decision,
        comments: note,
      });
      setSuccess(`${item.credentialTitle}: QA ${decision === 'APPROVED' ? 'eligibility approved' : 'eligibility rejected'}.`);
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setBusyKey('');
    }
  };

  return (
    <Page onRefresh={() => void load()} refreshing={loading}>
      <PageTitle title="Certificate eligibility" subtitle="Verify configured milestone or final-completion conditions before QA approval." />
      {programmes.length > 1 ? (
        <View className="flex-row flex-wrap gap-2">
          {programmes.map((programme) => (
            <Pressable
              key={programme.id}
              accessibilityRole="button"
              accessibilityState={{ selected: programme.id === programmeId }}
              className={`min-h-10 justify-center rounded-full border px-3 py-2 ${programme.id === programmeId ? 'border-primary bg-selected' : 'border-border bg-white'}`}
              onPress={() => setProgrammeId(programme.id)}>
              <Text className={`text-xs font-bold ${programme.id === programmeId ? 'text-primary' : 'text-muted'}`}>{programme.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {loading ? <LoadingNotice label="Loading assigned programme eligibility..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && !programmes.length ? (
        <EmptyNotice title="No QA programme access" message="An Administrator must assign your QA Officer account to a programme before you can review certificate eligibility." />
      ) : null}
      {!loading && !error && dashboard?.configuration === null ? (
        <EmptyNotice title="No approved certificate rules" message="A Provider must submit explicit certificate conditions and an Administrator must approve a rule version before QA eligibility can be reviewed." />
      ) : null}
      {!loading && !error && dashboard?.configuration && dashboard.reviews.length === 0 ? (
        <EmptyNotice title="No active learner enrolments" message="Eligibility review cards appear for active learner enrolments in this programme." />
      ) : null}
      {!loading && !error && dashboard?.configuration ? (
        <View className="gap-3">
          <Text className="text-xs font-bold text-muted">APPROVED RULE VERSION {dashboard.configuration.version}</Text>
          {dashboard.reviews.map((item) => {
            const key = `${item.enrolmentId}:${item.credentialKey}`;
            return (
              <View key={key} className="gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm shadow-primary/5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-base font-extrabold text-ink">{item.credentialTitle}</Text>
                    <Text className="text-sm text-muted">{item.learnerName} · {item.learnerReference}</Text>
                    <Text className="text-xs font-bold text-primary">{item.credentialType === 'FINAL' ? 'Final certificate' : 'Milestone certificate'}</Text>
                  </View>
                  {item.latestReview ? (
                    <Text className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${item.latestReview.decision === 'APPROVED' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                      QA {item.latestReview.decision.toLowerCase()}
                    </Text>
                  ) : null}
                </View>
                {item.blockers.length ? (
                  <View className="gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <Text className="text-xs font-extrabold text-amber-900">Outstanding conditions</Text>
                    {item.blockers.map((blocker, index) => <Text key={`${blocker.code}-${index}`} className="text-xs leading-4 text-amber-900">• {blocker.message}</Text>)}
                  </View>
                ) : (
                  <Text className="text-sm font-bold text-emerald-800">All configured conditions are currently satisfied.</Text>
                )}
                <TextInput
                  accessibilityLabel={`QA comment for ${item.credentialTitle}, ${item.learnerName}`}
                  className="min-h-20 rounded-xl border border-border bg-surface px-3 py-3 text-sm text-ink"
                  value={comments[key] ?? ''}
                  onChangeText={(value) => setComments((current) => ({ ...current, [key]: value }))}
                  multiline
                  textAlignVertical="top"
                  placeholder="Record the QA review decision and notes"
                />
                <View className="flex-row flex-wrap gap-2">
                  {!item.blockers.length ? (
                    <View className="min-w-[150px] flex-1">
                      <ActionButton label={busyKey === key ? 'Saving...' : 'Approve eligibility'} onPress={() => void decide(item, 'APPROVED')} disabled={Boolean(busyKey)} />
                    </View>
                  ) : null}
                  <View className="min-w-[120px] flex-1">
                    <ActionButton label={busyKey === key ? 'Saving...' : 'Reject eligibility'} onPress={() => void decide(item, 'REJECTED')} disabled={Boolean(busyKey)} variant="secondary" />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
    </Page>
  );
}
