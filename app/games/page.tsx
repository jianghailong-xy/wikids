import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ActiveGameCard } from "@/components/games/active-game-card";
import { AiRoster } from "@/components/games/ai-roster";
import { LobbyHero } from "@/components/games/lobby-hero";
import { loadActiveGame } from "@/lib/game-sessions";

export const metadata: Metadata = {
  title: "AI 游戏 — Wikids",
  description: "和 AI 伙伴一起玩狼人杀：观察、表达、推理。",
};

// The lobby reads the player's own sessions, so it is per-user and never
// statically cached.
export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in?callbackUrl=%2Fgames");
  const active = await loadActiveGame(session.user.id);

  return (
    <div className="game-shell mx-auto w-full max-w-[1280px]">
      <nav aria-label="面包屑" className="text-[13px] text-slate-600">
        <Link href="/" className="hover:text-slate-900">
          首页
        </Link>
        <span className="px-1.5" aria-hidden="true">
          /
        </span>
        <span className="font-medium text-slate-900">AI 游戏</span>
      </nav>

      <div className="mt-3">
        <h2 className="text-[28px] font-bold text-slate-900 sm:text-[40px]">一起玩，动脑想</h2>
        <p className="mt-2 text-[16px] text-slate-600 sm:text-[18px]">
          和 AI 伙伴一起观察、表达、推理。
        </p>
      </div>

      <div className="mt-6">
        <LobbyHero />
      </div>

      {active !== null ? (
        <div className="mt-6" data-testid="lobby-active">
          <ActiveGameCard session={active} />
        </div>
      ) : null}

      <div className="mt-10">
        <AiRoster />
      </div>
    </div>
  );
}
