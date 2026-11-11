import LearnerWorkspace from '@/components/learner-workspace';
import { LearnerOnly } from '@/components/programme-ui';

export default function LearnerEvidenceScreen() {
  return (
    <LearnerOnly>
      <LearnerWorkspace section="evidence" />
    </LearnerOnly>
  );
}
