/** `cx`, which is small enough to be complete and common enough to be worth it.
 *
 *  The test is mostly about the two ways the obvious implementation is wrong:
 *  `false` becoming the string `"false"`, and a nested conditional array being
 *  stringified rather than walked.
 */

import { describe, expect, it } from 'vitest';

import { cx } from './cx';

describe('joining class names', () => {
  it('joins what it is given', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c');
  });

  it('drops the falsy values rather than printing them', () => {
    expect(cx('a', false, 'b', undefined, null, 'c')).toBe('a b c');
    expect(cx(false, undefined, null)).toBe('');
  });

  it('walks a nested array so a conditional group needs no spreading', () => {
    // Through a function: a `const wide = true` is narrowed to `true` by the
    // time it is read, and a test that only ever passes a constant is a test
    // that proves the branch it did not take.
    const classesFor = (wide: boolean, hidden: boolean): string =>
      cx('base', [wide && 'w-full', hidden && 'hidden']);

    expect(classesFor(true, false)).toBe('base w-full');
    expect(classesFor(false, false)).toBe('base');
    expect(classesFor(true, true)).toBe('base w-full hidden');
  });

  it('takes numbers, because a grid column is one', () => {
    expect(cx('col', 12)).toBe('col 12');
  });

  it('does not invent whitespace around nothing', () => {
    expect(cx('a', '', '  ', 'b')).toBe('a b');
    expect(cx()).toBe('');
  });

  it('keeps the caller last, which is the rule that replaces tailwind-merge', () => {
    expect(cx('text-sm', 'text-xs')).toBe('text-sm text-xs');
  });
});
