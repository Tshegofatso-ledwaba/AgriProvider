import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Pressable, Text, View } from 'react-native';

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
import { getEnrolment, Enrolment } from '@/services/enrolments';
import {
  EvidenceCompletion,
  EvidenceHistory,
  EvidenceSubmission,
  getEvidenceHistory,
  listEnrolmentEvidence,
  previewEvidence,
  submitEvidence,
  EnrolmentEvidenceItem,
} from '@/services/evidence-submissions';

const maxFileSize = 5 * 1024 * 1024;
const acceptedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];

export default function EnrolmentEvidenceScreen() {
  return <ProviderOnly><EnrolmentEvidence /></ProviderOnly>;
}

function EnrolmentEvidence() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { credential } = useAuth();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [items, setItems] = useState<EnrolmentEvidenceItem[]>([]);
  const [completion, setCompletion] = useState<EvidenceCompletion | null>(null);
  const [history, setHistory] = useState<Record<string, EvidenceHistory>>({});
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validationMessage, setValidationMessage] = useState('');

  const loadEvidence = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Your session or enrolment is unavailable. Sign in again and retry.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [enrolmentRecord, result] = await Promise.all([
        getEnrolment(credential, id),
        listEnrolmentEvidence(credential, id),
      ]);
      setEnrolment(enrolmentRecord);
      setItems(result.requirements);
      setCompletion(result.completion);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => {
    void loadEvidence();
  }, [loadEvidence]));

  const selectAndUpload = async (item: EnrolmentEvidenceItem) => {
    setError('');
    setSuccess('');
    setValidationMessage('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: acceptedMimeTypes,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.size === 0) {
        setValidationMessage('The selected file is empty. Choose another document.');
        return;
      }
      if (typeof asset.size === 'number' && asset.size > maxFileSize) {
        setValidationMessage('Choose a PDF, JPEG, or PNG file no larger than 5 MB.');
        return;
      }
      if (asset.mimeType && !acceptedMimeTypes.includes(asset.mimeType)) {
        setValidationMessage('Choose a PDF, JPEG, or PNG file.');
        return;
      }
      if (!credential || !id) {
        setError('Your session is unavailable. Sign in again and retry.');
        return;
      }

      setUploadingId(item.requirement_id);
      setUploadProgress(0);
      await submitEvidence(
        credential,
        id,
        item.requirement_id,
        {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType ?? 'application/octet-stream',
        },
        setUploadProgress,
      );
      setSuccess(`Evidence submitted for “${item.requirement_title}”.`);
      await loadEvidence();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setUploadingId(null);
      setUploadProgress(0);
    }
  };

  const toggleHistory = async (item: EnrolmentEvidenceItem) => {
    const submission = item.latest_submission;
    if (!submission || !credential) return;
    if (expandedHistory === item.requirement_id) {
      setExpandedHistory(null);
      return;
    }
    setExpandedHistory(item.requirement_id);
    if (history[item.requirement_id]) return;

    setLoadingHistoryId(item.requirement_id);
    setError('');
    try {
      const versions = await getEvidenceHistory(credential, submission.id);
      setHistory((current) => ({ ...current, [item.requirement_id]: versions }));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoadingHistoryId(null);
    }
  };

  const openEvidence = async (submission: EvidenceSubmission) => {
    if (!credential) return;
    setPreviewingId(submission.id);
    setError('');
    try {
      await previewEvidence(credential, submission);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setPreviewingId(null);
    }
  };

  const renderVersion = (submission: EvidenceSubmission, reviews: EvidenceHistory['reviews']) => {
    const review = reviews.find((item) => item.submission_version === submission.version);
    return (
    <View key={submission.id} className="gap-2 rounded-xl bg-surface p-3">
      <Text className="text-sm font-bold text-ink">
        Version {submission.version} · {submission.status.replaceAll('_', ' ')}
      </Text>
      {review ? <Text className="text-xs font-bold text-ink">Decision: {review.decision.replaceAll('_', ' ')}</Text> : null}
      {review?.feedback ? <Text className="text-sm leading-5 text-muted">Feedback: {review.feedback}</Text> : null}
      {review ? <Text className="text-xs text-muted">Reviewed {new Date(review.reviewed_at).toLocaleString()}</Text> : null}
      <Text className="text-sm text-muted">{submission.original_filename}</Text>
      <Text className="text-xs text-muted">
        {(submission.file_size / 1024).toFixed(0)} KB · {new Date(submission.created_at).toLocaleString()}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: previewingId === submission.id }}
        disabled={previewingId === submission.id}
        className="self-start rounded-lg border border-border bg-white px-3 py-2"
        onPress={() => void openEvidence(submission)}>
        <Text className="text-sm font-bold text-primary">
          {previewingId === submission.id ? 'Opening...' : 'Open file'}
        </Text>
      </Pressable>
    </View>
    );
  };

  return (
    <Page>
      {loading ? <LoadingNotice label="Loading evidence checklist..." /> : null}
      {!loading && error && !enrolment ? <ErrorNotice message={error} onRetry={() => void loadEvidence()} /> : null}
      {!loading && enrolment ? (
        <>
          <PageTitle
            title="Evidence submissions"
            subtitle={`${enrolment.learner_name} · ${enrolment.programme_name}`}
          />
          {completion ? <CompletionSummary completion={completion} /> : null}
          <View className="gap-2 rounded-2xl border border-border bg-white p-4">
            <Text className="text-sm font-bold text-ink">Development storage notice</Text>
            <Text className="text-sm leading-5 text-muted">
              Files are stored on the API server for local development only. This is not durable production storage.
            </Text>
          </View>
          {error ? <ErrorNotice message={error} onRetry={() => void loadEvidence()} /> : null}
          {validationMessage ? (
            <Text className="text-sm text-danger" accessibilityRole="alert">{validationMessage}</Text>
          ) : null}
          {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
          {items.length === 0 ? (
            <EmptyNotice
              title="No evidence requirements"
              message="The provider has not configured any active checklist items for this programme."
            />
          ) : items.map((item) => (
            <View key={item.requirement_id} className="gap-3 rounded-2xl border border-border bg-white p-5">
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 text-base font-bold text-ink">{item.requirement_title}</Text>
                <StatusBadge status={item.status} />
              </View>
              {item.guidance ? <Text className="text-sm leading-5 text-muted">{item.guidance}</Text> : null}
              {item.latest_submission ? (
                <View className="gap-1 rounded-xl bg-surface p-3">
                  <Text className="text-sm font-bold text-ink">{item.latest_submission.original_filename}</Text>
                  <Text className="text-xs text-muted">
                    Version {item.latest_submission.version} · {(item.latest_submission.file_size / 1024).toFixed(0)} KB
                  </Text>
                  <Text className="text-xs text-muted">
                    Submitted {new Date(item.latest_submission.created_at).toLocaleString()}
                  </Text>
                  {item.latest_submission.latest_review ? (
                    <View className="mt-2 gap-1 border-t border-border pt-2">
                      <Text className="text-xs font-bold text-ink">
                        Assessor decision: {item.latest_submission.latest_review.decision.replaceAll('_', ' ')}
                      </Text>
                      {item.latest_submission.latest_review.feedback ? (
                        <Text className="text-sm leading-5 text-muted">{item.latest_submission.latest_review.feedback}</Text>
                      ) : null}
                      <Text className="text-xs text-muted">
                        Reviewed {new Date(item.latest_submission.latest_review.reviewed_at).toLocaleString()}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <Text className="text-sm text-muted">No document submitted for this item.</Text>
              )}
              {enrolment.status === 'active'
                && (item.status === 'NOT_SUBMITTED' || item.status === 'CORRECTION_REQUIRED') ? (
                <ActionButton
                  label={uploadingId === item.requirement_id
                    ? `Uploading ${Math.round(uploadProgress * 100)}%...`
                    : item.latest_submission ? 'Submit a new version' : 'Select document'}
                  onPress={() => void selectAndUpload(item)}
                  disabled={uploadingId !== null}
                />
              ) : null}
              {item.latest_submission ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    className="self-start rounded-lg px-2 py-2"
                    onPress={() => void toggleHistory(item)}>
                    <Text className="text-sm font-bold text-primary">
                      {expandedHistory === item.requirement_id ? 'Hide history' : 'View submission and review history'}
                    </Text>
                  </Pressable>
                  {expandedHistory === item.requirement_id ? (
                    loadingHistoryId === item.requirement_id
                      ? <LoadingNotice label="Loading submission history..." />
                      : <View className="gap-2">
                        {(history[item.requirement_id]?.submissions ?? []).map((submission) =>
                          renderVersion(submission, history[item.requirement_id]?.reviews ?? []))}
                      </View>
                  ) : null}
                </>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </Page>
  );
}

function CompletionSummary({ completion }: { completion: EvidenceCompletion }) {
  return (
    <View className="gap-3 rounded-2xl border border-border bg-white p-5">
      <Text className="text-lg font-bold text-ink">Checklist completion</Text>
      <View className="flex-row flex-wrap gap-2">
        <CountChip label="Required" count={completion.total_required} />
        <CountChip label="Not submitted" count={completion.not_submitted} />
        <CountChip label="Submitted" count={completion.submitted} />
        <CountChip label="Awaiting review" count={completion.awaiting_review} />
        <CountChip label="Approved" count={completion.approved} />
        <CountChip label="Correction required" count={completion.correction_required} />
      </View>
      <Text className="text-xs leading-5 text-muted">
        Submission status reflects recorded workflow data. Uploading a file does not approve evidence.
      </Text>
    </View>
  );
}

function CountChip({ label, count }: { label: string; count: number }) {
  return (
    <View className="rounded-full bg-selected px-3 py-2">
      <Text className="text-xs font-bold text-primary">{label}: {count}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: EnrolmentEvidenceItem['status'] }) {
  const style = status === 'APPROVED'
    ? 'bg-selected text-primary'
    : status === 'CORRECTION_REQUIRED'
      ? 'bg-red-100 text-danger'
      : status === 'NOT_SUBMITTED'
        ? 'bg-gray-100 text-muted'
        : 'bg-amber-100 text-amber-900';
  return (
    <Text className={`rounded-full px-2 py-1 text-xs font-bold ${style}`}>
      {status.replaceAll('_', ' ')}
    </Text>
  );
}
