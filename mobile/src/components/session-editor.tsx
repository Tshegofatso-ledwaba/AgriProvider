import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';

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
import { listProgrammes, Programme } from '@/services/programmes';
import { createSession, getSession, updateSession } from '@/services/sessions';

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function SessionEditor() {
  const { id, programmeId } = useLocalSearchParams<{ id?: string; programmeId?: string }>();
  const router = useRouter();
  const { credential } = useAuth();
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [selectedProgramme, setSelectedProgramme] = useState(programmeId ?? '');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(localDateValue(new Date()));
  const [time, setTime] = useState('09:00');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again to manage sessions.');
      return;
    }
    try {
      const availableProgrammes = await listProgrammes(credential);
      setProgrammes(availableProgrammes);
      if (id) {
        const session = await getSession(credential, id);
        setSelectedProgramme(session.programme_id);
        setTitle(session.title);
        const startsAt = new Date(session.starts_at);
        setDate(localDateValue(startsAt));
        setTime(`${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`);
      }
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const retry = async () => {
    setLoading(true);
    setError('');
    await load();
  };

  const submit = async () => {
    setError('');
    if (!id && !selectedProgramme) {
      setError('Select a programme.');
      return;
    }
    if (!title.trim() || title.trim().length > 160) {
      setError('Enter a session title of no more than 160 characters.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      setError('Enter the date as YYYY-MM-DD and time as HH:MM.');
      return;
    }
    const localStart = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(localStart.getTime())
      || localDateValue(localStart) !== date
      || `${String(localStart.getHours()).padStart(2, '0')}:${String(localStart.getMinutes()).padStart(2, '0')}` !== time) {
      setError('Enter a valid local date and time.');
      return;
    }
    if (!credential) {
      setError('Your session is unavailable. Sign in again and retry.');
      return;
    }
    setSaving(true);
    try {
      if (id) {
        await updateSession(credential, id, { title: title.trim(), startsAt: localStart.toISOString() });
        router.replace(routeHref(`/sessions/${id}`));
      } else {
        const created = await createSession(credential, {
          programmeId: selectedProgramme,
          title: title.trim(),
          startsAt: localStart.toISOString(),
        });
        router.replace(routeHref(`/sessions/${created.id}`));
      }
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Page keyboardAvoiding><LoadingNotice label="Loading session details..." /></Page>;
  if (id && error) {
    return <Page keyboardAvoiding><ErrorNotice message={error} onRetry={() => void retry()} /></Page>;
  }
  if (error && programmes.length === 0) {
    return <Page keyboardAvoiding><ErrorNotice message={error} onRetry={() => void retry()} /></Page>;
  }

  return (
    <Page keyboardAvoiding>
      <PageTitle
        title={id ? 'Edit session' : 'Create a session'}
        subtitle="Schedule a training session for one of your programmes."
      />
      {!id ? (
        <View className="gap-2">
          <Text className="text-sm font-bold text-ink">Programme</Text>
          {programmes.length === 0 ? (
            <Text className="text-sm text-muted">Create a programme before scheduling a session.</Text>
          ) : programmes.map((programme) => (
            <Pressable
              key={programme.id}
              onPress={() => setSelectedProgramme(programme.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedProgramme === programme.id }}
              className={`rounded-xl border p-4 ${
                selectedProgramme === programme.id ? 'border-primary bg-selected' : 'border-border bg-white'
              }`}>
              <Text className={`font-bold ${
                selectedProgramme === programme.id ? 'text-primary' : 'text-ink'
              }`}>{programme.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">Session title</Text>
        <TextInput
          accessibilityLabel="Session title"
          className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Field training"
          placeholderTextColor="#8B9691"
          maxLength={160}
          editable={!saving}
        />
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1 gap-2">
          <Text className="text-sm font-bold text-ink">Date</Text>
          <TextInput
            accessibilityLabel="Session date"
            className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#8B9691"
            keyboardType="numbers-and-punctuation"
            editable={!saving}
          />
        </View>
        <View className="w-28 gap-2">
          <Text className="text-sm font-bold text-ink">Time</Text>
          <TextInput
            accessibilityLabel="Session time"
            className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
            value={time}
            onChangeText={setTime}
            placeholder="HH:MM"
            placeholderTextColor="#8B9691"
            keyboardType="numbers-and-punctuation"
            editable={!saving}
          />
        </View>
      </View>
      <Text className="text-xs leading-5 text-muted">Time is interpreted in your device&apos;s local timezone and stored as a timestamp.</Text>
      {error ? <Text className="text-sm leading-5 text-danger" accessibilityRole="alert">{error}</Text> : null}
      <ActionButton
        label={saving ? 'Saving...' : id ? 'Save changes' : 'Create session'}
        onPress={() => void submit()}
        disabled={saving || (!id && !programmes.length)}
      />
      <ActionButton
        label="Cancel"
        onPress={() => navigateBack(
          router,
          id
            ? `/sessions/${id}`
            : programmeId
              ? `/programmes/${encodeURIComponent(programmeId)}`
              : '/sessions',
        )}
        disabled={saving}
        variant="secondary"
      />
    </Page>
  );
}
