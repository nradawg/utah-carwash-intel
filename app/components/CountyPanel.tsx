"use client";
import { useMemo, useState } from "react";
import type { County } from "@/lib/data";
import { countyLabel } from "./plain";

/**
 * Industry guidance puts a healthy express market at 25,000-35,000 people per
 * tunnel. No published Utah figure exists, so this is computed from Census
 * county population and mapped express tunnels.
 */
export function saturation(popPerTunnel: number | null, express: number) {
  if (express === 0) return { label: "no express wash yet", color: "#4da3ff", rank: 4 };
  if (popPerTunnel == null) return { label: "unknown", color: "var(--ink-3)", rank: -1 };
  if (popPerTunnel > 35_000) return { label: "room for more", color: "#3fb950", rank: 3 };
  if (popPerTunnel >= 25_000) return { label: "balanced", color: "#d29922", rank: 2 };
  return { label: "crowded", color: "#f85149", rank: 1 };
}

/**
 * value_basis arrives with the county export; read it null-safe so older
 * counties.json files without it still load.
 */
export const nonMarket = (c: County) =>
  (c as County & { value_basis?: string | null }).value_basis === "non_market";

const names = (cs: County[]) => cs.map(c => countyLabel(c.county)).join(" and ");

/** One line on why a land price is left out, or null when none are. */
export function nonMarketNote(counties: County[]) {
  const cs = counties.filter(nonMarket);
  return cs.length
    ? `${names(cs)}: land price is not comparable, because the county does not value land at market prices.`
    : null;
}

/** One line on why some counties have no lots, or null when all have some. */
export function noLotsNote(counties: County[]) {
  const cs = counties.filter(c => !c.candidate_parcels);
  return cs.length
    ? `${names(cs)}: no lots are scored, because the county tax records do not say which land is commercial.`
    : null;
}

const k = (v: number | null | undefined) =>
  v == null ? "n/a" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
    : v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v));

const grew = (g: number | null | undefined) =>
  g == null ? "n/a" : `${g > 0 ? "+" : ""}${g.toFixed(Math.abs(g) < 10 ? 1 : 0)}%`;

export default function CountyPanel({
  counties, active, onPick,
}: {
  counties: County[]; active: string | null; onPick: (c: string | null) => void;
}) {
  const [hideSmall, setHideSmall] = useState(false);
  const hasGrowth = counties.some(c => c.growth_pct != null);

  const rows = useMemo(() => {
    const r = counties.filter(c => !hideSmall || c.population >= 30_000);
    // Room for more first, then by people per tunnel descending: the ranking a
    // developer actually cares about. Counties with no lots to show go last,
    // since tapping them cannot show anything.
    r.sort((a, b) => {
      if (!a.candidate_parcels !== !b.candidate_parcels) return a.candidate_parcels ? -1 : 1;
      const sa = saturation(a.pop_per_tunnel, a.express);
      const sb = saturation(b.pop_per_tunnel, b.express);
      if (sa.rank !== sb.rank) return sb.rank - sa.rank;
      return (b.pop_per_tunnel ?? 0) - (a.pop_per_tunnel ?? 0);
    });
    return r;
  }, [counties, hideSmall]);

  const notes = [nonMarketNote(rows), noLotsNote(rows)].filter(Boolean);

  // Headers wrap onto two or three lines: the panel is narrow and short
  // forms like "Land $/ac" did not read as words. Tight padding, and words in
  // the proportional font, keep the spelled out table inside the 326px desktop
  // panel without a sideways scroll.
  const th = "px-1 py-1.5 text-right font-normal font-sans align-bottom leading-tight";
  const td = "px-1 py-2 text-right";

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--panel)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="text-[11.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
          People per express wash is the county population divided by its express tunnel
          washes. About 25,000 to 35,000 is healthy, so a higher number means room for another.
          Tap a county to show only its lots.
        </div>
        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-2 cursor-pointer text-[11.5px] min-h-[44px] pr-3"
            style={{ color: "var(--ink-3)" }}>
            <input type="checkbox" checked={hideSmall} onChange={e => setHideSmall(e.target.checked)}
              className="accent-[color:var(--accent)] w-5 h-5 md:w-3.5 md:h-3.5" />
            hide under 30k people
          </label>
          {active && (
            <button onClick={() => onPick(null)} className="text-[11.5px] underline min-h-[44px]"
              style={{ color: "var(--accent)" }}>show all counties</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <table className="w-full text-[11px] mono">
          <thead className="sticky top-0" style={{ background: "var(--panel-2)" }}>
            <tr style={{ color: "var(--ink-3)" }}>
              <th className="pl-3 pr-1 py-1.5 text-left font-normal font-sans align-bottom">County</th>
              <th className={th}>People</th>
              {hasGrowth && <th className={th}>Grew since 2020</th>}
              <th className={th}>Express washes</th>
              <th className={th}>People per express wash</th>
              <th className={`${th} pr-3`}>Land price per acre</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const s = saturation(r.pop_per_tunnel, r.express);
              const on = active === r.county;
              const empty = !r.candidate_parcels;
              return (
                <tr key={r.county} onClick={empty ? undefined : () => onPick(on ? null : r.county)}
                  className={empty ? "" : "cursor-pointer"}
                  style={{
                    borderBottom: "1px solid var(--line-soft)",
                    background: on ? "var(--accent-dim)" : "transparent",
                  }}>
                  <td className="pl-3 pr-1 py-2 text-left font-sans" style={{ color: "var(--ink)" }}>
                    {countyLabel(r.county)}
                    <span className="block text-[10px] leading-tight" style={{ color: s.color }}>{s.label}</span>
                    {empty && (
                      <span className="block text-[10px] leading-tight" style={{ color: "var(--ink-3)" }}>
                        no lots listed
                      </span>
                    )}
                  </td>
                  <td className={td} style={{ color: "var(--ink-2)" }}>{k(r.population)}</td>
                  {hasGrowth && (
                    <td className={td} style={{ color: "var(--ink-2)" }}>{grew(r.growth_pct)}</td>
                  )}
                  <td className={td} style={{ color: "var(--ink-2)" }}>{r.express}</td>
                  <td className={td} style={{ color: s.color }}>
                    {r.pop_per_tunnel == null ? "none" : k(r.pop_per_tunnel)}
                  </td>
                  <td className={`${td} pr-3`} style={{ color: "var(--ink-2)" }}>
                    {nonMarket(r)
                      ? <span className="font-sans text-[10px] leading-tight inline-block">not comparable</span>
                      : r.median_price_per_acre == null ? "n/a" : `$${k(r.median_price_per_acre)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(hasGrowth || notes.length > 0) && (
          <div className="px-4 py-3 text-[10.5px] leading-relaxed space-y-1.5" style={{ color: "var(--ink-3)" }}>
            {hasGrowth && <p>People is the 2025 Census estimate.</p>}
            {notes.map(n => <p key={n}>{n}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}
