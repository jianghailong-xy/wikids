/**
 * The GameDefinition contract: everything a game must provide to run on the
 * generic {@link GameEngine}.
 *
 * Contract for implementers:
 * - `initialState` returns a fresh state with `revision: 0` and any initial
 *   events (index 0, revision 0). It must throw on invalid configuration.
 * - `transition(state, command)` is the single source of truth for rule
 *   validation. On any illegal command it MUST throw {@link IllegalActionError}
 *   with state fully untouched; on the phase step limit it MUST throw
 *   {@link StepLimitError} before any state change. On success it returns a
 *   NEW state object (arrays copied, never mutated) with `steps` bumped and
 *   the raw event payloads produced by the command. It MUST NOT touch
 *   `state.revision` / `state.events` — the engine owns those fields.
 * - `legalChoices(state)` must agree with `transition`: a command whose
 *   `choiceId` is in the legal set is always accepted, and every accepted
 *   command's `choiceId` is in the legal set.
 * - `isTerminal(state)` marks the absorbing terminal state: the engine
 *   rejects every command there with `IllegalActionError(TERMINAL_STATE)`
 *   and the state never changes again.
 * - Views (`publicView`, `viewFor`) must never leak server-private data
 *   (seeds, night buffers, other players' private information).
 * - `serializeState` / `deserializeState` must round-trip exactly, including
 *   the seed, and `deserializeState` must validate the payload.
 */
export interface GameDefinition<
  State extends { readonly revision: number; readonly events: readonly unknown[] },
  Command,
  View,
  PublicView,
  Payload,
> {
  /** Stable definition id. */
  readonly id: string;
  /** Human-readable title. */
  readonly title: string;
  /** Frozen version stamp (definition / rules / event schema / PRNG). */
  readonly versions: import("./types").GameVersions;
  /** Abnormal-protection step cap (default 200 for quick6-v1). */
  readonly maxPhaseSteps: number;

  /**
   * Create the initial state from seed bytes. Production passes 32 bytes of
   * cryptographic randomness; tests pass fixed seeds. Options are
   * definition-specific (e.g. explicit role table, human seat).
   */
  initialState(seedBytes: Uint8Array, options?: unknown): State;

  /** The stable choice id a command maps onto, or null for unmappable input. */
  choiceId(command: Command): string | null;

  /** All legal choice ids for the given state (any seat plus system). */
  legalChoices(state: State): readonly import("./types").LegalChoice[];

  /** Seats that currently have at least one legal choice. */
  actors(state: State): readonly number[];

  /** The system settlement command that is legal now, or null. */
  systemCommand(state: State): Command | null;

  /**
   * Apply one command atomically. Throws IllegalActionError (rejected,
   * state unchanged, no step counted) or StepLimitError (abnormal cap hit,
   * nothing applied — never a draw). Returns the new state and the raw
   * event payloads produced by this command.
   */
  transition(
    state: State,
    command: Command,
  ): { state: State; events: readonly Payload[] };

  /** True once the terminal absorbing state is reached. */
  isTerminal(state: State): boolean;

  /** The game outcome, or null while running. */
  result(state: State): import("./types").GameResult | null;

  /** Public projection (what every observer, including dead players, sees). */
  publicView(state: State): PublicView;

  /** What one seat sees: public info plus exactly that seat's private info. */
  viewFor(state: State, seat: number): View;

  /** Stable phase token for RNG domain separation, e.g. `night:2`. */
  phaseToken(state: State): string;

  /** Successful-transition counter (the abnormal-protection step count). */
  stepsOf(state: State): number;

  /** Current rule round, or null if the game has no rounds. */
  roundOf(state: State): number | null;

  /** Serialize the full server state (including the seed) for persistence. */
  serializeState(state: State): string;

  /** Validate and restore a serialized state. */
  deserializeState(json: string): State;
}
