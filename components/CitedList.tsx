import type { CitedBullet } from "@/lib/schema";

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
            {item.sourceIds.length > 0 && (
              <span className="ml-1 inline-flex gap-0.5 align-super">
                {item.sourceIds.map((id) => (
                  <a
                    key={id}
                    href={`#src-${id}`}
                    className="nums rounded-[3px] bg-accent-bg px-1 text-[10px] font-medium text-accent no-underline transition-colors duration-150 hover:bg-accent hover:text-white"
                    aria-label={`Source ${id}`}
                  >
                    {id}
                  </a>
                ))}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
