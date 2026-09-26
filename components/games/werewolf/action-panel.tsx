"use client";

/**
 * The legal-action panel (docs/design/werewolf/visual-spec.md §3.2 中栏底部,
 * §3.3 底部固定操作区, §6 合法动作/发言区 rows).
 *
 * It offers exactly one thing at a time: the single action kind the server's
 * own-seat legal set contains. Nothing is computed from a role, no vote or
 * skip button exists unless the server authorized it, and a phase change
 * clears the stale selection (the hook drops it, this component then renders
 * only what is legal now).
 */
import { PLAYER_SPEECH_MAX_CHARS } from "@/lib/games/safety/policy";
import { seatSummary } from "@/lib/game-ui/roster";
import { isTerminalStatus, type UiEnvelope } from "@/lib/game-ui/envelope";
import {
  ACTION_TITLE,
  CONFIRM_LABEL,
  TARGET_HINT,
  isTargetAction,
} from "@/lib/game-ui/actions";
import { useEffect, useRef } from "react";
import type { MatchController } from "./use-match";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./constants";

export interface ActionPanelProps {
  readonly controller: MatchController;
  /**
   * Reports the pinned panel's rendered height so the page can reserve the
   * same space on mobile: the panel is fixed there (§3.3 thumb zone) and must
   * never cover the board or the speaking panel.
   */
  readonly onHeightChange?: (height: number) => void;
}

export function ActionPanel({ controller, onHeightChange }: ActionPanelProps) {
  const shellRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = shellRef.current;
    if (element === null || onHeightChange === undefined) return;
    const report = (): void => onHeightChange(element.getBoundingClientRect().height);
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange]);
  const { envelope, group, selected, draft, busy, restore, degraded, error, notice, submitted } =
    controller;
  const view = envelope.projectView;
  const seats = view.seats.length > 0 ? view.seats : [0, 1, 2, 3, 4, 5];
  const alive = view.aliveSeats.includes(view.humanSeat);
  const terminal = isTerminalStatus(envelope.status);
  const submitting = busy === "submitting";

  const shell = "border-t border-werewolf-borderDark/50 bg-werewolf-surface lg:rounded-2xl lg:border lg:border-werewolf-borderDark/40";

  function body() {
    if (restore === "failed") {
      return (
        <>
          <h2 className="text-[16px] font-semibold text-werewolf-text">连接暂时中断</h2>
          <p className="mt-1 text-[13px] text-werewolf-muted">
            对局状态还在服务器上，重新同步即可继续。
          </p>
          <button type="button" onClick={controller.retry} className={`${PRIMARY_BUTTON} mt-3`}>
            重试
          </button>
        </>
      );
    }

    if (terminal) {
      return (
        <>
          <h2 className="text-[16px] font-semibold text-werewolf-text">本局结束</h2>
          <p className="mt-1 text-[13px] text-werewolf-muted">可以查看结果与身份揭示。</p>
        </>
      );
    }

    if (!alive) {
      return (
        <>
          <h2 className="text-[16px] font-semibold text-werewolf-text">你已离场</h2>
          <p className="mt-1 text-[13px] text-werewolf-muted">
            可以继续观战，公开记录会一直更新。
          </p>
        </>
      );
    }

    if (group === null) {
      return (
        <>
          <h2 className="text-[16px] font-semibold text-werewolf-text">当前可做</h2>
          <p className="mt-1 text-[13px] text-werewolf-muted" data-testid="waiting-note">
            {busy === "advancing" ? "正在等待其他玩家，请稍候。" : "暂时没有需要你操作的内容。"}
          </p>
          {busy === "idle" ? (
            <button type="button" onClick={controller.retry} className={`${SECONDARY_BUTTON} mt-3 w-full`}>
              同步最新状态
            </button>
          ) : null}
        </>
      );
    }

    if (isTargetAction(group.kind)) {
      const selectedText = selected === null ? null : seatSummary(selected, view.humanSeat, seats);
      return (
        <>
          <h2 className="text-[16px] font-semibold text-werewolf-text">当前可做</h2>
          <p className="mt-1 text-[13px] text-werewolf-muted">{ACTION_TITLE[group.kind]}</p>
          <p className="mt-2 text-[13px] font-medium text-werewolf-text" data-testid="target-summary">
            {selectedText === null
              ? TARGET_HINT[group.kind]
              : `已选择：${selectedText}`}
          </p>
          <button
            type="button"
            onClick={controller.confirm}
            disabled={selected === null || submitting}
            aria-busy={submitting ? "true" : "false"}
            data-testid="confirm-action"
            className={`${PRIMARY_BUTTON} mt-3`}
          >
            {submitting ? "正在提交…" : CONFIRM_LABEL[group.kind]}
          </button>
        </>
      );
    }

    if (group.kind === "speech" || group.kind === "skip") {
      const speaking = group.kind === "speech";
      return (
        <>
          <h2 className="text-[16px] font-semibold text-werewolf-text">轮到你发言</h2>
          {speaking ? (
            <>
              <label htmlFor="speech-input" className="sr-only">
                发言内容
              </label>
              <textarea
                id="speech-input"
                data-testid="speech-input"
                value={draft}
                onChange={(event) => controller.setDraft(event.target.value.slice(0, PLAYER_SPEECH_MAX_CHARS))}
                maxLength={PLAYER_SPEECH_MAX_CHARS}
                rows={2}
                placeholder="说说你的判断…"
                disabled={submitting}
                className="mt-2 w-full resize-none rounded-xl border border-werewolf-borderDark/50 bg-werewolf-bg/60 px-3 py-2 text-[16px] text-werewolf-text placeholder:text-werewolf-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-werewolf-moon"
              />
              <p className="mt-1 text-right text-[12px] text-werewolf-muted" data-testid="speech-counter">
                {draft.length} / {PLAYER_SPEECH_MAX_CHARS}
              </p>
              <button
                type="button"
                onClick={controller.sendSpeech}
                disabled={submitting || draft.trim() === ""}
                aria-busy={submitting ? "true" : "false"}
                data-testid="speech-send"
                className={`${PRIMARY_BUTTON} mt-2`}
              >
                {submitting ? "正在发送…" : "发送发言"}
              </button>
            </>
          ) : (
            <p className="mt-1 text-[13px] text-werewolf-muted">
              现在只有跳过发言可用，你也可以等待其他玩家。
            </p>
          )}
          <button
            type="button"
            onClick={controller.skipSpeech}
            disabled={submitting}
            data-testid="speech-skip"
            className={`${SECONDARY_BUTTON} mt-2 w-full`}
          >
            跳过发言
          </button>
        </>
      );
    }

    return null;
  }

  return (
    <section
      ref={shellRef}
      aria-labelledby="action-heading"
      data-testid="action-panel"
      className={`${shell} fixed inset-x-0 bottom-0 z-20 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 sm:px-5 sm:pt-4 lg:static lg:z-auto lg:p-5`}
    >
      <div className="mx-auto w-full max-w-[680px] lg:max-w-none">
        <h2 id="action-heading" className="sr-only">
          当前可做
        </h2>
        {body()}
        <div role="status" aria-live="polite" className="mt-2 min-h-[1.25rem]">
          {submitted && !error ? (
            <p className="text-[12px] text-werewolf-muted" data-testid="submitted-note">
              已提交，请稍候。
            </p>
          ) : null}
          {!submitted && notice !== "" && group !== null && !error ? (
            <p className="text-[12px] text-werewolf-muted">{notice}</p>
          ) : null}
          {error !== null ? (
            <p className="text-[12px] font-medium text-[#FFC9A8]" data-testid="action-error">
              {error}
            </p>
          ) : null}
          {degraded && group !== null ? (
            <p className="text-[12px] text-werewolf-muted">AI 正在使用简化策略继续对局。</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
