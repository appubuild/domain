/** The vocabulary of a translated message (`ARCHITECTURE.md` §10).
 *
 *  Two rules shape this file:
 *
 *  * **No literal user-facing string in a component.** A component says
 *    `t('splash.starting')`, never `'Starting the editor…'`. English is a
 *    locale, not a default, and a string in a component is a string nobody can
 *    translate without a code change.
 *  * **A bundle is data, not code.** `bundles/*.json` are documents; a locale is
 *    added by adding a file and registering it, and — once the service serves
 *    them — by dropping one in a plugin. Nothing below can tell the difference.
 *
 *  The service's own `NS-*` codes are *not* translated here: a problem document
 *  carries a human `remedy` from the backend (`core/api/problem.ts`), and that
 *  sentence is the service's to translate. This table is for the window's own
 *  words.
 */

/** The CLDR plural categories. A message key may carry one form per category. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** A message that changes with a count: one form per category it needs.
 *
 *  `other` is the only one a locale must supply — it is the form every language
 *  has — and it is the fallback for a category a bundle left out, because a
 *  missing plural form is a message that must still be showable.
 */
export type PluralForms = Readonly<Partial<Record<PluralCategory, string>>>;

/** A node in a bundle: a plain message, a count-sensitive one, or a group. */
export type MessageNode = string | PluralForms | { readonly [key: string]: MessageNode };

/** A bundle: one locale, its name in that locale, and its messages. */
export interface MessageBundle {
  /** A BCP-47 tag: `en`, `bn`, `pt-BR`. */
  readonly locale: string;
  /** The language's own name — `বাংলা`, not `Bengali`. A list of languages is
   *  the one place you cannot translate a name for someone who reads it. */
  readonly label: string;
  readonly messages: Readonly<Record<string, MessageNode>>;
}

/** The values a message may interpolate.
 *
 *  `count` is special: it is what selects a plural form. Everything else is
 *  substituted by name into `{name}`.
 */
export type MessageValues = Readonly<Record<string, string | number>>;

/** The paths into a bundle, as `'group.key'` strings.
 *
 *  A bundle whose keys are a union of literals is a bundle a typo cannot be
 *  written against: `t('splash.staring')` fails to compile, which is a much
 *  better outcome than a splash screen that says `splash.staring`.
 */
export type MessageKey<T> = Leaves<T>;

type PluralOnly<T> = keyof T extends PluralCategory ? true : false;

type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : PluralOnly<T[K]> extends true
      ? K
      : T[K] extends object
        ? `${K}.${Leaves<T[K]>}`
        : never;
}[keyof T & string];
