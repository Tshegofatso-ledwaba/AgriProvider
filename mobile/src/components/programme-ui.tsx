import { Href, Link, Redirect, useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { PropsWithChildren, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { UserRole, useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { listLearners } from '@/services/learners';
import { listProgrammes } from '@/services/programmes';

export function routeHref(path: string): Href {
  return path as Href;
}

export function navigateBack(router: ReturnType<typeof useRouter>, fallbackPath: string) {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(routeHref(fallbackPath));
  }
}

function backTargetForPath(
  pathname: string,
  role?: UserRole,
  params?: { learnerId?: string; programmeId?: string },
): string | null {
  if (pathname === '/') {
    return null;
  }
  if (pathname === '/explore') {
    return role === 'assessor'
      ? '/assessor'
      : role === 'admin'
        ? '/admin'
        : role === 'qa'
          ? '/qa'
          : role === 'learner'
            ? '/learner'
            : '/';
  }
  if (pathname === '/assessor' || pathname === '/admin' || pathname === '/qa' || pathname === '/learner') {
    return null;
  }

  const [section, second, third] = pathname.split('/').filter(Boolean);
  if (section === 'assessor') {
    return '/assessor';
  }
  if (section === 'learner') {
    return '/learner';
  }

  if (['programmes', 'learners', 'enrolments', 'sessions'].includes(section ?? '')) {
    const sectionPath = `/${section}`;
    if (!second) {
      if (section === 'sessions' && params?.programmeId) {
        return `/programmes/${encodeURIComponent(params.programmeId)}`;
      }
      return '/';
    }
    if (second === 'new') {
      if (section === 'enrolments' && params?.learnerId) {
        return `/learners/${encodeURIComponent(params.learnerId)}`;
      }
      if ((section === 'enrolments' || section === 'sessions') && params?.programmeId) {
        return `/programmes/${encodeURIComponent(params.programmeId)}`;
      }
      return sectionPath;
    }
    return third ? `${sectionPath}/${second}` : sectionPath;
  }

  return '/';
}

export function ProviderOnly({ children }: PropsWithChildren) {
  return <RoleOnly roles={['provider']}>{children}</RoleOnly>;
}

export function AssessorOnly({ children }: PropsWithChildren) {
  return <RoleOnly roles={['assessor']}>{children}</RoleOnly>;
}

export function LearnerOnly({ children }: PropsWithChildren) {
  return <RoleOnly roles={['learner']}>{children}</RoleOnly>;
}

export function AdminOnly({ children }: PropsWithChildren) {
  return <RoleOnly roles={['admin']}>{children}</RoleOnly>;
}

export function QaOnly({ children }: PropsWithChildren) {
  return <RoleOnly roles={['qa']}>{children}</RoleOnly>;
}

function RoleOnly({ children, roles }: PropsWithChildren & { roles: UserRole[] }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-surface p-6">
        <ActivityIndicator size="large" color="#173F35" />
        <Text className="mt-4 text-sm text-muted">Checking your secure session...</Text>
      </SafeAreaView>
    );
  }
  if (!user || !roles.includes(user.role)) {
    return <Redirect href="/" />;
  }
  return children;
}

export function Page({
  children,
  keyboardAvoiding = false,
  onRefresh,
  refreshing = false,
}: PropsWithChildren & {
  keyboardAvoiding?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { user, credential, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuError, setMenuError] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<
    { id: string; title: string; detail: string; href: string }[]
  >([]);
  const router = useRouter();
  const pathname = usePathname();
  const learnerWorkspace = user?.role === 'learner';
  const maxWidthClass = learnerWorkspace ? 'max-w-xl' : 'max-w-3xl';
  const pageBackgroundClass = learnerWorkspace ? 'bg-[#F4F8F5]' : 'bg-[#F4F1ED]';
  const { learnerId, programmeId } = useGlobalSearchParams<{
    learnerId?: string;
    programmeId?: string;
  }>();
  const backTarget = backTargetForPath(pathname, user?.role, { learnerId, programmeId });

  const menuItems = user?.role === 'provider'
    ? [
        { label: 'Dashboard', href: '/' },
        { label: 'Programmes', href: '/programmes' },
        { label: 'Learners', href: '/learners' },
        { label: 'Enrolments', href: '/enrolments' },
        { label: 'Attendance', href: '/sessions' },
        { label: 'Profile', href: '/explore' },
      ]
    : user?.role === 'assessor'
      ? [
          { label: 'Review queue', href: '/assessor' },
          { label: 'Profile', href: '/explore' },
        ]
      : user?.role === 'admin'
        ? [
            { label: 'Assignments', href: '/admin' },
            { label: 'Profile', href: '/explore' },
          ]
        : user?.role === 'qa'
          ? [
              { label: 'Quality assurance', href: '/qa' },
              { label: 'Profile', href: '/explore' },
          ]
          : user?.role === 'learner'
            ? [
                  { label: 'Home', href: '/learner' },
                  { label: 'My programmes', href: '/learner/programmes' },
                  { label: 'Attendance', href: '/learner/attendance' },
                  { label: 'Evidence', href: '/learner/evidence' },
                  { label: 'Profile', href: '/explore' },
                ]
            : [
                { label: 'Dashboard', href: '/' },
                { label: 'Profile', href: '/explore' },
              ];

  const handleSignOut = async () => {
    setMenuOpen(false);
    setMenuError('');
    try {
      await signOut();
    } catch (error) {
      setMenuError(apiErrorText(error));
      setMenuOpen(true);
    }
  };

  const runWorkspaceSearch = async () => {
    const query = search.trim();
    if (!query || !credential) {
      setSearchResults([]);
      setSearchError(query ? 'Your session is unavailable. Sign in again to search.' : '');
      setSearchOpen(true);
      return;
    }

    setMenuOpen(false);
    setSearchOpen(true);
    setSearching(true);
    setSearchError('');
    try {
      const [learnerResult, programmes] = await Promise.all([
        listLearners(credential, { q: query, limit: 10 }),
        listProgrammes(credential),
      ]);
      const normalizedQuery = query.toLocaleLowerCase();
      const results = [
        ...learnerResult.learners.map((learner) => ({
          id: `learner-${learner.id}`,
          title: learner.full_name,
          detail: `Learner · ${learner.learner_reference}`,
          href: `/learners/${learner.id}`,
        })),
        ...programmes
          .filter((programme) => programme.name.toLocaleLowerCase().includes(normalizedQuery))
          .map((programme) => ({
            id: `programme-${programme.id}`,
            title: programme.name,
            detail: 'Programme',
            href: `/programmes/${programme.id}`,
          })),
      ].slice(0, 10);
      setSearchResults(results);
    } catch (requestError) {
      setSearchError(apiErrorText(requestError));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const content = (
    <>
      <View className="relative z-20 px-4 pt-4">
        <View className={`mx-auto w-full ${maxWidthClass} rounded-[24px] border border-border bg-white/90 px-3 py-2 shadow-sm shadow-black/5`}>
          <View className="flex-row items-center gap-3">
            {backTarget ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                accessibilityHint="Return to the previous screen"
                className="h-10 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-[#F4F1ED] active:opacity-70"
                onPress={() => navigateBack(router, backTarget)}>
                <Text className="text-2xl font-bold leading-7 text-primary">‹</Text>
              </Pressable>
            ) : null}
            <View className="flex-row items-center gap-2">
              <View className="h-8 w-8 items-center justify-center rounded-xl bg-primary">
                {learnerWorkspace ? (
                  <SymbolView
                    name={{ ios: 'graduationcap.fill', android: 'school', web: 'school' }}
                    size={17}
                    tintColor="#FFFFFF"
                  />
                ) : <Text className="text-xs font-extrabold text-white">A</Text>}
              </View>
              <Text className="text-base font-extrabold text-ink">AgriProvider</Text>
            </View>

            {user?.role === 'provider' ? (
              <View className="ml-1 min-w-0 flex-1 flex-row items-center rounded-full border border-border bg-[#F4F1ED] pl-3 pr-1">
                <TextInput
                  accessibilityLabel="Search workspace"
                  className="min-w-0 flex-1 py-2 text-xs text-ink"
                  value={search}
                  onChangeText={(value) => {
                    setSearch(value);
                    setSearchOpen(false);
                    setSearchError('');
                  }}
                  onSubmitEditing={() => void runWorkspaceSearch()}
                  placeholder="Search workspace"
                  placeholderTextColor="#68736E"
                  returnKeyType="search"
                  autoCapitalize="none"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Search workspace"
                  accessibilityState={{ disabled: searching || !search.trim() }}
                  className="rounded-full bg-primary px-3 py-2 active:opacity-80"
                  disabled={searching || !search.trim()}
                  onPress={() => void runWorkspaceSearch()}>
                  <Text className="text-xs font-bold text-white">{searching ? '...' : 'Search'}</Text>
                </Pressable>
              </View>
            ) : null}

            {learnerWorkspace ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Notifications unavailable"
                  accessibilityHint="Learner notifications are not available yet."
                  accessibilityState={{ disabled: true }}
                  className="h-10 w-10 items-center justify-center rounded-full"
                  disabled>
                  <SymbolView
                    name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
                    size={18}
                    tintColor="#728078"
                  />
                </Pressable>
                <Link href={routeHref('/explore')} asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open profile"
                    className="h-10 w-10 items-center justify-center rounded-full bg-[#E4EFE8] active:opacity-70">
                    <Text className="text-xs font-extrabold text-primary">
                      {user.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'L'}
                    </Text>
                  </Pressable>
                </Link>
              </>
            ) : user ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={menuOpen ? 'Close menu' : 'Open menu'}
                accessibilityState={{ expanded: menuOpen }}
                className="h-10 w-10 items-center justify-center rounded-full border border-border bg-[#F4F1ED] active:opacity-70"
                onPress={() => {
                  setSearchOpen(false);
                  setMenuError('');
                  setMenuOpen((value) => !value);
                }}>
                <View className="h-4 w-5 justify-between py-0.5">
                  <View className="h-0.5 rounded-full bg-primary" />
                  <View className="h-0.5 rounded-full bg-primary" />
                  <View className="h-0.5 rounded-full bg-primary" />
                </View>
              </Pressable>
            ) : null}
          </View>

        </View>

        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}>
          <View className="flex-1 items-end bg-black/10 px-4 pt-16">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              className="absolute inset-0"
              onPress={() => setMenuOpen(false)}
            />
            <View className="w-56 overflow-hidden rounded-2xl border border-border bg-white shadow-lg shadow-black/10">
              <View className="border-b border-border px-4 py-3">
                <Text className="text-xs font-bold text-muted">WORKSPACE MENU</Text>
                {user ? <Text className="mt-1 text-sm font-bold text-ink">{user.fullName}</Text> : null}
                {user ? <Text className="mt-1 text-xs text-muted">{user.email}</Text> : null}
                {user ? (
                  <Text className="mt-1 text-xs font-bold text-primary">
                    {user.role === 'qa'
                      ? 'Quality assurance'
                      : user.role === 'admin'
                        ? 'Administrator'
                        : user.role === 'assessor'
                          ? 'Assessor'
                          : user.role === 'learner'
                            ? 'Learner'
                            : 'Provider'}
                  </Text>
                ) : null}
              </View>
              {menuItems.map((item) => (
                <Pressable
                  key={item.href}
                  accessibilityRole="button"
                  className="border-b border-border px-4 py-3 active:bg-surface"
                  onPress={() => {
                    setMenuOpen(false);
                    router.push(routeHref(item.href));
                  }}>
                  <Text className="text-sm font-bold text-ink">{item.label}</Text>
                </Pressable>
              ))}
              {menuError ? (
                <Text className="border-t border-border px-4 py-3 text-sm text-danger" accessibilityRole="alert">
                  {menuError}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                className="px-4 py-3 active:bg-surface"
                onPress={() => void handleSignOut()}>
                <Text className="text-sm font-bold text-danger">Sign out</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {searchOpen ? (
          <View className="absolute left-0 right-0 top-[68px] z-30 overflow-hidden rounded-2xl border border-border bg-white shadow-lg shadow-black/10">
            {searching ? (
              <View className="flex-row items-center gap-3 px-4 py-4">
                <ActivityIndicator size="small" color="#173F35" />
                <Text className="text-sm text-muted">Searching learners and programmes...</Text>
              </View>
            ) : searchError ? (
              <Text className="px-4 py-4 text-sm text-danger" accessibilityRole="alert">{searchError}</Text>
            ) : searchResults.length ? (
              searchResults.map((result) => (
                <Pressable
                  key={result.id}
                  accessibilityRole="button"
                  className="border-b border-border px-4 py-3 active:bg-surface"
                  onPress={() => {
                    setSearchOpen(false);
                    router.push(routeHref(result.href));
                  }}>
                  <Text className="text-sm font-bold text-ink">{result.title}</Text>
                  <Text className="mt-1 text-xs text-muted">{result.detail}</Text>
                </Pressable>
              ))
            ) : (
              <Text className="px-4 py-4 text-sm text-muted">
                {search.trim() ? 'No matching learners or programmes found.' : 'Enter a learner name, reference, or programme name.'}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              className="border-t border-border px-4 py-3 active:bg-surface"
              onPress={() => setSearchOpen(false)}>
              <Text className="text-center text-xs font-bold text-primary">Close</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <ScrollView
        className={`flex-1 ${pageBackgroundClass}`}
        contentContainerClassName={`mx-auto w-full ${maxWidthClass} gap-5 px-5 pt-4 ${
          Platform.OS === 'web' ? 'pb-28' : 'pb-10'
        }`}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh
          ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          : undefined}>
        {children}
      </ScrollView>
    </>
  );

  return (
    <SafeAreaView className={`flex-1 ${pageBackgroundClass}`}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {content}
        </KeyboardAvoidingView>
      ) : content}
    </SafeAreaView>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View className="gap-1 pt-1">
      <Text className="text-2xl font-extrabold text-ink">{title}</Text>
      <Text className="text-sm leading-5 text-muted">{subtitle}</Text>
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const background = variant === 'primary'
    ? 'bg-primary'
    : variant === 'danger'
      ? 'bg-[#C94F4F]'
      : 'border border-border bg-white';
  const foreground = variant === 'secondary' ? 'text-ink' : 'text-white';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`min-h-12 items-center justify-center rounded-xl px-4 py-3 shadow-sm shadow-black/5 ${background} ${
        disabled ? 'opacity-50' : 'active:opacity-80'
      }`}
      onPress={onPress}
      disabled={disabled}>
      <Text className={`text-center text-sm font-bold ${foreground}`}>{label}</Text>
    </Pressable>
  );
}

export function LoadingNotice({ label = 'Loading...' }: { label?: string }) {
  return (
    <View className="items-center gap-3 rounded-2xl border border-border bg-white p-6 shadow-sm shadow-black/5">
      <ActivityIndicator color="#173F35" />
      <Text className="text-sm text-muted">{label}</Text>
    </View>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="gap-4 rounded-2xl border border-red-200 bg-white p-5 shadow-sm shadow-black/5">
      <Text className="text-sm leading-5 text-danger" accessibilityRole="alert">{message}</Text>
      <ActionButton label="Try again" onPress={onRetry} variant="secondary" />
    </View>
  );
}

export function EmptyNotice({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: PropsWithChildren['children'];
}) {
  return (
    <View className="items-center gap-3 rounded-2xl border border-dashed border-border bg-white p-6 shadow-sm shadow-black/5">
      <Text className="text-center text-lg font-bold text-ink">{title}</Text>
      <Text className="text-center text-sm leading-5 text-muted">{message}</Text>
      {action}
    </View>
  );
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 px-5">
        <View
          accessibilityRole="alert"
          className="w-full max-w-md gap-4 rounded-3xl border border-border bg-white p-5 shadow-lg shadow-black/20">
          <View className="gap-2">
            <Text className="text-xl font-extrabold text-ink">{title}</Text>
            <Text className="text-sm leading-5 text-muted">{message}</Text>
          </View>
          <View className="flex-row gap-3">
            <Pressable
              accessibilityRole="button"
              className="min-h-12 flex-1 items-center justify-center rounded-xl border border-border bg-white px-3 py-3"
              onPress={onCancel}>
              <Text className="text-sm font-bold text-ink">Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className={`min-h-12 flex-1 items-center justify-center rounded-xl px-3 py-3 ${
                destructive ? 'bg-danger' : 'bg-primary'
              }`}
              onPress={onConfirm}>
              <Text className="text-center text-sm font-bold text-white">{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
