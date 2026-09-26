"use client";
import Link from "next/link";

/**
 * The end-of-game reveal (docs/design/werewolf/visual-spec.md §6 结算 row).
 *
 * The roles shown here are the authorized POST_GAME reveal: the projection
 * carries `rolesRevealed` only once the game has ENDED, so nothing on this
 * panel can be rendered early — an eliminated seat says 离场 during play and
 * only turns into a role here (§2 离场不揭示身份). The tone is neutral: no
 * horror, no blame, no win/lose mockery.
 */
import { ROLE_LABEL, outcomeText, stoppedReason } from "@/lib/game-ui/labels";
import { seatSummary } from "@/lib/game-ui/roster";
import type { UiEnvelope } from "@/lib/game-ui/envelope";

export interface ResultRevealProps {
  readonly envelope: UiEnvelope;
  readonly onAbandon: () => void;
  readonly abandoning: boolean;
}

export function ResultReveal({ envelope, onAbandon, abandoning }: ResultRevealProps) {
  const view = envelope.projectView;
  const seats = view.seats.length > 0 ? view.seats : [0, 1, 2, 3, 4, 5];
  const known = [...seats].sort((a, b) => a - b);
  const finished = envelope.status === "finished";
  const reveal = view.rolesRevealed;
  const stopped = stoppedReason(envelope.status);

  return (
    <section
      aria-labelledby="result-heading"
      data-testid="result-reveal"
      className="rounded-2xl border border-werewolf-borderDark/40 bg-werewolf-surface p-4 sm:p-5"
    >
      <h2 id="result-heading" className="text-[18px] font-bold text-werewolf-text sm:text-[22px]">
        本局结束
      </h2>
      <p className="mt-1 text-[15px] font-semibold text-werewolf-moon" data-testid="result-outcome">
        {finished ? outcomeText(view.outcome) : (stopped ?? "这局对局已结束。")}
      </p>

      {finished ? (
        <div className="mt-4">
          <h3 className="text-[13px] font-semibold text-werewolf-muted">身份揭示</h3>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="role-reveal">
            {known.map((seat) => {
              const role = reveal?.[seat];
              return (
                <li
                  key={seat}
                  data-testid={`reveal-${seat}`}
                  className="rounded-xl border border-werewolf-borderDark/40 px-3 py-2"
                >
                  <p className="text-[13px] font-semibold text-werewolf-text">
                    {seatSummary(seat, view.humanSeat, known)}
                  </p>
                  <p className="mt-0.5 text-[13px] text-werewolf-moon">
                    {role === undefined ? "未知" : ROLE_LABEL[role]}
                  </p>
                  <p className="mt-0.5 text-[11px] text-werewolf-muted">
                    {view.aliveSeats.includes(seat) ? "在场" : "离场"}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/games/werewolf"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-werewolf-amber px-5 text-[16px] font-semibold text-werewolf-ink transition-colors hover:bg-werewolf-amberHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-werewolf-moon focus-visible:ring-offset-2 focus-visible:ring-offset-werewolf-bg"
        >
          再来一局
        </Link>
        <Link
          href="/games"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-werewolf-borderDark/60 px-4 text-sm font-semibold text-werewolf-moon transition-colors hover:bg-werewolf-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-werewolf-moon focus-visible:ring-offset-2 focus-visible:ring-offset-werewolf-bg"
        >
          返回大厅
        </Link>
        {envelope.status === "active" ? (
          <button
            type="button"
            onClick={onAbandon}
            disabled={abandoning}
            data-testid="abandon-inline"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-werewolf-borderDark/60 px-4 text-sm font-semibold text-werewolf-muted transition-colors hover:bg-werewolf-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-werewolf-moon focus-visible:ring-offset-2 focus-visible:ring-offset-werewolf-bg"
          >
            放弃这局
          </button>
        ) : null}
      </div>
    </section>
  );
}
