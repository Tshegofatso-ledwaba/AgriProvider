import { usePathname } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { Text, View } from 'react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { routeHref } from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';

export default function AppTabs() {
  const { user } = useAuth();
  const pathname = usePathname();

  return (
    <Tabs className="h-dvh overflow-hidden">
      <TabSlot style={{ flex: 1, minHeight: 0 }} />
      <TabList asChild>
        <View className={`${
          user
            ? 'absolute bottom-4 left-4 right-4 mx-auto max-w-xl rounded-2xl border border-border bg-element p-2 dark:border-dark-border dark:bg-dark-element'
            : 'hidden'
        }`}>
          {user?.role !== 'learner' ? (
            <TabTrigger
              name="index"
              href="/"
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <Text className="rounded-xl px-1 py-3 text-center text-xs font-bold text-muted active:opacity-70 dark:text-dark-muted">
                Dashboard
              </Text>
            </TabTrigger>
          ) : null}
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
          {user?.role === 'learner' ? (
            <TabTrigger
              name="learner"
              href={routeHref('/learner')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <LearnerTab label="Home" selected={pathname === '/learner'} symbol={{ ios: 'house.fill', android: 'home', web: 'home' }} />
            </TabTrigger>
          ) : null}
          {user?.role === 'learner' ? (
            <TabTrigger
              name="learner/programmes"
              href={routeHref('/learner/programmes')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <LearnerTab label="Programmes" selected={pathname === '/learner/programmes'} symbol={{ ios: 'book.closed.fill', android: 'menu_book', web: 'menu_book' }} />
            </TabTrigger>
          ) : null}
          {user?.role === 'learner' ? (
            <TabTrigger
              name="learner/attendance"
              href={routeHref('/learner/attendance')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <LearnerTab label="Attendance" selected={pathname === '/learner/attendance'} symbol={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} />
            </TabTrigger>
          ) : null}
          {user?.role === 'learner' ? (
            <TabTrigger
              name="learner/evidence"
              href={routeHref('/learner/evidence')}
              className="min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70">
              <LearnerTab label="Evidence" selected={pathname === '/learner/evidence'} symbol={{ ios: 'folder', android: 'folder_open', web: 'folder_open' }} />
            </TabTrigger>
          ) : null}
          {user ? (
            <TabTrigger
              name="explore"
              href={routeHref('/explore')}
              className={user.role === 'learner' ? 'min-w-0 flex-1 rounded-xl px-1 py-3 text-center active:opacity-70' : 'hidden'}>
              <LearnerTab label="Profile" selected={pathname === '/explore'} symbol={{ ios: 'person.crop.circle', android: 'person', web: 'person' }} />
            </TabTrigger>
          ) : null}
        </View>
      </TabList>
    </Tabs>
  );
}

function LearnerTab({
  label,
  selected,
  symbol,
}: {
  label: string;
  selected: boolean;
  symbol: SymbolViewProps['name'];
}) {
  const color = selected ? '#21764A' : '#68736E';
  return (
    <View className="items-center gap-1 px-1 py-1">
      <SymbolView name={symbol} size={16} tintColor={color} />
      <Text className={`text-[10px] font-bold ${selected ? 'text-primary' : 'text-muted'}`}>
        {label}
      </Text>
    </View>
  );
}
