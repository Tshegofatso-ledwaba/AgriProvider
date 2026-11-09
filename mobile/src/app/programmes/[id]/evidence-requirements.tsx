import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  ProviderOnly,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  archiveEvidenceRequirement,
  createEvidenceRequirement,
  EvidenceRequirement,
  listEvidenceRequirements,
  updateEvidenceRequirement,
} from '@/services/evidence-requirements';
import { getProgramme, Programme } from '@/services/programmes';

export default function EvidenceRequirementsScreen() {
  return (
    <ProviderOnly>
      <EvidenceRequirements />
    </ProviderOnly>
  );
}

function EvidenceRequirements() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { credential } = useAuth();
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [requirements, setRequirements] = useState<EvidenceRequirement[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [guidance, setGuidance] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [success, setSuccess] = useState('');

  const loadChecklist = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Programme details are unavailable. Sign in again and retry.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [programmeRecord, list] = await Promise.all([
        getProgramme(credential, id),
        listEvidenceRequirements(credential, id),
      ]);
      setProgramme(programmeRecord);
      setRequirements(list);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => {
    void loadChecklist();
  }, [loadChecklist]));

  const resetEditor = () => {
    setEditingId(null);
    setTitle('');
    setGuidance('');
    setFieldError('');
  };

  const beginEdit = (requirement: EvidenceRequirement) => {
    setEditingId(requirement.id);
    setTitle(requirement.title);
    setGuidance(requirement.guidance ?? '');
    setFieldError('');
    setSuccess('');
  };

  const submit = async () => {
    setFieldError('');
    setError('');
    setSuccess('');
    const titleValue = title.trim();
    const guidanceValue = guidance.trim();
    if (!titleValue || titleValue.length > 160) {
      setFieldError('Enter a checklist title of no more than 160 characters.');
      return;
    }
    if (guidanceValue.length > 2000) {
      setFieldError('Guidance must be 2000 characters or fewer.');
      return;
    }
    if (!credential || !id) {
      setError('Your session is unavailable. Sign in again and retry.');
      return;
    }

    setSaving(true);
    try {
      const saved = editingId
        ? await updateEvidenceRequirement(credential, id, editingId, {
          title: titleValue,
          guidance: guidanceValue || null,
        })
        : await createEvidenceRequirement(credential, id, {
          title: titleValue,
          guidance: guidanceValue || null,
        });
      setRequirements((current) => {
        const next = editingId
          ? current.map((item) => item.id === saved.id ? saved : item)
          : [...current, saved];
        return next.sort((left, right) => left.created_at.localeCompare(right.created_at));
      });
      setSuccess(editingId ? 'Checklist item updated.' : 'Checklist item added.');
      resetEditor();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (requirement: EvidenceRequirement) => {
    if (!credential || !id) return;
    setArchivingId(requirement.id);
    setError('');
    setSuccess('');
    try {
      await archiveEvidenceRequirement(credential, id, requirement.id);
      setRequirements((current) => current.filter((item) => item.id !== requirement.id));
      if (editingId === requirement.id) resetEditor();
      setSuccess('Checklist item archived.');
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setArchivingId(null);
    }
  };

  const confirmArchive = (requirement: EvidenceRequirement) => {
    Alert.alert(
      'Archive checklist item?',
      'It will be removed from this active checklist.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: () => void archive(requirement) },
      ],
    );
  };

  return (
    <Page keyboardAvoiding>
      {loading ? <LoadingNotice label="Loading evidence checklist..." /> : null}
      {!loading && error && !programme ? (
        <ErrorNotice message={error} onRetry={() => void loadChecklist()} />
      ) : null}
      {!loading && programme ? (
        <>
          <PageTitle
            title="Evidence checklist"
            subtitle={`Configure items for ${programme.name}. No standard evidence items are pre-filled.`}
          />
          <View className="gap-2 rounded-2xl border border-border bg-white p-4">
            <Text className="text-sm font-bold text-ink">Provider-defined requirements</Text>
            <Text className="text-sm leading-5 text-muted">
              Providers manage submissions from each learner enrolment. Uploading evidence does not mean it has been approved.
            </Text>
          </View>

          <View className="gap-3 rounded-2xl border border-border bg-white p-5">
            <Text className="text-lg font-bold text-ink">
              {editingId ? 'Edit checklist item' : 'Add checklist item'}
            </Text>
            <View className="gap-2">
              <Text className="text-sm font-bold text-ink">Title</Text>
              <TextInput
                accessibilityLabel="Checklist item title"
                className="min-h-12 rounded-xl border border-border bg-white px-4 text-base text-ink"
                value={title}
                onChangeText={setTitle}
                placeholder="For example, provider-defined attendance record"
                placeholderTextColor="#8B9691"
                maxLength={160}
                editable={!saving}
              />
            </View>
            <View className="gap-2">
              <Text className="text-sm font-bold text-ink">Guidance (optional)</Text>
              <TextInput
                accessibilityLabel="Checklist item guidance"
                className="min-h-24 rounded-xl border border-border bg-white px-4 py-3 text-base text-ink"
                value={guidance}
                onChangeText={setGuidance}
                placeholder="Add any instructions for this item"
                placeholderTextColor="#8B9691"
                maxLength={2000}
                multiline
                textAlignVertical="top"
                editable={!saving}
              />
            </View>
            {fieldError ? <Text className="text-sm text-danger" accessibilityRole="alert">{fieldError}</Text> : null}
            <ActionButton
              label={saving ? 'Saving...' : editingId ? 'Save changes' : 'Add checklist item'}
              onPress={() => void submit()}
              disabled={saving}
            />
            {editingId ? (
              <ActionButton label="Cancel edit" onPress={resetEditor} disabled={saving} variant="secondary" />
            ) : null}
          </View>

          {error ? <ErrorNotice message={error} onRetry={() => void loadChecklist()} /> : null}
          {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
          {requirements.length === 0 ? (
            <EmptyNotice
              title="No checklist items yet"
              message="Add the evidence items your provider wants to track for this programme."
            />
          ) : requirements.map((requirement) => (
            <View key={requirement.id} className="gap-3 rounded-2xl border border-border bg-white p-5">
              <View className="gap-1">
                <Text className="text-base font-bold text-ink">{requirement.title}</Text>
                <Text className="text-sm leading-5 text-muted">
                  {requirement.guidance || 'No guidance added.'}
                </Text>
              </View>
              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${requirement.title}`}
                  className="rounded-xl border border-border bg-white px-4 py-3"
                  onPress={() => beginEdit(requirement)}>
                  <Text className="text-sm font-bold text-ink">Edit</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Archive ${requirement.title}`}
                  accessibilityState={{ disabled: archivingId === requirement.id }}
                  className={`rounded-xl border border-border bg-white px-4 py-3 ${
                    archivingId === requirement.id ? 'opacity-50' : 'active:opacity-80'
                  }`}
                  disabled={archivingId === requirement.id}
                  onPress={() => confirmArchive(requirement)}>
                  <Text className="text-sm font-bold text-danger">
                    {archivingId === requirement.id ? 'Archiving...' : 'Archive'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </Page>
  );
}
