"use client";

/**
 * The phase banner (docs/design/werewolf/visual-spec.md §3.2/§6 阶段条).
 *
 * Left: the moon/sun pair with 第 N 夜/天 · the public phase name. Right: the
 * generalized AI status. Neither side ever names a hidden sub-phase, a role
 * or a thinking seat — during the night the AI status is one generic line
 * (§2 夜间状态).
 */
import { aiStatusText, phaseLabel } from "@/lib/game-ui/labels";
import { isTerminalStatus, type UiEnvelope } from "@/lib/game-ui/envelope";

function MoonIcon({ day }: { day: boolean }) {
  return day ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 text-werewolf-amber">
      <circle cx="12" cy="12" r="5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19" />
      </g>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 text-werewolf-moon">
      <path
        d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export interface PhaseBannerProps {
  readonly envelope: UiEnvelope;
  readonly advancing: boolean;
  readonly degraded: boolean;
}

export function PhaseBanner({ envelope, advancing, degraded }: PhaseBannerProps) {
  const { projectView, status } = envelope;
  const label = phaseLabel(projectView.phase, projectView.round);
  const terminal = isTerminalStatus(status);
  const day = label.dayNight === "天";
  const aiText = terminal ? "本局已结束" : aiStatusText(advancing, degraded);

  return (
    <section
      aria-label="当前阶段"
      className="rounded-2xl border border-werewolf-borderDark/40 bg-werewolf-surface px-5 py-4 sm:px-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <MoonIcon day={day} />
          <div>
            <h2 className="text-[20px] font-bold leading-tight text-werewolf-text sm:text-[26px]">
              {terminal ? "本局结束" : `${label.roundText} · ${label.phaseName}`}
            </h2>
            <p className="mt-0.5 text-[13px] text-werewolf-muted sm:text-sm">{label.helper}</p>
          </div>
        </div>
        <p
          className="flex items-center gap-2 text-[13px] font-medium text-werewolf-muted sm:text-sm"
          data-testid="ai-status"
          data-degraded={degraded ? "true" : "false"}
        >
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              degraded ? "bg-werewolf-amber" : "bg-werewolf-teal"
            }`}
          />
          {aiText}
        </p>
      </div>
      {degraded && !terminal ? (
        <p className="mt-3 rounded-xl border border-werewolf-borderDark/40 px-3 py-2 text-[13px] text-werewolf-muted">
          对局会继续正常进行，你可以继续观察与操作。
        </p>
      ) : null}
    </section>
  );
}
