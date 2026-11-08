/** The translator as a context: what a component asks for, and nothing else.
 *
 *  This file holds the context and the hook; `I18nProvider.tsx` holds the
 *  component that fills it. They are separate files for the same reason the
 *  theme's are — a module that exports a component *and* other things breaks
 *  fast refresh, and a hook that lived next to JSX would be imported by every
 *  component in the app for the sake of a symbol it could get from here.
 */

import { createContext, useContext, type Context } from 'react';

import type { AppMessageKey } from './bundles';
import type { Translator } from './translate';

/** What the context carries: the translator, and the locale it answers in. */
export interface I18n {
  readonly t: Translator<AppMessageKey>['t'];
  readonly has: Translator<AppMessageKey>['has'];
  /** The BCP-47 tag in force. */
  readonly locale: string;
  /** The writing direction of that locale — a panel that mirrors for Arabic
   *  needs it, and `Intl` already knows. */
  readonly direction: 'ltr' | 'rtl';
}

export const I18nContext: Context<I18n | undefined> = createContext<I18n | undefined>(undefined);

/** The translator this tree was given.
 *
 *  Throws when there is none, like `useApi`: a component that fell back to
 *  English silently is a component that works on every developer's machine and
 *  nowhere else.
 */
export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) {
    throw new Error('no I18n in context — wrap this tree in <I18nProvider>');
  }
  return i18n;
}
