import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  AssessorOnly,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  AssessorSubmissionDetails,
  AssessorSubmissionVersion,
  EvidenceReview,
  getAssessorSubmission,
  getAssessorSubmissionHistory,
  getReviewHistory,
  previewAssessorEvidence,
  reviewEvidence,
} from '@/services/assessor-reviews';

export default function AssessorSubmissionScreen() {
  return <AssessorOnly><AssessorSubmissionReview /></AssessorOnly>;
}

function AssessorSubmissionReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { credential } = useAuth();
  const [submission, setSubmission] = useState<AssessorSubmissionDetails | null>(null);
  const [versions, setVersions] = useState<AssessorSubmissionVersion[]>([]);
  const [reviews, setReviews] = useState<EvidenceReview[]>([]);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validationError, setValidationError] = useState('');

  const load = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Your assessor session or submission is unavailable. Retry from the review queue.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [record, history, submissionVersions] = await Promise.all([
        getAssessorSubmission(credential, id),
        getReviewHistory(credential, id),
        getAssessorSubmissionHistory(credential, id),
      ]);
      setSubmission(record);
      setReviews(history);
      setVersions(submissionVersions);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openFile = async (version: Pick<AssessorSubmissionDetails, 'id' | 'mime_type' | 'original_filename'>) => {
    if (!credential) return;
    setOpening(true);
    setError('');
    try {
      await previewAssessorEvidence(credential, version);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setOpening(false);
    }
  };

  const submitDecision = async (decision: EvidenceReview['decision']) => {
    setValidationError('');
    setError('');
    setSuccess('');
    const feedbackValue = feedback.trim();
    if (decision === 'CORRECTION_REQUESTED' && !feedbackValue) {
      setValidationError('Enter feedback explaining what the provider must correct.');
      return;
    }
    if (!credential || !submission) return;
    setSaving(true);
    try {
      await reviewEvidence(credential, submission.id, {
        decision,
        ...(decision === 'CORRECTION_REQUESTED' ? { feedback: feedbackValue } : {}),
      });
      setSuccess(decision === 'APPROVED' ? 'Evidence approved.' : 'Correction request sent to the provider.');
      setFeedback('');
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page keyboardAvoiding>
      {loading ? <LoadingNotice label="Loading evidence and assessment history..." /> : null}
      {!loading && error && !submission ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && submission ? (
        <>
          <PageTitle title={submission.learner_name} subtitle={`${submission.programme_name} · ${submission.learner_reference}`} />
          {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
          {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
          <View className="gap-2 border-b border-border pb-4">
            <Detail label="Evidence requirement" value={submission.requirement_title} />
            {submission.guidance ? <Text className="text-sm leading-5 text-muted">{submission.guidance}</Text> : null}
            <Detail label="Document" value={submission.original_filename} />
            <Detail label="Version" value={String(submission.version)} />
            <Detail label="Status" value={submission.status.replaceAll('_', ' ')} />
            <Detail label="Submitted" value={new Date(submission.created_at).toLocaleString()} />
            <ActionButton
              label={opening ? 'Opening document...' : 'Open evidence file'}
              onPress={() => void openFile(submission)}
              disabled={opening}
              variant="secondary"
            />
          </View>

          {submission.status === 'SUBMITTED' ? (
            <View className="gap-3 border-b border-border pb-5">
              <Text className="text-base font-bold text-ink">Record assessment decision</Text>
              <Text className="text-sm leading-5 text-muted">An approval or correction request is stored against this exact submission version.</Text>
              <Text className="text-sm font-bold text-ink">Correction feedback</Text>
              <TextInput
                accessibilityLabel="Correction feedback"
                className="min-h-24 rounded-xl border border-border bg-white px-4 py-3 text-base text-ink"
                value={feedback}
                onChangeText={setFeedback}
                maxLength={2000}
                multiline
                textAlignVertical="top"
                placeholder="Required when requesting corrections"
                placeholderTextColor="#8B9691"
                editable={!saving}
              />
              {validationError ? <Text className="text-sm text-danger" accessibilityRole="alert">{validationError}</Text> : null}
              <ActionButton label={saving ? 'Saving decision...' : 'Approve evidence'} onPress={() => void submitDecision('APPROVED')} disabled={saving} />
              <ActionButton label="Request corrections" onPress={() => void submitDecision('CORRECTION_REQUESTED')} disabled={saving} variant="secondary" />
            </View>
          ) : (
            <View className="gap-2 border-b border-border pb-4">
              <Text className="text-base font-bold text-ink">This version has been reviewed</Text>
              <Text className="text-sm leading-5 text-muted">Review decisions are immutable. A corrected upload receives a new version and can be reviewed separately.</Text>
            </View>
          )}

          <View className="gap-3 border-b border-border pb-4">
            <Text className="text-base font-bold text-ink">Previous submission versions</Text>
            {versions.filter((version) => version.version !== submission.version).map((version) => (
              <View key={version.id} className="gap-2 border-b border-border py-3">
                <Text className="text-sm font-bold text-ink">Version {version.version} · {version.status.replaceAll('_', ' ')}</Text>
                <Text className="text-sm text-muted">{version.original_filename}</Text>
                <Text className="text-xs text-muted">{new Date(version.created_at).toLocaleString()}</Text>
                <ActionButton
                  label={opening ? 'Opening document...' : `Open version ${version.version}`}
                  onPress={() => void openFile(version)}
                  disabled={opening}
                  variant="secondary"
                />
              </View>
            ))}
          </View>

          <View className="gap-3">
            <Text className="text-base font-bold text-ink">Review history</Text>
            {reviews.length === 0 ? <Text className="text-sm text-muted">No decisions recorded for this requirement.</Text> : null}
            {reviews.map((review) => (
              <View key={review.id} className="gap-1 border-b border-border py-3">
                <Text className="text-sm font-bold text-ink">Version {review.submission_version} · {review.decision.replaceAll('_', ' ')}</Text>
                {review.feedback ? <Text className="text-sm leading-5 text-muted">{review.feedback}</Text> : null}
                <Text className="text-xs text-muted">{review.assessor_name} · {new Date(review.reviewed_at).toLocaleString()}</Text>
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
    <View className="flex-row justify-between gap-4">
      <Text className="text-sm font-bold text-muted">{label}</Text>
      <Text className="flex-1 text-right text-sm text-ink">{value}</Text>
    </View>
  );
}