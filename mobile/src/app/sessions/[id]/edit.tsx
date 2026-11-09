import { ProviderOnly } from '@/components/programme-ui';
import { SessionEditor } from '@/components/session-editor';

export default function EditSessionScreen() {
  return <ProviderOnly><SessionEditor /></ProviderOnly>;
}
