import { LearnerEditor } from '@/components/learner-editor';
import { ProviderOnly } from '@/components/programme-ui';

export default function EditLearnerScreen() {
  return <ProviderOnly><LearnerEditor /></ProviderOnly>;
}
