/**
 * Scripted bot contract and the deterministic full-game driver.
 *
 * A scripted bot is a pure function of (view, legal choice ids, RNG stream):
 * same inputs → same command, forever. It never reads server-private state —
 * the view already enforces docs/quick6-v1-rules.md §7 visibility.
 *
 * The driver (`runBotGame`) plays a whole game to completion:
 * - every seat action comes from the bot's choice over the LEGAL choice ids,
 *   so bots structurally cannot produce illegal commands;
 * - each seat draws randomness from its own (phaseToken, seat, purpose)
 *   domain-separated stream, so the order in which seats complete their
 *   actions (including concurrent completion) never affects any other
 *   stream's draws or the game's outcome;
 * - a defensive dispatch guard plus the definition's own step cap turn any
 *   non-terminating ruleset into a loud failure (never a forged draw).
 */
import type { GameDefinition } from "./definition";
import type { GameEngine } from "./engine";
import { BotGuardError } from "./errors";
import type { GameResult, Rng, RngStreamFactory } from "./types";

export interface BotInput<View> {
  /** Visibility-filtered view of exactly this seat. */
  readonly view: View;
  readonly seat: number;
  /** Legal choice ids for this seat right now (never empty). */
  readonly choiceIds: readonly string[];
  readonly phase: string;
  readonly round: number;
}

export interface ScriptedBot<View, Command> {
  readonly name: string;
  /**
   * Choose one command from the legal choice ids, or null to defer to the
   * system (the driver will settle the phase). Must be a pure function of
   * its inputs.
   */
  choose(input: BotInput<View>, rng: Rng): Command | null;
}

export interface BotGameReport {
  /** Printable, reproducible seed label (ASCII). */
  readonly seedLabel: string;
  readonly outcome: GameResult;
  readonly winner: string;
  readonly reason: string;
  /** Successful transitions applied. */
  readonly steps: number;
  /** Final rule round. */
  readonly round: number;
  /** Events produced. */
  readonly eventCount: number;
}

export interface BotRunOptions<View, Command> {
  bot: ScriptedBot<View, Command>;
  /**
   * Path-derived stream factory (usually the game's seeded RNG). The driver
   * derives one stream per (phaseToken, seat, purpose).
   */
  rng: RngStreamFactory;
  /** Defensive dispatch guard (default 10_000; rules must terminate far sooner). */
  maxDispatches?: number;
  /** Printable, reproducible seed label recorded in the report. */
  seedLabel?: string;
}

/**
 * Drive a game to its terminal state with one bot for every seat (the human
 * seat is bot-driven too: full-game simulation). Returns the final report.
 * Throws {@link BotGuardError} if the game fails to terminate, and surfaces
 * the definition's {@link StepLimitError} as a failure — never a draw.
 */
export function runBotGame<
  State extends { readonly revision: number; readonly events: readonly unknown[] },
  Command,
  View,
  PublicView,
  Payload,
>(
  engine: GameEngine<State, Command, View, PublicView, Payload>,
  options: BotRunOptions<View, Command>,
): BotGameReport {
  const guard = options.maxDispatches ?? 10_000;
  let dispatches = 0;

  while (!engine.isTerminal()) {
    if (++dispatches > guard) {
      throw new BotGuardError(
        `game did not terminate within ${guard} dispatches (rules defect, never a draw)`,
      );
    }
    const actors = [...engine.actors()].sort((a, b) => a - b);
    if (actors.length === 0) {
      const finish = engine.systemCommand();
      if (finish === null) {
        throw new BotGuardError(
          "no actor has a legal choice and no settlement command exists",
        );
      }
      engine.dispatch(finish);
      continue;
    }
    for (const seat of actors) {
      if (engine.isTerminal()) break; // a previous actor ended the game
      const choices = engine.legalChoicesFor(seat).map((c) => c.id);
      if (choices.length === 0) continue;
      const command = options.bot.choose(
        {
          view: engine.viewFor(seat),
          seat,
          choiceIds: choices,
          phase: engine.phaseToken(),
          round: engine.definition.roundOf(engine.state) ?? 0,
        },
        options.rng.stream(
          "bot",
          `phase:${engine.phaseToken()}`,
          `seat:${seat}`,
          `purpose:${purposeOf(engine)}`,
        ),
      );
      if (command !== null) {
        engine.dispatch(command);
      }
    }
  }

  const result = engine.result();
  if (result === null) {
    throw new BotGuardError("engine is terminal but has no outcome (forged draw)");
  }
  return {
    seedLabel: options.seedLabel ?? "(seed)",
    outcome: result,
    winner: result.winner,
    reason: result.reason,
    steps: engine.definition.stepsOf(engine.state),
    round: engine.definition.roundOf(engine.state) ?? 0,
    eventCount: engine.state.events.length,
  };
}

/** Map the current phase token to the bot-purpose domain (stable per phase). */
function purposeOf<
  State extends { readonly revision: number; readonly events: readonly unknown[] },
  Command,
  View,
  PublicView,
  Payload,
>(engine: GameEngine<State, Command, View, PublicView, Payload>): string {
  const token = engine.phaseToken();
  if (token.startsWith("night:")) return "night";
  if (token.startsWith("discussion:")) return "speech";
  if (token.startsWith("vote:")) return "vote";
  return "none";
}

/** Re-export the definition type for convenience of game authors. */
export type { GameDefinition } from "./definition";
