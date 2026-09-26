"use client";
import Link from "next/link";

/**
 * The active-game card: resume or give up (docs/design/werewolf/visual-spec.md
 * §3.1, 恢复与放弃).
 *
 * A user has at most one active quick6 game, so this card is the lobby's
 * "continue where you left off". Resuming is a link (no request needed — the
 * match page reads the authoritative view itself); abandoning is an explicit,
 * confirmed action, because it is the only way to free the slot and it cannot
 * be undone. After a successful abandon the card is replaced by the start
 * action (router.refresh re-reads the server-rendered lobby).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GameTransportError, friendlyMessage, gameTransport } from "@/lib/game-ui/transport";
import { STATUS_LABEL } from "@/lib/game-ui/labels";
import { LIGHT_SECONDARY_BUTTON } from "./werewolf/constants";

export interface ActiveGameSummary {
  readonly sessionId: string;
  readonly status: "active" | "finished" | "aborted" | "abandoned";
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Rendered on the server: the client must not re-format a timestamp. */
  readonly startedAtText: string;
  readonly updatedAtText: string;
}

export interface ActiveGameCardProps {
  readonly session: ActiveGameSummary | null;
}

export function ActiveGameCard({ session }: ActiveGameCardProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session === null) return null;

  async function abandon(): Promise<void> {
    if (busy || session === null) return;
    setBusy(true);
    setError(null);
    try {
      await gameTransport.abandon(session.sessionId);
      setConfirming(false);
      router.refresh();
    } catch (thrown) {
      setError(friendlyMessage(thrown instanceof GameTransportError ? thrown.code : "unknown_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="active-game-heading"
      data-testid="active-game-card"
      data-session-id={session.sessionId}
      className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm"
    >
      <p className="text-[13px] font-semibold text-brand-600">你的对局</p>
      <h2 id="active-game-heading" className="mt-1 text-[20px] font-bold text-slate-900">
        狼人杀 · {STATUS_LABEL[session.status]}
      </h2>
      <p className="mt-1 text-[13px] text-slate-600">
        开始于 {session.startedAtText}，最近更新 {session.updatedAtText}。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/games/werewolf/${session.sessionId}`}
          data-testid="resume-game"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand-600 px-5 text-[16px] font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          继续对局
        </Link>
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => void abandon()}
              disabled={busy}
              data-testid="confirm-abandon"
              className={LIGHT_SECONDARY_BUTTON}
            >
              {busy ? "正在放弃…" : "确认放弃"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              data-testid="cancel-abandon"
              className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            data-testid="abandon-game"
            className={LIGHT_SECONDARY_BUTTON}
          >
            放弃这局
          </button>
        )}
      </div>

      {confirming ? (
        <p className="mt-2 text-[13px] text-slate-600">
          放弃后这局对局无法继续，但你可以立刻开始新的一局。
        </p>
      ) : null}
      {error !== null ? (
        <p className="mt-2 text-[13px] text-red-600" role="alert" data-testid="abandon-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
