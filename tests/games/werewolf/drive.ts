/**
 * Test-side full-game driver shared by the domain-security and replay
 * suites: plays a quick6 engine to its terminal state with the scripted bot,
 * capturing a frozen state snapshot after EVERY accepted dispatch (boundary),
 * plus the complete event log.
 *
 * The driver mirrors the production runBotGame loop (same bot, same
 * path-derived per-seat streams) so each run is fully deterministic for a
 * fixed (seedBytes, options).
 */
import { createQuick6Bot, createQuick6Rng } from "@/lib/games/werewolf";
import type {
  Quick6Engine,
  Quick6Event,
  Quick6StartOptions,
  Quick6State,
} from "@/lib/games/werewolf";

export interface DrivenGame {
  /** Frozen state snapshots: boundaries[0] is the initial state, then one per accepted dispatch. */
  boundaries: Quick6State[];
  /** The complete engine event log. */
  events: Quick6Event[];
  /** Start options the engine was created with (needed to replay fixtures). */
  options: Quick6StartOptions | undefined;
}

/** Same purpose mapping as the production driver (stable per phase). */
function purposeOf(engine: Quick6Engine): string {
  const token = engine.phaseToken();
  if (token.startsWith("night:")) return "night";
  if (token.startsWith("discussion:")) return "speech";
  if (token.startsWith("vote:")) return "vote";
  return "none";
}

export function playWithBoundaries(
  engine: Quick6Engine,
  options: Quick6StartOptions | undefined,
  maxDispatches = 2000,
): DrivenGame {
  const bot = createQuick6Bot();
  const rngFactory = createQuick6Rng(engine.state.seedBytes);
  const boundaries: Quick6State[] = [engine.state];
  let dispatches = 0;

  while (!engine.isTerminal()) {
    if (++dispatches > maxDispatches) {
      throw new Error(`game did not terminate within ${maxDispatches} dispatches`);
    }
    const actors = [...engine.actors()].sort((a, b) => a - b);
    if (actors.length === 0) {
      const finish = engine.systemCommand();
      if (finish === null) throw new Error("no actor and no settlement command");
      engine.dispatch(finish);
      boundaries.push(engine.state);
      continue;
    }
    for (const seat of actors) {
      if (engine.isTerminal()) break;
      const choiceIds = engine.legalChoicesFor(seat).map((c) => c.id);
      if (choiceIds.length === 0) continue;
      const command = bot.choose(
        {
          view: engine.viewFor(seat),
          seat,
          choiceIds,
          phase: engine.phaseToken(),
          round: engine.definition.roundOf(engine.state) ?? 0,
        },
        rngFactory.stream(
          "bot",
          `phase:${engine.phaseToken()}`,
          `seat:${seat}`,
          `purpose:${purposeOf(engine)}`,
        ),
      );
      if (command !== null) {
        engine.dispatch(command);
        boundaries.push(engine.state);
      }
    }
  }

  return {
    boundaries,
    events: [...engine.state.events],
    options,
  };
}
