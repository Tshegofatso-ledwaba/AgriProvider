import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  EmptyNotice,
  ErrorNotice,
  ActionButton,
  LoadingNotice,
  Page,
  PageTitle,
  ProviderOnly,
  routeHref,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { Learner, listLearners } from '@/services/learners';

export default function LearnersScreen() {
  return <ProviderOnly><LearnerList /></ProviderOnly>;
}

function LearnerList() {
  const { credential } = useAuth();
  const [learners, setLearners] = useState<Learner[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');

  const loadLearners = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again to view learners.');
      return;
    }
    setLoading(true);
    setError('');
    setLoadMoreError('');
    try {
      const result = await listLearners(credential, { q: search.trim(), status });
      setLearners(result.learners);
      setTotal(result.total);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, search, status]);

  const loadMore = async () => {
    if (!credential || loadingMore || learners.length >= total) return;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const result = await listLearners(credential, {
        q: search.trim(),
        status,
        offset: learners.length,
      });
      setLearners((current) => [...current, ...result.learners]);
      setTotal(result.total);
    } catch (requestError) {
      setLoadMoreError(apiErrorText(requestError));
    } finally {
      setLoadingMore(false);
    }
  };

  useFocusEffect(useCallback(() => {
    const timeout = setTimeout(() => { void loadLearners(); }, 250);
    return () => clearTimeout(timeout);
  }, [loadLearners]));

  return (
    <Page>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <PageTitle title="Learners" subtitle="Manage learner records belonging to your provider account." />
        </View>
        <Link href={routeHref('/learners/new')} asChild>
          <Pressable accessibilityRole="button" className="rounded-xl bg-primary px-4 py-3">
            <Text className="text-sm font-bold text-white">Register</Text>
          </Pressable>
        </Link>
      </View>

      <TextInput
        accessibilityLabel="Search learners"
        className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
        value={search}
        onChangeText={setSearch}
        placeholder="Search name or learner reference"
        placeholderTextColor="#8B9691"
        returnKeyType="search"
        autoCapitalize="none"
      />

      <View className="flex-row gap-2">
        {(['active', 'archived'] as const).map((filter) => (
          <Pressable
            key={filter}
            accessibilityRole="button"
            accessibilityState={{ selected: status === filter }}
            className={`rounded-full px-4 py-2 ${status === filter ? 'bg-primary' : 'bg-selected'}`}
            onPress={() => setStatus(filter)}>
            <Text className={`text-sm font-bold ${status === filter ? 'text-white' : 'text-primary'}`}>
              {filter === 'active' ? 'Active' : 'Archived'}
            </Text>
          </Pressable>
        ))}
        {!loading && !error ? (
          <Text className="ml-auto self-center text-sm text-muted">{total} {status} learners</Text>
        ) : null}
      </View>

      {loading ? <LoadingNotice label="Loading learners..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void loadLearners()} /> : null}
      {!loading && !error && learners.length === 0 ? (
        <EmptyNotice
          title={search ? 'No matching learners' : status === 'active' ? 'No learners yet' : 'No archived learners'}
          message={search
            ? 'Try another name or learner reference.'
            : status === 'active'
              ? 'Register a learner to begin managing enrolments.'
              : 'Archived learners will appear here.'}
          action={!search && status === 'active' ? (
            <Link href={routeHref('/learners/new')} asChild>
              <Pressable accessibilityRole="button" className="mt-2 rounded-xl bg-primary px-5 py-3">
                <Text className="text-sm font-bold text-white">Register a learner</Text>
              </Pressable>
            </Link>
          ) : undefined}
        />
      ) : null}
      {!loading && !error ? (
        <View className="flex-row flex-wrap gap-3">
          {learners.map((learner) => (
            <Link key={learner.id} href={routeHref(`/learners/${learner.id}`)} asChild>
              <Pressable accessibilityRole="button" className="min-w-[260px] flex-1 gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm shadow-primary/5 active:opacity-90">
                <View className="flex-row items-center gap-3">
                  <View className="h-11 w-11 items-center justify-center rounded-xl bg-selected">
                    <Text className="text-sm font-extrabold text-primary">
                      {learner.full_name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'L'}
                    </Text>
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-base font-extrabold text-ink" numberOfLines={1}>{learner.full_name}</Text>
                    <Text className="text-xs text-muted">{learner.learner_reference}</Text>
                  </View>
                  <Text className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
                    learner.status === 'active' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {learner.status}
                  </Text>
                </View>
                <Text className="text-xs font-bold text-primary">Open learner record ›</Text>
              </Pressable>
            </Link>
          ))}
        </View>
      ) : null}
      {!loading && loadMoreError ? (
        <View className="gap-3">
          <Text className="text-sm text-danger" accessibilityRole="alert">{loadMoreError}</Text>
          <ActionButton label="Retry loading more" onPress={() => void loadMore()} variant="secondary" />
        </View>
      ) : null}
      {!loading && !error && learners.length < total ? (
        <ActionButton
          label={loadingMore ? 'Loading more...' : 'Load more learners'}
          onPress={() => void loadMore()}
          disabled={loadingMore}
          variant="secondary"
        />
      ) : null}
    </Page>
  );
}
