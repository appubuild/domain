/** The bundles this build ships, and the key type derived from the reference.
 *
 *  Bundles are data: adding a language is adding a JSON file and a line here,
 *  and a plugin registering one at runtime hands the provider the same shape.
 *  The only thing in this file that is not data is `AppMessageKey`, which is
 *  derived from the reference bundle so that a key which does not exist cannot
 *  be written at all — a typo in `t('splash.staring')` fails to compile rather
 *  than shipping a splash screen that says `splash.staring`.
 */

import bn from './bundles/bn.json';
import en from './bundles/en.json';
import type { MessageBundle, MessageKey } from './types';

/** Every bundle this build ships. English first: it is the reference, and the
 *  fallback for every other one. */
export const BUILT_IN_BUNDLES: readonly MessageBundle[] = [en, bn];

/** The locale a window starts in when the platform says nothing usable. */
export const DEFAULT_LOCALE = 'en';

/** The keys that exist in the reference bundle. */
export type AppMessageKey = MessageKey<typeof en.messages>;
