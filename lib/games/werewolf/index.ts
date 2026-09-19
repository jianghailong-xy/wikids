/**
 * werewolf/quick6 production domain layer: a strict implementation of the
 * frozen spec docs/quick6-v1-rules.md on top of the generic games core.
 * Pure TypeScript — no database, no network, no Next.js, no environment
 * access, no concrete AI provider.
 */
import { GameEngine } from "@/lib/games/core";
import { runBotGame } from "@/lib/games/core";
import type { BotGameReport } from "@/lib/games/core";
import { createQuick6Bot } from "./bots";
import { Quick6Definition } from "./definition";
import type { Quick6DefinitionConfig } from "./definition";
import { createQuick6Rng } from "./prng";
import type { Quick6StartOptions } from "./types";

export type { Quick6DefinitionConfig } from "./definition";
export type {
  EliminationKind,
  EliminationRecord,
  ExternalPhase,
  GameOutcome,
  Quick6Command,
  Quick6Event,
  Quick6EventPayload,
  Quick6StartOptions,
  Quick6State,
  Role,
  SeatId,
  SeerCheckRecord,
  SpeechRecord,
  Team,
  VoteRecord,
  WinReason,
} from "./types";
export { ALL_PHASES, ALL_SEATS, ROLE_MULTISET, SEAT_COUNT } from "./types";
export type { PublicFacts, PublicProjection, SeatView, SystemView, ProjectedView, Viewer, ViewerScope } from "./view";
export { aiContextFor, livingSeats, projectView, publicProjection, viewFor } from "./view";
export type { ReplayErrorCode } from "./replay";
export { ReplayError, replayQuick6 } from "./replay";
export { DEFAULT_MAX_PHASE_STEPS, QUICK6_DEFINITION_ID, QUICK6_GAME_VERSIONS, QUICK6_TITLE } from "./versions";
export { QUICK6_RNG_DOMAINS, assertSeedBytes, createQuick6Rng } from "./prng";
export { generateSeedBytes, seedBytesFromInt, seedBytesToHex, seedLabel } from "./seed";
export { createQuick6Bot } from "./bots";
export {
  actors,
  choiceIdOf,
  isAlive,
  isSeatId,
  legalChoices,
  nextSpeaker,
  parseChoiceId,
  pendingNightSeats,
  pendingVoters,
  phaseToken,
  systemCommand,
} from "./legal";
export { Quick6Definition } from "./definition";

export type Quick6Engine = GameEngine<
  import("./types").Quick6State,
  import("./types").Quick6Command,
  import("./view").SeatView,
  import("./view").PublicProjection,
  import("./types").Quick6EventPayload
>;

export interface Quick6EngineOptions {
  definition?: Quick6DefinitionConfig;
  start?: Quick6StartOptions;
}

/** Create an engine for one quick6 game (production: crypto-random seed). */
export function createQuick6Engine(
  seedBytes: Uint8Array,
  options: Quick6EngineOptions = {},
): Quick6Engine {
  const definition =
    options.definition === undefined
      ? new Quick6Definition()
      : new Quick6Definition(options.definition);
  return new GameEngine(definition, seedBytes, options.start);
}

export interface Quick6SimulationOptions {
  /** Bot for every seat (default: the scripted quick6 bot). */
  bot?: ReturnType<typeof createQuick6Bot>;
  /** Printable seed label for the report. */
  seedLabel?: string;
  maxDispatches?: number;
}

/** Drive one full bot-vs-bot game to its terminal state. */
export function runQuick6BotGame(
  engine: Quick6Engine,
  options: Quick6SimulationOptions = {},
): BotGameReport {
  return runBotGame(engine, {
    bot: options.bot ?? createQuick6Bot(),
    rng: {
      stream: (...parts) => createQuick6Rng(engine.state.seedBytes).stream(...parts),
    },
    seedLabel: options.seedLabel,
    maxDispatches: options.maxDispatches,
  });
}
