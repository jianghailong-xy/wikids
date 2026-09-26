/**
 * The lobby feature illustration (docs/design/werewolf/visual-spec.md §3.1,
 * §4 shapes): a soft moonlit village — moon, rounded treetops, warm windows,
 * a few stars, matte paper feel. Deliberately gentle: no horror, no weapons,
 * no role symbols, and it never sits behind UI text.
 *
 * Inline SVG rather than a bitmap: it scales with the card, costs no request,
 * and cannot be mistaken for the design reference PNGs.
 */
export function NightVillage({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 220"
      role="img"
      aria-label="月光下的小村庄插画"
      className={className}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="ww-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2350" />
          <stop offset="100%" stopColor="#151A38" />
        </linearGradient>
        <radialGradient id="ww-moon-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#BDD9FF" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#BDD9FF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="320" height="220" fill="url(#ww-sky)" />

      <g fill="#EAF1FF" opacity="0.75">
        <circle cx="46" cy="34" r="1.6" />
        <circle cx="88" cy="66" r="1.2" />
        <circle cx="266" cy="40" r="1.5" />
        <circle cx="212" cy="24" r="1.1" />
        <circle cx="150" cy="30" r="1.3" />
        <circle cx="292" cy="86" r="1.2" />
      </g>

      <circle cx="242" cy="62" r="46" fill="url(#ww-moon-glow)" />
      <circle cx="242" cy="62" r="22" fill="#BDD9FF" opacity="0.92" />
      <circle cx="234" cy="56" r="4" fill="#A9C6EE" opacity="0.6" />
      <circle cx="248" cy="70" r="3" fill="#A9C6EE" opacity="0.5" />

      <path d="M0 178c34-16 62-6 92-14s58-20 92-12 74 4 136-8v76H0Z" fill="#1F2850" />

      <g>
        <rect x="70" y="140" width="52" height="42" rx="6" fill="#2E3968" />
        <path d="M62 142 L96 118 L130 142 Z" fill="#3A477E" />
        <rect x="82" y="156" width="12" height="12" rx="2.5" fill="#F4BF69" opacity="0.92" />
        <rect x="100" y="156" width="12" height="12" rx="2.5" fill="#F4BF69" opacity="0.7" />
      </g>

      <g>
        <rect x="146" y="130" width="66" height="52" rx="7" fill="#333F74" />
        <path d="M136 132 L179 102 L222 132 Z" fill="#41508C" />
        <rect x="160" y="150" width="14" height="14" rx="3" fill="#F4BF69" />
        <rect x="184" y="150" width="14" height="14" rx="3" fill="#F4BF69" opacity="0.65" />
        <rect x="175" y="168" width="10" height="14" rx="3" fill="#242D52" />
      </g>

      <g fill="#2B5F55">
        <path d="M40 182c0-16 10-26 22-30-12-4-22-14-22-30 0-18 14-32 32-32s32 14 32 32c0 16-10 26-22 30 12 4 22 14 22 30Z" />
      </g>
      <g fill="#356F63">
        <path d="M248 182c0-12 8-20 17-23-9-3-17-11-17-23 0-14 11-25 25-25s25 11 25 25c0 12-8 20-17 23 9 3 17 11 17 23Z" />
      </g>

      <g fill="#1B2246">
        <path d="M0 196c22-10 46-4 70-6s48-10 74-6 58 8 92 2 62-4 84 2v32H0Z" />
      </g>
      <g fill="#F4BF69" opacity="0.5">
        <circle cx="118" cy="188" r="2" />
        <circle cx="206" cy="190" r="2" />
      </g>
    </svg>
  );
}
