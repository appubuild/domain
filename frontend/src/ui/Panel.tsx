/** A panel: the surface everything else in the window sits on.
 *
 *  One component, because a dock tree is made of these and a dock tree with
 *  three different panel paddings looks like three applications. The chrome is
 *  the point:
 *
 *  * **The heading is a heading.** `h2` by default, with the level a prop, so a
 *    screen reader can move between panels the way it moves between sections of
 *    a document — which is what "move to next heading" is for.
 *  * **The body scrolls, the header does not.** A panel whose title scrolls out
 *    of view is a panel whose contents you have to scroll back up to identify.
 *  * **`surface-1` on `surface-0`.** One step up, every time: two steps reads as
 *    a floating layer, and no step at all reads as a hole.
 *
 *  There is no `padding` prop. Padding is the body's business, and a panel that
 *  lets each caller choose it is a panel that cannot be docked next to another
 *  one without the seam showing.
 */

import { type ReactNode, type Ref } from 'react';

import { cx, type ClassValue } from './cx';

/** The heading tag per level. A closed set, so the outline cannot be broken by
 *  a caller who passes `9`. */
const HEADING_TAG = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export interface PanelProps {
  /** Shown in the header. Omitted, there is no header at all — a panel that is
   *  only a body is a thumbnail strip, and it should not pay for one. */
  readonly title?: ReactNode;
  /** Controls on the right of the header. */
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  /** The heading level. `2` for a panel in the window; higher for a panel
   *  inside a panel, so the document's outline stays true. */
  readonly headingLevel?: 2 | 3 | 4;
  /** Let the body scroll. On by default: a panel that grows past the window is
   *  the common case, and clipping it is worse than scrolling it. */
  readonly scroll?: boolean;
  readonly className?: ClassValue;
  readonly ref?: Ref<HTMLElement>;
}

export function Panel({
  title,
  actions,
  children,
  headingLevel = 2,
  scroll = true,
  className,
  ref,
}: PanelProps): React.JSX.Element {
  // A record rather than a template string with a cast: a dynamic tag has to be
  // a component reference, and the lookup is what makes the level a closed set.
  const Heading = HEADING_TAG[headingLevel];

  return (
    <section
      ref={ref}
      className={cx(
        'flex min-h-0 flex-col rounded-panel border border-line',
        'bg-surface-1 shadow-panel',
        className,
      )}
    >
      {title === undefined ? null : (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2">
          <Heading className="truncate text-xs font-semibold tracking-wide text-ink-dim">
            {title}
          </Heading>
          {actions === undefined ? null : (
            <div className="flex shrink-0 items-center gap-1">{actions}</div>
          )}
        </header>
      )}
      <div className={cx('min-h-0 flex-1 p-3', scroll && 'overflow-y-auto')}>{children}</div>
    </section>
  );
}
