import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  QaOnly,
} from '@/components/programme-ui';
import { RecordFindingForm } from '@/components/record-finding-form';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  getQaSubmission,
  previewQaEvidence,
  QaDecision,
  QaSubmissionDetails,
  recordQaReview,
} from '@/services/qa';

export default function QASubmissionScreen() {
  return <QaOnly><QASubmissionReview /></QaOnly>;
}

function QASubmissionReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { credential } = useAuth();
  const [record, setRecord] = useState<QaSubmissionDetails | null>(null);
  const [comments, setComments] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validationError, setValidationError] = useState('');

  const load = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Your QA session or assessment record is unavailable. Return to the QA dashboard and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRecord(await getQaSubmission(credential, id));
    } catch (requestError) {
      setRecord(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openEvidence = async () => {
    if (!credential || !record) return;
    setOpening(true);
    setError('');
    try {
      await previewQaEvidence(credential, record);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setOpening(false);
    }
  };

  const submitOutcome = async (decision: QaDecision) => {
    setValidationError('');
    setError('');
    setSuccess('');
    if (!comments.trim()) {
      setValidationError('Add comments explaining the QA outcome.');
      return;
    }
    if (!credential || !record) return;
    setSaving(true);
    try {
      await recordQaReview(credential, record.submission_id, { decision, comments: comments.trim() });
      setSuccess('QA outcome recorded. The assessor decision remains unchanged.');
      setComments('');
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page keyboardAvoiding>
      {loading ? <LoadingNotice label="Loading assigned assessment and QA history..." /> : null}
      {!loading && error && !record ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && record ? (
        <>
          <PageTitle title={record.learner_name} subtitle={`${record.programme_name} · ${record.learner_reference}`} />
          {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
          {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}

          <View className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Text className="text-base font-extrabold text-ink">{record.requirement_title}</Text>
                <Text className="text-sm text-muted">{record.provider_name}</Text>
              </View>
              <StatusBadge status={record.qa_status} />
            </View>
            {record.guidance ? <Text className="text-sm leading-5 text-muted">{record.guidance}</Text> : null}
            <Detail label="Assessor" value={record.assessor_name} />
            <Detail label="Assessor decision" value={record.assessor_decision.replaceAll('_', ' ')} />
            <Detail label="Version reviewed" value={String(record.submission_version)} />
            <Detail label="Submitted" value={formatDate(record.submitted_at)} />
            <Detail label="Assessed" value={formatDate(record.assessor_reviewed_at)} />
            <Detail label="Document" value={record.original_filename} />
            {record.assessor_feedback ? (
              <View className="gap-1 border-t border-border pt-3">
                <Text className="text-xs font-bold text-muted">Assessor feedback</Text>
                <Text className="text-sm leading-5 text-ink">{record.assessor_feedback}</Text>
              </View>
            ) : null}
            <ActionButton
              label={opening ? 'Opening evidence...' : 'Open evidence file'}
              onPress={() => void openEvidence()}
              disabled={opening}
              variant="secondary"
            />
          </View>

          {record.qa_status === 'AWAITING_REVIEW' ? (
            <View className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
              <Text className="text-base font-extrabold text-ink">Record QA outcome</Text>
              <Text className="text-sm leading-5 text-muted">
                This creates a separate, immutable QA record for the exact assessor decision and evidence version. It does not change the assessor decision.
              </Text>
              <Text className="text-sm font-bold text-ink">Comments</Text>
              <TextInput
                accessibilityLabel="QA outcome comments"
                className="min-h-28 rounded-xl border border-border bg-white px-4 py-3 text-base text-ink"
                value={comments}
                onChangeText={setComments}
                maxLength={4000}
                multiline
                textAlignVertical="top"
                placeholder="Explain the QA outcome"
                placeholderTextColor="#8B9691"
                editable={!saving}
              />
              {validationError ? <Text className="text-sm text-danger" accessibilityRole="alert">{validationError}</Text> : null}
              <ActionButton label={saving ? 'Saving...' : 'Verify assessment'} onPress={() => void submitOutcome('VERIFIED')} disabled={saving} />
              <ActionButton label="Further action required" onPress={() => void submitOutcome('FURTHER_ACTION_REQUIRED')} disabled={saving} variant="secondary" />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving }}
                className="min-h-11 items-center justify-center rounded-xl px-4 py-2 active:opacity-70"
                disabled={saving}
                onPress={() => void submitOutcome('NOT_VERIFIED')}>
                <Text className="text-sm font-bold text-danger">Not verified</Text>
              </Pressable>
            </View>
          ) : (
            <View className="gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <Text className="text-base font-bold text-ink">QA outcome recorded</Text>
              <Detail label="Outcome" value={record.qa_status.replaceAll('_', ' ')} />
              {record.qa_comments ? <Text className="text-sm leading-5 text-muted">{record.qa_comments}</Text> : null}
              {record.qa_reviewed_at ? <Text className="text-xs text-muted">{formatDate(record.qa_reviewed_at)}</Text> : null}
              <Text className="text-xs leading-4 text-muted">QA outcomes are separate from and do not overwrite assessor decisions.</Text>
            </View>
          )}

          {record.qa_review_id && credential ? (
            <RecordFindingForm token={credential} qaReviewId={record.qa_review_id} />
          ) : null}

          <View className="gap-3">
            <Text className="text-base font-extrabold text-ink">Assessment and QA history</Text>
            {record.history.map((item) => (
              <View key={item.assessment_review_id} className="gap-2 rounded-xl border border-border bg-white p-3">
                <Text className="text-sm font-bold text-ink">
                  Version {item.submission_version} · assessor {item.assessor_decision.replaceAll('_', ' ')}
                </Text>
                <Text className="text-xs text-muted">Assessed {formatDate(item.assessor_reviewed_at)}</Text>
                {item.assessor_feedback ? <Text className="text-sm leading-5 text-muted">Assessor: {item.assessor_feedback}</Text> : null}
                {item.qa_decision ? (
                  <Text className="text-sm text-ink">QA: {item.qa_decision.replaceAll('_', ' ')} · {formatDate(item.qa_reviewed_at ?? '')}</Text>
                ) : <Text className="text-xs text-muted">No QA outcome recorded for this version.</Text>}
                {item.qa_comments ? <Text className="text-sm leading-5 text-muted">{item.qa_comments}</Text> : null}
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Page>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4">
      <Text className="text-xs font-bold text-muted">{label}</Text>
      <Text className="flex-1 text-right text-xs text-ink">{value}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status === 'AWAITING_REVIEW' ? 'Awaiting QA' : status.replaceAll('_', ' ').toLowerCase();
  const color = status === 'VERIFIED'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'AWAITING_REVIEW' || status === 'FURTHER_ACTION_REQUIRED'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-100 text-slate-700';
  return (
    <View className={`rounded-full border px-2.5 py-1 ${color}`}>
      <Text className="text-[10px] font-extrabold capitalize">{label}</Text>
    </View>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}
