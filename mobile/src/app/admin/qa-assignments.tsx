import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

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
  AssignableProgramme,
  listAssignableProgrammes,
} from '@/services/assessor-assignments';
import {
  createQaAssignment,
  listQaAssignments,
  listQaOfficers,
  QaOfficer,
  QaProgrammeAssignment,
  updateQaAssignment,
} from '@/services/qa';

type PendingAction = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  run: () => Promise<void>;
};

export default function AdminQaAssignmentsScreen() {
  return <AdminOnly><AdminQaAssignments /></AdminOnly>;
}

function AdminQaAssignments() {
  const { credential } = useAuth();
  const [officers, setOfficers] = useState<QaOfficer[]>([]);
  const [programmes, setProgrammes] = useState<AssignableProgramme[]>([]);
  const [assignments, setAssignments] = useState<QaProgrammeAssignment[]>([]);
  const [selectedOfficerId, setSelectedOfficerId] = useState('');
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your administrator session is unavailable. Sign in again and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [officerList, programmeList, assignmentList] = await Promise.all([
        listQaOfficers(credential),
        listAssignableProgrammes(credential),
        listQaAssignments(credential),
      ]);
      setOfficers(officerList);
      setProgrammes(programmeList);
      setAssignments(assignmentList);
      setSelectedOfficerId((current) => officerList.some((item) => item.id === current)
        ? current : officerList[0]?.id ?? '');
      setSelectedProgrammeId((current) => programmeList.some((item) => item.id === current)
        ? current : programmeList[0]?.id ?? '');
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const assign = async () => {
    if (!credential || !selectedOfficerId || !selectedProgrammeId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await createQaAssignment(credential, selectedProgrammeId, selectedOfficerId);
      setSuccess('QA Officer assigned to programme.');
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const setAssignmentStatus = async (assignment: QaProgrammeAssignment) => {
    if (!credential) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await updateQaAssignment(credential, assignment.id, assignment.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE');
      setSuccess(assignment.status === 'ACTIVE' ? 'QA programme access deactivated.' : 'QA programme access restored.');
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const activePairs = new Set(assignments
    .filter((assignment) => assignment.status === 'ACTIVE')
    .map((assignment) => `${assignment.qa_user_id}:${assignment.programme_id}`));
  const unassignedCount = programmes.filter((programme) =>
    !officers.some((officer) => activePairs.has(`${officer.id}:${programme.id}`))).length;

  return (
    <Page>
      <PageTitle title="QA programme access" subtitle="Assign QA Officers to the programmes they are authorized to review." />
      <ConfirmDialog
        visible={pendingAction !== null}
        title={pendingAction?.title ?? ''}
        message={pendingAction?.message ?? ''}
        confirmLabel={pendingAction?.confirmLabel ?? 'Confirm'}
        destructive={pendingAction?.destructive}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) void action.run();
        }}
      />
      {loading ? <LoadingNotice label="Loading QA Officers and programme scope..." /> : null}
      {!loading && error && officers.length === 0 && programmes.length === 0 ? (
        <ErrorNotice message={error} onRetry={() => void load()} />
      ) : null}
      {!loading && !error ? (
        <View className="flex-row flex-wrap gap-3">
          <ScopeMetric label="QA Officers" value={officers.length} />
          <ScopeMetric label="Programmes" value={programmes.length} />
          <ScopeMetric label="Active assignments" value={assignments.filter((item) => item.status === 'ACTIVE').length} />
          <ScopeMetric label="Unassigned programmes" value={unassignedCount} />
        </View>
      ) : null}
      {!loading && officers.length === 0 ? (
        <EmptyNotice title="No QA Officers available" message="Provision a QA Officer account before assigning programme access." />
      ) : null}
      {!loading && programmes.length === 0 ? (
        <EmptyNotice title="No active programmes" message="Provider programmes appear here after they are created." />
      ) : null}

      {!loading && officers.length > 0 && programmes.length > 0 ? (
        <View className="gap-4 rounded-[24px] border border-border bg-white p-4 shadow-sm shadow-black/5">
          <Text className="text-lg font-bold text-ink">New QA assignment</Text>
          <View className="gap-2">
            <Text className="text-sm font-bold text-ink">QA Officer</Text>
            {officers.map((officer) => (
              <Pressable
                key={officer.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: selectedOfficerId === officer.id, disabled: saving }}
                className={`rounded-xl border p-3 ${selectedOfficerId === officer.id ? 'border-primary bg-selected' : 'border-border bg-white'}`}
                disabled={saving}
                onPress={() => setSelectedOfficerId(officer.id)}>
                <Text className="text-sm font-bold text-ink">{officer.full_name}</Text>
                <Text className="text-xs text-muted">{officer.email}</Text>
              </Pressable>
            ))}
          </View>
          <View className="gap-2">
            <Text className="text-sm font-bold text-ink">Programme</Text>
            {programmes.map((programme) => (
              <Pressable
                key={programme.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: selectedProgrammeId === programme.id, disabled: saving }}
                className={`rounded-xl border p-3 ${selectedProgrammeId === programme.id ? 'border-primary bg-selected' : 'border-border bg-white'}`}
                disabled={saving}
                onPress={() => setSelectedProgrammeId(programme.id)}>
                <Text className="text-sm font-bold text-ink">{programme.name}</Text>
                <Text className="text-xs text-muted">Provider: {programme.provider_name}</Text>
              </Pressable>
            ))}
          </View>
          <ActionButton
            label={saving ? 'Assigning...' : 'Assign QA access'}
            disabled={saving || !selectedOfficerId || !selectedProgrammeId}
            onPress={() => setPendingAction({
              title: 'Assign QA Officer to programme?',
              message: 'The QA Officer will be able to view assessment records for this programme and record a separate QA outcome.',
              confirmLabel: 'Assign QA access',
              run: assign,
            })}
          />
        </View>
      ) : null}

      {error && (officers.length > 0 || programmes.length > 0) ? (
        <ErrorNotice message={error} onRetry={() => void load()} />
      ) : null}
      {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}

      <View className="gap-3">
        <Text className="text-lg font-bold text-ink">QA scope history</Text>
        {assignments.length === 0 ? (
          <EmptyNotice title="No QA programme assignments" message="QA Officers will see no assessment records until an administrator assigns programme scope." />
        ) : assignments.map((assignment) => (
          <View key={assignment.id} className="gap-3 rounded-[20px] border border-border bg-white p-4 shadow-sm shadow-black/5">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Text className="text-base font-bold text-ink">{assignment.programme_name}</Text>
                <Text className="text-sm text-muted">{assignment.qa_name} · {assignment.qa_email}</Text>
                <Text className="text-xs text-muted">Provider: {assignment.provider_name}</Text>
                <Text className="text-xs text-muted">
                  Assigned {new Date(assignment.created_at).toLocaleDateString()}
                  {assignment.deactivated_at ? ` · Deactivated ${new Date(assignment.deactivated_at).toLocaleDateString()}` : ''}
                </Text>
              </View>
              <Text className="text-[10px] font-extrabold tracking-[0.12em] text-primary">{assignment.status}</Text>
            </View>
            <ActionButton
              label={assignment.status === 'ACTIVE' ? 'Deactivate access' : 'Reactivate access'}
              variant={assignment.status === 'ACTIVE' ? 'secondary' : 'primary'}
              disabled={saving}
              onPress={() => setPendingAction({
                title: `${assignment.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'} QA access?`,
                message: `${assignment.qa_name} will ${assignment.status === 'ACTIVE' ? 'lose' : 'regain'} QA access to ${assignment.programme_name}. Assignment history is retained.`,
                confirmLabel: assignment.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate',
                destructive: assignment.status === 'ACTIVE',
                run: () => setAssignmentStatus(assignment),
              })}
            />
          </View>
        ))}
      </View>
    </Page>
  );
}

function ScopeMetric({ label, value }: { label: string; value: number }) {
  return (
    <View className="min-w-[140px] flex-1 gap-1 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
      <Text className="text-3xl font-extrabold text-ink">{value}</Text>
      <Text className="text-sm text-muted">{label}</Text>
    </View>
  );
}
