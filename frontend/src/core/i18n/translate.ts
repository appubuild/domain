/** The translator: a key, some values, one string (`ARCHITECTURE.md` §10).
 *
 *  The whole module is a pure function and a factory, because translation has no
 *  business knowing about React, the network or the DOM. `context.tsx` is where
 *  it becomes a hook; this is the part a test can hold.
 *
 *  Three decisions worth the lines they cost:
 *
 *  * **A missing message returns the key.** A blank where a label should be is a
 *    mystery; `splash.starting` in the UI is a one-line bug report. The
 *    `onMissing` callback is how CI hears about it without the user seeing a
 *    thrown exception in a panel that was only trying to say "Ready."
 *  * **Interpolation is substitution, not formatting.** `{count}` is replaced;
 *    the number is rendered with `String(value)` rather than
 *    `toLocaleString()`, because a formatted number is a *presentation* decision
 *    and this module is not the place to make it.
 *  * **A bundle may be partial at runtime.** The type system insists the
 *    bundles match; the runtime does not, because a plugin that ships a bundle
 *    with six strings and falls back to English for the rest is working as
 *    designed.
 */

import { pluralCategory, selectPlural } from './plural';
import type { MessageBundle, MessageNode, MessageValues } from './types';

/** A translator bound to one locale. */
export interface Translator<Key extends string = string> {
  /** The locale this translator answers in. */
  readonly locale: string;
  /** Translate `key`, interpolating `values` and selecting a plural form when
   *  the message has one and `values.count` is a number.
   *
   *  A property and not a method, on purpose: these are handed around — into a
   *  context, into a test, into a callback — and a method that is passed as a
   *  value arrives somewhere else with no `this` to speak of. */
  readonly t: (key: Key, values?: MessageValues) => string;
  /** The message only if the bundle has it, so a caller can tell "not
   *  translated yet" from "translated, and the answer is empty". */
  readonly has: (key: Key) => boolean;
}

export interface TranslatorOptions {
  readonly locale: string;
  readonly bundle: MessageBundle;
  /** Consulted for any key the primary bundle does not have. English, in every
   *  window: a half-translated build is better than one with holes in it. */
  readonly fallback?: MessageBundle | undefined;
  /** Called for every key no bundle could answer. Tests pass a collector; a
   *  development build passes `console.warn`. */
  readonly onMissing?: ((key: string) => void) | undefined;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Walk `a.b.c` through a bundle. Returns `undefined` at the first missing step
 *  rather than throwing, because "this bundle does not have that key" is the
 *  normal case for a partial bundle. */
function lookup(bundle: MessageBundle, key: string): MessageNode | undefined {
  let node: MessageNode | undefined = bundle.messages;
  for (const part of key.split('.')) {
    // The node is looked at as `unknown` for the length of the walk. A bundle
    // that arrives from outside — a plugin's JSON, a file someone edited — is
    // only *claimed* to be a `MessageBundle`, and `{"key": null}` parses
    // happily. Guarding against that from inside the type is impossible: the
    // type says `null` cannot be here, and the linter is right to say so.
    const level: unknown = node;
    if (typeof level !== 'object' || level === null || Array.isArray(level)) return undefined;
    // `hasOwn` and not a truthiness check: a key that is missing and a key set
    // to an empty string are different things to whoever wrote the bundle.
    node = Object.hasOwn(level, part) ? (level as Record<string, MessageNode>)[part] : undefined;
  }
  return node;
}

function interpolate(message: string, values: MessageValues | undefined): string {
  if (values === undefined) return message;
  return message.replace(PLACEHOLDER, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/** Resolve one key to one string, or `undefined` when no bundle has it. */
function resolve(
  options: TranslatorOptions,
  key: string,
  values: MessageValues | undefined,
): string | undefined {
  const node =
    lookup(options.bundle, key) ?? (options.fallback ? lookup(options.fallback, key) : undefined);
  if (node === undefined) return undefined;
  if (typeof node === 'string') return interpolate(node, values);

  const count = values?.['count'];
  if (typeof count === 'number') {
    // A count-sensitive message asked for without a count is still answerable:
    // `other` is the form that reads least wrong in isolation ("clips").
    const form = selectPlural(node, options.locale, count);
    if (form !== undefined) return interpolate(form, values);
  }
  const other = node['other'];
  // A node that is neither a string nor a set of plural forms is a *group*, and
  // a group is not a message: answering with its first child would be answering
  // a different question.
  return typeof other === 'string' ? interpolate(other, values) : undefined;
}

/** Bind a locale and its bundle into a translator.
 *
 *  The returned `t` never throws and never returns `undefined`: a translator
 *  that could fail would force every component to handle a failure it cannot do
 *  anything about, and the honest answer to a missing message is the key.
 */
export function createTranslator<Key extends string = string>(
  options: TranslatorOptions,
): Translator<Key> {
  return {
    locale: options.locale,
    t: (key: Key, values?: MessageValues): string => {
      const message = resolve(options, key, values);
      if (message !== undefined) return message;
      options.onMissing?.(key);
      return key;
    },
    has: (key: Key): boolean => resolve(options, key, undefined) !== undefined,
  };
}

/** The category a count lands in, re-exported for a component that needs to
 *  branch on it rather than interpolate it — the one place a plural is more
 *  than a string. */
export { pluralCategory };
