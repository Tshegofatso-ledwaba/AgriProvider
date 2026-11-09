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
import { apiErrorText } from '@/services/api';
import {
  createProgramme,
  getProgramme,
  Programme,
  updateProgramme,
} from '@/services/programmes';

export function ProgrammeEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { credential } = useAuth();
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const loadProgramme = useCallback(async () => {
    if (!id) {
      return;
    }
    if (!credential) {
      await Promise.resolve();
      setLoading(false);
      setError('Your session is unavailable. Sign in again to edit this programme.');
      return;
    }

    try {
      const loaded = await getProgramme(credential, id);
      setProgramme(loaded);
      setName(loaded.name);
      setDescription(loaded.description ?? '');
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => {
    void loadProgramme();
  }, [loadProgramme]));

  const retryLoad = async () => {
    setLoading(true);
    setError('');
    await loadProgramme();
  };

  const submit = async () => {
    setFieldError('');
    setError('');
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName) {
      setFieldError('Enter a programme name.');
      return;
    }
    if (trimmedName.length > 160) {
      setFieldError('Programme names must be 160 characters or fewer.');
      return;
    }
    if (trimmedDescription.length > 2000) {
      setFieldError('Descriptions must be 2000 characters or fewer.');
      return;
    }
    if (!credential) {
      setError('Your session is unavailable. Sign in again and retry.');
      return;
    }

    setSaving(true);
    try {
      const values = {
        name: trimmedName,
        description: trimmedDescription || null,
      };
      const saved = programme
        ? await updateProgramme(credential, programme.id, values)
        : await createProgramme(credential, values);
      router.replace(routeHref(programme ? `/programmes/${saved.id}` : '/programmes'));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Page keyboardAvoiding>
        <LoadingNotice label="Loading programme..." />
      </Page>
    );
  }
  if (id && !programme && error) {
    return (
      <Page keyboardAvoiding>
        <ErrorNotice message={error} onRetry={() => void retryLoad()} />
      </Page>
    );
  }

  return (
    <Page keyboardAvoiding>
      <PageTitle
        title={programme ? 'Edit programme' : 'Create a programme'}
        subtitle="Add basic programme information. You can update it later."
      />
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">Programme name</Text>
        <TextInput
          accessibilityLabel="Programme name"
          className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Crop production"
          placeholderTextColor="#8B9691"
          maxLength={160}
          editable={!saving}
          returnKeyType="next"
        />
      </View>
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">Description (optional)</Text>
        <TextInput
          accessibilityLabel="Programme description"
          className="min-h-32 rounded-xl border border-border bg-white px-4 py-3 text-base text-ink"
          value={description}
          onChangeText={setDescription}
          placeholder="Add a short description"
          placeholderTextColor="#8B9691"
          maxLength={2000}
          multiline
          textAlignVertical="top"
          editable={!saving}
        />
        <Text className="text-right text-xs text-muted">{description.length}/2000</Text>
      </View>
      {fieldError ? (
        <Text className="text-sm text-danger" accessibilityRole="alert">{fieldError}</Text>
      ) : null}
      {error ? <Text className="text-sm leading-5 text-danger" accessibilityRole="alert">{error}</Text> : null}
      <ActionButton
        label={saving ? 'Saving...' : programme ? 'Save changes' : 'Create programme'}
        onPress={() => void submit()}
        disabled={saving}
      />
      <ActionButton
        label="Cancel"
        onPress={() => navigateBack(router, programme ? `/programmes/${programme.id}` : '/programmes')}
        disabled={saving}
        variant="secondary"
      />
    </Page>
  );
}
