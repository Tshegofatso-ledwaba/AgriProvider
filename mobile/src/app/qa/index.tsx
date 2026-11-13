import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  EmptyNotice,
  DashboardHero,
  ErrorNotice,
  LoadingNotice,
  Page,
  QaOnly,
  routeHref,
  SummaryCard,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { getQaDashboard, QaDashboard, QaStatus } from '@/services/qa';

type QaFilter = 'all' | QaStatus;

const filters: { value: QaFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'AWAITING_REVIEW', label: 'Awaiting review' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'FURTHER_ACTION_REQUIRED', label: 'Further action' },
  { value: 'NOT_VERIFIED', label: 'Not verified' },
];

export default function QADashboardScreen() {
  return (
    <QaOnly>
      <QADashboard />
    </QaOnly>
  );
}

function QADashboard() {
  const { credential } = useAuth();
  const [dashboard, setDashboard] = useState<QaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<QaFilter>('AWAITING_REVIEW');
  const [programmeId, setProgrammeId] = useState('');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your QA session is unavailable. Sign in again and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setDashboard(await getQaDashboard(credential, {
        status: filter,
        programmeId: programmeId || undefined,
        q: submittedSearch || undefined,
      }));
    } catch (requestError) {
      setDashboard(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, filter, programmeId, submittedSearch]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Page onRefresh={() => void load()} refreshing={loading}>
      <DashboardHero
        eyebrow="QUALITY ASSURANCE"
        title="Review and verify"
        subtitle="Check assessor decisions within your assigned programme scope."
        symbol={{ ios: 'checkmark.shield.fill', android: 'verified_user', web: 'verified_user' }}
      />
      <Link href={routeHref('/qa/findings')} asChild>
        <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center self-start rounded-xl border border-border bg-white px-4 py-3 active:opacity-80">
          <Text className="text-sm font-bold text-ink">Findings and corrective actions</Text>
        </Pressable>
      </Link>
      <Link href={routeHref('/qa/eligibility')} asChild>
        <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center self-start rounded-xl border border-border bg-white px-4 py-3 active:opacity-80">
          <Text className="text-sm font-bold text-ink">Certificate eligibility reviews</Text>
        </Pressable>
      </Link>
      {dashboard?.scopeConfigured ? (
        <View className="gap-2">
          <Text className="text-xs font-bold uppercase text-muted">Assigned programme scope</Text>
          <View className="flex-row flex-wrap gap-2">
            <ScopeFilter label="All assigned" selected={!programmeId} onPress={() => setProgrammeId('')} />
            {dashboard.programmes.map((programme) => (
              <ScopeFilter
                key={programme.id}
                label={programme.name}
                selected={programmeId === programme.id}
                onPress={() => setProgrammeId(programme.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {loading ? <LoadingNotice label="Loading assigned QA activity..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && dashboard?.scopeConfigured ? (
        <View className="flex-row flex-wrap gap-3">
          <SummaryCard
            label="Awaiting review"
            value={dashboard.summary.awaiting_review}
            detail="Assessment records to check"
            symbol={{ ios: 'tray.full.fill', android: 'inbox', web: 'inbox' }}
            tone="amber"
          />
          <SummaryCard
            label="Verified"
            value={dashboard.summary.verified}
            detail="QA decisions recorded"
            symbol={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
            tone="forest"
          />
          <SummaryCard
            label="Further action"
            value={dashboard.summary.further_action_required}
            detail="Needs another workflow step"
            symbol={{ ios: 'arrow.trianglehead.2.clockwise.rotate.90', android: 'sync_problem', web: 'sync_problem' }}
            tone={dashboard.summary.further_action_required ? 'amber' : 'sage'}
          />
          <SummaryCard
            label="Not verified"
            value={dashboard.summary.not_verified}
            detail="Recorded QA outcomes"
            symbol={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
            tone="plain"
          />
        </View>
      ) : null}

      {!loading && !error && dashboard && !dashboard.scopeConfigured ? (
        <EmptyNotice
          title="No QA programme access"
          message="An administrator must assign your QA Officer account to a programme before its assessment records are visible."
        />
      ) : null}

      {!loading && !error && dashboard?.scopeConfigured ? (
        <>
          <View className="flex-row items-center gap-2">
            <TextInput
              accessibilityLabel="Search QA assessments"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-white px-3 text-sm text-ink"
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={() => setSubmittedSearch(search.trim())}
              placeholder="Search learner, programme, or evidence"
              placeholderTextColor="#5C6D67"
              returnKeyType="search"
            />
            <Pressable
              accessibilityRole="button"
              className="min-h-11 justify-center rounded-xl bg-primary px-4 active:opacity-80"
              onPress={() => setSubmittedSearch(search.trim())}>
              <Text className="text-sm font-bold text-white">Search</Text>
            </Pressable>
          </View>

          <View className="flex-row flex-wrap gap-2">
            {filters.map((item) => (
              <ScopeFilter
                key={item.value}
                label={item.label}
                selected={filter === item.value}
                onPress={() => setFilter(item.value)}
              />
            ))}
          </View>

          <View className="gap-3">
            <Text className="text-base font-extrabold text-ink">Assessment records</Text>
            {dashboard.reviews.length ? dashboard.reviews.map((review) => (
              <View key={review.assessment_review_id} className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-base font-extrabold text-ink">{review.learner_name}</Text>
                    <Text className="text-xs text-muted">{review.learner_reference} · {review.programme_name}</Text>
                  </View>
                  <StatusBadge status={review.qa_status} />
                </View>
                <View className="gap-1">
                  <Text className="text-sm font-bold text-ink">{review.requirement_title} · version {review.submission_version}</Text>
                  <Text className="text-xs text-muted">{review.provider_name} · Assessor: {review.assessor_name}</Text>
                  <Text className="text-xs text-muted">
                    Assessor decision: {review.assessor_decision.replaceAll('_', ' ')} · {formatDate(review.assessor_reviewed_at)}
                  </Text>
                </View>
                <Link href={routeHref(`/qa/submissions/${review.submission_id}`)} asChild>
                  <Pressable accessibilityRole="button" className="min-h-10 items-center justify-center self-start rounded-xl bg-primary px-4 py-2 active:opacity-80">
                    <Text className="text-sm font-bold text-white">
                      {review.qa_status === 'AWAITING_REVIEW' ? 'Review assessment' : 'View QA history'}
                    </Text>
                  </Pressable>
                </Link>
              </View>
            )) : (
              <EmptyNotice
                title="No matching assessment records"
                message={filter === 'AWAITING_REVIEW'
                  ? 'There are no assessor decisions awaiting QA review in this assigned scope.'
                  : 'Try another status or search within your assigned programmes.'}
              />
            )}
            {dashboard.total > dashboard.reviews.length ? (
              <Text className="text-xs text-muted">Showing {dashboard.reviews.length} of {dashboard.total} records. Narrow the search or status filter to find a record.</Text>
            ) : null}
          </View>
        </>
      ) : null}
    </Page>
  );
}

function ScopeFilter({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-9 justify-center rounded-full border px-3 py-2 ${selected ? 'border-primary bg-selected' : 'border-border bg-white'}`}
      onPress={onPress}>
      <Text className={`text-xs font-bold ${selected ? 'text-primary' : 'text-muted'}`}>{label}</Text>
    </Pressable>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status === 'AWAITING_REVIEW'
    ? 'Awaiting QA'
    : status.replaceAll('_', ' ').toLowerCase();
  const color = status === 'VERIFIED'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'AWAITING_REVIEW' || status === 'FURTHER_ACTION_REQUIRED'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-100 text-slate-700';
  return (
    <View className={`rounded-full border px-2.5 py-1 ${color}`}>
      <Text className="text-[10px] font-extrabold capitalize">{label}</Text>
    </View>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}
