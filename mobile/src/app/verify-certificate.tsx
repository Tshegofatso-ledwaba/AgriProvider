import { useState } from 'react';
import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiErrorText } from '@/services/api';
import { CertificateVerification, verifyCertificate } from '@/services/certificates';

export default function VerifyCertificateScreen() {
  const [reference, setReference] = useState('');
  const [certificate, setCertificate] = useState<CertificateVerification | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const verify = async () => {
    const normalized = reference.trim().toUpperCase();
    if (!/^CERT-\d{4}-[A-Z0-9]{12}$/.test(normalized)) {
      setError('Enter the certificate reference in the printed format.');
      setCertificate(null);
      return;
    }
    setLoading(true);
    setError('');
    setCertificate(null);
    try {
      setCertificate(await verifyCertificate(normalized));
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView contentContainerClassName="mx-auto w-full max-w-[520px] gap-5 px-5 py-6">
        <View className="flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Text className="text-base font-extrabold text-white">A</Text>
          </View>
          <Text className="text-lg font-extrabold text-ink">AgriProvider</Text>
        </View>
        <View className="gap-2 border-l-[3px] border-primary pl-3">
          <Text className="text-2xl font-extrabold text-ink">Certificate verification</Text>
          <Text className="text-sm leading-5 text-muted">Check whether a certificate reference is currently valid. No learner identity is disclosed.</Text>
        </View>
        <View className="gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm shadow-primary/5">
          <View className="gap-2">
            <Text className="text-sm font-bold text-ink">Verification reference</Text>
            <TextInput
              accessibilityLabel="Certificate verification reference"
              className="min-h-12 rounded-xl border border-border bg-surface px-4 text-sm text-ink"
              value={reference}
              onChangeText={(value) => setReference(value.toUpperCase())}
              placeholder="CERT-2026-XXXXXXXXXXXX"
              placeholderTextColor="#5C6D67"
              autoCapitalize="characters"
              autoCorrect={false}
              onSubmitEditing={() => void verify()}
            />
          </View>
          {error ? <Text className="text-sm text-danger" accessibilityRole="alert">{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: loading }}
            className={`min-h-12 items-center justify-center rounded-xl bg-primary px-4 py-3 ${loading ? 'opacity-60' : 'active:opacity-80'}`}
            disabled={loading}
            onPress={() => void verify()}>
            {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-sm font-bold text-white">Verify reference</Text>}
          </Pressable>
        </View>
        {certificate ? (
          <View className={`gap-3 rounded-2xl border border-l-4 bg-white p-5 shadow-sm shadow-primary/5 ${certificate.valid ? 'border-border border-l-emerald-600' : 'border-border border-l-red-600'}`}>
            <View className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 text-base font-extrabold text-ink">{certificate.valid ? 'Valid certificate' : `Certificate ${certificate.status.toLowerCase()}`}</Text>
              <Text className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${certificate.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                {certificate.status}
              </Text>
            </View>
            <Text className="text-sm font-bold text-ink">{certificate.certificateTitle}</Text>
            <InfoRow label="Programme" value={certificate.programmeName} />
            <InfoRow label="Type" value={certificate.certificateType === 'FINAL' ? 'Final certificate' : 'Milestone certificate'} />
            <InfoRow label="Issued" value={new Date(certificate.issuedAt).toLocaleDateString('en-ZA')} />
            <InfoRow label="Reference" value={certificate.verificationReference} />
          </View>
        ) : null}
        <Link href="/" asChild>
          <Pressable accessibilityRole="button" className="min-h-10 items-center justify-center rounded-xl px-4 py-2 active:opacity-70">
            <Text className="text-sm font-bold text-primary">Back to sign in</Text>
          </Pressable>
        </Link>
      </ScrollView>
    </SafeAreaView>
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
