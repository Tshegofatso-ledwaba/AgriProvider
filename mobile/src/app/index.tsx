import { useCallback, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AuthWorkspace from '@/components/auth-workspace';
import {
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  routeHref,
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
  if (user.role === 'admin') {
    return <Redirect href={routeHref('/admin')} />;
  }
  if (user.role === 'assessor') {
    return <Redirect href={routeHref('/assessor')} />;
  }
  if (user.role === 'qa') {
    return <Redirect href={routeHref('/qa')} />;
  }
  if (user.role === 'learner') {
    return <Redirect href={routeHref('/learner')} />;
  }
  return <ProviderDashboard name={user.fullName} />;
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
      <View className="rounded-[28px] bg-primary p-5 shadow-sm shadow-black/10">
        <Text className="text-[10px] font-extrabold tracking-[0.2em] text-white/70">PROVIDER WORKSPACE</Text>
        <Text className="mt-3 text-3xl font-extrabold text-white">Welcome, {firstName}</Text>
        <Text className="mt-2 text-sm leading-5 text-white/80">
          Manage your programmes, learner records, attendance and evidence.
        </Text>
      </View>

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
            <StatCard label="Learners" value={String(learnerCount ?? 0)} accent="primary" />
            <StatCard label="Programmes" value={String(programmeCount)} accent="neutral" />
            <StatCard label="Active enrolments" value={String(enrolmentCount ?? 0)} accent="success" />
          </View>
        </View>
      ) : null}

      {!loading && !error ? (
        <View className="gap-3 rounded-[24px] border border-border bg-white p-4 shadow-sm shadow-black/5">
          <View className="gap-1">
            <Text className="text-base font-bold text-ink">Quick actions</Text>
            <Text className="text-sm leading-5 text-muted">Go directly to common provider tasks.</Text>
          </View>
          <View className="flex-row flex-wrap gap-3">
            <QuickAction label="Add learner" href="/learners/new" tint="primary" />
            <QuickAction label="Create programme" href="/programmes/new" tint="secondary" />
            <QuickAction label="Enrol learner" href="/enrolments/new" tint="secondary" />
            <QuickAction label="Record attendance" href="/sessions" tint="neutral" />
            <QuickAction label="Evidence workspace" href="/enrolments" tint="neutral" />
          </View>
        </View>
      ) : null}

      <View className="gap-3 rounded-[24px] border border-border bg-white p-4 shadow-sm shadow-black/5">
        <Text className="text-base font-bold text-ink">Evidence and review</Text>
        <Text className="text-sm leading-5 text-muted">
          Evidence completeness and assessor feedback are tracked on each learner enrolment. Open the evidence workspace to review individual records.
        </Text>
        <Link href={routeHref('/explore')} asChild>
          <Pressable accessibilityRole="button" className="rounded-xl border border-border bg-surface px-4 py-3">
            <Text className="text-center text-sm font-bold text-ink">Your profile</Text>
          </Pressable>
        </Link>
      </View>
    </Page>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'primary' | 'success' | 'neutral' | 'warning';
}) {
  const tint = accent === 'primary'
    ? 'bg-primary/10'
    : accent === 'success'
      ? 'bg-emerald-50'
      : accent === 'warning'
        ? 'bg-[#F7E8BF]'
        : 'bg-slate-100';
  const text = accent === 'primary'
    ? 'text-primary'
    : accent === 'success'
      ? 'text-emerald-700'
      : accent === 'warning'
        ? 'text-[#7A5A00]'
        : 'text-slate-700';

  return (
    <View className={`min-w-[140px] flex-1 gap-2 rounded-2xl border border-border bg-white p-4 ${tint}`}>
      <Text className="text-sm font-bold text-muted">{label}</Text>
      <Text className={`text-3xl font-extrabold ${text}`}>{value}</Text>
    </View>
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
      <Pressable accessibilityRole="button" className={`rounded-xl px-4 py-3 ${bg}`}>
        <Text className={`text-center text-sm font-bold ${text}`}>{label}</Text>
      </Pressable>
    </Link>
  );
}
