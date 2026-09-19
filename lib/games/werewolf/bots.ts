/**
 * quick6 scripted bot: a deterministic, purely scripted player (no AI
 * provider). It decides ONLY from its own seat view and the legal choice ids
 * — it structurally cannot produce an illegal command — and draws randomness
 * from the per-(phaseToken, seat, purpose) stream handed to it, so
 * concurrent completion order can never affect any seat's decisions.
 *
 * Strategies (deliberately simple and rule-faithful):
 * - night wolf kill: uniform over legal targets (wolves decide
 *   INDEPENDENTLY — the bot never reads the other wolf's buffered target);
 * - seer check: prefer a living player not yet checked, else uniform;
 * - day speech: skip with probability 1/3, otherwise a scripted line;
 * - day vote: uniform over legal targets (no abstention).
 */
import type { BotInput, Rng, ScriptedBot } from "@/lib/games/core";
import { parseChoiceId } from "./legal";
import type { Quick6Command, SeatId } from "./types";
import type { SeatView } from "./view";

const SPEECH_SCRIPT = [
  "我认为我们需要仔细分析昨晚的情况。",
  "我暂时没有特别怀疑的对象。",
  "大家注意，狼人可能就在我们中间。",
  "我支持按发言顺序继续讨论。",
] as const;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)];
}

/** Seer strategy: prefer living unchecked players (own private history). */
function chooseSeerTarget(
  input: BotInput<SeatView>,
  rng: Rng,
): Quick6Command | null {
  const view = input.view;
  const checked = new Set(view.seerChecks.map((c) => c.target));
  const candidates: { seat: SeatId; target: SeatId }[] = [];
  const fallback: { seat: SeatId; target: SeatId }[] = [];
  for (const id of input.choiceIds) {
    if (!id.startsWith("seer-check@")) continue;
    const command = parseChoiceId(id);
    if (command?.type !== "SUBMIT_SEER_CHECK") continue;
    (checked.has(command.target) ? fallback : candidates).push({
      seat: command.seat,
      target: command.target,
    });
  }
  const chosen = pick(rng, candidates.length > 0 ? candidates : fallback);
  return { type: "SUBMIT_SEER_CHECK", seat: chosen.seat, target: chosen.target };
}

export function createQuick6Bot(): ScriptedBot<SeatView, Quick6Command> {
  return {
    name: "quick6-scripted-bot",
    choose(input: BotInput<SeatView>, rng: Rng): Quick6Command | null {
      const { choiceIds } = input;

      if (choiceIds.some((id) => id.startsWith("seer-check@"))) {
        return chooseSeerTarget(input, rng);
      }

      if (choiceIds.some((id) => id.startsWith("wolf-kill@"))) {
        const id = pick(rng, choiceIds.filter((c) => c.startsWith("wolf-kill@")));
        return parseChoiceId(id);
      }

      if (choiceIds.some((id) => id.startsWith("skip@"))) {
        // Explicit skip with probability 1/3, otherwise a scripted line.
        const skip = rng.next() < 1 / 3;
        const id = skip
          ? choiceIds.find((c) => c.startsWith("skip@"))!
          : choiceIds.find((c) => c.startsWith("speech@"))!;
        const command = parseChoiceId(id);
        if (command?.type === "SUBMIT_SPEECH" && command.text === null) return command;
        if (command?.type === "SUBMIT_SPEECH") {
          return { ...command, text: pick(rng, SPEECH_SCRIPT) };
        }
      }

      if (choiceIds.some((id) => id.startsWith("day-vote@"))) {
        const id = pick(rng, choiceIds.filter((c) => c.startsWith("day-vote@")));
        return parseChoiceId(id);
      }

      return null; // only system settlement choices remain
    },
  };
}
