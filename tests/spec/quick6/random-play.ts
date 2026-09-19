/**
 * Deterministic random legal play: every action is chosen from the legal
 * option set, so a full game always terminates (each night kills exactly one
 * player while any wolf lives). Used to prove, over 1000+ seeds, that valid
 * play never trips the abnormal step cap and always ends in a real outcome.
 */
import { SpecGame } from "./model";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomLegalPlay(seedBytes: Uint8Array, actionSeed: number): SpecGame {
  const game = new SpecGame({ seedBytes });
  const r = mulberry32(actionSeed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(r() * items.length)];

  let guard = 0;
  while (game.phase !== "END") {
    // Defensive only: the spec guarantees termination long before this.
    if (++guard > 10000) throw new Error("random play guard exceeded: rules do not terminate");
    switch (game.phase) {
      case "NIGHT": {
        const wolves = game.livingWolves();
        const seer = game.livingSeats().find((s) => game.roles[s] === "SEER");
        for (const w of wolves) {
          const targets = game.livingSeats().filter((t) => t !== w && game.roles[t] !== "WOLF");
          game.submitWolfKill(w, pick(targets));
        }
        if (seer !== undefined) {
          const targets = game.livingSeats().filter((t) => t !== seer);
          game.submitSeerCheck(seer, pick(targets));
        }
        game.finishNight();
        break;
      }
      case "DAY_DISCUSSION": {
        let next = game.nextSpeaker();
        while (next !== null) {
          game.submitSpeech(next, pick(["发言 A", "发言 B", null]));
          next = game.nextSpeaker();
        }
        game.finishDiscussion();
        break;
      }
      case "DAY_VOTE": {
        const alive = game.livingSeats();
        for (const s of alive) {
          game.submitDayVote(s, pick(alive.filter((t) => t !== s)));
        }
        game.finishVote();
        break;
      }
    }
  }
  return game;
}

/** Full internal trace for replay comparison (test-side only). */
export function trace(game: SpecGame): string {
  return JSON.stringify({
    events: game.events,
    outcome: game.outcome,
    eliminations: game.eliminations,
    roles: game.roles,
    round: game.round,
  });
}
