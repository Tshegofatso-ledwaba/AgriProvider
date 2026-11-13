import { useRef, useState } from 'react';
import { Link } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UserRole, useAuth } from '@/providers/auth-provider';
import { apiErrorText, hasApiBaseUrl, isRecord, requestApi } from '@/services/api';

type AuthMode = 'login' | 'register' | 'setup';

const signInTypes: { role: UserRole; label: string }[] = [
  { role: 'provider', label: 'Provider' },
  { role: 'assessor', label: 'Assessor' },
  { role: 'qa', label: 'QA officer' },
  { role: 'admin', label: 'Administrator' },
  { role: 'learner', label: 'Learner' },
];

export default function AuthWorkspace() {
  const { isBusy, sessionError, signIn, register, clearSessionError } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [accountType, setAccountType] = useState<UserRole>('provider');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false);
  const submitting = useRef(false);

  const submit = async () => {
    if (isBusy || submitting.current) return;
    setError('');
    setSuccess('');
    if (mode === 'setup') {
      if (!/^[0-9a-f]{64}$/i.test(setupCode.trim())) {
        setError('Enter the 64-character learner setup code from your provider.');
        return;
      }
      if (password.length < 12) {
        setError('Your password must be at least 12 characters.');
        return;
      }
      submitting.current = true;
      setIsSubmittingSetup(true);
      try {
        const payload = await requestApi('/api/auth/learner-activation', {
          method: 'POST',
          body: { token: setupCode.trim(), password },
        });
        if (!isRecord(payload) || !isRecord(payload.user) || typeof payload.user.email !== 'string') {
          throw new Error('The API returned an unexpected learner setup response.');
        }
        setEmail(payload.user.email);
        setAccountType('learner');
        setSetupCode('');
        setMode('login');
        setSuccess('Password set. Sign in as Learner to open your workspace.');
      } catch (requestError) {
        setError(apiErrorText(requestError));
      } finally {
        submitting.current = false;
        setIsSubmittingSetup(false);
      }
      return;
    }

    if (mode === 'register' && !fullName.trim()) {
      setError('Enter your full name.');
      return;
    }
    if (mode === 'register' && fullName.trim().length > 120) {
      setError('Your name must be 120 characters or fewer.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 12) {
      setError('Your password must be at least 12 characters.');
      return;
    }

    submitting.current = true;
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (mode === 'register') {
        await register(fullName.trim(), normalizedEmail, password);
      } else {
        await signIn(normalizedEmail, password, accountType);
      }
      setPassword('');
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      submitting.current = false;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          className="flex-1"
          contentContainerClassName={`mx-auto w-full max-w-[520px] gap-6 px-5 pt-5 ${
            Platform.OS === 'web' ? 'pb-28' : 'pb-9'
          }`}
          keyboardShouldPersistTaps="handled">
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-sm shadow-primary/30">
              <Text className="text-2xl font-extrabold text-white">A</Text>
            </View>
            <View>
              <Text className="text-lg font-extrabold text-ink">AgriProvider</Text>
              <Text className="mt-1 text-[10px] font-bold tracking-widest text-muted">
                TRAINING & QUALITY ASSURANCE
              </Text>
            </View>
          </View>

          <View className="gap-3 rounded-[28px] border border-primary/15 bg-primary p-5 shadow-sm shadow-black/10">
            <Text className="text-[11px] font-extrabold tracking-[0.2em] text-white/75">TRAINING WORKSPACE</Text>
            <Text className="text-3xl font-extrabold leading-9 text-white">
              Deliver training, evidence and review with clarity.
            </Text>
            <Text className="text-base leading-6 text-white/80">
              Keep providers, assessors, administrators and QA teams aligned from a single secure workflow.
            </Text>
          </View>

          <View className="gap-5 rounded-[28px] border border-border bg-white p-5 shadow-sm shadow-black/5">
            <View className="gap-3 rounded-2xl bg-primary/5 p-4">
              <Text className="text-[11px] font-extrabold tracking-[0.2em] text-primary">
                {mode === 'login' ? 'WELCOME BACK' : mode === 'setup' ? 'LEARNER SETUP' : 'CREATE ACCOUNT'}
              </Text>
              <Text className="text-2xl font-extrabold text-ink">
                {mode === 'login' ? 'Access your workspace' : mode === 'setup' ? 'Set up learner access' : 'Create a provider account'}
              </Text>
              <Text className="text-sm leading-5 text-muted">
                {mode === 'login'
                  ? 'Sign in to continue with your training operations.'
                  : mode === 'setup'
                    ? 'Use the one-time setup code provided by your training provider.'
                    : 'You are creating a Provider account for the training workspace.'}
              </Text>
            </View>

            {mode === 'register' ? (
              <View className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
                <View className="flex-row items-center gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary">
                    <Text className="text-sm font-extrabold text-white">P</Text>
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="text-base font-extrabold text-ink">Provider</Text>
                    <Text className="text-xs leading-5 text-muted">
                      Public sign-up creates the provider workspace for managing programmes, learners, attendance, and evidence.
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            {mode === 'login' ? (
              <View className="gap-2">
                <Text className="text-sm font-bold text-ink">Sign in as</Text>
                <View className="flex-row flex-wrap gap-2">
                  {signInTypes.map(({ role, label }) => {
                    const selected = accountType === role;
                    return (
                      <Pressable
                        key={role}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled: isBusy }}
                        className={`rounded-xl border px-3 py-2 ${
                          selected ? 'border-primary bg-primary/10' : 'border-border bg-white'
                        }`}
                        onPress={() => setAccountType(role)}
                        disabled={isBusy}>
                        <Text className={`text-sm font-bold ${selected ? 'text-primary' : 'text-ink'}`}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text className="text-xs leading-5 text-muted">
                  Choose the workspace tied to your account. Access is controlled by your assigned role.
                </Text>
              </View>
            ) : null}

            {mode === 'register' ? (
              <FormField
                label="Full name"
                value={fullName}
                onChangeText={setFullName}
                placeholder="Your name"
                autoComplete="name"
                editable={!isBusy}
              />
            ) : null}
            {mode === 'setup' ? (
              <FormField
                label="Learner setup code"
                value={setupCode}
                onChangeText={setSetupCode}
                placeholder="Paste the one-time code"
                autoComplete="off"
                editable={!isBusy && !isSubmittingSetup}
              />
            ) : null}
            {mode !== 'setup' ? (
              <FormField
                label="Work email"
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.com"
                autoComplete="email"
                keyboardType="email-address"
                editable={!isBusy}
              />
            ) : null}
            <View className="gap-2">
              <Text className="text-sm font-bold text-ink">{mode === 'setup' ? 'Choose a password' : 'Password'}</Text>
              <View className="min-h-12 flex-row items-center rounded-xl border border-border bg-white px-4">
                <TextInput
                  accessibilityLabel="Password"
                  className="min-h-12 min-w-0 flex-1 py-3 text-base text-ink"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 12 characters"
                  placeholderTextColor="#8B9691"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!passwordVisible}
                  editable={!isBusy && !isSubmittingSetup}
                  onSubmitEditing={() => void submit()}
                  returnKeyType="go"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                  accessibilityState={{ disabled: isBusy }}
                  className="ml-3 min-h-10 justify-center px-1"
                  onPress={() => setPasswordVisible((visible) => !visible)}
                  disabled={isBusy}>
                  <Text className="text-sm font-bold text-primary">
                    {passwordVisible ? 'Hide' : 'Show'}
                  </Text>
                </Pressable>
              </View>
            </View>
            {success ? <Text className="text-sm text-emerald-700" accessibilityRole="alert">{success}</Text> : null}
            {error || sessionError ? (
              <Text className="text-sm leading-5 text-danger" accessibilityRole="alert">
                {error || sessionError}
              </Text>
            ) : null}
            {!hasApiBaseUrl ? (
              <Text className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Configure EXPO_PUBLIC_API_URL in mobile/.env before signing in.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy || isSubmittingSetup || !hasApiBaseUrl, busy: isBusy || isSubmittingSetup }}
              className={`min-h-12 flex-row items-center justify-center rounded-2xl bg-primary px-4 py-4 ${
                isBusy || isSubmittingSetup || !hasApiBaseUrl ? 'opacity-50' : 'active:opacity-80'
              }`}
              onPress={() => void submit()}
              disabled={isBusy || isSubmittingSetup || !hasApiBaseUrl}>
              {isBusy || isSubmittingSetup ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="text-center text-base font-extrabold text-white">
                  {mode === 'login' ? 'Sign in securely' : mode === 'setup' ? 'Set learner password' : 'Create provider account'}
                </Text>
              )}
            </Pressable>

            <View className="flex-row flex-wrap items-center justify-center gap-1">
              {mode !== 'setup' ? (
                <>
                  <Text className="text-sm text-muted">
                    {mode === 'login' ? 'New to AgriProvider?' : 'Already have an account?'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isBusy}
                    onPress={() => {
                      setMode(mode === 'login' ? 'register' : 'login');
                      setPasswordVisible(false);
                      setError('');
                      setSuccess('');
                      clearSessionError();
                    }}>
                    <Text className="p-1 text-sm font-extrabold text-primary">
                      {mode === 'login' ? 'Create account' : 'Sign in'}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>

            {mode === 'login' ? (
              <Pressable
                accessibilityRole="button"
                disabled={isBusy}
                onPress={() => {
                  setMode('setup');
                  setError('');
                  setSuccess('');
                  setPassword('');
                }}>
                <Text className="text-center text-sm font-bold text-primary">Set up a learner account</Text>
              </Pressable>
            ) : null}

            {mode === 'login' ? (
              <Link href="/verify-certificate" asChild>
                <Pressable accessibilityRole="button" className="min-h-10 items-center justify-center rounded-xl border border-border bg-surface px-4 py-2 active:opacity-70">
                  <Text className="text-sm font-bold text-primary">Verify a certificate</Text>
                </Pressable>
              </Link>
            ) : null}

            <Text className="border-t border-border pt-3 text-center text-xs leading-5 text-muted">
              Passwords are protected on the server. Web sessions use an HttpOnly cookie; mobile tokens use secure device storage.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  autoComplete,
  keyboardType,
  secureTextEntry = false,
  editable,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  autoComplete: 'name' | 'email' | 'current-password' | 'new-password' | 'off';
  keyboardType?: 'default' | 'email-address';
  secureTextEntry?: boolean;
  editable: boolean;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8B9691"
        autoComplete={autoComplete}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={secureTextEntry || keyboardType === 'email-address' || autoComplete === 'off' ? 'none' : 'words'}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        editable={editable}
      />
    </View>
  );
}
