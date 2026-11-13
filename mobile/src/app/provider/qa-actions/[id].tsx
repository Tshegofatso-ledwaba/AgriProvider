import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Text, TextInput, View } from 'react-native';

import { FindingDetailsCard, FindingHistory } from '@/components/finding-ui';
import {
  ActionButton,
  ConfirmDialog,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  ProviderOnly,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { FindingDetail, getProviderFinding, respondToFinding } from '@/services/qa-findings';

export default function ProviderQaActionScreen() {
  return <ProviderOnly><ProviderQaAction /></ProviderOnly>;
}

function ProviderQaAction() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { credential } = useAuth();
  const [record, setRecord] = useState<FindingDetail | null>(null);
  const [response, setResponse] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Your session or this corrective action is unavailable. Return to the list and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRecord(await getProviderFinding(credential, id));
    } catch (requestError) {
      setRecord(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const requestSubmit = () => {
    setValidationError('');
    setSuccess('');
    if (!response.trim()) {
      setValidationError('Describe what you did to address the finding.');
      return;
    }
    setConfirming(true);
  };

  const submit = async () => {
    setConfirming(false);
    if (!credential || !record) return;
    setSaving(true);
    setError('');
    try {
      setRecord(await respondToFinding(credential, record.finding.id, response.trim()));
      setResponse('');
      setSuccess('Response submitted. The QA Officer has been notified.');
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const finding = record?.finding;
  const lastReturn = record?.events.filter((event) => event.event_type === 'RESPONSE_RETURNED').at(-1);

  return (
    <Page keyboardAvoiding>
      {loading && !record ? <LoadingNotice label="Loading corrective action..." /> : null}
      {!loading && error && !record ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {record && finding ? (
        <>
          <PageTitle title="QA corrective action" subtitle={finding.programme_name} />
          {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
          {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
          <FindingDetailsCard finding={finding} />

          {finding.status === 'OPEN' ? (
            <View className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
              <Text className="text-base font-extrabold text-ink">Your response</Text>
              {lastReturn?.comments ? (
                <View className="gap-1 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <Text className="text-xs font-bold text-amber-900">QA returned your previous response</Text>
                  <Text className="text-sm leading-5 text-ink">{lastReturn.comments}</Text>
                </View>
              ) : null}
              <Text className="text-sm leading-5 text-muted">
                Explain what was corrected. If evidence needs replacing, upload the new version from the learner&apos;s evidence workspace first.
              </Text>
              <TextInput
                accessibilityLabel="Corrective action response"
                className="min-h-28 rounded-xl border border-border bg-white px-4 py-3 text-base text-ink"
                value={response}
                onChangeText={setResponse}
                maxLength={4000}
                multiline
                textAlignVertical="top"
                placeholder="Describe the corrective action taken"
                placeholderTextColor="#8B9691"
                editable={!saving}
              />
              {validationError ? <Text className="text-sm text-danger" accessibilityRole="alert">{validationError}</Text> : null}
              <ActionButton label={saving ? 'Submitting...' : 'Submit response'} onPress={requestSubmit} disabled={saving} />
            </View>
          ) : (
            <View className="gap-1 rounded-2xl border border-border bg-white p-4">
              <Text className="text-sm font-bold text-ink">
                {finding.status === 'RESPONSE_SUBMITTED'
                  ? 'Waiting for QA to check your response'
                  : finding.status === 'VERIFIED' ? 'Verified by QA' : 'Closed'}
              </Text>
              <Text className="text-sm leading-5 text-muted">
                {finding.status === 'RESPONSE_SUBMITTED'
                  ? 'You will be notified when QA verifies the response or returns it for further action.'
                  : 'No further action is needed from you.'}
              </Text>
            </View>
          )}

          <FindingHistory events={record.events} />
          <ConfirmDialog
            visible={confirming}
            title="Submit response?"
            message="Your response is recorded permanently and sent to QA for checking."
            confirmLabel="Submit"
            onCancel={() => setConfirming(false)}
            onConfirm={() => void submit()}
          />
        </>
      ) : null}
    </Page>
  );
}
