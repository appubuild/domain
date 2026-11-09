/** A dock tree: the window's layout as data.
 *
 *  Data and not components, for the same reason a theme is (§10.10): the layout
 *  is something the user changes, the settings store saves (stage 6, slice 6),
 *  and a later version reads back — and none of those three is a React tree. A
 *  document can be validated, compared in a test and migrated; a component tree
 *  can only be rendered.
 *
 *  Every function here is pure, takes the node it changes and returns a new
 *  one, so the component that draws the dock (`Dock.tsx`) is only geometry.
 *  What it does *not* know: which panels exist, what a panel is, or where the
 *  document is kept. That is the window's business (stage 6, slice 5).
 *
 *  Sizes are **fractions of the container, not pixels**, which is the one
 *  decision the rest of the file is built on. A tree of pixel widths cannot be
 *  restored on a different monitor, cannot be resized by dragging the window,
 *  and cannot be validated — "these three numbers add up to 1" is a rule, while
 *  "these three numbers add up to the window" is a measurement.
 */

export type DockDirection = 'row' | 'column';

/** One pane, named. The dock does not know what a pane is — only that the
 *  window can draw something for the name. */
export interface DockLeaf {
  readonly kind: 'leaf';
  readonly id: string;
}

export interface DockSplit {
  readonly kind: 'split';
  readonly direction: DockDirection;
  /** One share per child, adding up to 1. Kept beside the children and not
   *  derived from them: two panes are not necessarily half and half. */
  readonly fractions: readonly number[];
  readonly children: readonly DockNode[];
}

export type DockNode = DockLeaf | DockSplit;

/** Where a divider sits, and how far it may travel. */
export interface DockBoundary {
  /** The boundary's position, as a fraction of the container. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

/** The smallest share a pane may be squeezed to. A twelfth is 96 px of a
 *  1 152 px window: below that a panel is a strip of clipped header, and a
 *  strip of clipped header is a pane the user will spend a drag getting back.
 */
export const MIN_DOCK_FRACTION = 1 / 12;

export function isLeaf(node: DockNode): node is DockLeaf {
  return node.kind === 'leaf';
}

export function leaf(id: string): DockLeaf {
  return { kind: 'leaf', id };
}

/** Two or more panes sharing a container. Equal shares when none are given. */
export function split(
  direction: DockDirection,
  children: readonly DockNode[],
  fractions?: readonly number[],
): DockSplit {
  return {
    kind: 'split',
    direction,
    fractions: normalizeFractions(fractions ?? [], children.length),
    children,
  };
}

/** The pane ids, in the order they appear on screen. */
export function leavesOf(node: DockNode): string[] {
  if (isLeaf(node)) return [node.id];
  return node.children.flatMap(leavesOf);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Make the shares add up to 1, or replace them with equal ones when they do
 *  not — because a document from a future version with a fourth share for three
 *  panes is not a crash, it is three panes of equal width. */
export function normalizeFractions(fractions: readonly number[], count: number): number[] {
  if (count <= 0) return [];
  const usable =
    fractions.length === count &&
    fractions.every((fraction) => Number.isFinite(fraction) && fraction > 0);
  if (!usable) return Array.from({ length: count }, () => 1 / count);
  const total = sum(fractions);
  return fractions.map((fraction) => fraction / total);
}

/** Where divider `index` sits — the one between children `index` and
 *  `index + 1` — and the two positions it must not pass.
 *
 *  Only the pair moves, which is why the answer is expressed against the whole
 *  container: the boundary is a position in it, but dragging it may not take
 *  share from the panes further along. */
export function boundaryAt(fractions: readonly number[], index: number): DockBoundary {
  const left = fractions[index] ?? 0;
  const right = fractions[index + 1] ?? 0;
  const pair = left + right;
  // Half the pair at most, so a pair too small for two minimums still has a
  // range rather than a `min` above its `max`.
  const floor = Math.min(MIN_DOCK_FRACTION, pair / 2);
  const previous = sum(fractions.slice(0, index));
  return {
    value: previous + left,
    min: previous + floor,
    max: previous + pair - floor,
  };
}

/** Move divider `index` to `boundary`, giving the difference to the pane on the
 *  far side and to nobody else.
 *
 *  A drag that redistributed across every pane would be a drag that moved the
 *  panes the user was not touching — the bug where resizing the inspector
 *  quietly narrows the media bin. */
export function resizeAt(fractions: readonly number[], index: number, boundary: number): number[] {
  const left = fractions[index] ?? 0;
  const right = fractions[index + 1] ?? 0;
  const pair = left + right;
  const floor = Math.min(MIN_DOCK_FRACTION, pair / 2);
  const previous = sum(fractions.slice(0, index));
  const share = Math.min(Math.max(boundary - previous, floor), pair - floor);
  const next = [...fractions];
  next[index] = share;
  next[index + 1] = pair - share;
  return next;
}

/** Replace the split at `path` — the indices to walk down — with the result of
 *  `update`. The tree is not mutated, and a path that leads nowhere returns the
 *  tree it was given: a resize of a pane that has since been closed is not an
 *  error anybody can act on. */
export function updateAt(
  node: DockNode,
  path: readonly number[],
  update: (split: DockSplit) => DockSplit,
): DockNode {
  const index = path[0];
  if (index === undefined) return isLeaf(node) ? node : update(node);
  if (isLeaf(node)) return node;
  const child = node.children[index];
  if (child === undefined) return node;
  const next = updateAt(child, path.slice(1), update);
  if (next === child) return node;
  const children = [...node.children];
  children[index] = next;
  return { ...node, children };
}

/** Replace one leaf. Private: it is the shape both commands below share. */
function mapLeaf(node: DockNode, id: string, replace: (found: DockLeaf) => DockNode): DockNode {
  if (isLeaf(node)) return node.id === id ? replace(node) : node;
  const children = node.children.map((child) => mapLeaf(child, id, replace));
  // Compared rather than flagged: a flag set inside the callback is a flag the
  // type checker cannot see, which is how a "changed" test quietly becomes a
  // constant `false`.
  const changed = children.some((child, index) => child !== node.children[index]);
  return changed ? { ...node, children } : node;
}

/** Put a new pane beside an existing one, sharing that pane's half of the
 *  container. Returns the tree unchanged when `id` is not in it. */
export function splitLeaf(
  node: DockNode,
  id: string,
  direction: DockDirection,
  newId: string,
  position: 'before' | 'after' = 'after',
): DockNode {
  return mapLeaf(node, id, (found) =>
    split(
      direction,
      position === 'before' ? [leaf(newId), leaf(found.id)] : [leaf(found.id), leaf(newId)],
    ),
  );
}

/** Take a pane out. Its share is shared out among the panes that were beside
 *  it, a container left with one child collapses into that child, and `null`
 *  means the last pane went — a window with no panes is not a dock.
 *
 *  Returns the tree unchanged when `id` is not in it. */
export function closeLeaf(node: DockNode, id: string): DockNode | null {
  if (isLeaf(node)) return node.id === id ? null : node;

  const kept: { readonly node: DockNode; readonly fraction: number }[] = [];
  node.children.forEach((child, index) => {
    const next = closeLeaf(child, id);
    // A pane that came back `null` is gone, and its share goes to the panes
    // beside it — which happens below, when what is left is re-shared.
    if (next !== null) kept.push({ node: next, fraction: node.fractions[index] ?? 0 });
  });

  // Changed counts a subtree that collapsed as well as a child that vanished:
  // closing a pane *inside* a group collapses the group into its last pane,
  // which is a new child here even though no child here was closed.
  const changed =
    kept.length !== node.children.length ||
    kept.some((entry, index) => entry.node !== node.children[index]);

  if (!changed) return node;
  if (kept.length === 0) return null;
  // A split of one is not a split: leaving it behind would give the window a
  // divider with a pane on one side of it.
  if (kept.length === 1) return kept[0]?.node ?? null;
  return {
    ...node,
    children: kept.map((entry) => entry.node),
    fractions: normalizeFractions(
      kept.map((entry) => entry.fraction),
      kept.length,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read a layout back out of storage.
 *
 *  `null` for anything that is not a dock tree, which is the contract a saved
 *  document needs: a layout written by a version that arranged the window
 *  differently is not a broken window, it is a layout the shell throws away and
 *  replaces with the default. `fractions` is the one thing that is repaired
 *  rather than rejected, because equal shares are a better answer than no
 *  window.
 */
export function parseDockNode(value: unknown): DockNode | null {
  if (!isRecord(value)) return null;

  if (value['kind'] === 'leaf') {
    const id = value['id'];
    return typeof id === 'string' && id !== '' ? { kind: 'leaf', id } : null;
  }

  if (value['kind'] !== 'split') return null;
  const direction = value['direction'];
  if (direction !== 'row' && direction !== 'column') return null;
  const raw = value['children'];
  if (!Array.isArray(raw) || raw.length < 2) return null;

  const children: DockNode[] = [];
  for (const child of raw) {
    const parsed = parseDockNode(child);
    if (parsed === null) return null;
    children.push(parsed);
  }

  const given = Array.isArray(value['fractions']) ? (value['fractions'] as readonly unknown[]) : [];
  const fractions = normalizeFractions(
    given.map((fraction) => (typeof fraction === 'number' ? fraction : Number.NaN)),
    children.length,
  );

  return { kind: 'split', direction, fractions, children };
}
