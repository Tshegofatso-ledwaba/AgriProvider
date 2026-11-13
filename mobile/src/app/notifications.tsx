import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  routeHref,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { listNotifications, markNotificationRead, UserNotification } from '@/services/notifications';

export default function NotificationsScreen() {
  return <NotificationInbox />;
}

function NotificationInbox() {
  const router = useRouter();
  const { credential, user } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again to view notifications.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await listNotifications(credential, { unreadOnly: unreadOnly || undefined });
      setNotifications(result.notifications);
      setTotal(result.total);
      setUnreadCount(result.unreadCount);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, unreadOnly]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const loadMore = async () => {
    if (!credential || loadingMore || notifications.length >= total) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await listNotifications(credential, {
        unreadOnly: unreadOnly || undefined,
        offset: notifications.length,
      });
      setNotifications((current) => [...current, ...result.notifications]);
      setTotal(result.total);
      setUnreadCount(result.unreadCount);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoadingMore(false);
    }
  };

  const openNotification = async (item: UserNotification) => {
    if (!credential || busyId) return;
    setBusyId(item.id);
    setError('');
    try {
      if (!item.read_at) {
        const updated = await markNotificationRead(credential, item.id);
        setNotifications((current) => current.map((notification) => notification.id === item.id ? updated : notification));
        setUnreadCount((count) => Math.max(0, count - 1));
      }
      if (item.action_path?.startsWith('/') && !item.action_path.startsWith('//') && !item.action_path.includes('://')) {
        router.push(routeHref(item.action_path));
      }
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setBusyId('');
    }
  };

  return (
    <Page onRefresh={() => void load()} refreshing={loading}>
      <PageTitle title="Notifications" subtitle={user?.fullName ?? 'Your account updates'} />
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm font-bold text-muted">{unreadCount} unread</Text>
        <View className="flex-row rounded-xl border border-border bg-white p-1">
          <FilterButton label="All" selected={!unreadOnly} onPress={() => setUnreadOnly(false)} />
          <FilterButton label="Unread" selected={unreadOnly} onPress={() => setUnreadOnly(true)} />
        </View>
      </View>
      {loading ? <LoadingNotice label="Loading notifications..." /> : null}
      {!loading && error && notifications.length === 0 ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && notifications.length === 0 ? (
        <EmptyNotice
          title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          message={unreadOnly ? 'You are up to date.' : 'Updates for your assigned work will appear here.'}
        />
      ) : null}
      {!loading && notifications.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{ busy: busyId === item.id }}
          className={`gap-2 rounded-xl border p-4 ${item.read_at ? 'border-border bg-white' : 'border-primary/30 bg-selected'}`}
          onPress={() => void openNotification(item)}>
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-sm font-bold text-ink">{item.title}</Text>
            {!item.read_at ? <View className="mt-1 h-2 w-2 rounded-full bg-primary" /> : null}
          </View>
          <Text className="text-sm leading-5 text-muted">{item.message}</Text>
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-xs capitalize text-muted">{item.category.replaceAll('_', ' ')}</Text>
            <Text className="text-xs text-muted">{formatDate(item.created_at)}</Text>
          </View>
        </Pressable>
      ))}
      {error && notifications.length > 0 ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
      {notifications.length < total ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
          className="min-h-11 items-center justify-center rounded-xl border border-border bg-white px-4 py-3"
          disabled={loadingMore}
          onPress={() => void loadMore()}>
          <Text className="text-sm font-bold text-primary">{loadingMore ? 'Loading...' : 'Load older notifications'}</Text>
        </Pressable>
      ) : null}
    </Page>
  );
}

function FilterButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-9 justify-center rounded-lg px-3 ${selected ? 'bg-primary' : 'bg-white'}`}
      onPress={onPress}>
      <Text className={`text-xs font-bold ${selected ? 'text-white' : 'text-muted'}`}>{label}</Text>
    </Pressable>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}
