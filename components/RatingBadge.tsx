import type { Thesis } from "@/lib/schema";

const STYLES: Record<Thesis["rating"], string> = {
  Buy: "text-buy bg-buy-bg",
  Hold: "text-hold bg-hold-bg",
  Sell: "text-sell bg-sell-bg",
};

export default function RatingBadge({ rating }: { rating: Thesis["rating"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-3 py-1 text-sm font-semibold tracking-wide uppercase ${STYLES[rating]}`}
    >
      {rating}
    </span>
  );
}
