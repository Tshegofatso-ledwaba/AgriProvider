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
  ProviderOnly,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import { FindingFilter, FindingList, listProviderFindings } from '@/services/qa-findings';

export default function ProviderQaActionsScreen() {
  return <ProviderOnly><ProviderQaActions /></ProviderOnly>;
}

function ProviderQaActions() {
  const { credential } = useAuth();
  const [data, setData] = useState<FindingList | null>(null);
  const [filter, setFilter] = useState<FindingFilter>('OPEN');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your session is unavailable. Sign in again and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setData(await listProviderFindings(credential, { status: filter }));
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
        title="QA corrective actions"
        subtitle="Respond to findings raised by QA Officers on your programmes."
      />
      {loading ? <LoadingNotice label="Loading corrective actions..." /> : null}
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
                href={`/provider/qa-actions/${finding.id}`}
                actionLabel={finding.status === 'OPEN' ? 'Respond' : 'View details'}
              />
            )) : (
              <EmptyNotice
                title={data.summary.total ? 'Nothing in this status' : 'No QA corrective actions'}
                message={data.summary.total
                  ? 'Choose another status to see other corrective actions.'
                  : 'When a QA Officer records a finding on one of your programmes, it will appear here and you will be notified.'}
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
