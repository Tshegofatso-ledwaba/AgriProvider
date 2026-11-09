import { ProgrammeEditor } from '@/components/programme-editor';
import { ProviderOnly } from '@/components/programme-ui';

export default function EditProgrammeScreen() {
  return (
    <ProviderOnly>
      <ProgrammeEditor />
    </ProviderOnly>
  );
}
