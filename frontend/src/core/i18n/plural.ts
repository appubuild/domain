/** Choosing a plural form (`ARCHITECTURE.md` §10).
 *
 *  English has two forms and a rule so simple that most code hardcodes it:
 *  `count === 1 ? 'clip' : 'clips'`. That is the bug. Bangla, like English, has
 *  two; Polish has three and a rule for 22; Arabic has six. A translator who
 *  opens a bundle and cannot express their language is a translator who stops
 *  translating, so the category comes from the platform's own CLDR data
 *  (`Intl.PluralRules`) rather than from a table we would have to maintain.
 *
 *  `Intl` is not always available and is not always happy — it throws on a
 *  malformed tag — so both cases fall back to the English rule. A wrong plural
 *  in one language is a bug; no message at all is a failure.
 */

import type { PluralCategory, PluralForms } from './types';

const CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

function isPluralCategory(value: string): value is PluralCategory {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** The CLDR category for `count` in `locale`. */
export function pluralCategory(locale: string, count: number): PluralCategory {
  try {
    const rules = new Intl.PluralRules(locale);
    const category = rules.select(count);
    if (isPluralCategory(category)) return category;
  } catch {
    // A tag `Intl` will not parse, or an engine without plural data. Either way
    // the answer below is better than no message.
  }
  return count === 1 ? 'one' : 'other';
}

/** The message for `count`: the form for its category, or the fallback ladder.
 *
 *  The ladder is `other` → the single string form → nothing, and every rung of
 *  it exists because a bundle is written by a human:
 *
 *  * a form for the category this count lands in;
 *  * otherwise `other`, which is the form every locale must supply;
 *  * otherwise, if the node turned out to be a plain string, that.
 */
export function selectPlural(
  forms: PluralForms,
  locale: string,
  count: number,
): string | undefined {
  const category = pluralCategory(locale, count);
  return forms[category] ?? forms['other'];
}
