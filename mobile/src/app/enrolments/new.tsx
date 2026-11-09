import { EnrolmentEditor } from '@/components/enrolment-editor';
import { ProviderOnly } from '@/components/programme-ui';

export default function CreateEnrolmentScreen() {
  return <ProviderOnly><EnrolmentEditor /></ProviderOnly>;
}
