import type { CitedBullet } from "@/lib/schema";
import CitedList from "./CitedList";

export default function CatalystsRisks({
  catalysts,
  risks,
}: {
  catalysts: CitedBullet[];
  risks: CitedBullet[];
}) {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
      <div>
        <h3 className="font-serif-display mb-2 text-lg font-semibold text-navy">Catalysts</h3>
        <CitedList items={catalysts} />
      </div>
      <div>
        <h3 className="font-serif-display mb-2 text-lg font-semibold text-navy">Risks</h3>
        <CitedList items={risks} />
      </div>
    </div>
  );
}
