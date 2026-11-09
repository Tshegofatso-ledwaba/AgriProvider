import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ActionButton, Page } from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';

export default function ExploreScreen() {
  const { user, isBusy, signOut } = useAuth();
  const router = useRouter();
  const [signOutError, setSignOutError] = useState('');
  const roleLabel = user?.role === 'provider'
    ? 'Provider'
    : user?.role === 'assessor'
      ? 'Assessor'
      : user?.role === 'qa'
        ? 'Quality assurance'
        : user?.role === 'admin'
          ? 'Administrator'
          : 'Workspace user';

  return (
    <Page>
        <View className="rounded-[28px] border border-border bg-white p-6 shadow-sm shadow-black/5">
          <Text className="text-[11px] font-extrabold tracking-[0.2em] text-primary">ACCOUNT</Text>
          <Text className="mt-3 text-3xl font-extrabold text-ink">Your profile</Text>
          <Text className="mt-2 text-base leading-6 text-muted">
            View the account currently signed in to AgriProvider.
          </Text>
        </View>

        <View className="rounded-[26px] border border-border bg-white p-5">
          <View className="flex-row items-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary">
              <Text className="text-xl font-extrabold text-white">{roleLabel.slice(0, 1)}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-muted">Signed in as</Text>
              <Text className="text-xl font-extrabold text-ink">{user?.fullName ?? 'AgriProvider user'}</Text>
              <Text className="text-sm text-muted">{user?.email}</Text>
              <Text className="text-sm text-muted">{roleLabel}</Text>
            </View>
          </View>
        </View>

        <View className="gap-3">
          {[
            ['Account role', roleLabel],
            ['Access', 'Managed by your AgriProvider account'],
          ].map(([label, value]) => (
            <View
              key={label}
              className="flex-row items-center justify-between gap-4 rounded-2xl border border-border bg-white px-4 py-3">
              <Text className="text-sm font-bold text-muted">{label}</Text>
              <Text className="text-sm font-bold text-ink">{value}</Text>
            </View>
          ))}
        </View>

        <View className="gap-3 rounded-2xl border border-border bg-white p-5">
          <Text className="text-base font-bold text-ink">Workspace information</Text>
          <Text className="text-sm leading-5 text-muted">
            Your available screens and data access are determined by this authenticated account.
          </Text>
        </View>

        {signOutError ? (
          <Text className="text-sm text-danger" accessibilityRole="alert">{signOutError}</Text>
        ) : null}
        <ActionButton
          label={isBusy ? 'Signing out...' : 'Sign out'}
          variant="danger"
          disabled={isBusy}
          onPress={() => {
            setSignOutError('');
            void signOut()
              .then(() => router.replace('/'))
              .catch((error: unknown) => setSignOutError(apiErrorText(error)));
          }}
        />
    </Page>
  );
}
