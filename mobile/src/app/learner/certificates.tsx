import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

import {
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  LearnerOnly,
  ActionButton,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { CertificateRecord, downloadLearnerCertificate, listLearnerCertificates } from '@/services/certificates';

export default function LearnerCertificatesScreen() {
  return <LearnerOnly><LearnerCertificates /></LearnerOnly>;
}

function LearnerCertificates() {
  const { credential } = useAuth();
  const [certificates, setCertificates] = useState<CertificateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your learner session is unavailable. Sign in again to view certificates.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setCertificates(await listLearnerCertificates(credential));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const download = async (certificate: CertificateRecord) => {
    if (!credential || busyId) return;
    setBusyId(certificate.id);
    setError('');
    try {
      const bytes = await downloadLearnerCertificate(credential, certificate.id);
      if (Platform.OS === 'web') {
        const copy = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(copy).set(bytes);
        const url = URL.createObjectURL(new Blob([copy], { type: 'application/pdf' }));
        try {
          await Linking.openURL(url);
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      } else {
        const file = new File(Paths.cache, `${certificate.verification_reference}.pdf`);
        await file.write(bytes);
        if (await File.canPreview(file)) {
          await file.preview({ title: certificate.certificate_title });
        } else {
          if (file.exists) file.delete();
          throw new Error('This device cannot preview PDF certificates.');
        }
      }
    } catch (downloadError) {
      setError(apiErrorText(downloadError));
    } finally {
      setBusyId('');
    }
  };

  return (
    <Page onRefresh={() => void load()} refreshing={loading}>
      <PageTitle title="My certificates" subtitle="View certificate history and download currently issued PDFs." />
      {loading ? <LoadingNotice label="Loading certificate history..." /> : null}
      {!loading && error && certificates.length === 0 ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && certificates.length === 0 ? (
        <EmptyNotice
          title="No certificates available"
          message="Certificates appear here only after your configured requirements are QA-approved and an Administrator authorizes issuance."
        />
      ) : null}
      {certificates.map((certificate) => (
        <View key={certificate.id} className="gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm shadow-primary/5">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
              <Text className="text-[10px] font-extrabold text-primary">{certificate.certificate_type === 'FINAL' ? 'FINAL CERTIFICATE' : 'MILESTONE CERTIFICATE'}</Text>
              <Text className="text-base font-extrabold text-ink">{certificate.certificate_title}</Text>
              <Text className="text-sm text-muted">{certificate.programme_name}</Text>
            </View>
            <StatusBadge status={certificate.status} />
          </View>
          <View className="gap-1 border-t border-border pt-3">
            <InfoRow label="Reference" value={certificate.verification_reference} />
            <InfoRow label="Issued" value={new Date(certificate.issued_at).toLocaleDateString('en-ZA')} />
            <InfoRow label="Issuer" value={`${certificate.issuer_name} · ${certificate.issuer_title}`} />
          </View>
          {certificate.status === 'ISSUED' ? (
            <ActionButton
              label={busyId === certificate.id ? 'Preparing PDF...' : 'Download certificate PDF'}
              onPress={() => void download(certificate)}
              disabled={Boolean(busyId)}
            />
          ) : (
            <Text className="text-xs leading-4 text-muted">
              {certificate.status === 'REVOKED'
                ? 'This certificate was revoked and can no longer be verified or downloaded.'
                : 'This certificate was superseded by a newer issued record and is kept for history.'}
            </Text>
          )}
        </View>
      ))}
      {error && certificates.length > 0 ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
    </Page>
  );
}

function StatusBadge({ status }: { status: CertificateRecord['status'] }) {
  const tone = status === 'ISSUED'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'REVOKED'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-border bg-surface text-muted';
  return (
    <View className={`rounded-full border px-2.5 py-1 ${tone}`}>
      <Text className="text-[10px] font-extrabold">{status}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4">
      <Text className="text-xs font-bold text-muted">{label}</Text>
      <Text className="flex-1 text-right text-xs text-ink">{value}</Text>
    </View>
  );
}
