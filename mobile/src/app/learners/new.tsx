import { ProviderOnly } from '@/components/programme-ui';
import { LearnerEditor } from '@/components/learner-editor';

export default function CreateLearnerScreen() {
  return <ProviderOnly><LearnerEditor /></ProviderOnly>;
}
