/** The command palette: every thing the window can do, found by typing.
 *
 *  Built out of three primitives, and the interesting part is what each one is
 *  trusted with:
 *
 *  * `Modal` — focus in, focus back out, Escape, and the rest of the window
 *    inert. A palette that let a keystroke reach the timeline behind it would
 *    edit the timeline.
 *  * `VirtualList` — a plugin registry grows without limit (stage 10), and
 *    drawing every command is a palette that hesitates on the first keystroke.
 *  * `filterCommands` — ranking, not searching: what the user typed is a
 *    *prefix of a word* nine times out of ten, and a substring search that
 *    cannot tell "Save" from "Save as…" is a palette that fights its user.
 *
 *  The ARIA shape is a **combobox**: the input keeps focus the whole time, the
 *  list is a `listbox`, and the active row is announced through
 *  `aria-activedescendant` rather than by moving focus — which is the only way
 *  a virtualised list can have an active row at all, since the row the user is
 *  on may not be the row that is drawn.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useI18n } from '../../core/i18n/context';
import { type Command, filterCommands } from '../../app/commands';
import { Modal } from '../../ui/Modal';
import { TextField } from '../../ui/TextField';
import { VirtualList, type VirtualListHandle } from '../../ui/VirtualList';

/** How tall a row is, and how many are drawn beyond the ones on screen. */
const ROW_HEIGHT = 34;
const OVERSCAN = 4;

export interface CommandPaletteProps {
  readonly open: boolean;
  /** Every command in the window. Disabled ones are left out, not greyed: a
   *  palette is a way of *finding* something, and a third of the list being
   *  un-runnable makes it a worse one. */
  readonly commands: readonly Command[];
  readonly onClose: () => void;
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: CommandPaletteProps): React.JSX.Element | null {
  const { t } = useI18n();
  // `useId` and not a counter: two palettes in one document (a story, a test)
  // must not point at each other's options.
  const id = useId();
  const listId = `${id}-commands`;
  const list = useRef<VirtualListHandle | null>(null);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(
    () =>
      filterCommands(
        commands.filter((command) => !command.disabled),
        query,
      ),
    [commands, query],
  );

  // A fresh opening is a clean slate: the palette that remembered last time's
  // search would be a palette you have to clear before you can use.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
  }, [open]);

  if (!open) return null;

  // Clamped rather than stored: the list shrinks as the user types, and an
  // active row that outran the results is a row that is not there.
  const current = Math.min(active, Math.max(0, results.length - 1));

  function move(step: number): void {
    const next = (current + step + results.length) % Math.max(1, results.length);
    setActive(next);
    // Scrolled through the list's own handle, because that is the only thing
    // that knows where row `next` is.
    list.current?.scrollToIndex(next, 'center');
  }

  function choose(index: number): void {
    const command = results[index];
    if (command === undefined) return;
    // Closed first: a command that opens a dialog inside a palette that is still
    // open is two modals fighting over focus.
    onClose();
    command.run();
  }

  return (
    <Modal
      open
      title={t('shell.palette.title')}
      description={t('shell.palette.description')}
      onClose={() => {
        onClose();
      }}
      className="w-[34rem]"
    >
      <div className="flex flex-col gap-2">
        <TextField
          label={t('shell.palette.label')}
          labelHidden
          placeholder={t('shell.palette.placeholder')}
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            setActive(0);
          }}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          {...(results.length > 0 ? { 'aria-activedescendant': `${id}-option-${current}` } : {})}
          onKeyDown={(event) => {
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault();
                move(1);
                return;
              case 'ArrowUp':
                event.preventDefault();
                move(-1);
                return;
              case 'Enter':
                event.preventDefault();
                choose(current);
                return;
              default:
                return;
            }
          }}
        />

        {results.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint" role="status">
            {t('shell.palette.empty')}
          </p>
        ) : (
          <VirtualList
            id={listId}
            role="listbox"
            label={t('shell.palette.title')}
            count={results.length}
            itemSize={ROW_HEIGHT}
            overscan={OVERSCAN}
            itemId={(index) => `${id}-option-${index}`}
            selectedIndex={current}
            ref={list}
            className="max-h-80 min-h-24"
          >
            {(index) => {
              const command = results[index];
              if (command === undefined) return null;
              // Selected on the row above, and not here: the row is the
              // `option`, and an `option` that does not say it is selected is
              // not one. This is only the drawing.
              const selected = index === current;
              return (
                <div
                  onClick={() => {
                    choose(index);
                  }}
                  // Not a button: focus stays in the combobox, and a button in
                  // every row would be a second tab stop per command.
                  className={`flex h-full cursor-pointer items-center gap-2 rounded-control px-2 text-sm ${
                    selected ? 'bg-surface-3 text-ink' : 'text-ink-dim'
                  }`}
                >
                  <span className="truncate">{command.title}</span>
                  {command.hint === undefined ? null : (
                    <span className="truncate text-xs text-ink-faint">{command.hint}</span>
                  )}
                  {command.shortcut === undefined ? null : (
                    <span className="ml-auto shrink-0 font-mono text-xs text-ink-faint">
                      {command.shortcut}
                    </span>
                  )}
                </div>
              );
            }}
          </VirtualList>
        )}
      </div>
    </Modal>
  );
}
