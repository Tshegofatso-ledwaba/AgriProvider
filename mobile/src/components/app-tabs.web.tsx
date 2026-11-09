import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { Text, View } from 'react-native';

import { routeHref } from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';

export default function AppTabs() {
  const { user } = useAuth();

  return (
    <Tabs className="h-dvh overflow-hidden">
      <TabSlot style={{ flex: 1, minHeight: 0 }} />
      <TabList asChild>
        <View className={`${
          user
            ? 'absolute bottom-4 left-4 right-4 mx-auto max-w-xl rounded-2xl border border-border bg-element p-2 dark:border-dark-border dark:bg-dark-element'
            : 'hidden'
        }`}>
          <TabTrigger
            name="index"
            href="/"
            className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
            <Text className="rounded-xl px-1 py-3 text-center text-xs font-bold text-muted active:opacity-70 dark:text-dark-muted">
              Dashboard
            </Text>
          </TabTrigger>
          {user?.role === 'provider' ? (
            <TabTrigger
              name="programmes"
              href={routeHref('/programmes')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <Text className="rounded-xl px-1 py-3 text-center text-xs font-bold text-muted active:opacity-70 dark:text-dark-muted">
                Programmes
              </Text>
            </TabTrigger>
          ) : null}
          {user?.role === 'provider' ? (
            <TabTrigger
              name="learners"
              href={routeHref('/learners')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <Text className="rounded-xl px-1 py-3 text-center text-xs font-bold text-muted active:opacity-70 dark:text-dark-muted">
                Learners
              </Text>
            </TabTrigger>
          ) : null}
          {user?.role === 'provider' ? (
            <TabTrigger
              name="enrolments"
              href={routeHref('/enrolments')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <Text className="rounded-xl px-1 py-3 text-center text-xs font-bold text-muted active:opacity-70 dark:text-dark-muted">
                Enrolments
              </Text>
            </TabTrigger>
          ) : null}
          {user?.role === 'assessor' ? (
            <TabTrigger
              name="assessor"
              href={routeHref('/assessor')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <Text className="rounded-xl px-1 py-3 text-center text-xs font-bold text-muted active:opacity-70 dark:text-dark-muted">
                Review queue
              </Text>
            </TabTrigger>
          ) : null}
          {user?.role === 'admin' ? (
            <TabTrigger
              name="admin"
              href={routeHref('/admin')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <Text className="rounded-xl px-1 py-3 text-center text-xs font-bold text-muted active:opacity-70 dark:text-dark-muted">
                Assignments
              </Text>
            </TabTrigger>
          ) : null}
          {user?.role === 'qa' ? (
            <TabTrigger
              name="qa"
              href={routeHref('/qa')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <Text className="rounded-xl px-1 py-3 text-center text-xs font-bold text-muted active:opacity-70 dark:text-dark-muted">
                Quality assurance
              </Text>
            </TabTrigger>
          ) : null}
          {user ? (
            <TabTrigger name="explore" href={routeHref('/explore')} className="hidden">
              <Text className="hidden">Profile</Text>
            </TabTrigger>
          ) : null}
        </View>
      </TabList>
    </Tabs>
  );
}
