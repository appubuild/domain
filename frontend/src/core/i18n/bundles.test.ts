/** The bundles this build ships, as documents.
 *
 *  A translation bundle is the one kind of source file a non-programmer edits,
 *  which is exactly why a machine has to check it: a translator adding
 *  `projects.clipCount` to the Bangla file and `projects.clips` to the English
 *  one has written two correct files that do not describe the same app.
 *
 *  So the key sets are compared, structurally, in both directions. A missing key
 *  and an extra key are both failures — the second one is a key a developer
 *  renamed in one file and not the other, and it is the one that ships.
 */

import { describe, expect, it } from 'vitest';

import bn from './bundles/bn.json';
import en from './bundles/en.json';
import { pluralCategory } from './plural';
import type { MessageBundle, MessageNode } from './types';

/** Every path in a bundle, as `'a.b.c'`, with count-sensitive keys collapsed —
 *  the plural forms are one message, not six. */
function keys(node: MessageNode, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  const entries = Object.entries(node);
  const isPlural =
    entries.length > 0 &&
    entries.every(([key]) => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(key));
  if (isPlural) return [prefix];
  return entries.flatMap(([key, child]) => keys(child, prefix === '' ? key : `${prefix}.${key}`));
}

function keySet(bundle: MessageBundle): Set<string> {
  return new Set(keys(bundle.messages));
}

const BUNDLES: readonly MessageBundle[] = [en, bn];

describe('every bundle', () => {
  it('names its locale and itself, in itself', () => {
    for (const bundle of BUNDLES) {
      // `বাংলা`, not `Bengali`: a list of languages is the one place you cannot
      // translate a name for the person reading it.
      expect(bundle.locale).not.toBe('');
      expect(bundle.label).not.toBe('');
    }
    expect(bn.label).toBe('বাংলা');
  });

  it('has the same keys as the reference bundle, neither fewer nor more', () => {
    const reference = keySet(en);
    for (const bundle of BUNDLES) {
      const own = keySet(bundle);
      const missing = [...reference].filter((key) => !own.has(key));
      const extra = [...own].filter((key) => !reference.has(key));
      expect({ locale: bundle.locale, missing, extra }).toEqual({
        locale: bundle.locale,
        missing: [],
        extra: [],
      });
    }
  });

  it('leaves no message empty, because an empty string renders as nothing', () => {
    for (const bundle of BUNDLES) {
      for (const [key, node] of Object.entries(bundle.messages)) {
        const flat = keys(node, key);
        expect(flat.length, `${bundle.locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('uses only the placeholders the reference message uses', () => {
    // `{name}` in English and `{nama}` in Bangla both render — one of them
    // renders as a literal, and it does so silently, in production, in the one
    // language nobody on the team reads.
    const placeholderOf = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();

    function walk(node: MessageNode, path: string, into: Map<string, Set<string>>): void {
      if (typeof node === 'string') {
        into.set(path, new Set(placeholderOf(node)));
        return;
      }
      for (const [key, child] of Object.entries(node)) {
        walk(child, path === '' ? key : `${path}.${key}`, into);
      }
    }

    const reference = new Map<string, Set<string>>();
    walk(en.messages, '', reference);

    for (const bundle of BUNDLES) {
      const own = new Map<string, Set<string>>();
      walk(bundle.messages, '', own);
      for (const [path, names] of reference) {
        expect([...names].sort(), `${bundle.locale}:${path}`).toEqual(
          [...(own.get(path) ?? new Set())].sort(),
        );
      }
    }
  });
});

describe('the plurals a bundle declares', () => {
  it('every count-sensitive message has an `other` form', () => {
    // `other` is the fallback every lookup ladder ends at, and the form every
    // language has. A message without it has a count that renders as nothing.
    function walk(node: MessageNode, path: string): void {
      if (typeof node === 'string') return;
      const entries = Object.entries(node);
      const isPlural =
        entries.length > 0 &&
        entries.every(([key]) => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(key));
      if (isPlural) {
        expect(Object.keys(node), path).toContain('other');
        return;
      }
      for (const [key, child] of entries) {
        walk(child, path === '' ? key : `${path}.${key}`);
      }
    }
    for (const bundle of BUNDLES) walk(bundle.messages, '');
  });

  it('the categories the platform reports are the ones a bundle may need', () => {
    // A guard on the assumption in `plural.ts`: if `Intl` is unavailable the
    // fallback is the English rule, and the bundles below have to work either
    // way — all three of these locales have the same two categories.
    for (const locale of ['en', 'bn', 'de']) {
      expect(pluralCategory(locale, 1)).toBe('one');
      expect(pluralCategory(locale, 7)).toBe('other');
    }
  });
});
