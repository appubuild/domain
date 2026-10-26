/**
 * Keyword normalization, label validation and the small phonetic helpers shared by
 * the generators and the scoring engine.
 *
 * Rules encoded here (all deterministic and unit-tested):
 *  - input is trimmed, Unicode-NFKC normalised and lower-cased;
 *  - ASCII labels are transliterated from Latin diacritics for generation;
 *  - the original Unicode form is preserved for display and punycode conversion;
 *  - a generated label must satisfy RFC-1035-style host rules.
 */

export type NormalizedKeyword = {
  /** Exactly what the user typed. */
  raw: string;
  /** Lower-case ASCII form used by the generators. */
  ascii: string;
  /** Lower-case Unicode form preserved for display. */
  unicode: string;
  /** True when the keyword contains non-ASCII characters. */
  hasNonAscii: boolean;
  /** Split into word tokens when the user typed several words. */
  tokens: string[];
  valid: boolean;
  /** Reason the keyword was rejected, when `valid` is false. */
  reason?: string;
};

const MAX_KEYWORD_LENGTH = 40;
const MIN_KEYWORD_LENGTH = 2;

/** Combines base letters + diacritics into plain Latin characters. */
export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Converts any Unicode input to an ASCII approximation suitable for a domain label.
 * Non-Latin scripts cannot be transliterated reliably without a large table, so they
 * are rejected rather than mangled into nonsense.
 */
export function toAscii(value: string): string {
  return stripDiacritics(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Ø/g, "O")
    .replace(/ø/g, "o")
    .replace(/Æ/g, "Ae")
    .replace(/æ/g, "ae")
    .replace(/Œ/g, "Oe")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d")
    .replace(/Ł/g, "L")
    .replace(/ł/g, "l")
    .replace(/Þ/g, "Th")
    .replace(/þ/g, "th")
    .replace(/Ð/g, "D")
    .replace(/ð/g, "d");
}

/** True when the string is (after transliteration) pure ASCII letters/digits. */
function isAsciiAlphaNumeric(value: string): boolean {
  return /^[a-z0-9]+$/.test(value);
}

export function normalizeKeyword(raw: string): NormalizedKeyword {
  const trimmed = raw.normalize("NFKC").trim();
  const unicode = trimmed.toLowerCase();
  const ascii = toAscii(unicode).replace(/[^a-z0-9]+/g, "");
  const hasNonAscii = /[^\x00-\x7F]/.test(trimmed);
  const tokens = ascii ? [ascii] : [];

  const base: NormalizedKeyword = {
    raw,
    ascii,
    unicode,
    hasNonAscii,
    tokens,
    valid: true,
  };

  if (!trimmed) return { ...base, valid: false, reason: "Keyword is empty." };
  // Internal whitespace is a user error, not something to silently melt together
  // ("pay me" must not become "payme" — each keyword gets its own field).
  if (/\s/.test(trimmed)) {
    return {
      ...base,
      valid: false,
      reason: "Use one keyword per field — spaces are not allowed inside a keyword.",
    };
  }
  if (ascii.length < MIN_KEYWORD_LENGTH) {
    return { ...base, valid: false, reason: `Use at least ${MIN_KEYWORD_LENGTH} letters or digits.` };
  }
  if (ascii.length > MAX_KEYWORD_LENGTH) {
    return { ...base, valid: false, reason: `Keep keywords under ${MAX_KEYWORD_LENGTH} characters.` };
  }
  if (!isAsciiAlphaNumeric(ascii)) {
    return {
      ...base,
      valid: false,
      reason: "Keyword must contain letters or digits (accents are converted to ASCII).",
    };
  }
  if (hasNonAscii && ascii.length === 0) {
    return {
      ...base,
      valid: false,
      reason: "This script can’t be transliterated into an ASCII domain label.",
    };
  }
  return base;
}

/* --------------------------------- labels --------------------------------- */

export type LabelCheck = { valid: boolean; reason?: string };

export type LabelRules = {
  minLength: number;
  maxLength: number;
  allowHyphens: boolean;
  allowNumbers: boolean;
};

/**
 * Validates a generated label against hostname rules and the user's character rules.
 * TLDs are validated separately (see `normalizeTld`).
 */
export function validateLabel(label: string, rules: LabelRules): LabelCheck {
  if (!label) return { valid: false, reason: "Empty label." };
  if (label.length < rules.minLength) {
    return { valid: false, reason: `Shorter than the ${rules.minLength}-character minimum.` };
  }
  if (label.length > Math.min(rules.maxLength, 63)) {
    return { valid: false, reason: `Longer than the ${Math.min(rules.maxLength, 63)}-character maximum.` };
  }
  if (!/^[a-z0-9-]+$/.test(label)) {
    return { valid: false, reason: "Contains characters that are not allowed in a domain label." };
  }
  if (label.startsWith("-") || label.endsWith("-")) {
    return { valid: false, reason: "Labels cannot start or end with a hyphen." };
  }
  if (!rules.allowHyphens && label.includes("-")) {
    return { valid: false, reason: "Hyphens are disabled." };
  }
  if (!rules.allowNumbers && /[0-9]/.test(label)) {
    return { valid: false, reason: "Numbers are disabled." };
  }
  // A double hyphen in positions 3-4 is reserved for IDN (xn--) and is otherwise invalid.
  if (label.includes("--") && !label.startsWith("xn--")) {
    return { valid: false, reason: "Consecutive hyphens are not valid in a label." };
  }
  return { valid: true };
}

/** Converts a Unicode label to its punycode (xn--) form when the runtime supports it. */
export function toPunycode(label: string): string | null {
  if (!/[^\x00-\x7F]/.test(label)) return null;
  try {
    const host = new URL(`https://${label}`).hostname;
    return host.startsWith("xn--") ? host : null;
  } catch {
    return null;
  }
}

/** Lower-case key used for de-duplication. */
export function dedupeKey(label: string): string {
  return label.toLowerCase().replace(/[-_]/g, "");
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

export function isVowel(char: string): boolean {
  return VOWELS.has(char);
}

/**
 * Syllable estimate. Heuristic, not a dictionary: vowel groups, minus a silent final
 * `e` for longer words, with `y` treated as a vowel when it is not word-initial.
 * Documented as a heuristic because it can be wrong on loanwords (e.g. "rhythm").
 */
export function countSyllables(word: string): number {
  const value = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!value) return 0;
  if (value.length <= 3) return 1;

  let syllables = 0;
  let previousWasVowel = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] ?? "";
    const vowel = isVowel(char) || (char === "y" && i > 0 && !isVowel(value[i - 1] ?? ""));
    if (vowel && !previousWasVowel) syllables += 1;
    previousWasVowel = vowel;
  }

  // Silent trailing "e" ("shoppe" -> 1, "nest" stays 1 via the vowel-group rule).
  if (value.endsWith("e") && !value.endsWith("le") && !value.endsWith("ee")) {
    syllables = Math.max(1, syllables - 1);
  }
  if (value.endsWith("es") && value.length > 4 && !/[aeiou]es$/.test(value)) {
    syllables = Math.max(1, syllables - 1);
  }
  return Math.max(1, syllables);
}

export function vowelRatio(value: string): number {
  const letters = value.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return 0;
  let vowels = 0;
  for (const char of letters) if (isVowel(char)) vowels += 1;
  return vowels / letters.length;
}

export function longestConsonantCluster(value: string): number {
  const letters = value.toLowerCase().replace(/[^a-z]/g, "");
  let longest = 0;
  let current = 0;
  for (const char of letters) {
    if (isVowel(char) || char === "y") {
      current = 0;
      continue;
    }
    current += 1;
    if (current > longest) longest = current;
  }
  return longest;
}

/** Splits a compound label back into its components using the known dictionary words. */
export function splitAtKnownWords(label: string, known: Set<string>): string[] | null {
  const lower = label.toLowerCase();
  for (let i = 1; i < lower.length; i += 1) {
    const left = lower.slice(0, i);
    const right = lower.slice(i);
    if (known.has(left) && known.has(right)) return [left, right];
  }
  return null;
}

/** `paynest` -> `Paynest`, `payNest` -> `PayNest` when the second component is known. */
export function camelJoin(components: string[]): string {
  return components
    .map((component, index) => {
      const clean = component.toLowerCase();
      if (index === 0) return clean.charAt(0).toUpperCase() + clean.slice(1);
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    })
    .join("");
}

/** Lower-case flat label (no separators) for the actual domain string. */
export function flatJoin(components: string[]): string {
  return components.map((component) => component.toLowerCase()).join("");
}

/** Longest TLD label we will accept. Real delegations are far shorter; this is a sanity cap. */
export const MAX_TLD_LENGTH = 18;

export function normalizeTld(tld: string): string | null {
  const value = tld.trim().toLowerCase().replace(/^\./, "");
  if (!value || value.length > MAX_TLD_LENGTH) return null;
  if (!/^(xn--[a-z0-9]+(-[a-z0-9]+)*|[a-z]{2,18})$/.test(value)) return null;
  return value;
}
