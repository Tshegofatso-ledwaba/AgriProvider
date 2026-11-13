import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';

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
  CertificateRule,
  createProviderCertificateConfiguration,
  EligibilityConfiguration,
  listProviderCertificateConfigurations,
  listProviderCertificateStatus,
  ProviderCertificateStatus,
  submitProviderCertificateConfiguration,
} from '@/services/certificates';
import { EvidenceRequirement, listEvidenceRequirements } from '@/services/evidence-requirements';
import { listSessions, TrainingSession } from '@/services/sessions';

type AttendanceStatus = 'present' | 'absent' | 'excused';

type DraftCredential = {
  key: string;
  title: string;
  type: 'MILESTONE' | 'FINAL';
  evidenceIds: string[];
  assessmentIds: string[];
  attendance: { sessionId: string; acceptedStatuses: AttendanceStatus[] }[];
};

const statusOptions: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'excused', label: 'Excused' },
];

export default function ProgrammeCertificatesScreen() {
  return <ProviderOnly><ProgrammeCertificateRules /></ProviderOnly>;
}

function ProgrammeCertificateRules() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { credential } = useAuth();
  const [requirements, setRequirements] = useState<EvidenceRequirement[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [configurations, setConfigurations] = useState<EligibilityConfiguration[]>([]);
  const [statusConfiguration, setStatusConfiguration] = useState<{ id: string; version: number } | null>(null);
  const [statusRows, setStatusRows] = useState<ProviderCertificateStatus[]>([]);
  const [rules, setRules] = useState<CertificateRule[]>([]);
  const [ruleKey, setRuleKey] = useState('');
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleType, setRuleType] = useState<'MILESTONE' | 'FINAL'>('MILESTONE');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [assessmentIds, setAssessmentIds] = useState<string[]>([]);
  const [attendance, setAttendance] = useState<DraftCredential['attendance']>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const latest = configurations[0] ?? null;

  const load = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Your provider session or programme is unavailable.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [requirementList, sessionList, configurationList, statusResult] = await Promise.all([
        listEvidenceRequirements(credential, id),
        listSessions(credential, id),
        listProviderCertificateConfigurations(credential, id),
        listProviderCertificateStatus(credential, id),
      ]);
      setRequirements(requirementList);
      setSessions(sessionList);
      setConfigurations(configurationList);
      setStatusConfiguration(statusResult.configuration);
      setStatusRows(statusResult.eligibility);
      const current = configurationList[0];
      setRules(current?.criteria.certificates ?? []);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggle = (values: string[], idValue: string, setValues: (next: string[]) => void) => {
    setValues(values.includes(idValue) ? values.filter((value) => value !== idValue) : [...values, idValue]);
  };

  const toggleAssessment = (requirementId: string) => {
    const next = assessmentIds.includes(requirementId)
      ? assessmentIds.filter((value) => value !== requirementId)
      : [...assessmentIds, requirementId];
    setAssessmentIds(next);
    setEvidenceIds((current) => current.includes(requirementId) ? current : [...current, requirementId]);
  };

  const toggleAttendanceSession = (sessionId: string) => {
    setAttendance((current) => current.some((item) => item.sessionId === sessionId)
      ? current.filter((item) => item.sessionId !== sessionId)
      : [...current, { sessionId, acceptedStatuses: [] }]);
  };

  const toggleAcceptedStatus = (sessionId: string, status: AttendanceStatus) => {
    setAttendance((current) => current.map((item) => item.sessionId !== sessionId
      ? item
      : {
          ...item,
          acceptedStatuses: item.acceptedStatuses.includes(status)
            ? item.acceptedStatuses.filter((value) => value !== status)
            : [...item.acceptedStatuses, status],
        }));
  };

  const addCredential = () => {
    const key = ruleKey.trim();
    const title = ruleTitle.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(key) || !title || (ruleType === 'FINAL' && rules.some((rule) => rule.type === 'FINAL'))) {
      setError('Enter a unique lowercase key and title. Only one final certificate may be configured per version.');
      return;
    }
    const conditionCount = evidenceIds.length + assessmentIds.length
      + attendance.filter((item) => item.acceptedStatuses.length > 0).length;
    if (!conditionCount || attendance.some((item) => item.acceptedStatuses.length === 0)) {
      setError('Add at least one condition and choose accepted attendance statuses for every selected session.');
      return;
    }
    if (rules.some((rule) => rule.key === key)) {
      setError('Each certificate key must be unique within the programme rules.');
      return;
    }
    setRules((current) => [...current, {
      key,
      title,
      type: ruleType,
      requiredEvidenceRequirementIds: evidenceIds,
      requiredAssessmentRequirementIds: assessmentIds,
      attendanceRequirements: attendance,
    }]);
    setRuleKey('');
    setRuleTitle('');
    setEvidenceIds([]);
    setAssessmentIds([]);
    setAttendance([]);
    setError('');
    setSuccess('Certificate condition added. Save a new rule version to submit it for approval.');
  };

  const saveDraft = async () => {
    if (!credential || !id || saving || !rules.length) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const configuration = await createProviderCertificateConfiguration(credential, id, { certificates: rules });
      setConfigurations((current) => [configuration, ...current]);
      setSuccess(`Rule version ${configuration.version} saved as a draft.`);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  const submitDraft = async () => {
    if (!credential || !id || !latest || latest.status !== 'DRAFT' || saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const submitted = await submitProviderCertificateConfiguration(credential, id, latest.id);
      setConfigurations((current) => current.map((configuration) => configuration.id === latest.id
        ? { ...configuration, ...submitted, status: 'PENDING_APPROVAL' }
        : configuration));
      setSuccess('Certificate rules submitted to an Administrator for approval.');
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <PageTitle title="Certificate rules" subtitle="Configure explicit conditions for milestone or final certificates. No rules are preselected or inferred from progress." />
      {loading ? <LoadingNotice label="Loading programme requirements and sessions..." /> : null}
      {!loading && error && !requirements.length && !sessions.length ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading ? (
        <>
          {latest ? (
            <View className="gap-2 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-primary/5">
              <Text className="text-xs font-bold text-muted">LATEST RULE VERSION · {latest.version}</Text>
              <Text className="text-base font-extrabold text-ink">{latest.status.replaceAll('_', ' ')}</Text>
              {latest.status === 'DRAFT' ? (
                <ActionButton label={saving ? 'Submitting...' : 'Submit draft for Administrator approval'} onPress={() => void submitDraft()} disabled={saving} />
              ) : null}
              {latest.status === 'APPROVED' ? (
                <Text className="text-sm leading-5 text-muted">Approved rules are immutable. Changes require a new version.</Text>
              ) : null}
            </View>
          ) : (
            <EmptyNotice title="No certificate rules configured" message="Add explicit milestone or final-certificate conditions. Certificates remain unavailable until an Administrator approves the submitted rule version." />
          )}

          {rules.length ? (
            <View className="gap-3">
              <Text className="text-base font-extrabold text-ink">Configured certificates</Text>
              {rules.map((rule) => (
                <View key={rule.key} className="gap-2 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-primary/5">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1 gap-1">
                      <Text className="text-base font-extrabold text-ink">{rule.title}</Text>
                      <Text className="text-xs text-muted">{rule.key} · {rule.type === 'FINAL' ? 'Final certificate' : 'Milestone certificate'}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${rule.title}`} onPress={() => setRules((current) => current.filter((item) => item.key !== rule.key))}>
                      <Text className="text-xs font-bold text-danger">Remove</Text>
                    </Pressable>
                  </View>
                  <Text className="text-xs text-muted">
                    {rule.requiredEvidenceRequirementIds.length} evidence · {rule.requiredAssessmentRequirementIds.length} assessments · {rule.attendanceRequirements.length} attendance conditions
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View className="gap-3">
            <Text className="text-base font-extrabold text-ink">Learner eligibility and certificate status</Text>
            {!statusConfiguration ? (
              <EmptyNotice title="No approved rules yet" message="Learner eligibility appears after an Administrator approves a submitted rule version." />
            ) : statusRows.length ? statusRows.map((item) => (
              <View key={`${item.enrolmentId}:${item.credentialKey}`} className="gap-2 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-primary/5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-sm font-extrabold text-ink">{item.learnerName}</Text>
                    <Text className="text-xs text-muted">{item.learnerReference} · {item.credentialTitle}</Text>
                  </View>
                  <Text className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${item.certificate?.status === 'ISSUED' ? 'bg-emerald-50 text-emerald-800' : item.certificate?.status === 'REVOKED' ? 'bg-red-50 text-red-800' : item.certificate?.status === 'SUPERSEDED' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-900'}`}>
                    {item.certificate?.status ?? `QA ${item.qaDecision?.toLowerCase() ?? 'pending'}`}
                  </Text>
                </View>
                {item.blockers.length ? (
                  <Text className="text-xs leading-4 text-amber-900" numberOfLines={2}>{item.blockers.map((blocker) => blocker.message).join(' ')}</Text>
                ) : item.certificate ? (
                  <Text className="text-xs text-muted">Reference · {item.certificate.verification_reference}</Text>
                ) : <Text className="text-xs text-emerald-800">All configured conditions are currently satisfied; QA review is the next step.</Text>}
              </View>
            )) : (
              <EmptyNotice title="No active learner enrolments" message="Learner certificate status will appear for active enrolments once rules are approved." />
            )}
          </View>

          <View className="gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm shadow-primary/5">
            <Text className="text-base font-extrabold text-ink">Add a certificate condition set</Text>
            <TextInput
              accessibilityLabel="Certificate key"
              className="min-h-12 rounded-xl border border-border bg-surface px-4 text-sm text-ink"
              value={ruleKey}
              onChangeText={setRuleKey}
              placeholder="Unique key, e.g. milestone-one"
              autoCapitalize="none"
            />
            <TextInput
              accessibilityLabel="Certificate title"
              className="min-h-12 rounded-xl border border-border bg-surface px-4 text-sm text-ink"
              value={ruleTitle}
              onChangeText={setRuleTitle}
              placeholder="Certificate title"
            />
            <View className="flex-row gap-2">
              {(['MILESTONE', 'FINAL'] as const).map((type) => (
                <Pressable
                  key={type}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ruleType === type }}
                  className={`min-h-10 flex-1 items-center justify-center rounded-xl border px-3 ${ruleType === type ? 'border-primary bg-selected' : 'border-border bg-white'}`}
                  onPress={() => setRuleType(type)}>
                  <Text className={`text-xs font-bold ${ruleType === type ? 'text-primary' : 'text-muted'}`}>
                    {type === 'FINAL' ? 'Final completion' : 'Milestone'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View className="gap-2">
              <Text className="text-sm font-bold text-ink">Required evidence and assessment</Text>
              {requirements.length ? requirements.map((requirement) => (
                <View key={requirement.id} className="gap-2 rounded-xl border border-border bg-surface p-3">
                  <ToggleRow
                    label={requirement.title}
                    selected={evidenceIds.includes(requirement.id)}
                    onPress={() => toggle(evidenceIds, requirement.id, setEvidenceIds)}
                  />
                  <ToggleRow
                    label="Assessment approval also required"
                    selected={assessmentIds.includes(requirement.id)}
                    onPress={() => toggleAssessment(requirement.id)}
                  />
                </View>
              )) : <Text className="text-sm text-muted">No active evidence requirements exist for this programme yet.</Text>}
            </View>

            <View className="gap-2">
              <Text className="text-sm font-bold text-ink">Attendance conditions</Text>
              {sessions.length ? sessions.map((session) => {
                const condition = attendance.find((item) => item.sessionId === session.id);
                return (
                  <View key={session.id} className="gap-2 rounded-xl border border-border bg-surface p-3">
                    <ToggleRow label={`${session.title} · ${new Date(session.starts_at).toLocaleDateString()}`} selected={Boolean(condition)} onPress={() => toggleAttendanceSession(session.id)} />
                    {condition ? (
                      <View className="flex-row flex-wrap gap-2">
                        {statusOptions.map((option) => (
                          <Pressable
                            key={option.value}
                            accessibilityRole="button"
                            accessibilityState={{ selected: condition.acceptedStatuses.includes(option.value) }}
                            className={`rounded-lg border px-3 py-2 ${condition.acceptedStatuses.includes(option.value) ? 'border-primary bg-selected' : 'border-border bg-white'}`}
                            onPress={() => toggleAcceptedStatus(session.id, option.value)}>
                            <Text className={`text-xs font-bold ${condition.acceptedStatuses.includes(option.value) ? 'text-primary' : 'text-muted'}`}>{option.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              }) : <Text className="text-sm text-muted">No active training sessions exist for this programme yet.</Text>}
            </View>
            {error ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
            {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
            <ActionButton label="Add condition set" onPress={addCredential} />
            <ActionButton label={saving ? 'Saving...' : 'Save new rules as draft'} onPress={() => void saveDraft()} disabled={saving || !rules.length} variant="secondary" />
          </View>
        </>
      ) : null}
    </Page>
  );
}

function ToggleRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} className="flex-row items-start gap-2" onPress={onPress}>
      <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${selected ? 'border-primary bg-primary' : 'border-border bg-white'}`}>
        {selected ? <Text className="text-xs font-extrabold text-white">✓</Text> : null}
      </View>
      <Text className="flex-1 text-sm text-ink">{label}</Text>
    </Pressable>
  );
}
