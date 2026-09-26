import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ActiveGameCard } from "@/components/games/active-game-card";
import { AiRoster } from "@/components/games/ai-roster";
import { LobbyHero } from "@/components/games/lobby-hero";
import { loadActiveGame } from "@/lib/game-sessions";

export const metadata: Metadata = {
  title: "狼人杀 — Wikids AI 游戏",
  description: "6 人极速局：1 位玩家 + 5 位 AI，2 狼人 / 1 预言家 / 3 平民。",
};

export const dynamic = "force-dynamic";

/**
 * The werewolf page: the game's own entry — start or continue a game, plus
 * the rules the lobby advertises. It is where the match board's 规则 link and
 * the result panel's 再来一局 land.
 */
export default async function WerewolfPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in?callbackUrl=%2Fgames%2Fwerewolf");
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
        <Link href="/games" className="hover:text-slate-900">
          AI 游戏
        </Link>
        <span className="px-1.5" aria-hidden="true">
          /
        </span>
        <span className="font-medium text-slate-900">狼人杀</span>
      </nav>

      <div className="mt-3">
        <h2 className="text-[28px] font-bold text-slate-900 sm:text-[40px]">一起玩，动脑想</h2>
        <p className="mt-2 text-[16px] text-slate-600 sm:text-[18px]">
          一晚一天，靠公开发言与投票找出狼人。
        </p>
      </div>

      <div className="mt-6">
        <LobbyHero rulesHref="#rules" />
      </div>

      {active !== null ? (
        <div className="mt-6" data-testid="lobby-active">
          <ActiveGameCard session={active} />
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5" data-testid="no-active-game">
          <h3 className="text-[16px] font-semibold text-slate-900">还没有进行中的对局</h3>
          <p className="mt-1 text-[13px] text-slate-600">
            每位玩家同时只能有一局进行中的对局。开始后可以随时离开，回来继续；上面的
            「开始 AI 对局」就是入口。
          </p>
        </div>
      )}

      <section id="rules" aria-labelledby="rules-heading" className="mt-10 scroll-mt-6">
        <h2 id="rules-heading" className="text-[20px] font-bold text-slate-900 sm:text-[24px]">
          玩法规则
        </h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            {
              term: "人数与身份",
              detail: "固定 6 席：1 位玩家 + 5 位 AI。全局 2 狼人、1 预言家、3 平民，每局随机分配。",
            },
            {
              term: "夜晚",
              detail: "狼人选择一位目标，预言家查验一位玩家。夜晚不会有公开发言。",
            },
            {
              term: "白天发言",
              detail: "天亮后按座位顺序轮流发言，可以发言或跳过。",
            },
            {
              term: "投票",
              detail: "所有在场玩家各投一位其他玩家，票数唯一最高者离场，平票则无人离场。",
            },
            {
              term: "胜负",
              detail: "狼人全部离场则好人胜利；狼人数量不少于其他玩家则狼人胜利。",
            },
            {
              term: "可见范围",
              detail: "身份只对自己可见；离场不揭身份，只有终局才会公开全部身份。",
            },
          ].map((item) => (
            <div key={item.term} className="rounded-2xl border border-slate-200 bg-white p-4">
              <dt className="text-[15px] font-semibold text-slate-900">{item.term}</dt>
              <dd className="mt-1 text-[14px] leading-relaxed text-slate-600">{item.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12px] text-slate-500">
          规则版本 quick6-v1。对局中不会出现计时、道具、语音或额外身份。
        </p>
      </section>

      <div className="mt-10">
        <AiRoster />
      </div>
    </div>
  );
}
