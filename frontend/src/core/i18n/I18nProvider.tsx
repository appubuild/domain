/** Translation as a React resource: the provider, and the rules it keeps.
 *
 *  The window's rule is *no literal user-facing string in a component*, and a
 *  rule is only a rule when it is the easy thing to do — so `useI18n()` is one
 *  call, works in every component, and carries the locale with it.
 *
 *  Two things are deliberately absent:
 *
 *  * **No global translator.** A component that imported `t` directly could not
 *    be rendered in another locale, which is exactly what a screenshot test and
 *    a translator both need.
 *  * **No async.** Bundles are imported, not fetched: a window that rendered
 *    English and then swapped in Bangla is a window that flickered, and the
 *    first paint is the one a user judges the app by. Bundles arriving from a
 *    plugin (stage 10) are registered into this same provider, and the plugin is
 *    loaded before the panel that needs it.
 *
 *  One thing is done that a provider is not usually asked to do: the document
 *  element is told which language it is in and which way it reads, because a
 *  screen reader picks its voice from `lang` and a stylesheet mirrors on `dir`.
 *  Both are restored on unmount — a provider that left `lang="bn"` behind would
 *  make the next test's English assertions pass for the wrong reason.
 */

import { useLayoutEffect, useMemo, type ReactNode } from 'react';

import en from './bundles/en.json';
import { BUILT_IN_BUNDLES, DEFAULT_LOCALE, type AppMessageKey } from './bundles';
import { I18nContext, type I18n } from './context';
import { createTranslator, type Translator } from './translate';
import type { MessageBundle } from './types';

export interface I18nProviderProps {
  readonly children: ReactNode;
  /** The locale to answer in. Defaults to English. */
  readonly locale?: string;
  /** Every bundle the provider may choose from, including any a plugin
   *  registered. Defaults to the bundles this build ships. */
  readonly bundles?: readonly MessageBundle[];
  /** Called for every key no bundle could answer, so a test can fail on a
   *  missing translation instead of a user seeing `splash.starting`. */
  readonly onMissing?: ((key: string) => void) | undefined;
  /** Injected so a test can prove a translation without shipping a bundle for
   *  it, and so a story can render one component in twelve languages. */
  readonly translator?: Translator<AppMessageKey> | undefined;
}

/** The bundle for `locale`, or the reference when this build has no such one. */
function bundleFor(locale: string, bundles: readonly MessageBundle[]): MessageBundle {
  // Exact first, then the language subtag: a window running `bn-BD` should get
  // the Bangla bundle rather than falling all the way back to English.
  const lowered = locale.toLowerCase();
  return (
    bundles.find((candidate) => candidate.locale.toLowerCase() === lowered) ??
    bundles.find((candidate) => candidate.locale.toLowerCase() === lowered.split('-')[0]) ??
    en
  );
}

function directionOf(locale: string): 'ltr' | 'rtl' {
  // The set of RTL language subtags is short and, unlike plural rules, really
  // is a table: `Intl.Locale` is too new to trust in a packaged WebView, and
  // getting this wrong mirrors the whole window.
  const language = locale.toLowerCase().split('-')[0] ?? '';
  return ['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi'].includes(language) ? 'rtl' : 'ltr';
}

export function I18nProvider({
  children,
  locale = DEFAULT_LOCALE,
  bundles = BUILT_IN_BUNDLES,
  onMissing,
  translator,
}: I18nProviderProps): React.JSX.Element {
  const value = useMemo<I18n>(() => {
    const bundle = bundleFor(locale, bundles);
    const chosen =
      translator ??
      createTranslator<AppMessageKey>({
        locale,
        bundle,
        // The reference bundle is the fallback for every other one, because a
        // button with no label is worse than a button in the wrong language.
        ...(bundle === en ? {} : { fallback: en }),
        ...(onMissing ? { onMissing } : {}),
      });
    return {
      t: chosen.t,
      has: chosen.has,
      locale: chosen.locale,
      direction: directionOf(locale),
    };
  }, [bundles, locale, onMissing, translator]);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const previousLang = root.getAttribute('lang');
    const previousDir = root.getAttribute('dir');
    root.setAttribute('lang', value.locale);
    root.setAttribute('dir', value.direction);
    return () => {
      if (previousLang === null) root.removeAttribute('lang');
      else root.setAttribute('lang', previousLang);
      if (previousDir === null) root.removeAttribute('dir');
      else root.setAttribute('dir', previousDir);
    };
  }, [value.direction, value.locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
