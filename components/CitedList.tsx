import type { CitedBullet } from "@/lib/schema";
import CiteMarks from "./CiteMarks";

export default function CitedList({ items }: { items: CitedBullet[] }) {
  return (
    <ul className="space-y-3 text-[15px] leading-[1.65]">
      {items.map((item, i) => (
        <li
          key={i}
          className="reveal group flex gap-3 text-ink-2"
          style={{ "--i": i + 1 } as React.CSSProperties}
        >
          <span
            aria-hidden="true"
            className="mt-[9px] h-px w-3 shrink-0 bg-hairline-strong transition-all duration-300 group-hover:w-5 group-hover:bg-navy"
          />
          <span>
            {item.text}
            <CiteMarks sourceIds={item.sourceIds} />
          </span>
        </li>
      ))}
    </ul>
  );
}
