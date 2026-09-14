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
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-10">
      <div className="print-break-avoid">
        <h3 className="mb-3 flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.16em] text-navy uppercase">
            Catalysts
          </span>
          <span className="nums text-[11px] text-muted-2">{catalysts.length}</span>
        </h3>
        <CitedList items={catalysts} />
      </div>
      <div className="print-break-avoid">
        <h3 className="mb-3 flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.16em] text-navy uppercase">
            Risks
          </span>
          <span className="nums text-[11px] text-muted-2">{risks.length}</span>
        </h3>
        <CitedList items={risks} />
      </div>
    </div>
  );
}
