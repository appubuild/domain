/** The two dialogs the file menu needs, and the reason they are dialogs.
 *
 *  **New** asks for a name and the service picks the file's home; **Open** asks
 *  for a path, because there is no file picker yet — a native one is the
 *  desktop shell's to show (stage 11), and a web page's
 *  `<input type="file">` would hand us a `File` object and a name rather than
 *  the path the service imports from. So today it is a path, typed, and it is
 *  honest about being one.
 *
 *  Both own their field's value and both refuse to answer with an empty one.
 *  Neither writes to the store: they report what the user said and let the
 *  shell decide — a dialog that saved a project itself would be a dialog the
 *  shell could not refuse to save.
 */

import { useState } from 'react';

import { useI18n } from '../../core/i18n/context';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { TextField } from '../../ui/TextField';

export interface NewProjectDialogProps {
  readonly open: boolean;
  /** Called with the name the user typed, trimmed and not empty. */
  readonly onSubmit: (name: string) => void;
  readonly onClose: () => void;
}

export function NewProjectDialog({
  open,
  onSubmit,
  onClose,
}: NewProjectDialogProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [name, setName] = useState('');

  return (
    <Modal
      open={open}
      title={t('shell.dialog.new.title')}
      description={t('shell.dialog.new.description')}
      onClose={() => {
        onClose();
      }}
      footer={
        <>
          <Button
            onClick={() => {
              onClose();
            }}
          >
            {t('shell.dialog.cancel')}
          </Button>
          <Button
            variant="solid"
            disabled={name.trim() === ''}
            onClick={() => {
              onSubmit(name.trim());
            }}
          >
            {t('shell.dialog.new.create')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('shell.dialog.new.nameLabel')}
        placeholder={t('shell.dialog.new.namePlaceholder')}
        value={name}
        onValueChange={setName}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || name.trim() === '') return;
          event.preventDefault();
          onSubmit(name.trim());
        }}
      />
    </Modal>
  );
}

export interface OpenProjectDialogProps {
  readonly open: boolean;
  /** Called with the path the user typed. */
  readonly onSubmit: (path: string) => void;
  readonly onClose: () => void;
}

export function OpenProjectDialog({
  open,
  onSubmit,
  onClose,
}: OpenProjectDialogProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [path, setPath] = useState('');

  return (
    <Modal
      open={open}
      title={t('shell.dialog.open.title')}
      description={t('shell.dialog.open.description')}
      onClose={() => {
        onClose();
      }}
      footer={
        <>
          <Button
            onClick={() => {
              onClose();
            }}
          >
            {t('shell.dialog.cancel')}
          </Button>
          <Button
            variant="solid"
            disabled={path.trim() === ''}
            onClick={() => {
              onSubmit(path.trim());
            }}
          >
            {t('shell.dialog.open.open')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('shell.dialog.open.pathLabel')}
        placeholder={t('shell.dialog.open.pathPlaceholder')}
        value={path}
        onValueChange={setPath}
        // Monospaced and not truncated: a path is the one field where the
        // difference between two characters is the whole difference.
        className="font-mono"
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || path.trim() === '') return;
          event.preventDefault();
          onSubmit(path.trim());
        }}
      />
    </Modal>
  );
}
