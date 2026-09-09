"use client";
import type { Scored } from "@/lib/scoring";
import { scoreColor } from "./MapView";

export default function ResultsList({
  top, passed, selected, onSelect,
}: {
  top: Scored[]; passed: number;
  selected: Scored | null; onSelect: (s: Scored) => void;
}) {
  return (
    <div className="h-full flex flex-col" style={{ background: "var(--panel)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink)" }}>
          Ranked sites
        </div>
        <div className="text-[11px] mt-1" style={{ color: "var(--ink-3)" }}>
          {passed.toLocaleString()} clear every screen. Showing top {Math.min(top.length, 200)}.
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {top.length === 0 && (
          <div className="px-4 py-8 text-[12px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
            No parcel clears these screens. Loosen the traffic minimum, raise the budget,
            or reduce the land requirement.
          </div>
        )}
        {top.map((s, i) => {
          const sel = selected?.site.parcel_id === s.site.parcel_id;
          return (
            <button key={s.site.parcel_id + i} onClick={() => onSelect(s)}
              className="w-full text-left px-4 py-2.5 transition-colors"
              style={{
                borderBottom: "1px solid var(--line-soft)",
                background: sel ? "var(--accent-dim)" : "transparent",
              }}>
              <div className="flex items-center gap-2.5">
                <span className="mono text-[10px] w-5 shrink-0" style={{ color: "var(--ink-3)" }}>
                  {i + 1}
                </span>
                <span className="mono text-[14px] font-semibold w-9 shrink-0"
                  style={{ color: scoreColor(s.total) }}>{s.total.toFixed(0)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] truncate" style={{ color: "var(--ink)" }}>
                    {s.site.address || "Unaddressed parcel"}
                  </span>
                  <span className="block text-[10.5px] truncate" style={{ color: "var(--ink-3)" }}>
                    {s.site.city || s.site.county} · {s.site.acres} ac ·{" "}
                    {s.site.aadt ? `${(s.site.aadt / 1000).toFixed(0)}k AADT` : "no count"} ·{" "}
                    {s.site.express_3mi} tunnel{s.site.express_3mi === 1 ? "" : "s"} in 3 mi
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
