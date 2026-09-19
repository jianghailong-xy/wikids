/**
 * Generic game engine: runs any {@link GameDefinition} with strict
 * guarantees:
 * - every accepted command bumps `revision` by exactly 1;
 * - produced events get contiguous indexes (`events[i].index === i`) and the
 *   revision that produced them;
 * - every rejected command leaves the state deep-equal unchanged;
 * - the terminal state absorbs every command;
 * - the exposed state snapshot is deeply frozen (immutable).
 *
 * The engine owns `revision` and `events`; the definition owns all rule
 * validation and the step counter (`steps`), which it bumps only on
 * successful transitions.
 */
import type { GameDefinition } from "./definition";
import { IllegalActionError } from "./errors";
import type { GameEvent, GameResult, LegalChoice } from "./types";

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    // Typed arrays (e.g. seed bytes) cannot be frozen with elements; they
    // are never mutated by definitions and the engine holds its own copy.
    if (!ArrayBuffer.isView(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
  }
  return value;
}

export class GameEngine<
  State extends { readonly revision: number; readonly events: readonly unknown[] },
  Command,
  View,
  PublicView,
  Payload,
> {
  /** Set once at construction (or by `restore`); never reassigned after. */
  definition: GameDefinition<State, Command, View, PublicView, Payload>;

  private _state: State;

  constructor(
    definition: GameDefinition<State, Command, View, PublicView, Payload>,
    seedBytes: Uint8Array,
    options?: unknown,
  ) {
    this.definition = definition;
    this._state = deepFreeze(definition.initialState(seedBytes, options));
  }

  /** Wrap an already-validated state (e.g. a deserialized snapshot). */
  static restore<
    State extends { readonly revision: number; readonly events: readonly unknown[] },
    Command,
    View,
    PublicView,
    Payload,
  >(
    definition: GameDefinition<State, Command, View, PublicView, Payload>,
    state: State,
  ): GameEngine<State, Command, View, PublicView, Payload> {
    const engine = Object.create(GameEngine.prototype) as GameEngine<
      State,
      Command,
      View,
      PublicView,
      Payload
    >;
    engine.definition = definition;
    engine._state = deepFreeze(state);
    return engine;
  }

  /** Immutable snapshot of the full server state. */
  get state(): Readonly<State> {
    return this._state;
  }

  get revision(): number {
    return this._state.revision;
  }

  isTerminal(): boolean {
    return this.definition.isTerminal(this._state);
  }

  result(): GameResult | null {
    return this.definition.result(this._state);
  }

  legalChoices(): readonly LegalChoice[] {
    return this.definition.legalChoices(this._state);
  }

  /** Legal choices available to one seat (empty for dead/terminal). */
  legalChoicesFor(seat: number): readonly LegalChoice[] {
    return this.definition
      .legalChoices(this._state)
      .filter((choice) => choice.seat === seat);
  }

  choiceIdOf(command: Command): string | null {
    return this.definition.choiceId(command);
  }

  actors(): readonly number[] {
    return this.definition.actors(this._state);
  }

  systemCommand(): Command | null {
    return this.definition.systemCommand(this._state);
  }

  publicView(): PublicView {
    return this.definition.publicView(this._state);
  }

  viewFor(seat: number): View {
    return this.definition.viewFor(this._state, seat);
  }

  phaseToken(): string {
    return this.definition.phaseToken(this._state);
  }

  serializeState(): string {
    return this.definition.serializeState(this._state);
  }

  /**
   * Apply one command. On success returns the events produced (frozen); on
   * rejection throws with the state untouched. Terminal absorption:
   * every command after the game ended is rejected.
   */
  dispatch(command: Command): readonly GameEvent<Payload>[] {
    if (this.definition.isTerminal(this._state)) {
      throw new IllegalActionError(
        "TERMINAL_STATE",
        "the game is over: the terminal state absorbs every action",
      );
    }
    const before = this._state;
    const { state: next, events: payloads } = this.definition.transition(
      before,
      command,
    );
    const revision = before.revision + 1;
    const baseIndex = before.events.length;
    const wrapped = payloads.map((payload, i) =>
      deepFreeze<GameEvent<Payload>>({
        index: baseIndex + i,
        revision,
        payload,
      }),
    );
    const state = deepFreeze({
      ...next,
      revision,
      events: [...before.events, ...wrapped],
    } as State);
    this._state = state;
    return wrapped;
  }
}
