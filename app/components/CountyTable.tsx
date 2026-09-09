"use client";
import { useMemo, useState } from "react";
import type { County } from "@/lib/data";

type Key = keyof County;

const n = (v: number | null | undefined) =>
  v == null ? "—" : Math.round(v).toLocaleString();

/**
 * Industry guidance puts a healthy express market at 25,000 to 35,000 people
 * per tunnel. Below that a market is tight; well above it is under-served.
 * No published Utah figure exists, so this is computed here.
 */
function read(popPerTunnel: number | null, express: number) {
  if (express === 0) return { label: "no express tunnel", color: "var(--accent)" };
  if (popPerTunnel == null) return { label: "—", color: "var(--ink-3)" };
  if (popPerTunnel > 35_000) return { label: "under-served", color: "var(--good)" };
  if (popPerTunnel >= 25_000) return { label: "balanced", color: "var(--warn)" };
  return { label: "tight", color: "var(--bad)" };
}

export default function CountyTable({ counties }: { counties: County[] }) {
  const [sort, setSort] = useState<Key>("pop_per_tunnel");
  const [asc, setAsc] = useState(false);
  const [minPop, setMinPop] = useState(0);

  const rows = useMemo(() => {
    const r = counties.filter(c => c.population >= minPop);
    r.sort((a, b) => {
      const av = a[sort], bv = b[sort];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string")
        return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      return asc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return r;
  }, [counties, sort, asc, minPop]);

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
          County saturation and cost
        </div>
        <p className="text-[11px] mt-1.5 leading-relaxed max-w-3xl" style={{ color: "var(--ink-2)" }}>
          People per express tunnel is the saturation measure the industry uses, and no
          published Utah figure exists, so it is computed here from ACS county population
          and mapped express tunnels. Guidance puts a healthy market at 25,000 to 35,000
          per tunnel. Counts reflect what OpenStreetMap and Overture have mapped, so treat
          small-county numbers as indicative.
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
            {head("population", "Population")}
            {head("washes", "Wash facilities")}
            {head("express", "Express tunnels")}
            {head("pop_per_tunnel", "People per tunnel")}
            <th className="px-3 py-2 text-left font-normal"
              style={{ color: "var(--ink-3)", borderBottom: "1px solid var(--line)" }}>Read</th>
            {head("candidate_parcels", "Candidate parcels")}
            {head("median_price_per_acre", "Median $/acre")}
            {head("median_aadt", "Median AADT")}
            {head("permits_2026", "Permits 2026")}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const v = read(r.pop_per_tunnel, r.express);
            return (
              <tr key={r.county} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <td className="px-3 py-1.5 text-left" style={{ color: "var(--ink)" }}>{r.county}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.population)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.washes)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.express)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink)" }}>
                  {r.pop_per_tunnel == null ? "—" : n(r.pop_per_tunnel)}
                </td>
                <td className="px-3 py-1.5 text-left" style={{ color: v.color }}>{v.label}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.candidate_parcels)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>
                  {r.median_price_per_acre == null ? "—" : `$${n(r.median_price_per_acre)}`}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.median_aadt)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.permits_2026)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
