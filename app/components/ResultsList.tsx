"use client";
import { DEFAULT_INPUTS, type Inputs, type Scored } from "@/lib/scoring";
import { scoreColor } from "./MapView";
import { acres, countyLabel, grade, kShort, placeName, siteTitle, streetAddress } from "./plain";

export default function ResultsList({
  top, passed, distinct, selected, onSelect, inputs = DEFAULT_INPUTS,
}: {
  top: Scored[]; passed: number; distinct: number;
  selected: Scored | null; onSelect: (s: Scored) => void;
  /** The settings the list was ranked with, for the radius and spread wording. */
  inputs?: Pick<Inputs, "compRing" | "spreadMi">;
}) {
  const ring = inputs.compRing;
  const spread = inputs.spreadMi;
  return (
    <div className="h-full flex flex-col" style={{ background: "var(--panel)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink)" }}>
          Best spots
        </div>
        <div className="text-[11.5px] mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>
          {passed.toLocaleString()} commercial lots pass your filters
          {distinct < passed && <>, in {distinct.toLocaleString()} separate areas</>}.
          Showing the top {Math.min(top.length, 200)}. Lots are not necessarily for sale.
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {top.length === 0 && (
          <div className="px-4 py-8 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
            No lot passes these filters. Try a lower traffic minimum, a bigger budget,
            or less land.
          </div>
        )}
        {top.map((s, i) => {
          const sel = selected?.site.uid === s.site.uid;
          const g = grade(s.total);
          const site = s.site;
          const tunnels = ring === 1 ? site.express_1mi : ring === 3 ? site.express_3mi : site.express_5mi;
          return (
            <button key={site.uid} onClick={() => onSelect(s)}
              className="w-full text-left px-4 py-2.5 transition-colors"
              style={{
                borderBottom: "1px solid var(--line-soft)",
                background: sel ? "var(--accent-dim)" : "transparent",
              }}>
              <div className="flex items-center gap-2.5">
                <span className="mono text-[10px] w-5 shrink-0" style={{ color: "var(--ink-3)" }}>
                  {i + 1}
                </span>
                <span className="w-12 shrink-0 leading-tight">
                  <span className="block mono text-[14px] font-semibold" style={{ color: scoreColor(g.n) }}>{g.n}</span>
                  <span className="block text-[10px]" style={{ color: scoreColor(g.n) }}>{g.word.replace(" spot", "")}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] truncate" style={{ color: "var(--ink)" }}>
                    {siteTitle(site)}
                  </span>
                  <span className="block text-[11px] leading-snug mt-0.5" style={{ color: "var(--ink-3)" }}>
                    {streetAddress(site.address) && <>{placeName(site) ?? `${countyLabel(site.county)} County`} · </>}
                    {acres(site.acres)} ac ·{" "}
                    {site.aadt ? `${kShort(site.aadt)} cars/day` : "no traffic count"} ·{" "}
                    {tunnels === 0 ? "no express washes" : `${tunnels} express wash${tunnels === 1 ? "" : "es"}`} within {ring} mi
                    {/* Spread hides lower scoring lots this close to this one. */}
                    {s.nearby > 0 && spread > 0 && (
                      <span style={{ color: "var(--ink-2)" }}>
                        {" "}· +{s.nearby} more {s.nearby === 1 ? "lot" : "lots"} within {spread} {spread === 1 ? "mile" : "miles"}
                      </span>
                    )}
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
