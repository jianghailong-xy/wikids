/**
 * Versioned game-content safety policy (P6.3).
 *
 * Every threshold and template the safety pipeline enforces lives here,
 * behind one version stamp. A pipeline running under an unknown version is
 * refused, so a future policy change must be published as a new version
 * instead of silently re-interpreting an old one. The version is also
 * recorded on every persisted AI run (game_ai_runs.prompt_version) so the
 * exact policy a decision was made under is always recoverable.
 *
 * Pure TypeScript — no database, no network, no environment access.
 */

/** Frozen safety-policy version stamp (bump on any rule change). */
export const SAFETY_POLICY_VERSION = "safety-v1";

/** Frozen prompt-policy version stamp, recorded on every AI run. */
export const PROMPT_POLICY_VERSION = "prompt-v1";

/** Player speech upper bound, in characters (after sanitization). */
export const PLAYER_SPEECH_MAX_CHARS = 240;

/** AI utterance upper bound, in characters (after sanitization). */
export const AI_UTTERANCE_MAX_CHARS = 180;

/**
 * Upper bound for the serialized provider prompt, in bytes (UTF-8). A
 * prompt that would exceed this is never sent: the decision fails with
 * PROMPT_TOO_LARGE and the orchestration falls back deterministically.
 */
export const SERIALIZED_PROMPT_MAX_BYTES = 24 * 1024;

/**
 * Neutral templates used when a message is unsafe or exceeds its bound.
 * Both are short, plain, in-game lines that never change the game state
 * (a replaced speech still consumes the seat's speech turn).
 */
export const NEUTRAL_PLAYER_SPEECH = "（这条发言已被隐藏。）";
export const NEUTRAL_AI_UTTERANCE = "我先看看局势。";

/**
 * Replacement tokens for scrubbed PII identifiers. Plain ASCII so they can
 * never be re-identified, never trip the scrubber again (idempotent) and
 * never need escaping.
 */
export const PII_REPLACEMENT = {
  email: "[EMAIL]",
  phone: "[PHONE]",
  url: "[URL]",
} as const;

/** The categories the versioned attack corpus covers (P6.3). */
export const ATTACK_CATEGORIES = [
  "instruction_override",
  "system_prompt",
  "role_leak",
  "forged_choice",
  "unicode_confusion",
  "html_markdown",
  "real_world_threat",
  "child_inappropriate",
  "pii",
] as const;

export type AttackCategory = (typeof ATTACK_CATEGORIES)[number];

export function isAttackCategory(value: string): value is AttackCategory {
  return (ATTACK_CATEGORIES as readonly string[]).includes(value);
}
