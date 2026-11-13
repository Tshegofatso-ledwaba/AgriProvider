import { useCallback, useState } from 'react';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';

import { FindingDetailsCard, FindingHistory } from '@/components/finding-ui';
import {
  ActionButton,
  ConfirmDialog,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  QaOnly,
  routeHref,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { FindingDetail, getQaFinding, transitionQaFinding } from '@/services/qa-findings';

type QaAction = 'verify' | 'return' | 'close';

const actionCopy: Record<QaAction, { title: string; message: string; confirm: string; success: string }> = {
  verify: {
    title: 'Verify corrective action?',
    message: 'This confirms the provider response resolves the finding. It is recorded permanently.',
    confirm: 'Verify',
    success: 'Corrective action verified. Close the finding when no further QA action is needed.',
  },
  return: {
    title: 'Return for further action?',
    message: 'The finding reopens and the provider is notified to respond again. Their previous response stays in the history.',
    confirm: 'Return to provider',
    success: 'Response returned. The provider has been notified.',
  },
  close: {
    title: 'Close this finding?',
    message: 'Closing is final. The finding and its history remain available for audit.',
    confirm: 'Close finding',
    success: 'Finding closed.',
  },
};

export default function QaFindingScreen() {
  return <QaOnly><QaFindingDetail /></QaOnly>;
}

function QaFindingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { credential } = useAuth();
  const [record, setRecord] = useState<FindingDetail | null>(null);
  const [comments, setComments] = useState('');
  const [pendingAction, setPendingAction] = useState<QaAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Your QA session or finding is unavailable. Return to the findings list and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRecord(await getQaFinding(credential, id));
    } catch (requestError) {
      setRecord(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const requestAction = (action: QaAction) => {
    setValidationError('');
    setSuccess('');
    if (!comments.trim()) {
      setValidationError('Add comments before recording this decision.');
      return;
    }
    setPendingAction(action);
  };

  const runAction = async () => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action || !credential || !record) return;
    setSaving(true);
    setError('');
    try {
      setRecord(await transitionQaFinding(credential, record.finding.id, action, comments.trim()));
      setComments('');
      setSuccess(actionCopy[action].success);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const status = record?.finding.status;
  const canAct = status === 'RESPONSE_SUBMITTED' || status === 'VERIFIED';

  return (
    <Page keyboardAvoiding>
      {loading && !record ? <LoadingNotice label="Loading finding..." /> : null}
      {!loading && error && !record ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {record ? (
        <>
          <PageTitle title="QA finding" subtitle={record.finding.programme_name} />
          {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
          {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
          <FindingDetailsCard finding={record.finding} />
          <Link href={routeHref(`/qa/submissions/${record.finding.submission_id}`)} asChild>
            <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center self-start rounded-xl border border-border bg-white px-4 py-2 active:opacity-80">
              <Text className="text-sm font-bold text-ink">Open assessment record</Text>
            </Pressable>
          </Link>

          {canAct ? (
            <View className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
              <Text className="text-base font-extrabold text-ink">
                {status === 'RESPONSE_SUBMITTED' ? 'Check the provider response' : 'Close the finding'}
              </Text>
              <Text className="text-sm leading-5 text-muted">
                {status === 'RESPONSE_SUBMITTED'
                  ? 'Verify the response if it resolves the finding, or return it to the provider with comments.'
                  : 'The corrective action has been verified. Add closure comments to close the finding.'}
              </Text>
              <TextInput
                accessibilityLabel="QA comments"
                className="min-h-24 rounded-xl border border-border bg-white px-4 py-3 text-base text-ink"
                value={comments}
                onChangeText={setComments}
                maxLength={4000}
                multiline
                textAlignVertical="top"
                placeholder="Comments shared with the provider"
                placeholderTextColor="#8B9691"
                editable={!saving}
              />
              {validationError ? <Text className="text-sm text-danger" accessibilityRole="alert">{validationError}</Text> : null}
              {status === 'RESPONSE_SUBMITTED' ? (
                <>
                  <ActionButton label={saving ? 'Saving...' : 'Verify corrective action'} onPress={() => requestAction('verify')} disabled={saving} />
                  <ActionButton label="Return for further action" onPress={() => requestAction('return')} disabled={saving} variant="secondary" />
                </>
              ) : (
                <ActionButton label={saving ? 'Saving...' : 'Close finding'} onPress={() => requestAction('close')} disabled={saving} />
              )}
            </View>
          ) : (
            <View className="gap-1 rounded-2xl border border-border bg-white p-4">
              <Text className="text-sm font-bold text-ink">
                {status === 'OPEN' ? 'Waiting for the provider' : 'No further QA action'}
              </Text>
              <Text className="text-sm leading-5 text-muted">
                {status === 'OPEN'
                  ? 'The provider has been notified. You can check the response once it is submitted.'
                  : 'This finding is closed. Its history remains available for audit.'}
              </Text>
            </View>
          )}

          <FindingHistory events={record.events} />
          <ConfirmDialog
            visible={pendingAction !== null}
            title={pendingAction ? actionCopy[pendingAction].title : ''}
            message={pendingAction ? actionCopy[pendingAction].message : ''}
            confirmLabel={pendingAction ? actionCopy[pendingAction].confirm : 'Confirm'}
            onCancel={() => setPendingAction(null)}
            onConfirm={() => void runAction()}
          />
        </>
      ) : null}
    </Page>
  );
}
