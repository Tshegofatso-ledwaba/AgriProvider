import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  ActionButton,
  AdminOnly,
  ConfirmDialog,
  DashboardHero,
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  routeHref,
  SummaryCard,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  AssessorAssignment,
  AssignableProgramme,
  AvailableAssessor,
  createAssessorAssignment,
  listAssessorAssignments,
  listAssignableProgrammes,
  listAvailableAssessors,
  updateAssessorAssignment,
} from '@/services/assessor-assignments';

type AssignmentConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
};

export default function AdminAssignmentsScreen() {
  return <AdminOnly><AdminAssignments /></AdminOnly>;
}

function AdminAssignments() {
  const { credential } = useAuth();
  const [assessors, setAssessors] = useState<AvailableAssessor[]>([]);
  const [programmes, setProgrammes] = useState<AssignableProgramme[]>([]);
  const [assignments, setAssignments] = useState<AssessorAssignment[]>([]);
  const [selectedAssessorId, setSelectedAssessorId] = useState('');
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState<AssignmentConfirmation | null>(null);

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your administrator session is unavailable. Sign in again and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [assessorList, programmeList, assignmentList] = await Promise.all([
        listAvailableAssessors(credential),
        listAssignableProgrammes(credential),
        listAssessorAssignments(credential),
      ]);
      setAssessors(assessorList);
      setProgrammes(programmeList);
      setAssignments(assignmentList);
      setSelectedAssessorId((current) => current || assessorList[0]?.id || '');
      setSelectedProgrammeId((current) => current || programmeList[0]?.id || '');
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const assign = async () => {
    if (!credential || !selectedAssessorId || !selectedProgrammeId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await createAssessorAssignment(credential, selectedProgrammeId, selectedAssessorId);
      setSuccess('Assessor assigned to programme.');
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const changeAssignment = async (assignment: AssessorAssignment) => {
    if (!credential) return;
    setUpdatingId(assignment.id);
    setError('');
    setSuccess('');
    try {
      await updateAssessorAssignment(
        credential,
        assignment.id,
        { status: assignment.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      );
      setSuccess(assignment.status === 'ACTIVE' ? 'Assignment deactivated.' : 'Assignment reactivated.');
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setUpdatingId(null);
    }
  };

  const reassign = async (assignment: AssessorAssignment, assessor: AvailableAssessor) => {
    if (!credential) return;
    setUpdatingId(assignment.id);
    setError('');
    setSuccess('');
    try {
      await updateAssessorAssignment(credential, assignment.id, { assessorUserId: assessor.id });
      setSuccess(`Programme reassigned to ${assessor.full_name}.`);
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setUpdatingId(null);
    }
  };

  const confirmPendingAction = async () => {
    const pending = confirmation;
    if (!pending) return;
    setConfirmation(null);
    await pending.onConfirm();
  };

  const activeProgrammeIds = new Set(
    assignments.filter((assignment) => assignment.status === 'ACTIVE').map((assignment) => assignment.programme_id),
  );
  const unassignedProgrammeCount = programmes.filter((programme) => !activeProgrammeIds.has(programme.id)).length;

  return (
    <Page>
      <DashboardHero
        eyebrow="OPERATIONS"
        title="Administrator workspace"
        subtitle="Manage assessor access and programme assignments."
        symbol={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }}
      />
      <Link href={routeHref('/admin/qa-assignments')} asChild>
        <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center self-start rounded-xl border border-border bg-white px-4 py-3 active:opacity-80">
          <Text className="text-sm font-bold text-ink">Manage QA programme access</Text>
        </Pressable>
      </Link>
      <Link href={routeHref('/admin/qa-finding-options')} asChild>
        <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center self-start rounded-xl border border-border bg-white px-4 py-3 active:opacity-80">
          <Text className="text-sm font-bold text-ink">Configure QA finding categories and severities</Text>
        </Pressable>
      </Link>
      <Link href={routeHref('/admin/certificates')} asChild>
        <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center self-start rounded-xl border border-border bg-white px-4 py-3 active:opacity-80">
          <Text className="text-sm font-bold text-ink">Certificate authorization</Text>
        </Pressable>
      </Link>
      <ConfirmDialog
        visible={confirmation !== null}
        title={confirmation?.title ?? ''}
        message={confirmation?.message ?? ''}
        confirmLabel={confirmation?.confirmLabel ?? 'Confirm'}
        destructive={confirmation?.destructive}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmPendingAction()}
      />
      {loading ? <LoadingNotice label="Loading assessors, programmes, and assignments..." /> : null}
      {error && !assessors.length && !programmes.length ? (
        <ErrorNotice message={error} onRetry={() => void load()} />
      ) : null}
      {!loading && !error ? (
        <View className="flex-row flex-wrap gap-3">
          <SummaryCard
            label="Available assessors"
            value={assessors.length}
            detail="Ready for programme assignment"
            symbol={{ ios: 'person.2.fill', android: 'groups', web: 'groups' }}
            tone="forest"
          />
          <SummaryCard
            label="Active programmes"
            value={programmes.length}
            detail="Available across providers"
            symbol={{ ios: 'square.grid.2x2.fill', android: 'grid_view', web: 'grid_view' }}
          />
          <SummaryCard
            label="Active assignments"
            value={assignments.filter((assignment) => assignment.status === 'ACTIVE').length}
            detail="Current assessor access"
            symbol={{ ios: 'checkmark.circle.fill', android: 'task_alt', web: 'task_alt' }}
            tone="plain"
          />
          <SummaryCard
            label="Unassigned programmes"
            value={unassignedProgrammeCount}
            detail="Awaiting assessor access"
            symbol={{ ios: 'exclamationmark.circle.fill', android: 'error_outline', web: 'error_outline' }}
            tone={unassignedProgrammeCount ? 'amber' : 'sage'}
          />
        </View>
      ) : null}
      {!loading && !error && assessors.length === 0 ? (
        <EmptyNotice title="No available assessors" message="Provision an assessor account before creating an assignment." />
      ) : null}
      {!loading && !error && programmes.length === 0 ? (
        <EmptyNotice title="No active programmes" message="Provider programmes appear here once they have been created." />
      ) : null}

      {!loading && assessors.length > 0 && programmes.length > 0 ? (
        <>
          <View className="gap-4 rounded-[24px] border border-border bg-white p-4 shadow-sm shadow-black/5">
            <Text className="text-lg font-bold text-ink">New assignment</Text>
            <View className="gap-2">
              <Text className="text-sm font-bold text-ink">Assessor</Text>
              {assessors.map((assessor) => (
                <Pressable
                  key={assessor.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedAssessorId === assessor.id }}
                  className={`rounded-xl border p-3 ${selectedAssessorId === assessor.id ? 'border-primary bg-selected' : 'border-border bg-white'}`}
                  onPress={() => setSelectedAssessorId(assessor.id)}>
                  <Text className="text-sm font-bold text-ink">{assessor.full_name}</Text>
                  <Text className="text-xs text-muted">{assessor.email}</Text>
                </Pressable>
              ))}
            </View>
            <View className="gap-2">
              <Text className="text-sm font-bold text-ink">Programme</Text>
              {programmes.map((programme) => (
                <Pressable
                  key={programme.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedProgrammeId === programme.id }}
                  className={`rounded-xl border p-3 ${selectedProgrammeId === programme.id ? 'border-primary bg-selected' : 'border-border bg-white'}`}
                  onPress={() => setSelectedProgrammeId(programme.id)}>
                  <Text className="text-sm font-bold text-ink">{programme.name}</Text>
                  <Text className="text-xs text-muted">Provider: {programme.provider_name}</Text>
                </Pressable>
              ))}
            </View>
            <ActionButton
              label={saving ? 'Assigning...' : 'Assign assessor'}
              onPress={() => setConfirmation({
                title: 'Assign assessor to programme?',
                message: 'This will give the selected assessor access to review evidence for the selected programme.',
                confirmLabel: 'Assign assessor',
                onConfirm: assign,
              })}
              disabled={saving || !selectedAssessorId || !selectedProgrammeId}
            />
          </View>

          <View className="gap-3">
            <Text className="text-lg font-bold text-ink">Assignment history</Text>
            {assignments.length === 0 ? (
              <EmptyNotice title="No assignments yet" message="New assessor assignments will be listed here." />
            ) : assignments.map((assignment) => (
              <View key={assignment.id} className="gap-2 rounded-[20px] border border-border bg-white p-4 shadow-sm shadow-black/5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-base font-bold text-ink">{assignment.programme_name}</Text>
                    <Text className="text-sm text-muted">{assignment.assessor_name} · {assignment.assessor_email}</Text>
                    <Text className="text-xs text-muted">
                      {assignment.status} · Assigned {new Date(assignment.created_at).toLocaleDateString()}
                      {assignment.deactivated_at ? ` · Deactivated ${new Date(assignment.deactivated_at).toLocaleDateString()}` : ''}
                    </Text>
                  </View>
                  <Text className="text-[10px] font-extrabold tracking-[0.12em] text-primary">{assignment.status}</Text>
                </View>
                <ActionButton
                  label={updatingId === assignment.id ? 'Updating...' : assignment.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  onPress={() => setConfirmation({
                    title: assignment.status === 'ACTIVE' ? 'Deactivate assignment?' : 'Reactivate assignment?',
                    message: assignment.status === 'ACTIVE'
                      ? `This will remove ${assignment.assessor_name}'s active review access to ${assignment.programme_name}.`
                      : `This will restore ${assignment.assessor_name}'s review access to ${assignment.programme_name}.`,
                    confirmLabel: assignment.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate',
                    destructive: assignment.status === 'ACTIVE',
                    onConfirm: () => changeAssignment(assignment),
                  })}
                  disabled={updatingId !== null}
                  variant={assignment.status === 'ACTIVE' ? 'secondary' : 'primary'}
                />
                {assignment.status === 'ACTIVE' ? assessors
                  .filter((assessor) => assessor.id !== assignment.assessor_user_id)
                  .map((assessor) => (
                    <Pressable
                      key={assessor.id}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: updatingId !== null }}
                      className="self-start px-2 py-2"
                      disabled={updatingId !== null}
                      onPress={() => setConfirmation({
                        title: 'Reassign programme?',
                        message: `This will move ${assignment.programme_name} review access to ${assessor.full_name}.`,
                        confirmLabel: 'Reassign',
                        onConfirm: () => reassign(assignment, assessor),
                      })}>
                      <Text className="text-sm font-bold text-primary">
                        {updatingId === assignment.id ? 'Updating...' : `Reassign to ${assessor.full_name}`}
                      </Text>
                    </Pressable>
                  )) : null}
              </View>
            ))}
          </View>
        </>
      ) : null}

      {error && (assessors.length > 0 || programmes.length > 0) ? (
        <ErrorNotice message={error} onRetry={() => void load()} />
      ) : null}
      {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
    </Page>
  );
}
