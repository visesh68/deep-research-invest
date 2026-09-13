import type { CitedBullet } from "@/lib/schema";
import CitedList from "./CitedList";

export default function BullBearColumns({
  bullCase,
  bearCase,
}: {
  bullCase: CitedBullet[];
  bearCase: CitedBullet[];
}) {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
      <div className="border-l-2 border-buy pl-4">
        <h3 className="font-serif-display mb-2 text-lg font-semibold text-navy">Bull Case</h3>
        <CitedList items={bullCase} />
      </div>
      <div className="border-l-2 border-sell pl-4">
        <h3 className="font-serif-display mb-2 text-lg font-semibold text-navy">Bear Case</h3>
        <CitedList items={bearCase} />
      </div>
    </div>
  );
}
