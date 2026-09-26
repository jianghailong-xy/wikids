/**
 * The 狼人杀 feature card (docs/design/werewolf/visual-spec.md §3.1 item 3).
 *
 * Priority order the layout keeps: game name + AI attribute → player count and
 * role configuration → the start action → (below) the AI companions. The card
 * states the frozen quick6-v1 configuration as information (2 狼人 · 1 预言家 ·
 * 3 平民) and never promises a duration, a timer or a role the rules do not
 * have. The illustration carries no seats and no identities.
 */
import Link from "next/link";
import { NightVillage } from "./night-village";
import { StartGameButton } from "./start-game-button";

export interface LobbyHeroProps {
  /** Where 了解规则 points (the werewolf page's rules section). */
  readonly rulesHref?: string;
}

export function LobbyHero({ rulesHref = "/games/werewolf#rules" }: LobbyHeroProps) {
  return (
    <section
      aria-labelledby="lobby-hero-heading"
      data-testid="lobby-hero"
      className="overflow-hidden rounded-[24px] bg-werewolf-bg sm:rounded-[28px]"
    >
      <div className="grid gap-0 lg:grid-cols-[55fr_45fr]">
        <div className="p-5 sm:p-8 lg:p-10">
          <span className="inline-flex items-center rounded-full border border-werewolf-borderDark/60 px-3 py-1 text-[12px] font-semibold text-werewolf-moon">
            AI 对局
          </span>
          <h1
            id="lobby-hero-heading"
            className="mt-4 text-[34px] font-bold leading-tight text-werewolf-text sm:text-[44px] lg:text-[52px]"
          >
            狼人杀
          </h1>
          <p className="mt-2 text-[18px] font-semibold text-werewolf-moon">6 人极速局</p>
          <p className="mt-1 text-[16px] text-werewolf-muted">1 位玩家 + 5 位 AI</p>

          <p className="mt-4 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-werewolf-borderDark/50 px-3 py-2 text-[14px] text-werewolf-text">
            <span className="font-semibold">2 狼人 · 1 预言家 · 3 平民</span>
            <span className="text-werewolf-muted">每局随机分配，身份只对自己可见</span>
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <StartGameButton className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-werewolf-amber px-6 text-[18px] font-semibold text-werewolf-ink transition-colors hover:bg-werewolf-amberHover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-werewolf-moon focus-visible:ring-offset-2 focus-visible:ring-offset-werewolf-bg sm:w-auto" />
            <Link
              href={rulesHref}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-werewolf-borderDark/70 px-5 text-[16px] font-semibold text-werewolf-moon transition-colors hover:bg-werewolf-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-werewolf-moon focus-visible:ring-offset-2 focus-visible:ring-offset-werewolf-bg"
            >
              了解规则
            </Link>
          </div>
        </div>

        <div className="relative min-h-[190px] sm:min-h-[240px] lg:min-h-[320px]">
          <NightVillage className="h-full w-full" />
        </div>
      </div>
    </section>
  );
}
