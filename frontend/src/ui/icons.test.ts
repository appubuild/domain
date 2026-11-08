/** The icon set, checked as data.
 *
 *  A hand-written path is the one kind of source a test can only check
 *  structurally — there is no asserting that `film` looks like film — so what is
 *  asserted is everything that makes a broken icon *detectable*: every name has
 *  shapes, every shape is a kind the renderer handles, and nothing is drawn
 *  outside the 24 × 24 grid it was written for. That last one catches the real
 *  failure, which is an icon copied from a 32-grid set and quietly clipped.
 */

import { describe, expect, it } from 'vitest';

import { ICONS, ICON_NAMES, type IconShape } from './icons';

const VIEWBOX = 24;

function numbers(shape: IconShape): readonly number[] {
  switch (shape.kind) {
    case 'path':
      // Every number in the path data, ignoring the letters that precede them.
      return [...shape.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    case 'circle':
      return [shape.cx, shape.cy, shape.r];
    case 'line':
      return [shape.x1, shape.y1, shape.x2, shape.y2];
    case 'rect':
      return [shape.x, shape.y, shape.width, shape.height, shape.rx];
  }
}

describe('every icon', () => {
  it('has at least one shape, because an empty icon renders as nothing', () => {
    for (const name of ICON_NAMES) {
      expect(ICONS[name].length, name).toBeGreaterThan(0);
    }
  });

  it('is drawn inside the viewBox', () => {
    for (const name of ICON_NAMES) {
      for (const shape of ICONS[name]) {
        for (const value of numbers(shape)) {
          // Every number, whatever it means — a coordinate, a radius, an arc
          // flag — has to fit the grid, or the shape is clipped or malformed.
          expect(Number.isFinite(value), `${name} ${shape.kind}`).toBe(true);
          expect(Math.abs(value), `${name} ${shape.kind}`).toBeLessThanOrEqual(VIEWBOX);
        }
      }
    }
  });

  it('uses coordinates rather than negative sizes', () => {
    for (const name of ICON_NAMES) {
      for (const shape of ICONS[name]) {
        if (shape.kind === 'rect') {
          expect(shape.width, name).toBeGreaterThan(0);
          expect(shape.height, name).toBeGreaterThan(0);
        }
        if (shape.kind === 'circle') {
          expect(shape.r, name).toBeGreaterThan(0);
        }
      }
    }
  });

  it('is named in kebab-case, because the name is also a DOM attribute value', () => {
    for (const name of ICON_NAMES) {
      expect(name, name).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    }
  });

  it('has no duplicate names, which a record makes impossible but a merge does not', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});

describe('the set as a whole', () => {
  it('carries the icons the first panels need', () => {
    // Not a completeness claim — a list of what something already depends on, so
    // that renaming one of these is a decision and not an accident.
    for (const name of [
      'close',
      'check',
      'plus',
      'trash',
      'folder',
      'film',
      'play',
      'pause',
    ] as const) {
      expect(ICON_NAMES, name).toContain(name);
    }
  });
});
