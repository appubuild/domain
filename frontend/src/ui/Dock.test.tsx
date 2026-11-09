// @vitest-environment jsdom
/** The dock, which is geometry and nothing else.
 *
 *  The tests here are the contract with the window that owns the tree: the dock
 *  draws what it is given, names every handle after the two panes it divides,
 *  and reports a **new tree** rather than a size. The last one is what makes a
 *  layout undoable, saveable and refusable, and the pair-only rule is what
 *  stops resizing the inspector from quietly narrowing the media bin.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { type DockNode, leaf, split } from './dock';
import { Dock } from './Dock';

/** Media beside the preview, the inspector under the preview, the timeline
 *  under everything. */
const WINDOW: DockNode = split('column', [
  leaf('timeline'),
  split(
    'row',
    [leaf('media'), split('column', [leaf('preview'), leaf('inspector')])],
    [0.25, 0.75],
  ),
]);

const LABELS = {
  media: 'Media',
  preview: 'Preview',
  inspector: 'Inspector',
  timeline: 'Timeline',
} as const;

/** jsdom has no layout, so the container a handle measures is handed its rect:
 *  800 px wide, which is a window. */
function stubContainer(element: HTMLElement, width = 800, height = 600): void {
  const container = element.parentElement;
  if (container === null) throw new Error('the handle has no container to measure');
  container.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
}

function Host({
  initial = WINDOW,
  labels,
}: {
  readonly initial?: DockNode;
  readonly labels?: Readonly<Record<string, string>>;
}): React.JSX.Element {
  // Stateful, because the dock is a pure function of the tree it is given: the
  // only way to see a drag is to hold the tree it reported.
  const [layout, setLayout] = useState(initial);
  return (
    <Dock
      layout={layout}
      labels={labels}
      onLayoutChange={setLayout}
      render={(id) => (
        <div data-testid={`pane-${id}`} data-pane={id}>
          {id}
        </div>
      )}
    />
  );
}

/** The wrapper the dock puts around a pane, which is where the share lives. */
function paneOf(id: string): HTMLElement {
  const pane = screen.getByTestId(`pane-${id}`).parentElement;
  if (pane === null) throw new Error(`pane ${id} has no wrapper`);
  return pane;
}

function shareOf(id: string): number {
  return Number.parseFloat(paneOf(id).style.flex);
}

describe('drawing a tree', () => {
  it('renders a pane per leaf, and knows nothing about what a pane is', () => {
    render(<Host />);
    expect(screen.getAllByTestId(/^pane-/).map((pane) => pane.dataset['pane'])).toEqual([
      'timeline',
      'media',
      'preview',
      'inspector',
    ]);
  });

  it('renders a leaf on its own with no handle at all', () => {
    render(<Host initial={leaf('preview')} />);
    expect(screen.getByTestId('pane-preview')).toBeTruthy();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('gives every pane its share of the container', () => {
    render(<Host />);
    // Each share is a share **of its own container**, not of the window: the
    // preview holds half of the group it sits in, and the group holds three
    // quarters of the row. A basis of 0 is what makes that true rather than
    // approximate — a pane with a wide child in it does not push its neighbour
    // out.
    expect(shareOf('timeline')).toBeCloseTo(0.5);
    expect(shareOf('media')).toBeCloseTo(0.25);
    expect(shareOf('preview')).toBeCloseTo(0.5);
    expect(shareOf('inspector')).toBeCloseTo(0.5);
  });

  it('one handle between each pair of neighbours, and not one per pane', () => {
    render(<Host />);
    // Three handles: one for the outer column, one for the row beside the media
    // bin, one for the column under the preview.
    expect(screen.getAllByRole('separator').length).toBe(3);
  });
});

describe('naming the handles', () => {
  it('names each after the two panes it divides', () => {
    render(<Host labels={LABELS} />);
    expect(screen.getByRole('separator', { name: 'Resize Timeline and Media' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize Media and Preview' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize Preview and Inspector' })).toBeTruthy();
  });

  it('falls back to the ids, because an unnamed pane is still a pane', () => {
    render(<Host />);
    expect(screen.getByRole('separator', { name: 'Resize media and preview' })).toBeTruthy();
  });
});

describe('a drag', () => {
  it('reports a new tree in which the pair moved and nobody else did', () => {
    render(<Host />);
    const handle = screen.getByRole('separator', { name: 'Resize media and preview' });
    stubContainer(handle);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    // 400 of 800: the media bin takes half the window, and takes it from the
    // group beside it rather than from the timeline.
    expect(shareOf('media')).toBeCloseTo(0.5);
    expect(shareOf('timeline')).toBeCloseTo(0.5);
    // The preview and the inspector keep their half-and-half of the group: the
    // group got smaller, and what it does with that is its own business.
    expect(shareOf('preview')).toBeCloseTo(0.5);
    expect(shareOf('inspector')).toBeCloseTo(0.5);
  });

  it('starts the second drag from where the first one ended', () => {
    render(<Host />);
    const handle = screen.getByRole('separator', { name: 'Resize media and preview' });
    stubContainer(handle);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(shareOf('media')).toBeCloseTo(0.5);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(shareOf('media')).toBeCloseTo(0.75);
  });

  it('cannot take a pane below its minimum', () => {
    render(<Host />);
    const handle = screen.getByRole('separator', { name: 'Resize media and preview' });
    stubContainer(handle);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -4000 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    // A twelfth of the window is the floor: a pane squeezed to nothing is a
    // pane the user has to spend a drag finding again.
    expect(shareOf('media')).toBeCloseTo(1 / 12);
  });
});

describe('the keyboard', () => {
  it('moves a handle without a pointer at all', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.tab();
    const focused = document.activeElement?.getAttribute('aria-label');
    expect(focused).toBe('Resize timeline and media');

    // The outer split is a column, so the arrow that moves it is the vertical
    // one: the keys belong to the axis the panes are laid out on.
    await user.keyboard('{ArrowDown}');
    expect(shareOf('timeline')).toBeCloseTo(0.51);
  });

  it('a handle deep in the tree changes only its own split', async () => {
    const user = userEvent.setup();
    render(<Host labels={LABELS} />);

    screen.getByRole('separator', { name: 'Resize Preview and Inspector' }).focus();
    await user.keyboard('{ArrowDown}');

    // The stack under the preview moved; the row beside the media bin did not,
    // and neither did the timeline.
    expect(shareOf('preview')).toBeCloseTo(0.51);
    expect(shareOf('inspector')).toBeCloseTo(0.49);
    expect(shareOf('media')).toBeCloseTo(0.25);
    expect(shareOf('timeline')).toBeCloseTo(0.5);
  });
});
