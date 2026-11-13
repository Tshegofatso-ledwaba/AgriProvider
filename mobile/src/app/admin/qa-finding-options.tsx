import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';

import { FilterChip } from '@/components/finding-ui';
import {
  ActionButton,
  AdminOnly,
  ConfirmDialog,
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  createFindingOption,
  FindingOptionKind,
  listManagedFindingOptions,
  ManagedFindingOption,
  updateFindingOption,
} from '@/services/qa-findings';

const kindLabels: Record<FindingOptionKind, string> = { CATEGORY: 'Categories', SEVERITY: 'Severities' };

export default function FindingOptionsScreen() {
  return <AdminOnly><FindingOptions /></AdminOnly>;
}

function FindingOptions() {
  const { credential } = useAuth();
  const [options, setOptions] = useState<ManagedFindingOption[] | null>(null);
  const [kind, setKind] = useState<FindingOptionKind>('CATEGORY');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [toggleTarget, setToggleTarget] = useState<ManagedFindingOption | null>(null);

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your administrator session is unavailable. Sign in again and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setOptions(await listManagedFindingOptions(credential));
    } catch (requestError) {
      setOptions(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const add = async () => {
    setFormError('');
    setSuccess('');
    if (!label.trim()) {
      setFormError('Enter a label.');
      return;
    }
    if (!credential) return;
    setSaving(true);
    try {
      await createFindingOption(credential, kind, label.trim());
      setLabel('');
      setSuccess(`${kind === 'CATEGORY' ? 'Category' : 'Severity'} added.`);
      await load();
    } catch (requestError) {
      setFormError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async () => {
    const target = toggleTarget;
    setToggleTarget(null);
    if (!target || !credential) return;
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      await updateFindingOption(credential, target.id, { isActive: !target.is_active });
      setSuccess(`"${target.label}" ${target.is_active ? 'deactivated' : 'reactivated'}.`);
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const visible = options?.filter((option) => option.kind === kind) ?? [];

  return (
    <Page keyboardAvoiding onRefresh={() => void load()} refreshing={loading}>
      <PageTitle
        title="QA finding options"
        subtitle="Configure the categories and severities QA Officers can assign to findings. Nothing is pre-filled; use your organisation's approved scales."
      />
      <View className="flex-row gap-2">
        {(['CATEGORY', 'SEVERITY'] as const).map((value) => (
          <FilterChip key={value} label={kindLabels[value]} selected={kind === value} onPress={() => setKind(value)} />
        ))}
      </View>

      <View className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
        <Text className="text-base font-extrabold text-ink">Add {kind === 'CATEGORY' ? 'category' : 'severity'}</Text>
        <TextInput
          accessibilityLabel={`New ${kind === 'CATEGORY' ? 'category' : 'severity'} label`}
          className="min-h-11 rounded-xl border border-border bg-white px-4 text-base text-ink"
          value={label}
          onChangeText={setLabel}
          maxLength={80}
          placeholder="Label"
          placeholderTextColor="#8B9691"
          editable={!saving}
          onSubmitEditing={() => void add()}
        />
        {formError ? <Text className="text-sm text-danger" accessibilityRole="alert">{formError}</Text> : null}
        {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
        <ActionButton label={saving ? 'Saving...' : 'Add'} onPress={() => void add()} disabled={saving} />
      </View>

      {loading ? <LoadingNotice label="Loading finding options..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && options ? (
        visible.length ? (
          <View className="gap-2">
            {visible.map((option) => (
              <View key={option.id} className="flex-row items-center justify-between gap-3 rounded-xl border border-border bg-white p-3">
                <View className="flex-1 gap-1">
                  <Text className={`text-sm font-bold ${option.is_active ? 'text-ink' : 'text-muted line-through'}`}>{option.label}</Text>
                  <Text className="text-xs text-muted">
                    {option.is_active ? 'Active' : 'Inactive'} · used on {option.usage_count} finding{option.usage_count === 1 ? '' : 's'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${option.is_active ? 'Deactivate' : 'Reactivate'} ${option.label}`}
                  className="min-h-10 justify-center rounded-xl border border-border px-3 active:opacity-70"
                  disabled={saving}
                  onPress={() => setToggleTarget(option)}>
                  <Text className={`text-xs font-bold ${option.is_active ? 'text-danger' : 'text-primary'}`}>
                    {option.is_active ? 'Deactivate' : 'Reactivate'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <EmptyNotice
            title={`No ${kindLabels[kind].toLowerCase()} configured`}
            message="QA Officers can still record findings without them. Add labels from your approved QA policy."
          />
        )
      ) : null}

      <ConfirmDialog
        visible={toggleTarget !== null}
        title={toggleTarget?.is_active ? 'Deactivate option?' : 'Reactivate option?'}
        message={toggleTarget?.is_active
          ? 'QA Officers will no longer be able to select it. Existing findings keep their label.'
          : 'QA Officers will be able to select it again.'}
        confirmLabel={toggleTarget?.is_active ? 'Deactivate' : 'Reactivate'}
        destructive={toggleTarget?.is_active}
        onCancel={() => setToggleTarget(null)}
        onConfirm={() => void toggle()}
      />
    </Page>
  );
}
