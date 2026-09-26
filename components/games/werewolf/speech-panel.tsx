"use client";

/**
 * The 发言区 panel (docs/design/werewolf/visual-spec.md §3.2 中栏, §6 发言区).
 *
 * It shows the availability of speaking in words — never a live-looking
 * disabled input, never a microphone, never night chat. During the night it
 * says why speaking is unavailable instead of looking broken (§3.3), and an
 * eliminated player is told they can keep watching.
 *
 * The composer itself lives in the action panel, which is directly below this
 * panel on desktop and pinned in the thumb zone on mobile — a single input,
 * so a draft can never be split across two controls.
 */
import { isTerminalStatus, type UiEnvelope } from "@/lib/game-ui/envelope";
import type { UiActionGroup } from "@/lib/game-ui/actions";

export interface SpeechPanelProps {
  readonly envelope: UiEnvelope;
  readonly group: UiActionGroup | null;
}

export function SpeechPanel({ envelope, group }: SpeechPanelProps) {
  const view = envelope.projectView;
  const alive = view.aliveSeats.includes(view.humanSeat);
  const terminal = isTerminalStatus(envelope.status);

  let text: string;
  let testId = "speech-unavailable";
  if (terminal) {
    text = "本局已结束，发言已关闭。";
  } else if (!alive) {
    text = "你已离场，可继续观战。";
    testId = "speech-spectate";
  } else if (group !== null && (group.kind === "speech" || group.kind === "skip")) {
    text = "轮到你发言了，请在下方输入或跳过。";
    testId = "speech-ready";
  } else if (view.phase === "NIGHT") {
    text = "白天轮到你时可发言。";
    testId = "speech-night";
  } else {
    text = "请等待其他玩家发言。";
    testId = "speech-waiting";
  }

  return (
    <section
      aria-labelledby="speech-heading"
      data-testid="speech-panel"
      className="rounded-2xl border border-werewolf-borderDark/40 bg-werewolf-surface px-4 py-3 sm:px-5"
    >
      <h2 id="speech-heading" className="text-[15px] font-semibold text-werewolf-text sm:text-[16px]">
        发言区
      </h2>
      <p className="mt-1 text-[13px] text-werewolf-muted" data-testid={testId}>
        {text}
      </p>
    </section>
  );
}
