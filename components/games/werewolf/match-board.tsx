"use client";
import Link from "next/link";

/**
 * The match workspace (docs/design/werewolf/visual-spec.md §3.2 desktop,
 * §3.3 mobile).
 *
 * Layout: at ≥1200px the phase banner spans the workspace and the body is
 * three columns (private identity ≈235 / board ≈660 / public timeline ≈290,
 * 20px gaps). Below that it becomes a single column in the mobile priority
 * order — phase, own identity, six seats, recent public events, speaking
 * availability — with the legal actions pinned in the thumb zone and a
 * spacer that keeps the panel from covering the board.
 *
 * Everything on this screen comes from the one session envelope the server
 * rendered; the client never receives or reconstructs the server state.
 */
import { useCallback, useState } from "react";
import { isTerminalStatus, type UiEnvelope } from "@/lib/game-ui/envelope";
import { isTargetAction } from "@/lib/game-ui/actions";
import { ActionPanel } from "./action-panel";
import { IdentityCard } from "./identity-card";
import { PhaseBanner } from "./phase-banner";
import { PublicTimeline } from "./public-timeline";
import { ResultReveal } from "./result-reveal";
import { SeatGrid } from "./seat-grid";
import { SpeechPanel } from "./speech-panel";
import { useMatch } from "./use-match";

export interface MatchBoardProps {
  readonly initial: UiEnvelope;
}

export function MatchBoard({ initial }: MatchBoardProps) {
  const controller = useMatch(initial);
  const { envelope, group, selected, busy, restore, degraded, timeline, freshEntries } = controller;
  const [barHeight, setBarHeight] = useState(0);
  const terminal = isTerminalStatus(envelope.status);
  const choosingTarget = group !== null && isTargetAction(group.kind);
  const selectable = choosingTarget && group !== null ? group.targets : [];
  const disabled = busy !== "idle" || restore === "restoring";

  const onBarHeight = useCallback((height: number) => setBarHeight(height), []);

  return (
    <div
      // `data-restore` is the board's readiness signal: while the session is
      // being re-read the licensed controls stay locked (§6 网络 row), and
      // both the tests and the E2E wait on this rather than on a timer.
      data-restore={restore}
      data-testid="game-shell"
      className="game-shell -mx-4 bg-werewolf-bg px-4 pb-4 pt-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 lg:pb-10"
    >
      <div className="mx-auto w-full max-w-[1280px]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/games"
              className="rounded-lg px-2 py-1 text-[13px] font-medium text-werewolf-moon hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-werewolf-moon focus-visible:ring-offset-2 focus-visible:ring-offset-werewolf-bg"
            >
              返回大厅
            </Link>
            <h1 className="text-[20px] font-bold text-werewolf-text sm:text-[24px]">狼人杀</h1>
            <span className="rounded-full border border-werewolf-borderDark/60 px-2.5 py-0.5 text-[12px] font-semibold text-werewolf-moon">
              AI 对局
            </span>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-[12px] text-werewolf-muted sm:text-[13px]">6 人极速局 · 1 位玩家 + 5 位 AI</p>
            <Link
              href="/games/werewolf#rules"
              className="rounded-lg px-2 py-1 text-[13px] font-medium text-werewolf-moon hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-werewolf-moon focus-visible:ring-offset-2 focus-visible:ring-offset-werewolf-bg"
            >
              规则
            </Link>
          </div>
        </div>

        <div className="mt-4">
          <PhaseBanner envelope={envelope} advancing={busy === "advancing"} degraded={degraded} />
        </div>

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="live-region"
          className="sr-only"
        >
          {controller.notice}
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:mt-5 lg:grid lg:grid-cols-[235px_minmax(0,1fr)_290px] lg:items-start lg:gap-5">
          <div className="order-2 lg:order-none lg:col-start-1 lg:row-start-1">
            <IdentityCard envelope={envelope} />
          </div>

          <div className="order-3 flex flex-col gap-4 lg:order-none lg:col-start-2 lg:row-start-1">
            <div className="rounded-2xl border border-werewolf-borderDark/40 bg-werewolf-surface/60 p-3 sm:p-4">
              <SeatGrid
                view={envelope.projectView}
                selected={selected}
                selectable={selectable}
                choosingTarget={choosingTarget}
                disabled={disabled}
                onSelect={controller.select}
              />
            </div>
            {terminal ? (
              <ResultReveal
                envelope={envelope}
                onAbandon={controller.abandon}
                abandoning={busy === "submitting"}
              />
            ) : null}
          </div>

          <div className="order-4 lg:order-none lg:col-start-3 lg:row-start-1 lg:row-span-2">
            <PublicTimeline entries={timeline} freshCount={freshEntries} />
          </div>

          {/*
            §3.2: the speaking panel and the licensed actions sit under the
            board, in that order, inside the centre column. On mobile the
            action panel is pinned to the thumb zone (it leaves the flow
            there), which is why it lives here rather than beside the grid.
          */}
          <div className="order-5 flex flex-col gap-4 lg:order-none lg:col-start-2 lg:row-start-2">
            <SpeechPanel envelope={envelope} group={group} />
            <ActionPanel controller={controller} onHeightChange={onBarHeight} />
          </div>
        </div>

        {/* Keeps the pinned action panel from covering the board on mobile. */}
        <div aria-hidden="true" className="lg:hidden" style={{ height: barHeight }} />
      </div>
    </div>
  );
}
