"use client";
import { useMemo, useState } from "react";
import type { County } from "@/lib/data";

/**
 * Industry guidance puts a healthy express market at 25,000-35,000 people per
 * tunnel. No published Utah figure exists, so this is computed from ACS county
 * population and mapped express tunnels.
 */
export function saturation(popPerTunnel: number | null, express: number) {
  if (express === 0) return { label: "no tunnel", color: "#4da3ff", rank: 4 };
  if (popPerTunnel == null) return { label: "—", color: "var(--ink-3)", rank: -1 };
  if (popPerTunnel > 35_000) return { label: "under-served", color: "#3fb950", rank: 3 };
  if (popPerTunnel >= 25_000) return { label: "balanced", color: "#d29922", rank: 2 };
  return { label: "tight", color: "#f85149", rank: 1 };
}

const k = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v));

export default function CountyPanel({
  counties, active, onPick,
}: {
  counties: County[]; active: string | null; onPick: (c: string | null) => void;
}) {
  const [hideSmall, setHideSmall] = useState(true);

  const rows = useMemo(() => {
    const r = counties.filter(c => !hideSmall || c.population >= 30_000);
    // Under-served first, then by people per tunnel descending: the ranking a
    // developer actually cares about.
    r.sort((a, b) => {
      const sa = saturation(a.pop_per_tunnel, a.express);
      const sb = saturation(b.pop_per_tunnel, b.express);
      if (sa.rank !== sb.rank) return sb.rank - sa.rank;
      return (b.pop_per_tunnel ?? 0) - (a.pop_per_tunnel ?? 0);
    });
    return r;
  }, [counties, hideSmall]);

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--panel)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="text-[11px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
          People per express tunnel. Healthy is 25k to 35k, so higher means under-served.
          Click a county to filter the map and the ranked list.
        </div>
        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px]"
            style={{ color: "var(--ink-3)" }}>
            <input type="checkbox" checked={hideSmall} onChange={e => setHideSmall(e.target.checked)}
              className="accent-[color:var(--accent)] w-3 h-3" />
            hide under 30k people
          </label>
          {active && (
            <button onClick={() => onPick(null)} className="text-[11px] underline"
              style={{ color: "var(--accent)" }}>clear filter</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[11.5px] mono">
          <thead className="sticky top-0" style={{ background: "var(--panel-2)" }}>
            <tr style={{ color: "var(--ink-3)" }}>
              <th className="px-3 py-1.5 text-left font-normal">County</th>
              <th className="px-2 py-1.5 text-right font-normal">Pop</th>
              <th className="px-2 py-1.5 text-right font-normal">Tun</th>
              <th className="px-2 py-1.5 text-right font-normal">Per tunnel</th>
              <th className="px-2 py-1.5 text-right font-normal">$/acre</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const s = saturation(r.pop_per_tunnel, r.express);
              const on = active === r.county;
              return (
                <tr key={r.county} onClick={() => onPick(on ? null : r.county)}
                  className="cursor-pointer"
                  style={{
                    borderBottom: "1px solid var(--line-soft)",
                    background: on ? "var(--accent-dim)" : "transparent",
                  }}>
                  <td className="px-3 py-1.5 text-left" style={{ color: "var(--ink)" }}>
                    {r.county}
                    <span className="block text-[10px]" style={{ color: s.color }}>{s.label}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{k(r.population)}</td>
                  <td className="px-2 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>{r.express}</td>
                  <td className="px-2 py-1.5 text-right" style={{ color: s.color }}>
                    {r.pop_per_tunnel == null ? "none" : k(r.pop_per_tunnel)}
                  </td>
                  <td className="px-2 py-1.5 text-right" style={{ color: "var(--ink-2)" }}>
                    {r.median_price_per_acre == null ? "—" : `$${k(r.median_price_per_acre)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
