/** A menu of commands: the desktop idiom, with the keyboard model that comes
 *  with it.
 *
 *  A menu is not a list of buttons in a box, and the difference is entirely in
 *  what the keyboard does:
 *
 *  * **One tab stop for the whole menu.** Arrow keys move between items; Tab
 *    leaves the menu. A menu where Tab moves between items is a menu that
 *    cannot be escaped without walking to the end of it.
 *  * **Home and End jump, arrows wrap.** Muscle memory for a menu is twenty
 *    years older than the web.
 *  * **Typing a letter jumps to the next item that starts with it.** One
 *    character, not a search field: this is type-ahead, and it is what makes a
 *    twelve-item menu navigable without reading it.
 *  * **Escape closes and returns focus to the trigger.** Which is the whole
 *    contract of a menu: it is a detour, not a destination.
 *
 *  `Menu` renders the list; the trigger and the open state are the caller's,
 *  because a menu is opened by a button, by a right-click and by a keyboard
 *  shortcut, and a component that owned the opening would own all three badly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { cx, type ClassValue } from './cx';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Portal } from './Portal';
import { isEscapeKey, useDismissable } from './useDismissable';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** The shortcut, shown but not handled — a menu item does not know the app's
   *  key map, and a component that registered a global listener to find out
   *  would be a component that fights the command palette for it. */
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /** A separator *before* this item. A `MenuItem` that was a separator would be
   *  a menu where every entry had an `id` it did not need. */
  readonly separatorBefore?: boolean;
  readonly onSelect?: () => void;
}

export interface MenuProps {
  readonly open: boolean;
  readonly items: readonly MenuItem[];
  /** Where the menu is anchored. The caller measures its trigger; a component
   *  that measured for you would need to know what a "trigger" is. */
  readonly anchor: { readonly x: number; readonly y: number } | null;
  /** The element that opened it, or `null`. A press on the trigger is not an
   *  outside press — otherwise the toggle closes and reopens in one event. */
  readonly trigger?: HTMLElement | null | undefined;
  readonly onClose: (reason: 'escape' | 'outside' | 'select') => void;
  /** Accessible name for the list. "Project actions", not "menu". */
  readonly label: string;
  readonly className?: ClassValue;
}

/** How long a typed letter stays part of the same type-ahead run. */
const TYPE_AHEAD_RESET_MS = 800;

export function Menu({
  open,
  items,
  anchor,
  trigger,
  onClose,
  label,
  className,
}: MenuProps): React.JSX.Element | null {
  // State rather than a ref, for the reason in `Modal`: the menu is portalled,
  // and a ref read during the first commit finds nothing.
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState(-1);
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  useDismissable({ open, onDismiss: onClose, container: list, trigger });

  // The enabled items, in the order the keyboard walks them: a disabled item is
  // skipped rather than focused, because a menu item you can land on and not
  // press is worse than one you cannot land on.
  const enabled = items.filter((item) => item.disabled !== true);

  const move = useCallback(
    (delta: number): void => {
      if (enabled.length === 0) return;
      setActive((current) => {
        const index = current < 0 ? (delta > 0 ? 0 : enabled.length - 1) : current + delta;
        // Wrapping, not clamping: at the bottom of a menu, Down goes to the top.
        // That is what every other menu on the user's machine does.
        return (index + enabled.length) % enabled.length;
      });
    },
    [enabled.length],
  );

  // A new opening starts with nothing active: arrowing down from a fresh menu
  // lands on the first item, which is what the idiom expects, and it means the
  // first item is not pre-highlighted in a way that suggests it is chosen.
  useEffect(() => {
    if (open) setActive(-1);
  }, [open]);

  // Focus the menu itself when it opens. Without this the keys go to the
  // document: a menu is a keyboard component, and a menu that opens without
  // taking focus is one where ArrowDown does nothing until you click it. The
  // container is focused and not the first item, because "nothing is chosen yet"
  // is a state the menu has to be able to show.
  useEffect(() => {
    if (open) list?.focus();
    // `list` as well as `open`: the menu is portalled, so the element does not
    // exist during the commit that opens it.
  }, [list, open]);

  useEffect(() => {
    if (!open || active < 0) return;
    const item = enabled[active];
    if (item === undefined) return;
    // `id` rather than a ref array: the item the user is on is identified by
    // what it is, and the DOM is where the focus has to end up. Matched by
    // walking rather than with a selector and `CSS.escape`, which is a CSSOM
    // function an environment without a full CSS implementation need not have.
    const element = list
      ? [...list.querySelectorAll<HTMLElement>('[data-menu-item]')].find(
          (candidate) => candidate.dataset['menuItem'] === item.id,
        )
      : undefined;
    element?.focus();
    // `list` too: the menu is portalled, so the element does not exist yet on
    // the commit that opens it.
  }, [active, enabled, list, open]);

  if (!open || anchor === null) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        return;
      case 'Home':
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        event.preventDefault();
        setActive(enabled.length - 1);
        return;
      default:
        break;
    }

    if (isEscapeKey(event.nativeEvent)) {
      // Handled here as well as by `useDismissable`, so the press does not reach
      // the dialog or the panel behind: a menu is the innermost thing open, and
      // it is the thing Escape should close.
      event.stopPropagation();
      onClose('escape');
      return;
    }

    // Type-ahead: one printable character at a time, matched against the start
    // of a label, resetting after a pause so "cl" finds "Close" and "c l" does
    // not find "Clip".
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const run = now - typed.current.at > TYPE_AHEAD_RESET_MS ? '' : typed.current.text;
      const text = run + event.key.toLowerCase();
      typed.current = { text, at: now };
      const from = active < 0 ? 0 : active + 1;
      const order = [...enabled.slice(from), ...enabled.slice(0, from)];
      const next = order.find((item) => item.label.toLowerCase().startsWith(text));
      if (next !== undefined) {
        event.preventDefault();
        setActive(enabled.indexOf(next));
      }
    }
  };

  return (
    <Portal>
      <div
        ref={setList}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        // One tab stop for the whole menu: `list.current` holds focus and the
        // items are reached with arrows, so Tab leaves rather than walking.
        onKeyDown={onKeyDown}
        // Anchored by the caller, flipped by nobody: a menu that opens towards
        // the edge of the screen is the caller's problem to solve by measuring
        // its own trigger, which it has to do anyway.
        style={{ left: anchor.x, top: anchor.y }}
        className={cx(
          'fixed z-[var(--z-overlay)] min-w-48 py-1',
          'rounded-panel border border-line bg-surface-2 shadow-overlay',
          className,
        )}
      >
        {items.map((item) => (
          <div key={item.id}>
            {item.separatorBefore === true ? (
              <div role="separator" className="my-1 h-px bg-line" />
            ) : null}
            <button
              type="button"
              role="menuitem"
              data-menu-item={item.id}
              disabled={item.disabled === true}
              // `-1` for every item: focus is moved here by arrow key, never by
              // Tab, which is what makes the menu one tab stop.
              tabIndex={-1}
              aria-keyshortcuts={item.shortcut}
              onClick={() => {
                if (item.disabled === true) return;
                item.onSelect?.();
                onClose('select');
              }}
              onPointerEnter={() => {
                if (item.disabled === true) return;
                setActive(enabled.indexOf(item));
              }}
              className={cx(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                'transition-colors duration-[var(--duration-fast)] ease-out',
                item.disabled === true
                  ? 'cursor-not-allowed text-ink-faint'
                  : 'text-ink hover:bg-surface-3',
              )}
            >
              {item.icon === undefined ? (
                // A spacer, so a label in a menu where some items have icons
                // lines up with the ones that do.
                <span className="w-4 shrink-0" />
              ) : (
                <Icon name={item.icon} size="sm" />
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut === undefined ? null : (
                <span className="shrink-0 font-mono text-xs text-ink-faint">{item.shortcut}</span>
              )}
            </button>
          </div>
        ))}
      </div>
    </Portal>
  );
}
