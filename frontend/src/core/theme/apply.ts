/** Writing a theme onto an element: the one way a token reaches the DOM.
 *
 *  A theme is applied as **inline custom properties on the root element**.
 *  Inline style wins over the `:root` rule Tailwind generates from
 *  `styles/theme.css`, which is the mechanism that lets a document override a
 *  stylesheet without a second stylesheet existing — and it is why the
 *  stylesheet still has to declare every token: an override of a property that
 *  was never declared is a property that resolves to nothing if the override is
 *  ever removed.
 *
 *  Two consequences worth knowing:
 *
 *  * **Applying is total.** Every token the theme does *not* mention is removed
 *    from the element, so switching light → dark does not leave light's colours
 *    behind. A theme that only half-applies is the bug where a panel is
 *    unreadable in the theme you just chose.
 *  * **Applying is idempotent and reversible.** `applyTheme(el, NOVA_DARK)`
 *    after `applyTheme(el, NOVA_LIGHT)` leaves the element exactly as
 *    `applyTheme(el, NOVA_DARK)` alone would have.
 */

import { THEME_TOKENS, type Theme, type ThemeTokens } from './tokens';

/** The attribute that records which theme is applied.
 *
 *  It is data and not a class list because a theme is one value: a component
 *  that needs to know the current theme reads an attribute, and CSS that needs
 *  to can select on `[data-theme='nova-light']` without inventing a convention.
 */
export const THEME_ATTRIBUTE = 'data-theme';

/** The pairs a theme would write, in token order.
 *
 *  Exposed separately so the interesting half of applying — which properties,
 *  with which values — is testable with a plain array and no document.
 */
export function themeDeclarations(theme: Theme): readonly (readonly [string, string])[] {
  return THEME_TOKENS.filter((token) => theme.tokens[token] !== undefined).map((token) => [
    token,
    theme.tokens[token] as string,
  ]);
}

/** Apply `theme` to `element` and to nothing else.
 *
 *  Scoped to an element rather than reaching for `document` for the same reason
 *  every dependency here is a parameter: a theme applied to a subtree is how a
 *  preview of a theme is rendered inside the settings panel, and a module that
 *  could only paint the whole window could not do that.
 */
export function applyTheme(element: HTMLElement, theme: Theme): void {
  // Remove first, set second. The other order leaves one frame — or, in a test,
  // one assertion — where the old theme's tokens are still the element's.
  for (const token of THEME_TOKENS) {
    element.style.removeProperty(token);
  }
  for (const [token, value] of themeDeclarations(theme)) {
    element.style.setProperty(token, value);
  }
  element.setAttribute(THEME_ATTRIBUTE, theme.id);
}

/** Take the theme back off, leaving the stylesheet's own values in force.
 *
 *  Used when a preview is closed and by a test that must not leak a theme into
 *  the next one. After this, `readAppliedTheme(element)` is `undefined` again.
 */
export function clearTheme(element: HTMLElement): void {
  for (const token of THEME_TOKENS) {
    element.style.removeProperty(token);
  }
  element.removeAttribute(THEME_ATTRIBUTE);
}

/** Which theme this element was last given, if any. */
export function readAppliedTheme(element: HTMLElement): string | undefined {
  return element.getAttribute(THEME_ATTRIBUTE) ?? undefined;
}

/** The tokens currently written on an element, for assertions and for a
 *  settings panel that wants to show what is in force rather than what was
 *  requested. */
export function readAppliedTokens(element: HTMLElement): ThemeTokens {
  const applied: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value = element.style.getPropertyValue(token);
    if (value !== '') applied[token] = value;
  }
  return applied;
}
