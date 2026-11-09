/** The dock tree, which is data before it is geometry.
 *
 *  Every function here is pure, so every test is a value in and a value out —
 *  and the two that matter most are the ones nobody would think to write: that
 *  a drag takes share from the pane on the far side of the handle **and from
 *  nobody else**, and that a document read back out of storage is either a
 *  window or a `null`, never a window with a pane missing.
 */

import { describe, expect, it } from 'vitest';

import {
  MIN_DOCK_FRACTION,
  boundaryAt,
  closeLeaf,
  isLeaf,
  leaf,
  leavesOf,
  normalizeFractions,
  parseDockNode,
  resizeAt,
  split,
  splitLeaf,
  updateAt,
  type DockNode,
} from './dock';

/** A window: media on the left, the preview and the inspector stacked beside
 *  it, the timeline under everything. Small enough to read in a failure. */
const WINDOW: DockNode = split('column', [
  leaf('timeline'),
  split(
    'row',
    [leaf('media'), split('column', [leaf('preview'), leaf('inspector')])],
    [0.25, 0.75],
  ),
]);

function shares(node: DockNode): number[] | undefined {
  return isLeaf(node) ? undefined : [...node.fractions];
}

describe('making a tree', () => {
  it('splits into equal shares when none are asked for', () => {
    expect(shares(split('row', [leaf('a'), leaf('b'), leaf('c')]))).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('scales the shares it is given so they add up to one', () => {
    // A layout hand-written in a fixture with 1/4/5 rather than 0.1/0.4/0.5 is
    // still a layout, not a bug report.
    expect(normalizeFractions([1, 4, 5], 3)).toEqual([0.1, 0.4, 0.5]);
  });

  it('replaces shares that do not fit the children, rather than rejecting them', () => {
    expect(normalizeFractions([0.5, 0.5], 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(normalizeFractions([Number.NaN, 0.5], 2)).toEqual([0.5, 0.5]);
    expect(normalizeFractions([-1, 2], 2)).toEqual([0.5, 0.5]);
    expect(normalizeFractions([], 0)).toEqual([]);
  });

  it('lists the panes in the order they appear on screen', () => {
    expect(leavesOf(WINDOW)).toEqual(['timeline', 'media', 'preview', 'inspector']);
  });
});

describe('a handle between two panes', () => {
  it('sits after everything to the left of it', () => {
    // The second divider of three panes at 0.2/0.3/0.5 is at 0.5, not at 0.3.
    const boundary = boundaryAt([0.2, 0.3, 0.5], 1);
    expect(boundary.value).toBeCloseTo(0.5);
  });

  it('cannot take a pane below its minimum, nor past its neighbour', () => {
    const boundary = boundaryAt([0.5, 0.5], 0);
    expect(boundary.min).toBeCloseTo(MIN_DOCK_FRACTION);
    expect(boundary.max).toBeCloseTo(1 - MIN_DOCK_FRACTION);
  });

  it('keeps a range even for a pair too small for two minimums', () => {
    // A pair of 0.05 shared between two panes: the floor gives way rather than
    // leaving a `min` above the `max`, and the handle pins itself at the pair's
    // midpoint — which is the honest answer when both panes are already as
    // small as they can be.
    const boundary = boundaryAt([0.95, 0.025, 0.025], 1);
    expect(boundary.min).toBeLessThanOrEqual(boundary.max);
    expect(boundary.min).toBeCloseTo(0.975);
    expect(boundary.max).toBeCloseTo(0.975);
  });

  it('moves the pair and nobody else', () => {
    const next = resizeAt([0.2, 0.3, 0.5], 1, 0.6);
    expect(next[0]).toBeCloseTo(0.2);
    expect(next[1]).toBeCloseTo(0.4);
    expect(next[2]).toBeCloseTo(0.4);
  });

  it('holds the pair at its bounds, because a drag is allowed to overshoot', () => {
    const wide = resizeAt([0.5, 0.5], 0, 10);
    expect(wide[0]).toBeCloseTo(1 - MIN_DOCK_FRACTION);
    expect(wide[1]).toBeCloseTo(MIN_DOCK_FRACTION);
    const narrow = resizeAt([0.5, 0.5], 0, -10);
    expect(narrow[0]).toBeCloseTo(MIN_DOCK_FRACTION);
    expect(narrow[1]).toBeCloseTo(1 - MIN_DOCK_FRACTION);
  });

  it('keeps the total, so a drag cannot lose a sliver of the window', () => {
    const next = resizeAt([0.2, 0.3, 0.5], 1, 0.41);
    expect(next.reduce((total, share) => total + share, 0)).toBeCloseTo(1);
  });
});

describe('changing a tree', () => {
  it('replaces the split at a path, and leaves the rest of the tree alone', () => {
    const next = updateAt(WINDOW, [1, 1], (node) => ({
      ...node,
      fractions: resizeAt(node.fractions, 0, 0.75),
    }));
    expect(isLeaf(next)).toBe(false);
    if (isLeaf(next)) return;
    // The timeline is untouched, and the outer split still holds its shares.
    expect(shares(next)).toEqual([0.5, 0.5]);
    const side = next.children[1];
    expect(side !== undefined && !isLeaf(side) ? shares(side) : undefined).toEqual([0.25, 0.75]);
    const stack = side !== undefined && !isLeaf(side) ? side.children[1] : undefined;
    expect(stack !== undefined && !isLeaf(stack) ? shares(stack) : undefined).toEqual([0.75, 0.25]);
  });

  it('is the same tree when the path leads nowhere', () => {
    // A drag reported for a pane the user has just closed.
    expect(updateAt(WINDOW, [1, 7], (node) => node)).toBe(WINDOW);
    expect(updateAt(WINDOW, [1, 1, 0], (node) => node)).toBe(WINDOW);
  });

  it('puts a new pane beside an existing one, on the side it was asked for', () => {
    const next = splitLeaf(WINDOW, 'preview', 'row', 'effects', 'before');
    expect(leavesOf(next)).toEqual(['timeline', 'media', 'effects', 'preview', 'inspector']);
  });

  it('is unchanged by a split for a pane that is not there', () => {
    expect(splitLeaf(WINDOW, 'scopes', 'row', 'effects')).toBe(WINDOW);
  });

  it('closes a pane and shares out what it held', () => {
    const next = closeLeaf(WINDOW, 'inspector');
    expect(leavesOf(next ?? leaf('nothing'))).toEqual(['timeline', 'media', 'preview']);
    // The stack beside the media bin is left with one pane, so it collapses into
    // that pane: a container of one is not a container.
    expect(next !== null && !isLeaf(next) ? shares(next) : undefined).toEqual([0.5, 0.5]);
  });

  it('is unchanged by a close for a pane that is not there', () => {
    expect(closeLeaf(WINDOW, 'scopes')).toBe(WINDOW);
  });

  it('says there is no window left when the last pane goes', () => {
    expect(closeLeaf(leaf('preview'), 'preview')).toBeNull();
  });
});

describe('a layout read back out of storage', () => {
  it('survives a round trip through JSON', () => {
    const parsed = parseDockNode(JSON.parse(JSON.stringify(WINDOW)));
    expect(parsed).toEqual(WINDOW);
  });

  it('repairs shares that do not add up, because equal panes beat no window', () => {
    const parsed = parseDockNode({
      kind: 'split',
      direction: 'row',
      fractions: [1, 1, 1],
      children: [
        { kind: 'leaf', id: 'a' },
        { kind: 'leaf', id: 'b' },
      ],
    });
    expect(parsed !== null && !isLeaf(parsed) ? shares(parsed) : undefined).toEqual([0.5, 0.5]);
  });

  it('refuses everything else, so the shell can fall back to the default', () => {
    // A layout written by a version that arranged the window differently is a
    // document to throw away, not a window to half-draw.
    const junk: readonly unknown[] = [
      null,
      'preview',
      42,
      {},
      { kind: 'panel', id: 'preview' },
      { kind: 'leaf' },
      { kind: 'leaf', id: '' },
      { kind: 'split', direction: 'diagonal', children: [leaf('a'), leaf('b')] },
      { kind: 'split', direction: 'row', children: [leaf('a')] },
      { kind: 'split', direction: 'row', children: [{ kind: 'leaf', id: 'a' }, { kind: 'nope' }] },
    ];
    for (const value of junk) {
      expect(parseDockNode(value)).toBeNull();
    }
  });

  it('accepts a leaf with no shares at all, and a split that omits them', () => {
    expect(parseDockNode({ kind: 'leaf', id: 'preview' })).toEqual(leaf('preview'));
    const parsed = parseDockNode({
      kind: 'split',
      direction: 'column',
      children: [
        { kind: 'leaf', id: 'a' },
        { kind: 'leaf', id: 'b' },
      ],
    });
    expect(parsed !== null && !isLeaf(parsed) ? shares(parsed) : undefined).toEqual([0.5, 0.5]);
  });
});
