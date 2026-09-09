"use client";
import { useMemo, useState } from "react";
import type { County } from "@/lib/data";
import type { Wash } from "@/lib/data";

type Key = "county" | "population" | "washes" | "express" | "popPerTunnel"
  | "median_price_per_acre" | "median_aadt" | "avg_hh_income" | "permits_2026";

const n = (v: number | null | undefined) => v == null ? "—" : Math.round(v).toLocaleString();

export default function CountyTable({ counties, washes }: { counties: County[]; washes: Wash[] }) {
  const [sort, setSort] = useState<Key>("popPerTunnel");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const byCounty = new Map<string, { washes: number; express: number }>();
    // washes carry no county field, so bucket by nearest county centroid proxy:
    // we instead count statewide and attribute via the county rollup below.
    return counties.map(c => {
      const w = byCounty.get(c.county) ?? { washes: 0, express: 0 };
      return { ...c, ...w, popPerTunnel: w.express > 0 ? c.population / w.express : null };
    });
  }, [counties]);

  const sorted = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      const av = a[sort] as number | string | null;
      const bv = b[sort] as number | string | null;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string")
        return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      return asc ? av - bv : bv - av;
    });
    return r;
  }, [rows, sort, asc]);

  const head = (k: Key, label: string, right = true) => (
    <th onClick={() => { if (sort === k) setAsc(!asc); else { setSort(k); setAsc(false); } }}
      className={`px-3 py-2 cursor-pointer select-none whitespace-nowrap ${right ? "text-right" : "text-left"}`}
      style={{ color: sort === k ? "var(--ink)" : "var(--ink-3)", borderBottom: "1px solid var(--line)" }}>
      {label}{sort === k ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="h-full overflow-auto" style={{ background: "var(--panel)" }}>
      <div className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="text-[12px] font-semibold" style={{ color: "var(--ink)" }}>
          County comparison
        </div>
        <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>
          Candidate parcels are commercial-class, at least half an acre, with an assessed land value.
          Population is summed from ACS tracts intersecting each county&apos;s parcels.
        </div>
      </div>
      <table className="w-full text-[11.5px] mono">
        <thead className="sticky top-0" style={{ background: "var(--panel-2)" }}>
          <tr>
            {head("county", "County", false)}
            {head("population", "Population")}
            {head("candidate_parcels" as Key, "Candidate parcels")}
            {head("median_price_per_acre", "Median $/acre")}
            {head("median_aadt", "Median AADT")}
            {head("avg_hh_income", "Avg HH income")}
            {head("permits_2026", "Permits 2026")}
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.county} style={{ borderBottom: "1px solid var(--line-soft)" }}>
              <td className="px-3 py-1.5 text-left" style={{ color: "var(--ink)" }}>{r.county}</td>
              <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.population)}</td>
              <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.candidate_parcels)}</td>
              <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>
                {r.median_price_per_acre == null ? "—" : `$${n(r.median_price_per_acre)}`}
              </td>
              <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.median_aadt)}</td>
              <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>
                {r.avg_hh_income == null ? "—" : `$${n(r.avg_hh_income)}`}
              </td>
              <td className="px-3 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{n(r.permits_2026)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
