import { ProviderOnly } from '@/components/programme-ui';
import { SessionEditor } from '@/components/session-editor';

export default function CreateSessionScreen() {
  return <ProviderOnly><SessionEditor /></ProviderOnly>;
}
