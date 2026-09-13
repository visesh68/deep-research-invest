import type { CitedBullet } from "@/lib/schema";

export default function CitedList({ items }: { items: CitedBullet[] }) {
  return (
    <ul className="space-y-2 text-[15px] leading-relaxed">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-[2px] text-muted select-none">—</span>
          <span>
            {item.text}
            {item.sourceIds.length > 0 && (
              <sup className="ml-0.5">
                {item.sourceIds.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ","}
                    <a href={`#src-${id}`} className="text-navy no-underline hover:underline">
                      {id}
                    </a>
                  </span>
                ))}
              </sup>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
