import LearnerWorkspace from '@/components/learner-workspace';
import { LearnerOnly } from '@/components/programme-ui';

export default function LearnerAttendanceScreen() {
  return (
    <LearnerOnly>
      <LearnerWorkspace section="attendance" />
    </LearnerOnly>
  );
}
