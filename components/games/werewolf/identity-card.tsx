"use client";

/**
 * The private identity card (docs/design/werewolf/visual-spec.md §3.2/§3.3).
 *
 * Everything in this card is the owner's own authorized information: the
 * role they were dealt, their wolf teammates (TEAM_WOLVES scope) and their
 * own seer checks (living seer only). None of it is derived on the client —
 * if the projection did not carry a field, the card does not show it, which
 * is exactly why an eliminated player's spectate view (public facts plus the
 * role they already knew) never leaks a teammate or a check result.
 *
 * The card is always marked 仅自己可见 with a lock, on every viewport; on
 * mobile it is a compact strip that expands, and it stays identifiable while
 * collapsed (§3.3).
 */
import { useState } from "react";
import {
  ROLE_ABILITY,
  ROLE_LABEL,
  ROLE_PRIVATE_HINT,
} from "@/lib/game-ui/labels";
import { seatSummary } from "@/lib/game-ui/roster";
import { seatViewOf, type UiEnvelope } from "@/lib/game-ui/envelope";
import { FOCUS_RING } from "./constants";

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        d="M7 10V7.5a5 5 0 0 1 10 0V10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <rect x="5" y="10" width="14" height="10" rx="2.5" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

export interface IdentityCardProps {
  readonly envelope: UiEnvelope;
}

export function IdentityCard({ envelope }: IdentityCardProps) {
  const [open, setOpen] = useState(false);
  const view = envelope.projectView;
  const seat = seatViewOf(view);
  const alive = view.aliveSeats.includes(view.humanSeat);
  const seats = view.seats.length > 0 ? view.seats : [0, 1, 2, 3, 4, 5];

  const roleText = seat === null ? "终局已揭晓" : ROLE_LABEL[seat.ownRole];

  return (
    <section
      aria-labelledby="identity-heading"
      data-testid="identity-card"
      className="rounded-2xl border border-werewolf-borderDark/40 bg-werewolf-surface p-3 sm:p-4 lg:p-5"
    >
      <div className="flex items-center gap-2 text-werewolf-moon">
        <LockIcon />
        <h2 id="identity-heading" className="text-[13px] font-semibold sm:text-sm">
          我的身份
        </h2>
        <span className="ml-auto rounded-full border border-werewolf-borderDark/50 px-2 py-px text-[11px] font-medium">
          仅自己可见
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-2 lg:mt-3">
        <p className="text-[18px] font-bold text-werewolf-text sm:text-[22px]" data-testid="own-role">
          {roleText}
        </p>
        <p className="text-[12px] text-werewolf-muted">{seatSummary(view.humanSeat, view.humanSeat, seats)}</p>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="identity-details"
          className={`ml-auto rounded-lg border border-werewolf-borderDark/50 px-2 py-1 text-[12px] font-medium text-werewolf-moon lg:hidden ${FOCUS_RING}`}
        >
          {open ? "收起" : "详情"}
        </button>
      </div>

      {!alive ? (
        <p
          className="mt-2 rounded-lg border border-werewolf-borderDark/40 px-2.5 py-1.5 text-[12px] text-werewolf-muted"
          data-testid="spectate-note"
        >
          你已离场，可继续观战。
        </p>
      ) : null}

      <div id="identity-details" className={open ? "mt-3 block" : "mt-3 hidden lg:block"}>
        {seat === null ? (
          <p className="text-[13px] leading-relaxed text-werewolf-muted">
            本局已结束，身份已在下方对所有人揭示。
          </p>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-werewolf-muted">
              {ROLE_ABILITY[seat.ownRole]}
            </p>
            {seat.wolfTeammates.length > 0 ? (
              <div className="mt-3" data-testid="wolf-teammates">
                <p className="text-[12px] font-semibold text-werewolf-moon">我的同伴</p>
                <p className="mt-1 text-[13px] text-werewolf-text">
                  {seat.wolfTeammates.map((mate) => seatSummary(mate, view.humanSeat, seats)).join("、")}
                </p>
              </div>
            ) : null}
            {seat.seerChecks.length > 0 ? (
              <div className="mt-3" data-testid="seer-checks">
                <p className="text-[12px] font-semibold text-werewolf-moon">我的查验结果</p>
                <ul className="mt-1 space-y-1">
                  {seat.seerChecks.map((check) => (
                    <li key={`${check.round}:${check.target}`} className="text-[13px] text-werewolf-text">
                      第 {check.round} 夜 · {seatSummary(check.target, view.humanSeat, seats)} ·{" "}
                      {check.isWolf ? "狼人" : "不是狼人"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {seat.ownNightSubmission !== null ? (
              <p className="mt-3 text-[13px] text-werewolf-text" data-testid="own-submission">
                已提交：{seatSummary(seat.ownNightSubmission.target, view.humanSeat, seats)}
              </p>
            ) : null}
            <p className="mt-3 text-[12px] text-werewolf-muted">{ROLE_PRIVATE_HINT[seat.ownRole]}</p>
          </>
        )}
      </div>
    </section>
  );
}
