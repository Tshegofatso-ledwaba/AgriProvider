import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  ErrorNotice,
  LoadingNotice,
  navigateBack,
  Page,
  PageTitle,
  routeHref,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { ApiError, apiErrorText } from '@/services/api';
import { createLearner, getLearner, Learner, updateLearner } from '@/services/learners';

export function LearnerEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { credential } = useAuth();
  const [learner, setLearner] = useState<Learner | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const loadLearner = useCallback(async () => {
    if (!id) return;
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again to edit this learner.');
      return;
    }

    try {
      const loaded = await getLearner(credential, id);
      if (loaded.status === 'archived') {
        setError('Archived learner records cannot be edited.');
        return;
      }
      setLearner(loaded);
      setFullName(loaded.full_name);
      setPhone(loaded.phone ?? '');
      setEmail(loaded.email ?? '');
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => {
    void loadLearner();
  }, [loadLearner]));

  const retryLoad = async () => {
    setLoading(true);
    setError('');
    await loadLearner();
  };

  const submit = async (allowDuplicate = false) => {
    setFieldError('');
    setError('');
    const nameValue = fullName.trim();
    const phoneValue = phone.trim();
    const emailValue = email.trim().toLowerCase();
    if (!nameValue || nameValue.length > 120) {
      setFieldError('Enter a full name of no more than 120 characters.');
      return;
    }
    if (phoneValue && (
      phoneValue.length > 32 || !/^[+0-9().\-\s]+$/.test(phoneValue) || !/\d/.test(phoneValue)
    )) {
      setFieldError('Enter a valid phone number of no more than 32 characters.');
      return;
    }
    if (emailValue && (
      emailValue.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)
    )) {
      setFieldError('Enter a valid email address.');
      return;
    }
    if (!credential) {
      setError('Your session is unavailable. Sign in again and retry.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const values = {
        fullName: nameValue,
        phone: phoneValue || null,
        email: emailValue || null,
        ...(allowDuplicate ? { confirmPossibleDuplicate: true } : {}),
      };
      const saved = learner
        ? await updateLearner(credential, learner.id, values)
        : await createLearner(credential, values);
      router.replace(routeHref(learner ? `/learners/${saved.id}` : '/learners'));
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === 'POSSIBLE_DUPLICATE') {
        setConfirmDuplicate(true);
        setError(requestError.message);
      } else {
        setError(apiErrorText(requestError));
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Page keyboardAvoiding><LoadingNotice label="Loading learner..." /></Page>;
  }
  if (id && !learner && error) {
    return <Page keyboardAvoiding><ErrorNotice message={error} onRetry={() => void retryLoad()} /></Page>;
  }

  return (
    <Page keyboardAvoiding>
      <PageTitle
        title={learner ? 'Edit learner' : 'Register a learner'}
        subtitle="Only the approved profile details are collected. A private internal reference is generated automatically."
      />
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">Full name</Text>
        <TextInput
          accessibilityLabel="Learner full name"
          className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
          value={fullName}
          onChangeText={(value) => { setFullName(value); setConfirmDuplicate(false); }}
          placeholder="Learner full name"
          placeholderTextColor="#8B9691"
          maxLength={120}
          editable={!saving}
          autoCapitalize="words"
          returnKeyType="next"
        />
      </View>
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">Phone (optional)</Text>
        <TextInput
          accessibilityLabel="Learner phone"
          className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
          value={phone}
          onChangeText={(value) => { setPhone(value); setConfirmDuplicate(false); }}
          placeholder="+27 00 000 0000"
          placeholderTextColor="#8B9691"
          maxLength={32}
          editable={!saving}
          keyboardType="phone-pad"
        />
      </View>
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">Email (optional)</Text>
        <TextInput
          accessibilityLabel="Learner email"
          className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
          value={email}
          onChangeText={(value) => { setEmail(value); setConfirmDuplicate(false); }}
          placeholder="name@example.com"
          placeholderTextColor="#8B9691"
          maxLength={254}
          editable={!saving}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
      </View>
      <Text className="text-xs leading-5 text-muted">
        Learner reference and registration date are assigned by the system. No national identity number is collected.
      </Text>
      {fieldError ? <Text className="text-sm text-danger" accessibilityRole="alert">{fieldError}</Text> : null}
      {error ? <Text className="text-sm leading-5 text-danger" accessibilityRole="alert">{error}</Text> : null}
      <ActionButton
        label={saving ? 'Saving...' : confirmDuplicate ? 'Continue anyway' : learner ? 'Save changes' : 'Register learner'}
        onPress={() => void submit(confirmDuplicate)}
        disabled={saving}
      />
      <ActionButton
        label="Cancel"
        onPress={() => navigateBack(router, learner ? `/learners/${learner.id}` : '/learners')}
        disabled={saving}
        variant="secondary"
      />
    </Page>
  );
}
