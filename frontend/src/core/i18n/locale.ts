/** Which language this window should speak before anybody has chosen one.
 *
 *  The answer comes from the platform, not from a constant: an editor installed
 *  on a machine set to Bangla has been told which language the person reads, and
 *  starting in English because nobody wrote a settings screen yet is ignoring
 *  the one preference the user has already expressed.
 *
 *  It is a pure-ish function of `navigator` with an injected fallback so a test
 *  can ask "what would a Bengali machine get" without pretending to be one.
 */

/** The language tags the platform offers, best first.
 *
 *  `navigator.languages` is the user's ordered preference list and
 *  `navigator.language` is its first entry; some hosts (and every non-browser
 *  test environment) have neither.
 */
export function platformLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  const languages = (navigator as { readonly languages?: readonly string[] }).languages;
  // `Array.from` rather than a spread of the value `Array.isArray` narrowed:
  // that narrows a `readonly` array to `any[]`, and an `any[]` returned from a
  // function that promises `readonly string[]` is how a wrong type spreads.
  if (languages !== undefined && languages.length > 0) return Array.from(languages);
  const language = (navigator as { readonly language?: string }).language;
  return typeof language === 'string' && language !== '' ? [language] : [];
}

/** The first locale the platform offers, or `fallback`.
 *
 *  Only non-empty, well-formed-enough tags are considered: a host that hands
 *  back an empty string is not claiming a language, and a tag with a stray
 *  character in it would make every lookup miss and every message fall back.
 */
export function preferredLocale(fallback = 'en', offered = platformLocales()): string {
  for (const candidate of offered) {
    if (typeof candidate !== 'string') continue;
    const tag = candidate.trim();
    if (/^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/i.test(tag)) return tag;
  }
  return fallback;
}
