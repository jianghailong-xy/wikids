/**
 * Domain error types. All game-rule rejections are {@link IllegalActionError}
 * with a granular code; the engine and definitions guarantee that a rejected
 * action leaves state fully unchanged and counts no step.
 */

export type IllegalActionCode =
  /** Seat id malformed or out of range. */
  | "INVALID_SEAT"
  /** Command malformed (bad argument types). */
  | "INVALID_ARGUMENT"
  /** Action not legal in the current phase. */
  | "WRONG_PHASE"
  /** Actor is dead. */
  | "DEAD_ACTOR"
  /** Actor's role is not allowed to take this action. */
  | "UNAUTHORIZED_ROLE"
  /** Target is not legal for this action. */
  | "ILLEGAL_TARGET"
  /** Target is the actor themself. */
  | "SELF_TARGET"
  /** Target is dead. */
  | "DEAD_TARGET"
  /** This seat already took this action in the current phase/round. */
  | "DUPLICATE_ACTION"
  /** Action out of the required seat order (speech). */
  | "OUT_OF_ORDER"
  /** Abstention is forbidden: a mandatory submission is missing or blank. */
  | "ABSTAIN_FORBIDDEN"
  /** Settlement requested while mandatory submissions are incomplete. */
  | "INCOMPLETE_SUBMISSIONS"
  /** The game is over: the terminal state absorbs every action. */
  | "TERMINAL_STATE"
  /** The command maps to a choice id that is not in the legal choice set. */
  | "ILLEGAL_CHOICE";

/**
 * Illegal input/action: rejected with state fully unchanged and no step
 * counted (docs/quick6-v1-rules.md §8).
 */
export class IllegalActionError extends Error {
  readonly code: IllegalActionCode;
  constructor(code: IllegalActionCode, message: string) {
    super(`illegal game action (${code}): ${message}`);
    this.name = "IllegalActionError";
    this.code = code;
  }
}

/**
 * Abnormal protection: the phase step limit was hit. This is a
 * specification/implementation defect signal — tests must FAIL on it and
 * must never fake it into a draw (no draw outcome exists in quick6-v1).
 */
export class StepLimitError extends Error {
  readonly reason = "TOO_MANY_STEPS" as const;
  constructor() {
    super(
      "phase step limit exceeded (TOO_MANY_STEPS; abnormal protection, never a draw)",
    );
    this.name = "StepLimitError";
  }
}

/** Serialized state is malformed or fails validation. */
export class SerializationError extends Error {
  constructor(message: string) {
    super(`state serialization error: ${message}`);
    this.name = "SerializationError";
  }
}

/** Invalid seed bytes (too short / wrong type). */
export class InvalidSeedError extends Error {
  constructor(message: string) {
    super(`invalid seed: ${message}`);
    this.name = "InvalidSeedError";
  }
}

/** A scripted bot run exceeded its defensive guard (rules must terminate). */
export class BotGuardError extends Error {
  constructor(message: string) {
    super(`scripted bot guard exceeded: ${message}`);
    this.name = "BotGuardError";
  }
}
