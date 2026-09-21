/**
 * The safety pipeline (P6.3): the single deterministic transform every
 * player speech and AI utterance passes through before it is persisted or
 * sent to a provider.
 *
 * Order per message (each step is pure):
 *   1. Unicode normalization (NFC);
 *   2. unsafe classification — an unsafe message is replaced whole by the
 *      neutral template (in-game suspicion is never flagged);
 *   3. PII scrubbing — emails / phone numbers / URLs become fixed tokens;
 *   4. plain-text escaping — the message is inert HTML/Markdown/JSON text;
 *   5. length bound — a message that grew past its bound (escaping
 *      expands) is replaced by the neutral template.
 *
 * The pipeline result for player speech is an explicit outcome (accepted
 * text vs replaced-by-template) so callers and tests can observe exactly
 * what happened; AI utterances collapse to the final safe string.
 */
import { isUnsafeText } from "./classifier";
import {
  AI_UTTERANCE_MAX_CHARS,
  NEUTRAL_AI_UTTERANCE,
  NEUTRAL_PLAYER_SPEECH,
  PLAYER_SPEECH_MAX_CHARS,
} from "./policy";
import { escapePlainText, normalizeUnicode, scrubPii } from "./text";

export type PlayerSpeechOutcome =
  | { readonly kind: "accepted"; readonly text: string; readonly blocked: false }
  | { readonly kind: "replaced"; readonly text: string; readonly blocked: true };

/**
 * Sanitize one player speech. An unsafe message (or one that exceeds the
 * bound after sanitization) is replaced by the neutral template — it still
 * consumes the speech turn but carries no content. A safe message is
 * normalized, PII-scrubbed and escaped; normal in-game suspicion passes
 * through unchanged.
 */
export function sanitizePlayerSpeech(raw: string): PlayerSpeechOutcome {
  const normalized = normalizeUnicode(raw);
  if (isUnsafeText(normalized)) {
    return { kind: "replaced", text: NEUTRAL_PLAYER_SPEECH, blocked: true };
  }
  const scrubbed = scrubPii(normalized);
  const escaped = escapePlainText(scrubbed);
  if (escaped.length > PLAYER_SPEECH_MAX_CHARS) {
    return { kind: "replaced", text: NEUTRAL_PLAYER_SPEECH, blocked: true };
  }
  return { kind: "accepted", text: escaped, blocked: false };
}

/**
 * Sanitize one AI utterance. Unsafe output or an utterance that exceeds
 * AI_UTTERANCE_MAX_CHARS becomes the neutral template; otherwise it is
 * normalized, PII-scrubbed and escaped. Always returns a string within the
 * bound (the templates are shorter than the bound by construction).
 */
export function sanitizeAiUtterance(raw: string): string {
  const normalized = normalizeUnicode(raw);
  if (isUnsafeText(normalized)) return NEUTRAL_AI_UTTERANCE;
  const scrubbed = scrubPii(normalized);
  const escaped = escapePlainText(scrubbed);
  return escaped.length > AI_UTTERANCE_MAX_CHARS ? NEUTRAL_AI_UTTERANCE : escaped;
}

/**
 * Idempotent belt-and-braces scrub for text already sanitized at
 * persistence time (the provider re-applies ONLY the idempotent PII step;
 * re-escaping would corrupt already-escaped text).
 */
export function scrubPersistedText(text: string): string {
  return scrubPii(text);
}

/**
 * Serialized-prompt budget: byte length (UTF-8) of the whole provider
 * request payload. Exceeding {@link SERIALIZED_PROMPT_MAX_BYTES} must be
 * refused before any bytes leave the server.
 */
export function serializedPromptBytes(json: unknown): number {
  return new TextEncoder().encode(JSON.stringify(json)).length;
}
