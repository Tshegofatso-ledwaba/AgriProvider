import { useCallback, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AuthWorkspace from '@/components/auth-workspace';
import {
  DashboardHero,
  ErrorNotice,
  getRoleHomeRoute,
  LoadingNotice,
  Page,
  PageTitle,
  routeHref,
  SummaryCard,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { listEnrolments } from '@/services/enrolments';
import { listLearners } from '@/services/learners';
import { listProgrammes } from '@/services/programmes';

export default function HomeScreen() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-surface p-6">
        <ActivityIndicator size="large" color="#173F35" />
        <Text className="mt-4 text-sm text-muted">Checking your secure session...</Text>
      </SafeAreaView>
    );
  }
  if (!user) {
    return <AuthWorkspace />;
  }
  const roleHomeRoute = getRoleHomeRoute(user.role);
  if (roleHomeRoute) {
    return <Redirect href={routeHref(roleHomeRoute)} />;
  }
  if (user.role === 'provider') {
    return <ProviderDashboard name={user.fullName} />;
  }
  return <Redirect href={routeHref('/')} />;
}

function ProviderDashboard({ name }: { name: string }) {
  const { credential } = useAuth();
  const [programmeCount, setProgrammeCount] = useState<number | null>(null);
  const [learnerCount, setLearnerCount] = useState<number | null>(null);
  const [enrolmentCount, setEnrolmentCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCount = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again to load dashboard data.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [programmes, learners, enrolments] = await Promise.all([
        listProgrammes(credential),
        listLearners(credential, { limit: 1 }),
        listEnrolments(credential, { status: 'active' }),
      ]);
      setProgrammeCount(programmes.length);
      setLearnerCount(learners.total);
      setEnrolmentCount(enrolments.total);
    } catch (requestError) {
      setError(apiErrorText(requestError));
      setProgrammeCount(null);
      setLearnerCount(null);
      setEnrolmentCount(null);
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => {
    void loadCount();
  }, [loadCount]));

  const firstName = name.trim().split(/\s+/)[0] || 'there';
  const currentDate = new Date();

  return (
    <Page>
      <DashboardHero
        eyebrow="PROVIDER WORKSPACE"
        title={`Welcome back, ${firstName}`}
        subtitle="Manage programmes, learner records, attendance and evidence from one operational view."
        symbol={{ ios: 'building.2.fill', android: 'domain', web: 'domain' }}
      />

      <PageTitle
        title="Workspace overview"
        subtitle={currentDate.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}
      />
      {loading ? <LoadingNotice label="Loading your dashboard..." /> : null}
      {!loading && error ? (
        <ErrorNotice message={error} onRetry={() => void loadCount()} />
      ) : null}

      {!loading && !error && programmeCount !== null ? (
        <View className="gap-3">
          <Text className="text-base font-bold text-ink">At a glance</Text>
          <View className="flex-row flex-wrap gap-3">
            <SummaryCard
              label="Learners"
              value={learnerCount ?? 0}
              detail="Provider records"
              symbol={{ ios: 'person.2.fill', android: 'groups', web: 'groups' }}
              tone="forest"
            />
            <SummaryCard
              label="Programmes"
              value={programmeCount}
              detail="Training programmes"
              symbol={{ ios: 'square.grid.2x2.fill', android: 'grid_view', web: 'grid_view' }}
            />
            <SummaryCard
              label="Active enrolments"
              value={enrolmentCount ?? 0}
              detail="Current learner participation"
              symbol={{ ios: 'checkmark.circle.fill', android: 'task_alt', web: 'task_alt' }}
              tone="sage"
            />
          </View>
        </View>
      ) : null}

      {!loading && !error ? (
        <View className="gap-3 rounded-[24px] border border-border bg-white p-4 shadow-sm shadow-black/5">
          <View className="gap-1">
            <Text className="text-base font-bold text-ink">Quick actions</Text>
            <Text className="text-sm leading-5 text-muted">Start the next task in one tap.</Text>
          </View>
          <View className="flex-row flex-wrap gap-3">
            <QuickAction label="Add learner" href="/learners/new" tint="primary" />
            <QuickAction label="Create programme" href="/programmes/new" tint="secondary" />
            <QuickAction label="Enrol learner" href="/enrolments/new" tint="secondary" />
            <QuickAction label="Record attendance" href="/sessions" tint="neutral" />
            <QuickAction label="Evidence workspace" href="/enrolments" tint="neutral" />
            <QuickAction label="QA corrective actions" href="/provider/qa-actions" tint="neutral" />
          </View>
        </View>
      ) : null}

      <View className="gap-3 rounded-[24px] border border-border bg-white p-4 shadow-sm shadow-black/5">
        <Text className="text-base font-bold text-ink">Evidence and review</Text>
        <Text className="text-sm leading-5 text-muted">
          Evidence completeness and assessor feedback stay linked to each learner enrolment. Review requirements from the workspace to keep progress moving.
        </Text>
        <Link href={routeHref('/explore')} asChild>
          <Pressable accessibilityRole="button" className="rounded-xl border border-border bg-surface px-4 py-3 active:opacity-80">
            <Text className="text-center text-sm font-bold text-ink">Open your profile</Text>
          </Pressable>
        </Link>
      </View>
    </Page>
  );
}

function QuickAction({
  label,
  href,
  tint,
}: {
  label: string;
  href: string;
  tint: 'primary' | 'secondary' | 'neutral';
}) {
  const bg = tint === 'primary'
    ? 'bg-primary'
    : tint === 'secondary'
      ? 'bg-surface'
      : 'bg-slate-100';
  const text = tint === 'primary' ? 'text-white' : 'text-ink';

  return (
    <Link href={routeHref(href)} asChild>
      <Pressable accessibilityRole="button" className={`min-w-[140px] flex-1 rounded-xl px-4 py-3 active:opacity-80 ${bg}`}>
        <Text className={`text-center text-sm font-bold ${text}`}>{label}</Text>
      </Pressable>
    </Link>
  );
}
