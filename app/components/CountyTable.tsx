"use client";
import { useMemo, useState } from "react";
import type { County } from "@/lib/data";
import { countyLabel } from "./plain";
import { nonMarket, nonMarketNote, noLotsNote } from "./CountyPanel";

type Key = keyof County;

const n = (v: number | null | undefined) =>
  v == null ? "n/a" : Math.round(v).toLocaleString();

const signed = (v: number | null | undefined, suffix = "") =>
  v == null ? "n/a" : `${v > 0 ? "+" : ""}${suffix === "%" ? v.toFixed(Math.abs(v) < 10 ? 1 : 0) : Math.round(v).toLocaleString()}${suffix}`;

/**
 * Industry guidance puts a healthy express market at 25,000 to 35,000 people
 * per tunnel. Below that a market is crowded; well above it has room for more.
 * No published Utah figure exists, so this is computed here.
 */
function read(popPerTunnel: number | null, express: number) {
  if (express === 0) return { label: "no express wash yet", color: "var(--accent)" };
  if (popPerTunnel == null) return { label: "unknown", color: "var(--ink-3)" };
  if (popPerTunnel > 35_000) return { label: "room for more", color: "var(--good)" };
  if (popPerTunnel >= 25_000) return { label: "balanced", color: "var(--warn)" };
  return { label: "crowded", color: "var(--bad)" };
}

export default function CountyTable({ counties }: { counties: County[] }) {
  const [sort, setSort] = useState<Key>("pop_per_tunnel");
  const [asc, setAsc] = useState(false);
  const [minPop, setMinPop] = useState(0);
  // The 2020 to 2025 columns arrive with the Census estimates step; hide them
  // rather than print a column of n/a before that data exists.
  const hasGrowth = counties.some(c => c.growth_pct != null);
  const hasMoves = counties.some(c => c.net_domestic_2020_2025 != null);

  const rows = useMemo(() => {
    const r = counties.filter(c => c.population >= minPop);
    // A land price the county did not set at market value sorts with the
    // blanks, not at the cheap end where it would look like a bargain.
    const val = (c: County) => sort === "median_price_per_acre" && nonMarket(c) ? null : c[sort];
    r.sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string")
        return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      return asc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return r;
  }, [counties, sort, asc, minPop]);

  const notes = [nonMarketNote(rows), noLotsNote(rows)].filter(Boolean);

  const head = (k: Key, label: string, right = true) => (
    <th onClick={() => { if (sort === k) setAsc(!asc); else { setSort(k); setAsc(false); } }}
      className={`px-3 py-2 cursor-pointer select-none whitespace-nowrap font-normal ${right ? "text-right" : "text-left"}`}
      style={{ color: sort === k ? "var(--ink)" : "var(--ink-3)", borderBottom: "1px solid var(--line)" }}>
      {label}{sort === k ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="h-full overflow-auto" style={{ background: "var(--panel)" }}>
      <div className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="text-[12px] font-semibold" style={{ color: "var(--ink)" }}>
          Which counties have room for another car wash
        </div>
        <p className="text-[11px] mt-1.5 leading-relaxed max-w-3xl" style={{ color: "var(--ink-2)" }}>
          People per express wash is how the industry judges whether a market is crowded.
          No published Utah figure exists, so it is worked out here from Census county
          population and the express tunnel washes on the map. About 25,000 to 35,000 people
          per express wash is healthy. Car wash counts come from OpenStreetMap and Overture
          Maps, which miss some washes, so treat small county numbers as a rough guide. Tap
          or click a column heading to sort.
        </p>
        <label className="flex items-center gap-2 mt-2.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
          <input type="checkbox" checked={minPop > 0}
            onChange={e => setMinPop(e.target.checked ? 30_000 : 0)}
            className="accent-[color:var(--accent)] w-3.5 h-3.5" />
          hide counties under 30,000 people
        </label>
      </div>
      <table className="w-full text-[11.5px] mono">
        <thead className="sticky top-0 z-10" style={{ background: "var(--panel-2)" }}>
          <tr>
            {head("county", "County", false)}
            {head("population", hasGrowth ? "People (2025)" : "People")}
            {hasGrowth && head("growth_pct", "Grew since 2020")}
            {hasMoves && head("net_domestic_2020_2025", "Moved in, net")}
            {head("washes", "Car washes")}
            {head("express", "Express washes")}
            {head("pop_per_tunnel", "People per express wash")}
            <th className="px-3 py-2 text-left font-normal"
              style={{ color: "var(--ink-3)", borderBottom: "1px solid var(--line)" }}>How crowded</th>
            {head("candidate_parcels", "Lots scored")}
            {head("median_price_per_acre", "Land price per acre")}
            {head("median_aadt", "Cars per day past a typical lot")}
            {head("permits_2026", "New homes permitted in 2026")}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const v = read(r.pop_per_tunnel, r.express);
            return (
              <tr key={r.county} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <td className="px-3 py-1.5 text-left whitespace-nowrap" style={{ color: "var(--ink)" }}>{countyLabel(r.county)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.population)}</td>
                {hasGrowth && (
                  <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{signed(r.growth_pct, "%")}</td>
                )}
                {hasMoves && (
                  <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{signed(r.net_domestic_2020_2025)}</td>
                )}
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.washes)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.express)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink)" }}>
                  {r.pop_per_tunnel == null ? "none" : n(r.pop_per_tunnel)}
                </td>
                <td className="px-3 py-1.5 text-left whitespace-nowrap" style={{ color: v.color }}>{v.label}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>
                  {r.candidate_parcels ? n(r.candidate_parcels) : "none listed"}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap" style={{ color: "var(--ink-2)" }}>
                  {nonMarket(r) ? "not comparable"
                    : r.median_price_per_acre == null ? "n/a" : `$${n(r.median_price_per_acre)}`}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.median_aadt)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.permits_2026)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-3 text-[10.5px] leading-relaxed max-w-3xl space-y-1.5" style={{ color: "var(--ink-3)" }}>
        {notes.map(t => <p key={t}>{t}</p>)}
        {hasMoves && (
          <p>
            Moved in, net: people who moved to the county from elsewhere in the US minus those
            who moved away, April 2020 to July 2025, from Census population estimates.
          </p>
        )}
        <p>
          Land price per acre is the typical county tax value per acre of the lots scored
          in that county. Asking prices are usually higher.
        </p>
      </div>
    </div>
  );
}
