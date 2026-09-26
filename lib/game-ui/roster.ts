/**
 * The fixed public seat roster (docs/design/werewolf/visual-spec.md §6).
 *
 * The five AI personalities and their accessories are public, fixed and
 * unrelated to the secret roles: the spec forbids any surface where an
 * appearance, species or colour implies a faction ("禁止把兔/熊/鸟/鹿/猫映射为
 * 固定阵营"). A game's role deal never touches this module, and these names
 * never travel to the server — the wire carries seat ids only.
 *
 * The seat shown as "我" is the human seat the server reports, so a game
 * whose human sits anywhere in 1..6 still reads correctly; the five AI
 * personas fill the remaining seats in ascending seat order.
 */

export interface AiPersona {
  readonly key: string;
  readonly name: string;
  /** Personality tag from §6 — a speech style, never a role hint. */
  readonly trait: string;
  /** The one character drawn in the neutral portrait. */
  readonly initial: string;
  /** The accessory named in §6, kept as a text label, not an image. */
  readonly accessory: string;
  /** Portrait tint (personality expression, never faction). */
  readonly portrait: string;
}

export const AI_PERSONAS: readonly AiPersona[] = [
  {
    key: "acheng",
    name: "阿橙",
    trait: "热情",
    initial: "橙",
    accessory: "琥珀围巾",
    portrait: "bg-[#F7D9C4] text-[#8A4B23] ring-[#E8B489]",
  },
  {
    key: "manman",
    name: "慢慢",
    trait: "细心",
    initial: "慢",
    accessory: "圆眼镜",
    portrait: "bg-[#E9DCC7] text-[#6B5330] ring-[#CBB794]",
  },
  {
    key: "diandian",
    name: "点点",
    trait: "好奇",
    initial: "点",
    accessory: "粉蓝羽饰",
    portrait: "bg-[#D8E6F7] text-[#2F5178] ring-[#AFC9E6]",
  },
  {
    key: "mumu",
    name: "木木",
    trait: "简洁",
    initial: "木",
    accessory: "青绿领饰",
    portrait: "bg-[#D6ECE6] text-[#28655A] ring-[#A6D4C7]",
  },
  {
    key: "tuantuan",
    name: "团团",
    trait: "爱表达",
    initial: "团",
    accessory: "月蓝帽子",
    portrait: "bg-[#E7E4F6] text-[#43407A] ring-[#C3BEE4]",
  },
];

export interface SeatDisplay {
  readonly seat: number;
  /** 1-based seat number exactly as the board shows it. */
  readonly label: string;
  readonly name: string;
  readonly isHuman: boolean;
  /** Present for AI seats only. */
  readonly persona: AiPersona | null;
}

const HUMAN_PORTRAIT = "bg-[#CFE0FA] text-[#1E3A6B] ring-[#9CBDEB]";

/** The human seat's neutral portrait tint (moon blue, §6). */
export function humanPortrait(): string {
  return HUMAN_PORTRAIT;
}

/**
 * Display identity for every seat of the game, derived from the human seat
 * the server reported. The AI personas keep their relative order, so the
 * same five personalities appear in every game even when the human is not
 * in seat 1.
 */
export function seatDisplays(humanSeat: number, seats: readonly number[]): SeatDisplay[] {
  const ordered = [...seats].sort((a, b) => a - b);
  let personaIndex = 0;
  return ordered.map((seat) => {
    const isHuman = seat === humanSeat;
    const persona = isHuman ? null : (AI_PERSONAS[personaIndex++] ?? null);
    return {
      seat,
      label: `${seat + 1} 号`,
      name: isHuman ? "我" : (persona?.name ?? `${seat + 1} 号`),
      isHuman,
      persona,
    };
  });
}

/** Display for one seat; falls back to the bare seat number. */
export function seatDisplayOf(
  seat: number,
  humanSeat: number,
  seats: readonly number[],
): SeatDisplay {
  return (
    seatDisplays(humanSeat, seats).find((display) => display.seat === seat) ?? {
      seat,
      label: `${seat + 1} 号`,
      name: `${seat + 1} 号`,
      isHuman: seat === humanSeat,
      persona: null,
    }
  );
}

/** `3 号 · 慢慢` — the summary form the action panel and timeline use. */
export function seatSummary(
  seat: number,
  humanSeat: number,
  seats: readonly number[],
): string {
  const display = seatDisplayOf(seat, humanSeat, seats);
  return `${display.label} · ${display.name}`;
}
