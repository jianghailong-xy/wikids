/**
 * Generic game-domain core types.
 *
 * The core layer is a pure domain framework: no database, no network, no
 * Next.js, no environment access and no concrete AI provider. Games build on
 * it by implementing a {@link GameDefinition}.
 */

/**
 * Randomness port: business code must receive this port and never call
 * `Math.random()` directly (docs/quick6-v1-rules.md §10).
 */
export interface Rng {
  /** A value in [0, 1), matching Math.random semantics. */
  next(): number;
}

/** Factory for independent, path-derived RNG streams. */
export interface RngStreamFactory {
  /**
   * Derive an independent deterministic stream from the given path parts.
   * The same path always yields the same stream; different paths yield
   * independent streams. Derivation is purely path-based, so the order in
   * which streams are created (or how submissions complete concurrently)
   * can never affect any stream's draws.
   */
  stream(...pathParts: readonly string[]): Rng;
}

/** Clock port: business code receives it instead of calling `Date.now()`. */
export interface Clock {
  now(): Date;
}

/**
 * AI provider port (interface only — the domain never imports a concrete
 * provider implementation). Scripted bots are deterministic and do not use
 * this port.
 */
export interface AiProvider {
  complete(input: { system: string; prompt: string }): Promise<string>;
}

/**
 * Frozen version stamp of a game definition. Every change to a definition,
 * its rules, its event schema or its PRNG algorithm must bump the relevant
 * version and be published as a new version — old streams and event shapes
 * stay reproducible forever (docs/quick6-v1-rules.md §9).
 */
export interface GameVersions {
  /** Version of the definition (state machine + commands + rules glue). */
  readonly definition: string;
  /** Frozen rules version the definition implements. */
  readonly rules: string;
  /** Event payload schema version. */
  readonly eventSchema: string;
  /** PRNG algorithm version. */
  readonly prng: string;
}

/** One entry of the engine-managed event log. */
export interface GameEvent<Payload> {
  /** Contiguous event index within one game (0, 1, 2, …). */
  readonly index: number;
  /** State revision that produced this event (revision of the dispatch). */
  readonly revision: number;
  readonly payload: Payload;
}

/** Outcome of a finished game. Concrete games refine this. */
export interface GameResult {
  /** Winner of the game. */
  readonly winner: string;
  /** Machine-readable win reason. */
  readonly reason: string;
}

/**
 * A legal choice_id option: the stable identifier a command maps onto.
 * Bots and clients pick from this set; every legal command must correspond
 * to exactly one choice id.
 */
export interface LegalChoice {
  /** Stable choice id, e.g. `wolf-kill@0:2` or `finish-night`. */
  readonly id: string;
  /** Seat that may take this action (`null` for system/settlement choices). */
  readonly seat: number | null;
  /** Human-readable label for UIs. */
  readonly label: string;
}

/**
 * Engine-managed state fields: every game state carries a monotonically
 * increasing revision and the contiguous event log. Definitions must not
 * write these fields inside `transition` — the engine owns them.
 */
export interface EngineState<Payload> {
  /** Number of successfully applied transitions so far. Starts at 0. */
  readonly revision: number;
  /** Event log; `events[i].index === i` always holds. */
  readonly events: readonly GameEvent<Payload>[];
}
