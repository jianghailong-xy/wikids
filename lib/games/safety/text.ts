/**
 * Deterministic text transforms of the safety pipeline (P6.3): Unicode
 * normalization, plain-text escaping and PII scrubbing. All functions are
 * pure; the escaping function is deliberately NOT idempotent (it must run
 * exactly once, on raw text) while the PII scrubber IS idempotent (a
 * replacement token can never match again), so the scrubber may safely be
 * re-applied on the provider boundary.
 */
import { PII_REPLACEMENT } from "./policy";

/** NFC-compose the text (Unicode Canonical Composition). */
export function normalizeUnicode(text: string): string {
  return text.normalize("NFC");
}

/**
 * Escape the five HTML-sensitive characters plus the backtick into entity
 * form, so stored and prompted text is inert plain text no matter what
 * renders or parses it later (HTML, Markdown, JSON embedding). Chinese
 * punctuation is deliberately untouched.
 */
export function escapePlainText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

// ---------------------------------------------------------------------------
// PII scrubbing (emails, phone numbers, URLs) — idempotent
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** http(s)/ftp URLs and bare www. hosts; never matches choice ids or CJK. */
const URL_PATTERN =
  /(?:(?:https?|ftp):\/\/|www\.)[^\s<>"'，。！？；：、（）【】]*/gi;

/** Chinese mobile numbers (1[3-9] + 9 digits), with optional +86 prefix. */
const MOBILE_PATTERN = /(?:\+?86[-\s]?)?1[3-9]\d{9}/g;

/** Any other long digit run (landlines, QQ, room numbers): 7-15 digits. */
const LONG_DIGIT_RUN_PATTERN = /\b\d{7,15}\b/g;

/**
 * Replace email addresses, phone numbers and URLs with fixed neutral
 * tokens. Runs AFTER unsafe classification (a PII-bearing message that is
 * otherwise fine keeps its text, only the identifiers are removed) and
 * BEFORE escaping (the tokens need none). Idempotent by construction:
 * `[EMAIL]` / `[PHONE]` / `[URL]` match no pattern again.
 */
export function scrubPii(text: string): string {
  return text
    .replace(URL_PATTERN, PII_REPLACEMENT.url)
    .replace(EMAIL_PATTERN, PII_REPLACEMENT.email)
    .replace(MOBILE_PATTERN, PII_REPLACEMENT.phone)
    .replace(LONG_DIGIT_RUN_PATTERN, PII_REPLACEMENT.phone);
}

/** True when the text still contains any scrubbable PII identifier. */
export function containsPii(text: string): boolean {
  return (
    EMAIL_PATTERN.test(text) ||
    URL_PATTERN.test(text) ||
    MOBILE_PATTERN.test(text) ||
    LONG_DIGIT_RUN_PATTERN.test(text)
  );
}

// NOTE: the regexes carry /g state; the helpers above reset it by testing
// fresh each call, but callers iterating must not rely on lastIndex.

/** True when the text still contains a raw HTML/Markdown-sensitive char. */
export function containsUnescapedMarkup(text: string): boolean {
  return /[&<>"'`]/.test(text);
}
