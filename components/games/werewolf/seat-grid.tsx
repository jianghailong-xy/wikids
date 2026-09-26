"use client";

/**
 * The six-seat board (docs/design/werewolf/visual-spec.md §3.2/§3.3/§6).
 *
 * Rules this component obeys:
 * - Exactly six cards in a 3×2 grid on every viewport; the order is always
 *   seat 1 → 6 and no seat is ever hidden — an eliminated seat keeps its
 *   place, number and neutral portrait, and says 离场 (§2).
 * - Which seats are selectable is exactly the target set the SERVER
 *   authorized for this seat (never a client-side rule derivation). A seat
 *   that is not selectable is not rendered as a control at all, so it can
 *   never be submitted, and the restriction is explained in words rather
 *   than shown only by dimming (§6).
 * - Appearances express personality, never a faction: identities appear here
 *   only when the projection carries the END reveal.
 */
import { seatDisplayOf } from "@/lib/game-ui/roster";
import { ROLE_LABEL } from "@/lib/game-ui/labels";
import type { UiProjectView } from "@/lib/game-ui/envelope";
import { FOCUS_RING } from "./constants";
import { humanPortrait } from "@/lib/game-ui/roster";

export interface SeatGridProps {
  readonly view: UiProjectView;
  readonly selected: number | null;
  /** Exactly the seats the server authorized as targets right now. */
  readonly selectable: readonly number[];
  /** True while a target action is on offer (drives the 不可选自己 hint). */
  readonly choosingTarget: boolean;
  readonly disabled: boolean;
  readonly onSelect: (seat: number) => void;
}

export function SeatGrid({
  view,
  selected,
  selectable,
  choosingTarget,
  disabled,
  onSelect,
}: SeatGridProps) {
  const seats = view.seats.length > 0 ? view.seats : [0, 1, 2, 3, 4, 5];
  const known = [...seats].sort((a, b) => a - b);
  const aliveCount = view.aliveSeats.length;
  const revealed = view.rolesRevealed;

  return (
    <section aria-labelledby="seat-grid-heading">
      <div className="flex items-end justify-between gap-4">
        <h2 id="seat-grid-heading" className="text-[18px] font-semibold text-werewolf-text sm:text-[20px]">
          玩家座位
        </h2>
        <p className="text-[13px] text-werewolf-muted sm:text-sm" data-testid="seats-alive">
          {aliveCount} / {known.length} 在场
        </p>
      </div>

      <ul
        className="mt-3 grid grid-cols-3 gap-2 sm:gap-3"
        data-testid="seat-grid"
        aria-label="六位玩家"
      >
        {known.map((seat) => {
          const display = seatDisplayOf(seat, view.humanSeat, known);
          const alive = view.aliveSeats.includes(seat);
          const isSelected = selected === seat;
          const canSelect = alive && selectable.includes(seat) && !disabled;
          const role = revealed?.[seat];
          const portrait = display.isHuman
            ? humanPortrait()
            : (display.persona?.portrait ?? "bg-werewolf-surface text-werewolf-muted ring-werewolf-borderDark");

          const face = (
            <>
              <span
                aria-hidden="true"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold ring-1 sm:h-11 sm:w-11 sm:text-[17px] ${portrait} ${
                  alive ? "" : "opacity-60 saturate-50"
                }`}
              >
                {display.isHuman ? "我" : (display.persona?.initial ?? display.label.slice(0, 1))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-werewolf-text sm:text-[15px]">
                  {display.label} · {display.name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-werewolf-muted sm:text-[12px]">
                  <span className="rounded-full border border-werewolf-borderDark/50 px-1.5 py-px font-medium text-werewolf-moon">
                    {display.isHuman ? "你" : "AI"}
                  </span>
                  <span data-testid={`seat-state-${seat}`}>
                    {alive ? "在场" : "离场"}
                  </span>
                  {role === undefined ? (
                    !display.isHuman ? <span>身份未知</span> : null
                  ) : (
                    <span className="font-semibold text-werewolf-text" data-testid={`seat-role-${seat}`}>
                      {ROLE_LABEL[role]}
                    </span>
                  )}
                </span>
              </span>
            </>
          );

          return (
            <li key={seat} className="min-w-0">
              {canSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(seat)}
                  aria-pressed={isSelected}
                  aria-label={`${display.label} ${display.name}${isSelected ? "，已选择" : "，可选"}`}
                  data-testid={`seat-${seat}`}
                  data-selected={isSelected ? "true" : "false"}
                  className={`flex min-h-[44px] w-full items-center gap-2 rounded-xl border bg-white/[0.03] p-2 text-left transition-colors hover:bg-white/[0.07] sm:p-2.5 ${
                    isSelected
                      ? "border-2 border-werewolf-moon bg-werewolf-moon/10"
                      : "border border-werewolf-borderDark/40"
                  } ${FOCUS_RING}`}
                >
                  {face}
                  {isSelected ? (
                    <span className="sr-only">已选择</span>
                  ) : null}
                </button>
              ) : (
                <div
                  data-testid={`seat-${seat}`}
                  data-selected="false"
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-werewolf-borderDark/25 bg-white/[0.02] p-2 text-left sm:p-2.5"
                >
                  {face}
                </div>
              )}
              {isSelected ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-werewolf-moon">
                  <span aria-hidden="true">✓</span>已选择
                </p>
              ) : null}
              {display.isHuman && choosingTarget && alive ? (
                <p className="mt-1 text-[11px] text-werewolf-muted">不可选自己</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
