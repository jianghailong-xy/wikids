/**
 * The five AI companions (docs/design/werewolf/visual-spec.md §3.1 item 4).
 *
 * These five cards introduce the AI personalities — they are explicitly NOT a
 * seat grid and the heading says so. Every card carries the AI badge, and no
 * role word, faction colour or species-to-faction hint appears anywhere: the
 * appearances are fixed for the product and the identity deal is random each
 * game (§6 固定人格视觉表).
 */
import { AI_PERSONAS } from "@/lib/game-ui/roster";

export function AiRoster() {
  return (
    <section aria-labelledby="ai-roster-heading" data-testid="ai-roster">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ai-roster-heading" className="text-[20px] font-bold text-slate-900 sm:text-[24px]">
          认识你的 AI 伙伴
        </h2>
        <p className="text-[13px] text-slate-600">各有表达风格，身份每局随机</p>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {AI_PERSONAS.map((persona) => (
          <li
            key={persona.key}
            data-testid={`persona-${persona.key}`}
            className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4"
          >
            <span
              aria-hidden="true"
              className={`flex h-11 w-11 items-center justify-center rounded-full text-[17px] font-semibold ring-1 ${persona.portrait}`}
            >
              {persona.initial}
            </span>
            <p className="mt-3 flex items-center gap-2 text-[16px] font-semibold text-slate-900 sm:text-[18px]">
              {persona.name}
              <span className="rounded-full border border-slate-300 px-1.5 py-px text-[11px] font-medium text-slate-600">
                AI
              </span>
            </p>
            <p className="mt-1 text-[13px] text-slate-600">{persona.trait}</p>
            <p className="mt-1 text-[12px] text-slate-500">外观：{persona.accessory}</p>
          </li>
        ))}
      </ul>

      <p className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-[14px] font-medium text-brand-700">
        先听线索 · 再说理由 · 友好讨论
      </p>
    </section>
  );
}
