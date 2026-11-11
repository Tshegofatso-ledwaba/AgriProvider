import LearnerWorkspace from '@/components/learner-workspace';
import { LearnerOnly } from '@/components/programme-ui';

export default function LearnerProgrammesScreen() {
  return (
    <LearnerOnly>
      <LearnerWorkspace section="programmes" />
    </LearnerOnly>
  );
}
