import type { CitedBullet } from "@/lib/schema";
import CitedList from "./CitedList";

function Column({
  title,
  tone,
  items,
  delay,
}: {
  title: string;
  tone: "buy" | "sell";
  items: CitedBullet[];
  delay: number;
}) {
  const accent = tone === "buy" ? "bg-buy" : "bg-sell";
  const text = tone === "buy" ? "text-buy" : "text-sell";
  return (
    <div className="print-break-avoid relative pl-5">
      <span
        aria-hidden="true"
        className={`rule-in absolute top-1 bottom-1 left-0 w-[3px] origin-top ${accent}`}
        style={{ "--d": `${delay}ms`, animationName: "rule-in", transformOrigin: "top" } as React.CSSProperties}
      />
      <h3 className="mb-3 flex items-center gap-2">
        {/* Label carries the meaning; the accent colour only reinforces it. */}
        <span className={`text-[11px] font-semibold tracking-[0.16em] uppercase ${text}`}>
          {title}
        </span>
        <span className="nums text-[11px] text-muted-2">{items.length}</span>
      </h3>
      <CitedList items={items} />
    </div>
  );
}

export default function BullBearColumns({
  bullCase,
  bearCase,
}: {
  bullCase: CitedBullet[];
  bearCase: CitedBullet[];
}) {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-10">
      <Column title="Bull Case" tone="buy" items={bullCase} delay={60} />
      <Column title="Bear Case" tone="sell" items={bearCase} delay={140} />
    </div>
  );
}
