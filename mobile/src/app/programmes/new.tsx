import { ProviderOnly } from '@/components/programme-ui';
import { ProgrammeEditor } from '@/components/programme-editor';

export default function CreateProgrammeScreen() {
  return (
    <ProviderOnly>
      <ProgrammeEditor />
    </ProviderOnly>
  );
}
