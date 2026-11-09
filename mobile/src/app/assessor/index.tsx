import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  AssessorOnly,
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  routeHref,
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
      <PageTitle title="Assessment workspace" subtitle={`Evidence review queue for ${user?.fullName ?? 'assessor'}.`} />
      {loading ? <LoadingNotice label="Loading assigned programmes..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
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
              className="gap-2 rounded-[20px] border border-border bg-white p-4 shadow-sm shadow-black/5"
              onPress={() => router.push(routeHref(`/assessor/submissions/${submission.id}`))}>
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 text-base font-bold text-ink">{submission.learner_name}</Text>
                <Text className="text-xs font-extrabold text-primary">NEEDS REVIEW</Text>
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
      {!loading && !error && programmes.length > 0 ? (
        <View className="gap-3">
          <Text className="text-base font-bold text-ink">Review overview</Text>
          <View className="flex-row flex-wrap gap-3">
            <MetricCard label="Pending reviews" count={totals.pending} />
            <MetricCard label="Approved" count={totals.approved} />
            <MetricCard label="Corrections requested" count={totals.corrections} />
          </View>
        </View>
      ) : null}
      {!loading && !error && programmes.length === 0 ? (
        <EmptyNotice title="No programmes assigned" message="An administrator must assign you to a programme before its evidence is available." />
      ) : null}
      <View className="gap-3">
        {[...programmes].sort((a, b) => b.pending_reviews - a.pending_reviews).map((programme) => (
          <Pressable
            key={programme.id}
            accessibilityRole="button"
            className="gap-4 rounded-[24px] border border-border bg-white p-4 shadow-sm shadow-black/5"
            onPress={() => router.push(routeHref(`/assessor/programmes/${programme.id}`))}>
            <View className="flex-row items-start justify-between gap-4">
              <Text className="flex-1 text-lg font-bold text-ink">{programme.name}</Text>
              <Text className="text-[10px] font-extrabold tracking-[0.16em] text-primary">{programme.pending_reviews} PENDING</Text>
            </View>
            <View className="flex-row flex-wrap gap-3">
              <MetricCard label="Learners" count={programme.learner_count} />
              <MetricCard label="Approved" count={programme.approved_count} />
              <MetricCard label="Corrections" count={programme.correction_count} />
            </View>
            <Text className="text-sm font-bold text-primary">Open programme reviews ›</Text>
          </Pressable>
        ))}
      </View>
    </Page>
  );
}

function MetricCard({ label, count }: { label: string; count: number }) {
  return (
    <View className="min-w-[120px] flex-1 rounded-2xl border border-border bg-white px-4 py-3">
      <Text className="text-2xl font-extrabold text-ink">{count}</Text>
      <Text className="text-xs text-muted">{label}</Text>
    </View>
  );
}