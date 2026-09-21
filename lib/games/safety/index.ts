/**
 * Versioned game-content safety pipeline (P6.3).
 *
 * - policy.ts   — frozen version stamps, length bounds, neutral templates,
 *                 PII replacement tokens and the attack-category list.
 * - text.ts     — pure transforms: NFC normalization, plain-text escaping,
 *                 PII scrubbing (email / phone / URL).
 * - classifier.ts — the deterministic unsafe-content pattern table (game-
 *                 aware: normal suspicion is never flagged).
 * - pipeline.ts — the single entry points: sanitizePlayerSpeech and
 *                 sanitizeAiUtterance, plus the serialized-prompt budget.
 *
 * Every player speech and AI utterance must pass through the pipeline
 * before it is persisted (game_events / snapshots / receipts) or included
 * in a provider prompt. Pure TypeScript — no database, no network.
 */
export type { AttackCategory } from "./policy";
export {
  AI_UTTERANCE_MAX_CHARS,
  ATTACK_CATEGORIES,
  isAttackCategory,
  NEUTRAL_AI_UTTERANCE,
  NEUTRAL_PLAYER_SPEECH,
  PII_REPLACEMENT,
  PLAYER_SPEECH_MAX_CHARS,
  PROMPT_POLICY_VERSION,
  SAFETY_POLICY_VERSION,
  SERIALIZED_PROMPT_MAX_BYTES,
} from "./policy";
export {
  containsPii,
  containsUnescapedMarkup,
  escapePlainText,
  normalizeUnicode,
  scrubPii,
} from "./text";
export { isUnsafeText, unsafeCategories } from "./classifier";
export type { PlayerSpeechOutcome } from "./pipeline";
export {
  sanitizeAiUtterance,
  sanitizePlayerSpeech,
  scrubPersistedText,
  serializedPromptBytes,
} from "./pipeline";
