import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Text, TextInput, View } from 'react-native';

import { FilterChip } from '@/components/finding-ui';
import { ActionButton, routeHref } from '@/components/programme-ui';
import { apiErrorText } from '@/services/api';
import { createQaFinding, FindingOption, listActiveFindingOptions } from '@/services/qa-findings';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function RecordFindingForm({ token, qaReviewId }: { token: string; qaReviewId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<FindingOption[] | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [finding, setFinding] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [severityId, setSeverityId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    listActiveFindingOptions(token)
      .then((result) => { if (!cancelled) setOptions(result); })
      .catch((requestError) => { if (!cancelled) setOptionsError(apiErrorText(requestError)); });
    return () => { cancelled = true; };
  }, [open, options, token]);

  const submit = async () => {
    if (submitting.current) return;
    const nextErrors: Record<string, string> = {};
    if (!finding.trim()) nextErrors.finding = 'Describe the finding.';
    if (!correctiveAction.trim()) nextErrors.correctiveAction = 'Describe the corrective action required.';
    if (dueDate.trim() && !datePattern.test(dueDate.trim())) nextErrors.dueDate = 'Use the YYYY-MM-DD format, for example 2026-12-01.';
    setErrors(nextErrors);
    setError('');
    if (Object.keys(nextErrors).length) return;

    submitting.current = true;
    setSaving(true);
    try {
      const created = await createQaFinding(token, {
        qaReviewId,
        finding: finding.trim(),
        correctiveAction: correctiveAction.trim(),
        categoryId,
        severityId,
        dueDate: dueDate.trim() || null,
      });
      router.push(routeHref(`/qa/findings/${created.finding.id}`));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <View className="gap-2 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
        <Text className="text-base font-extrabold text-ink">Findings and corrective actions</Text>
        <Text className="text-sm leading-5 text-muted">
          Record a finding when the provider must take corrective action. The provider is notified and must respond before you can verify it.
        </Text>
        <ActionButton label="Record a finding" onPress={() => setOpen(true)} variant="secondary" />
      </View>
    );
  }

  const categories = options?.filter((option) => option.kind === 'CATEGORY') ?? [];
  const severities = options?.filter((option) => option.kind === 'SEVERITY') ?? [];

  return (
    <View className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
      <Text className="text-base font-extrabold text-ink">Record a finding</Text>
      <Text className="text-xs leading-4 text-muted">
        The provider will see the finding and corrective action. Your QA review comments stay internal.
      </Text>

      <Field label="Finding" error={errors.finding}>
        <TextInput
          accessibilityLabel="Finding"
          className="min-h-24 rounded-xl border border-border bg-white px-4 py-3 text-base text-ink"
          value={finding}
          onChangeText={setFinding}
          maxLength={4000}
          multiline
          textAlignVertical="top"
          placeholder="What did the QA review identify?"
          placeholderTextColor="#8B9691"
          editable={!saving}
        />
      </Field>
      <Field label="Corrective action required" error={errors.correctiveAction}>
        <TextInput
          accessibilityLabel="Corrective action required"
          className="min-h-24 rounded-xl border border-border bg-white px-4 py-3 text-base text-ink"
          value={correctiveAction}
          onChangeText={setCorrectiveAction}
          maxLength={4000}
          multiline
          textAlignVertical="top"
          placeholder="What must the provider do?"
          placeholderTextColor="#8B9691"
          editable={!saving}
        />
      </Field>

      {optionsError ? <Text className="text-sm text-danger">{optionsError}</Text> : null}
      {options && categories.length ? (
        <OptionPicker label="Category (optional)" options={categories} selected={categoryId} onSelect={setCategoryId} />
      ) : null}
      {options && severities.length ? (
        <OptionPicker label="Severity (optional)" options={severities} selected={severityId} onSelect={setSeverityId} />
      ) : null}
      {options && !categories.length && !severities.length ? (
        <Text className="text-xs leading-4 text-muted">
          No categories or severities are configured. An administrator can add them under Finding options.
        </Text>
      ) : null}

      <Field label="Due date (optional)" error={errors.dueDate}>
        <TextInput
          accessibilityLabel="Due date in year-month-day format"
          className="min-h-11 rounded-xl border border-border bg-white px-4 text-base text-ink"
          value={dueDate}
          onChangeText={setDueDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#8B9691"
          autoCapitalize="none"
          maxLength={10}
          editable={!saving}
        />
      </Field>

      {error ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
      <ActionButton label={saving ? 'Recording...' : 'Record finding'} onPress={() => void submit()} disabled={saving} />
      <ActionButton label="Cancel" onPress={() => setOpen(false)} disabled={saving} variant="secondary" />
    </View>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      {children}
      {error ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

function OptionPicker({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: FindingOption[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        <FilterChip label="None" selected={selected === null} onPress={() => onSelect(null)} />
        {options.map((option) => (
          <FilterChip key={option.id} label={option.label} selected={selected === option.id} onPress={() => onSelect(option.id)} />
        ))}
      </View>
    </View>
  );
}
