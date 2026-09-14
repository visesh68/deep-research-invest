import type { Thesis } from "@/lib/schema";

const STYLES: Record<Thesis["rating"], string> = {
  Buy: "text-buy bg-buy-bg ring-buy/15",
  Hold: "text-hold bg-hold-bg ring-hold/15",
  Sell: "text-sell bg-sell-bg ring-sell/15",
};

// The buy/hold/sell hues sit in the CVD floor band (hold↔buy ΔE 6.0 under
// protanopia), so the rating is never carried by colour alone: the word is
// always present and the glyph gives a second, non-colour cue.
const GLYPH: Record<Thesis["rating"], React.ReactNode> = {
  Buy: <path d="M7 2.5 L11.5 9 H2.5 Z" />,
  Hold: <rect x="2.5" y="5.2" width="9" height="2.6" rx="0.6" />,
  Sell: <path d="M7 10.5 L2.5 4 H11.5 Z" />,
};

export default function RatingBadge({ rating }: { rating: Thesis["rating"] }) {
  return (
    <span
      className={`reveal inline-flex items-center gap-2 rounded-sm px-3.5 py-2 text-sm font-semibold tracking-[0.14em] uppercase ring-1 ring-inset ${STYLES[rating]}`}
      style={{ "--d": "240ms" } as React.CSSProperties}
    >
      <svg viewBox="0 0 14 13" className="size-3 fill-current" aria-hidden="true">
        {GLYPH[rating]}
      </svg>
      {rating}
    </span>
  );
}
