import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  AssessorOnly,
  DashboardHero,
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  routeHref,
  SummaryCard,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  AssessorProgramme,
  AssessorSubmission,
  listAssignedProgrammes,
  listProgrammeSubmissions,
} from '@/services/assessor-reviews';

export default function AssessorDashboardScreen() {
  return <AssessorOnly><AssessorDashboard /></AssessorOnly>;
}

function AssessorDashboard() {
  const { credential, user } = useAuth();
  const router = useRouter();
  const [programmes, setProgrammes] = useState<AssessorProgramme[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = useState<AssessorSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your assessor session is unavailable. Sign in again and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const assignedProgrammes = await listAssignedProgrammes(credential);
      const programmeQueues = await Promise.all(
        assignedProgrammes.map((programme) =>
          listProgrammeSubmissions(credential, programme.id, 'SUBMITTED')),
      );
      setProgrammes(assignedProgrammes);
      setPendingSubmissions(
        programmeQueues.flat().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
      );
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const totals = programmes.reduce((summary, programme) => ({
    pending: summary.pending + programme.pending_reviews,
    approved: summary.approved + programme.approved_count,
    corrections: summary.corrections + programme.correction_count,
  }), { pending: 0, approved: 0, corrections: 0 });

  return (
    <Page>
      <DashboardHero
        eyebrow="ASSESSMENT"
        title={`Welcome, ${user?.fullName ?? 'assessor'}`}
        subtitle="Review evidence and follow decisions across your assigned programmes."
        symbol={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
      />
      {loading ? <LoadingNotice label="Loading assigned programmes..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && programmes.length > 0 ? (
        <View className="gap-3">
          <Text className="text-base font-extrabold text-ink">Review overview</Text>
          <View className="flex-row flex-wrap gap-3">
            <SummaryCard
              label="Pending reviews"
              value={totals.pending}
              detail="Evidence awaiting your decision"
              symbol={{ ios: 'tray.full.fill', android: 'inbox', web: 'inbox' }}
              tone="amber"
            />
            <SummaryCard
              label="Approved"
              value={totals.approved}
              detail="Recorded assessment outcomes"
              symbol={{ ios: 'checkmark.circle.fill', android: 'task_alt', web: 'task_alt' }}
              tone="sage"
            />
            <SummaryCard
              label="Corrections requested"
              value={totals.corrections}
              detail="Returned for provider follow-up"
              symbol={{ ios: 'arrow.uturn.backward.circle.fill', android: 'assignment_return', web: 'assignment_return' }}
              tone={totals.corrections ? 'amber' : 'plain'}
            />
          </View>
        </View>
      ) : null}
      {!loading && !error && programmes.length > 0 ? (
        <View className="gap-3">
          <Text className="text-base font-bold text-ink">Evidence waiting for review</Text>
          {pendingSubmissions.length === 0 ? (
            <EmptyNotice title="No submissions waiting" message="New evidence from your assigned programmes will appear here." />
          ) : pendingSubmissions.map((submission) => (
            <Pressable
              key={submission.id}
              accessibilityRole="button"
              accessibilityLabel={`Review ${submission.requirement_title}, version ${submission.version}, for ${submission.learner_name}`}
              className="gap-3 rounded-2xl border border-l-4 border-border border-l-amber-400 bg-white p-5 shadow-sm shadow-primary/5 active:opacity-90"
              onPress={() => router.push(routeHref(`/assessor/submissions/${submission.id}`))}>
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 text-base font-bold text-ink">{submission.learner_name}</Text>
                <View className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1">
                  <Text className="text-[10px] font-extrabold text-amber-900">Needs review</Text>
                </View>
              </View>
              <Text className="text-sm text-muted">{submission.programme_name} · {submission.requirement_title}</Text>
              <Text className="text-xs text-muted">
                Version {submission.version} · {submission.original_filename} · {new Date(submission.created_at).toLocaleString()}
              </Text>
              <Text className="text-sm font-bold text-primary">Review evidence ›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!loading && !error && programmes.length === 0 ? (
        <EmptyNotice title="No programmes assigned" message="An administrator must assign you to a programme before its evidence is available." />
      ) : null}
      {!loading && !error && programmes.length > 0 ? (
        <View className="gap-3">
          <Text className="text-base font-extrabold text-ink">Assigned programmes</Text>
          {[...programmes].sort((a, b) => b.pending_reviews - a.pending_reviews).map((programme) => (
            <Pressable
              key={programme.id}
              accessibilityRole="button"
              className="gap-4 rounded-2xl border border-l-4 border-border border-l-primary bg-white p-5 shadow-sm shadow-primary/5 active:opacity-90"
              onPress={() => router.push(routeHref(`/assessor/programmes/${programme.id}`))}>
              <View className="flex-row items-start justify-between gap-4">
                <Text className="flex-1 text-lg font-bold text-ink">{programme.name}</Text>
                <Text className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold text-amber-900">
                  {programme.pending_reviews} pending
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-4 rounded-xl bg-[#F0F7F1] px-4 py-3">
                <InlineMetric label="Learners" value={programme.learner_count} />
                <InlineMetric label="Approved" value={programme.approved_count} />
                <InlineMetric label="Corrections" value={programme.correction_count} warning={programme.correction_count > 0} />
              </View>
              <Text className="text-sm font-bold text-primary">Open programme reviews ›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Page>
  );
}

function InlineMetric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return (
    <View className="min-w-[72px] flex-1 gap-1">
      <Text className={`text-lg font-extrabold ${warning ? 'text-amber-900' : 'text-ink'}`}>{value}</Text>
      <Text className="text-[10px] font-bold text-muted">{label}</Text>
    </View>
  );
}
