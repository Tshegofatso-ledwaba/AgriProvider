import { Text, View } from 'react-native';

import { Page, PageTitle, QaOnly } from '@/components/programme-ui';

export default function QADashboardScreen() {
  return (
    <QaOnly>
      <Page>
        <PageTitle
          title="Quality assurance"
          subtitle="A dedicated workspace for quality verification."
        />

        <View className="gap-3 rounded-[24px] border border-amber-200 bg-amber-50 p-5">
          <Text className="text-base font-bold text-amber-900">QA workflow is not enabled</Text>
          <Text className="text-sm leading-5 text-amber-900">
            QA assignment scope, verification outcomes and permitted status changes still require approval and backend support. No verification data or decisions are being simulated.
          </Text>
        </View>

        <View className="gap-3">
          <WorkspaceSection
            title="Awaiting verification"
            description="A QA queue will appear here when an approved assignment and verification workflow is available."
          />
          <WorkspaceSection
            title="Completed checks"
            description="Verification history is not available until QA outcomes can be recorded by the backend."
          />
          <WorkspaceSection
            title="Findings and review details"
            description="Checklist criteria, findings and comments will be shown only after their rules and permissions are confirmed."
          />
        </View>
      </Page>
    </QaOnly>
  );
}

function WorkspaceSection({ title, description }: { title: string; description: string }) {
  return (
    <View className="gap-2 rounded-[22px] border border-border bg-white p-4 shadow-sm shadow-black/5">
      <Text className="text-base font-bold text-ink">{title}</Text>
      <Text className="text-sm leading-5 text-muted">{description}</Text>
    </View>
  );
}
