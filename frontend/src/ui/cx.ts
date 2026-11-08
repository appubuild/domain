/** Joining class names: the whole of it, and deliberately nothing more.
 *
 *  There is no `tailwind-merge` here, and that is a decision rather than an
 *  omission. A merge that resolves `px-2 px-4` into `px-4` has to know every
 *  utility Tailwind can generate, which means a second implementation of
 *  Tailwind's own conflict table living in the bundle and going stale. What a
 *  component needs instead is a rule a reader can check in one line:
 *
 *      The caller's `className` is appended last, and CSS decides.
 *
 *  Which works because a component never writes a utility it also lets the
 *  caller override — `Button` sets padding from its `size`, not as a `px-*`
 *  the caller might pass. A component that needs a caller to win on a property
 *  it set itself is a component that wants two variants, not a merge.
 */

/** Anything that may appear where a class name goes, including nothing. */
export type ClassValue = string | number | false | null | undefined | readonly ClassValue[];

/** Join the truthy values with a single space.
 *
 *  Nested arrays are flattened so a caller can write
 *  `cx('base', isActive && 'active', [isWide && 'w-full'])` without thinking
 *  about it, and `false`/`undefined` disappear rather than becoming the string
 *  `"false"` — the bug that makes every conditional-class helper a trap.
 */
export function cx(...values: readonly ClassValue[]): string {
  const out: string[] = [];
  const visit = (value: ClassValue): void => {
    if (value === false || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      // Cast deliberately: `Array.isArray` narrows a `readonly` array to `any[]`,
      // and an `any` allowed into this loop is an `any` allowed into every
      // component's class list.
      const items = value as readonly ClassValue[];
      for (const item of items) visit(item);
      return;
    }
    const text = String(value).trim();
    if (text !== '') out.push(text);
  };
  for (const value of values) visit(value);
  return out.join(' ');
}
