import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';

import {
  FilterChip,
  FindingCard,
  findingFilters,
  FindingSummaryRow,
} from '@/components/finding-ui';
import {
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  QaOnly,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { FindingFilter, FindingList, listQaFindings } from '@/services/qa-findings';

export default function QaFindingsScreen() {
  return <QaOnly><QaFindings /></QaOnly>;
}

function QaFindings() {
  const { credential } = useAuth();
  const [data, setData] = useState<FindingList | null>(null);
  const [filter, setFilter] = useState<FindingFilter>('RESPONSE_SUBMITTED');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your QA session is unavailable. Sign in again and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setData(await listQaFindings(credential, { status: filter }));
    } catch (requestError) {
      setData(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, filter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Page onRefresh={() => void load()} refreshing={loading}>
      <PageTitle
        title="Findings and corrective actions"
        subtitle="Track findings you and other QA Officers recorded within your assigned programmes."
      />
      {loading ? <LoadingNotice label="Loading findings..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && data ? (
        <>
          <FindingSummaryRow summary={data.summary} />
          <View className="flex-row flex-wrap gap-2">
            {findingFilters.map((item) => (
              <FilterChip key={item.value} label={item.label} selected={filter === item.value} onPress={() => setFilter(item.value)} />
            ))}
          </View>
          <View className="gap-3">
            {data.findings.length ? data.findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                href={`/qa/findings/${finding.id}`}
                actionLabel={finding.status === 'RESPONSE_SUBMITTED'
                  ? 'Check response'
                  : finding.status === 'VERIFIED' ? 'Close finding' : 'View finding'}
              />
            )) : (
              <EmptyNotice
                title={data.summary.total ? 'No findings match this filter' : 'No findings recorded yet'}
                message={data.summary.total
                  ? 'Choose another status to see other findings.'
                  : 'Open an assessment you reviewed from the QA dashboard and record a finding when corrective action is needed.'}
              />
            )}
            {data.total > data.findings.length ? (
              <Text className="text-xs text-muted">Showing {data.findings.length} of {data.total}. Use a status filter to narrow the list.</Text>
            ) : null}
          </View>
        </>
      ) : null}
    </Page>
  );
}
