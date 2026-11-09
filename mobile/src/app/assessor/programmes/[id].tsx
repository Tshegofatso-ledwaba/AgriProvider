import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  AssessorOnly,
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  routeHref,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import { apiErrorText } from '@/services/api';
import {
  AssessorLearner,
  AssessorProgramme,
  AssessorSubmission,
  listAssignedProgrammes,
  listProgrammeLearners,
  listProgrammeSubmissions,
} from '@/services/assessor-reviews';

export default function AssessorProgrammeScreen() {
  return <AssessorOnly><AssessorProgrammeQueue /></AssessorOnly>;
}

function AssessorProgrammeQueue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { credential } = useAuth();
  const [programme, setProgramme] = useState<AssessorProgramme | null>(null);
  const [learners, setLearners] = useState<AssessorLearner[]>([]);
  const [submissions, setSubmissions] = useState<AssessorSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!credential || !id) {
      setLoading(false);
      setError('Assigned programme details are unavailable. Return to your review dashboard and retry.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [programmeList, learnerList, submissionList] = await Promise.all([
        listAssignedProgrammes(credential),
        listProgrammeLearners(credential, id),
        listProgrammeSubmissions(credential, id),
      ]);
      setProgramme(programmeList.find((item) => item.id === id) ?? null);
      setLearners(learnerList);
      setSubmissions(submissionList);
    } catch (requestError) {
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Page>
      {loading ? <LoadingNotice label="Loading programme learners and evidence..." /> : null}
      {!loading && error && !programme ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && programme ? (
        <>
          <PageTitle title={programme.name} subtitle={`${learners.length} active learners · ${submissions.length} submissions`} />
          {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
          <View className="gap-3 border-b border-border pb-4">
            <Text className="text-base font-bold text-ink">Enrolled learners</Text>
            {learners.length === 0 ? <Text className="text-sm text-muted">No active learners are enrolled.</Text> : null}
            {learners.map((learner) => (
              <View key={learner.enrolment_id} className="flex-row justify-between gap-3">
                <Text className="flex-1 text-sm font-bold text-ink">{learner.full_name}</Text>
                <Text className="text-xs text-muted">{learner.learner_reference}</Text>
              </View>
            ))}
          </View>
          <View className="gap-3">
            <Text className="text-base font-bold text-ink">Evidence queue</Text>
            {submissions.length === 0 ? (
              <EmptyNotice title="No evidence submitted" message="Submitted evidence for this assigned programme will appear here." />
            ) : submissions.map((submission) => (
              <Pressable
                key={submission.id}
                accessibilityRole="button"
                className="gap-2 border-b border-border py-3"
                onPress={() => router.push(routeHref(`/assessor/submissions/${submission.id}`))}>
                <View className="flex-row items-start justify-between gap-3">
                  <Text className="flex-1 text-base font-bold text-ink">{submission.learner_name}</Text>
                  <Text className="text-xs font-bold text-primary">{submission.status.replaceAll('_', ' ')}</Text>
                </View>
                <Text className="text-sm text-muted">{submission.requirement_title} · Version {submission.version}</Text>
                <Text className="text-xs text-muted">{submission.original_filename} · {new Date(submission.created_at).toLocaleString()}</Text>
                <Text className="text-sm font-bold text-primary">Review submission ›</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </Page>
  );
}