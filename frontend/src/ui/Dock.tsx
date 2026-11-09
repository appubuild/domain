/** The geometry of a window: a tree of panes with handles between them.
 *
 *  What this component is **not** is a window. It does not know which panels
 *  exist, it has no opinion about what goes where, it does not persist anything
 *  and it has no chrome: the tree arrives as data (`DockNode`), the panes are
 *  drawn by a callback, and every drag is reported as a new tree. The window
 *  that decides *what* is docked is stage 6, slice 5; the store that keeps the
 *  document is stage 6, slice 6.
 *
 *  Two things it does decide:
 *
 *  * **A drag reports a tree, not a size.** The dock is a pure function of the
 *    layout it is given, so the shell can refuse a change, undo it, or save it
 *    without asking the component anything.
 *  * **Every handle is named after the two panes it divides.** "Resize Media and
 *    Inspector" is a handle a screen-reader user can find; three handles all
 *    called "splitter" are three handles nobody can tell apart.
 */

import { type ReactNode, Fragment } from 'react';

import { cx, type ClassValue } from './cx';
import {
  type DockNode,
  type DockSplit,
  boundaryAt,
  isLeaf,
  leavesOf,
  resizeAt,
  updateAt,
} from './dock';
import { Splitter } from './Splitter';

export interface DockProps {
  readonly layout: DockNode;
  /** Draw a pane. The dock hands back the id and renders whatever comes out —
   *  which is what keeps the registry, and the knowledge of what a panel is, in
   *  the window where it belongs. */
  readonly render: (id: string) => ReactNode;
  readonly onLayoutChange: (layout: DockNode) => void;
  /** Human names for panes, by id. Omitted, a handle is named after the ids. */
  readonly labels?: Readonly<Record<string, string>> | undefined;
  readonly className?: ClassValue;
}

export function Dock({
  layout,
  render,
  onLayoutChange,
  labels,
  className,
}: DockProps): React.JSX.Element {
  function resize(path: readonly number[], index: number, boundary: number): void {
    onLayoutChange(
      updateAt(layout, path, (node) => ({
        ...node,
        fractions: resizeAt(node.fractions, index, boundary),
      })),
    );
  }

  return (
    <div className={cx('flex min-h-0 min-w-0 flex-1', className)}>
      <Branch node={layout} path={[]} render={render} labels={labels} onResize={resize} />
    </div>
  );
}

interface BranchProps {
  readonly node: DockNode;
  /** Where this node is in the tree, as the child indices to walk down. It is
   *  also the React key: a pane that moved is a different pane, and a pane that
   *  stayed is the same one with its scroll position intact. */
  readonly path: readonly number[];
  readonly render: (id: string) => ReactNode;
  readonly labels: Readonly<Record<string, string>> | undefined;
  readonly onResize: (path: readonly number[], index: number, boundary: number) => void;
}

function Branch({ node, path, render, labels, onResize }: BranchProps): React.JSX.Element {
  if (isLeaf(node)) return <>{render(node.id)}</>;

  return (
    <div
      className={cx(
        'flex min-h-0 min-w-0 flex-1',
        node.direction === 'row' ? 'flex-row' : 'flex-col',
      )}
    >
      {node.children.map((child, index) => {
        const childPath = [...path, index];
        return (
          <Fragment key={childPath.join('.')}>
            {index === 0 ? null : (
              <Splitter
                direction={node.direction}
                label={handleLabel(node, index, labels)}
                value={boundaryAt(node.fractions, index - 1).value}
                min={boundaryAt(node.fractions, index - 1).min}
                max={boundaryAt(node.fractions, index - 1).max}
                onChange={(boundary) => {
                  onResize(path, index - 1, boundary);
                }}
              />
            )}
            {/* `flex` with a basis of 0 is what makes a fraction a fraction:
                the shares are the *only* thing deciding the size, and a pane
                with a wide child in it does not push its neighbour out. */}
            <div
              className="flex min-h-0 min-w-0 flex-col"
              style={{ flex: `${node.fractions[index] ?? 0} 1 0%` }}
            >
              <Branch
                node={child}
                path={childPath}
                render={render}
                labels={labels}
                onResize={onResize}
              />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/** The name of the handle between children `index - 1` and `index`: the last
 *  pane of the group on one side and the first of the group on the other, which
 *  is the pair the user sees the handle sitting between. */
function handleLabel(
  node: DockSplit,
  index: number,
  labels: Readonly<Record<string, string>> | undefined,
): string {
  const before = node.children[index - 1];
  const after = node.children[index];
  if (before === undefined || after === undefined) return 'Resize panes';
  return `Resize ${paneName(before, labels, 'last')} and ${paneName(after, labels, 'first')}`;
}

function paneName(
  node: DockNode,
  labels: Readonly<Record<string, string>> | undefined,
  which: 'first' | 'last',
): string {
  const ids = leavesOf(node);
  const id = which === 'first' ? ids[0] : ids[ids.length - 1];
  if (id === undefined) return 'pane';
  return labels?.[id] ?? id;
}
