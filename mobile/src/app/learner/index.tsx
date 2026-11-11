import LearnerWorkspace from '@/components/learner-workspace';
import { LearnerOnly } from '@/components/programme-ui';

export default function LearnerDashboardScreen() {
  return (
    <LearnerOnly>
      <LearnerWorkspace section="home" />
    </LearnerOnly>
  );
}
