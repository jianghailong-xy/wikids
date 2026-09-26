"use client";

/**
 * The public event timeline (docs/design/werewolf/visual-spec.md §3.2 右栏,
 * §3.3 公开事件, §6 公开事件 row).
 *
 * It renders only authorized public events — every row comes from the
 * session's `increments`, which the server has already filtered to public
 * facts. Private results (a seer check, a teammate) are never rendered here,
 * and there is no path by which they could reach a row.
 *
 * Oldest is at the top and newest at the bottom on every viewport. Mobile
 * shows the two most recent rows with a 查看全部 control; expanding does not
 * reorder anything, and new rows never yank the reader's scroll position.
 */
import { useState } from "react";
import type { TimelineEntry } from "@/lib/game-ui/labels";
import { FOCUS_RING } from "./constants";

/** How many rows the mobile card shows before 查看全部. */
const RECENT_ON_MOBILE = 2;

export interface PublicTimelineProps {
  readonly entries: readonly TimelineEntry[];
  /** Rows that arrived after first paint get a quiet emphasis (§6). */
  readonly freshCount: number;
}

export function PublicTimeline({ entries, freshCount }: PublicTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const hiddenOnMobile = Math.max(0, entries.length - RECENT_ON_MOBILE);

  return (
    <section
      aria-labelledby="timeline-heading"
      data-testid="public-timeline"
      className="rounded-2xl bg-werewolf-paper p-4 text-werewolf-ink sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="timeline-heading" className="text-[16px] font-semibold sm:text-[18px]">
          公开事件
        </h2>
        <div className="flex items-center gap-2">
          {freshCount > 0 ? (
            <span
              className="rounded-full bg-werewolf-moon/30 px-2 py-px text-[11px] font-semibold text-werewolf-ink"
              data-testid="timeline-fresh"
            >
              新增 {freshCount}
            </span>
          ) : null}
          {hiddenOnMobile > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-controls="timeline-list"
              className={`rounded-lg px-2 py-1 text-[12px] font-semibold text-[#1D4ED8] lg:hidden ${FOCUS_RING}`}
            >
              {expanded ? "收起" : "查看全部"}
            </button>
          ) : null}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-[13px] text-werewolf-paperMuted">公开记录将在这里出现。</p>
      ) : (
        <ol
          id="timeline-list"
          data-testid="timeline-list"
          className="mt-3 max-h-none space-y-2 lg:max-h-[26rem] lg:overflow-y-auto lg:pr-1"
        >
          {entries.map((entry, index) => {
            const collapsedOnMobile = !expanded && index < hiddenOnMobile;
            const isFresh = index >= entries.length - freshCount;
            return (
              <li
                key={entry.key}
                data-testid="timeline-entry"
                data-kind={entry.kind}
                data-round={entry.round}
                data-phase={entry.phase ?? ""}
                className={`relative flex gap-2 rounded-lg py-1 pl-3 text-[13px] leading-relaxed sm:text-sm ${
                  collapsedOnMobile ? "hidden lg:flex" : "flex"
                } ${isFresh ? "bg-werewolf-moon/15" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    entry.kind === "result"
                      ? "bg-werewolf-amber"
                      : entry.kind === "elimination"
                        ? "bg-[#B4553F]"
                        : "bg-werewolf-borderDark"
                  }`}
                />
                <span className={entry.kind === "speech" ? "break-words" : ""}>{entry.text}</span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-3 rounded-lg bg-werewolf-moon/15 px-3 py-2 text-[12px] text-werewolf-paperMuted">
        这里只展示公开信息。
      </p>
    </section>
  );
}
