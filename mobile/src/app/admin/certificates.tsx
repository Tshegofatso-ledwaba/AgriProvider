import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  AdminOnly,
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  decideAdminCertificateConfiguration,
  decideAdminEligibility,
  EligibilityConfiguration,
  EligibilityReview,
  listAdminCertificateConfigurations,
  listAdminCertificates,
  listAdminEligibilityReviews,
  CertificateRecord,
  revokeCertificate,
} from '@/services/certificates';

type AdminCertificateData = {
  configurations: EligibilityConfiguration[];
  reviews: EligibilityReview[];
  certificates: CertificateRecord[];
};

export default function AdminCertificatesScreen() {
  return <AdminOnly><AdminCertificateDesk /></AdminOnly>;
}

function AdminCertificateDesk() {
  const { credential } = useAuth();
  const [data, setData] = useState<AdminCertificateData | null>(null);
  const [configurationReasons, setConfigurationReasons] = useState<Record<string, string>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [supersedingIds, setSupersedingIds] = useState<Record<string, string>>({});
  const [revocationReasons, setRevocationReasons] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your Administrator session is unavailable. Sign in again.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [configurations, reviews, certificates] = await Promise.all([
        listAdminCertificateConfigurations(credential, 'PENDING_APPROVAL'),
        listAdminEligibilityReviews(credential, 'APPROVED'),
        listAdminCertificates(credential),
      ]);
      setData({ configurations, reviews, certificates });
    } catch (requestError) {
      setData(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const runAction = async (key: string, work: () => Promise<unknown>, message: string) => {
    if (busyKey) return;
    setBusyKey(key);
    setError('');
    setSuccess('');
    try {
      await work();
      setSuccess(message);
      await load();
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setBusyKey('');
    }
  };

  const activeCertificates = data?.certificates.filter((certificate) => certificate.status === 'ISSUED') ?? [];

  return (
    <Page onRefresh={() => void load()} refreshing={loading}>
      <PageTitle title="Certificate authorization" subtitle="Approve configured rules, review QA eligibility, and authorize certificate issuance." />
      {loading ? <LoadingNotice label="Loading certificate work queue..." /> : null}
      {!loading && error && !data ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}

      {!loading && data ? (
        <>
          <View className="gap-3">
            <Text className="text-base font-extrabold text-ink">Programme rule approvals</Text>
            {data.configurations.length ? data.configurations.map((configuration) => (
              <View key={configuration.id} className="gap-3 rounded-2xl border border-l-4 border-border border-l-amber-400 bg-white p-5 shadow-sm shadow-primary/5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-base font-extrabold text-ink">{configuration.programme_name}</Text>
                    <Text className="text-xs text-muted">Provider · {configuration.provider_name}</Text>
                  </View>
                  <Text className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold text-amber-900">Version {configuration.version}</Text>
                </View>
                {configuration.criteria.certificates.map((rule) => (
                  <View key={rule.key} className="gap-1 border-t border-border pt-2">
                    <Text className="text-sm font-bold text-ink">{rule.title}</Text>
                    <Text className="text-xs text-muted">{rule.type === 'FINAL' ? 'Final certificate' : 'Milestone'} · {rule.requiredEvidenceRequirementIds.length} evidence · {rule.requiredAssessmentRequirementIds.length} assessments · {rule.attendanceRequirements.length} attendance conditions</Text>
                  </View>
                ))}
                <ActionButton
                  label={busyKey === `rule-${configuration.id}-approve` ? 'Approving...' : 'Approve rule version'}
                  onPress={() => void runAction(`rule-${configuration.id}-approve`, () => decideAdminCertificateConfiguration(credential ?? '', configuration.id, 'approve'), 'Certificate rule version approved.')}
                  disabled={Boolean(busyKey)}
                />
                <TextInput
                  accessibilityLabel={`Rejection reason for rule version ${configuration.version}`}
                  className="min-h-16 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink"
                  value={configurationReasons[configuration.id] ?? ''}
                  onChangeText={(value) => setConfigurationReasons((current) => ({ ...current, [configuration.id]: value }))}
                  multiline
                  textAlignVertical="top"
                  placeholder="Reason required to reject this rule version"
                />
                <ActionButton
                  label={busyKey === `rule-${configuration.id}-reject` ? 'Rejecting...' : 'Reject rule version'}
                  onPress={() => void runAction(`rule-${configuration.id}-reject`, () => decideAdminCertificateConfiguration(credential ?? '', configuration.id, 'reject', configurationReasons[configuration.id]), 'Certificate rule version rejected.')}
                  disabled={Boolean(busyKey)}
                  variant="secondary"
                />
              </View>
            )) : <EmptyNotice title="No rule versions awaiting approval" message="Submitted Provider certificate conditions will appear here." />}
          </View>

          <View className="gap-3">
            <Text className="text-base font-extrabold text-ink">QA-approved eligibility</Text>
            {data.reviews.length ? data.reviews.map((review) => {
              const prior = activeCertificates.find((certificate) => certificate.learner_id === review.learner_id
                && certificate.programme_id === review.programme_id
                && certificate.credential_key === review.credential_key);
              return (
                <View key={review.id} className="gap-3 rounded-2xl border border-l-4 border-border border-l-emerald-600 bg-white p-5 shadow-sm shadow-primary/5">
                  <View className="gap-1">
                    <Text className="text-base font-extrabold text-ink">{review.credential_title}</Text>
                    <Text className="text-sm text-muted">{review.learner_name} · {review.learner_reference}</Text>
                    <Text className="text-xs text-muted">{review.programme_name} · QA Officer {review.qa_name}</Text>
                    <Text className="text-xs font-bold text-emerald-800">QA approved · {new Date(review.reviewed_at).toLocaleString()}</Text>
                  </View>
                  <Text className="text-sm leading-5 text-muted">{review.comments}</Text>
                  {prior ? (
                    <View className="gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <Text className="text-xs font-bold text-amber-900">Existing issued certificate · {prior.verification_reference}</Text>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: supersedingIds[review.id] === prior.id }}
                        className="flex-row items-start gap-2"
                        onPress={() => setSupersedingIds((current) => ({ ...current, [review.id]: current[review.id] === prior.id ? '' : prior.id }))}>
                        <Text className="text-sm font-bold text-primary">{supersedingIds[review.id] === prior.id ? '☑' : '☐'} Supersede this certificate</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  <ActionButton
                    label={busyKey === `eligibility-${review.id}-approve` ? 'Authorizing...' : 'Authorize and issue PDF'}
                    onPress={() => void runAction(`eligibility-${review.id}-approve`, () => decideAdminEligibility(credential ?? '', review.id, {
                      decision: 'APPROVED',
                      ...(supersedingIds[review.id] ? { supersedesCertificateId: supersedingIds[review.id] } : {}),
                    }), 'Certificate authorized and issued.')}
                    disabled={Boolean(busyKey) || (Boolean(prior) && !supersedingIds[review.id])}
                  />
                  <TextInput
                    accessibilityLabel={`Rejection reason for ${review.credential_title}`}
                    className="min-h-16 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink"
                    value={reviewReasons[review.id] ?? ''}
                    onChangeText={(value) => setReviewReasons((current) => ({ ...current, [review.id]: value }))}
                    multiline
                    textAlignVertical="top"
                    placeholder="Reason required to reject issuance"
                  />
                  <ActionButton
                    label={busyKey === `eligibility-${review.id}-reject` ? 'Rejecting...' : 'Reject issuance'}
                    onPress={() => void runAction(`eligibility-${review.id}-reject`, () => decideAdminEligibility(credential ?? '', review.id, {
                      decision: 'REJECTED', comments: reviewReasons[review.id] ?? '',
                    }), 'Certificate issuance rejected and recorded.')}
                    disabled={Boolean(busyKey)}
                    variant="secondary"
                  />
                </View>
              );
            }) : <EmptyNotice title="No QA-approved records" message="QA-approved milestone or final-completion records will appear here for Administrator authorization." />}
          </View>

          <View className="gap-3">
            <Text className="text-base font-extrabold text-ink">Certificate history</Text>
            {data.certificates.length ? data.certificates.map((certificate) => (
              <View key={certificate.id} className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-primary/5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-sm font-extrabold text-ink">{certificate.certificate_title}</Text>
                    <Text className="text-xs text-muted">{certificate.learner_name} · {certificate.programme_name}</Text>
                    <Text className="text-xs font-bold text-primary">{certificate.verification_reference}</Text>
                  </View>
                  <Text className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${certificate.status === 'ISSUED' ? 'bg-emerald-50 text-emerald-800' : certificate.status === 'REVOKED' ? 'bg-red-50 text-red-800' : 'bg-slate-100 text-slate-700'}`}>{certificate.status}</Text>
                </View>
                {certificate.status === 'ISSUED' ? (
                  <>
                    <TextInput
                      accessibilityLabel={`Revocation reason for ${certificate.verification_reference}`}
                      className="min-h-14 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink"
                      value={revocationReasons[certificate.id] ?? ''}
                      onChangeText={(value) => setRevocationReasons((current) => ({ ...current, [certificate.id]: value }))}
                      multiline
                      textAlignVertical="top"
                      placeholder="Reason required to revoke this certificate"
                    />
                    <ActionButton
                      label={busyKey === `revoke-${certificate.id}` ? 'Revoking...' : 'Revoke certificate'}
                      onPress={() => void runAction(`revoke-${certificate.id}`, () => revokeCertificate(credential ?? '', certificate.id, revocationReasons[certificate.id] ?? ''), 'Certificate revoked and verification disabled.')}
                      disabled={Boolean(busyKey)}
                      variant="danger"
                    />
                  </>
                ) : null}
              </View>
            )) : <EmptyNotice title="No certificates issued" message="Certificates appear here after QA approval and Administrator authorization." />}
          </View>
        </>
      ) : null}
      {success ? <Text className="text-sm font-bold text-primary" accessibilityRole="alert">{success}</Text> : null}
      {error && data ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
    </Page>
  );
}
