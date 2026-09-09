"use client";
import type { Scored } from "@/lib/scoring";
import { scoreColor } from "./MapView";

const money = (n: number | null) => n == null ? "n/a" : `$${Math.round(n).toLocaleString()}`;
const num = (n: number | null | undefined) => n == null ? "n/a" : Math.round(n).toLocaleString();

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="py-2" style={{ borderBottom: "1px solid var(--line-soft)" }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>{k}</div>
      <div className="mono text-[13px] mt-0.5" style={{ color: "var(--ink)" }}>{v}</div>
      {sub && <div className="text-[10.5px] mt-0.5" style={{ color: "var(--ink-3)" }}>{sub}</div>}
    </div>
  );
}

export default function SiteDetail({ s, onClose, isoOffsetMi }: {
  s: Scored; onClose: () => void; isoOffsetMi: number | null;
}) {
  const site = s.site;
  const wTotal = s.factors.reduce((a, f) => a + f.weight, 0) || 1;

  return (
    <div className="fade h-full overflow-y-auto" style={{ background: "var(--panel)" }}>
      <div className="px-4 pt-4 pb-3 sticky top-0 z-10"
        style={{ background: "var(--panel)", borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>
              {site.address || "Unaddressed parcel"}
            </div>
            <div className="text-[11.5px] mt-0.5" style={{ color: "var(--ink-2)" }}>
              {site.city || "unincorporated"}, {site.county} County
            </div>
          </div>
          <button onClick={onClose} className="text-[16px] leading-none px-1"
            style={{ color: "var(--ink-3)" }} aria-label="close">×</button>
        </div>
        <div className="flex items-baseline gap-2 mt-3">
          <span className="mono text-[30px] font-semibold leading-none"
            style={{ color: scoreColor(s.total) }}>{s.total.toFixed(1)}</span>
          <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>/ 100 weighted score</span>
        </div>
      </div>

      <div className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--line-soft)" }}>
        <div className="text-[10px] uppercase tracking-[0.14em] mb-2.5" style={{ color: "var(--ink-3)" }}>
          Score breakdown
        </div>
        {s.factors.map(f => (
          <div key={f.key} className="mb-3">
            <div className="flex justify-between items-baseline text-[11.5px]">
              <span style={{ color: "var(--ink-2)" }}>{f.label}</span>
              <span className="mono" style={{ color: "var(--ink)" }}>
                {(f.score * 100).toFixed(0)}
                <span style={{ color: "var(--ink-3)" }}> × {Math.round(f.weight / wTotal * 100)}%</span>
              </span>
            </div>
            <div className="h-1 rounded-full mt-1.5 overflow-hidden" style={{ background: "var(--line)" }}>
              <div className="h-full rounded-full" style={{
                width: `${f.score * 100}%`,
                background: f.score >= 0.6 ? "var(--good)" : f.score >= 0.4 ? "var(--warn)" : "var(--bad)",
              }} />
            </div>
            <div className="text-[10.5px] mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>{f.note}</div>
          </div>
        ))}
      </div>

      {(s.strengths.length > 0 || s.weaknesses.length > 0) && (
        <div className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--line-soft)" }}>
          <div className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: "var(--ink-3)" }}>
            Why this ranks here
          </div>
          {s.strengths.map((t, i) => (
            <div key={`s${i}`} className="text-[11.5px] mb-1.5 pl-3 relative" style={{ color: "var(--ink-2)" }}>
              <span className="absolute left-0" style={{ color: "var(--good)" }}>+</span>{t}
            </div>
          ))}
          {s.weaknesses.map((t, i) => (
            <div key={`w${i}`} className="text-[11.5px] mb-1.5 pl-3 relative" style={{ color: "var(--ink-2)" }}>
              <span className="absolute left-0" style={{ color: "var(--bad)" }}>−</span>{t}
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-1">
        <Stat k="Parcel size" v={`${site.acres} acres`}
          sub={`${site.max_dim_ft} ft × ${site.min_dim_ft} ft bounding dimensions`} />
        <Stat k="Land value (assessed)" v={money(site.land_value)}
          sub={site.value_flag === "below_market"
            ? "Flagged: assessed below market, likely greenbelt or exempt"
            : `${money(site.price_per_acre)} per acre`} />
        <Stat k="Property class" v={site.prop_class}
          sub={site.is_vacant ? "No building on record" : `${num(site.bldg_sqft)} sq ft existing building`} />
        <Stat k="Traffic" v={site.aadt ? `${num(site.aadt)} AADT` : "no count nearby"}
          sub={site.aadt_desc
            ? `${site.aadt_desc}${site.aadt_growth_pct != null ? ` · ${site.aadt_growth_pct > 0 ? "+" : ""}${site.aadt_growth_pct}% over 10 yr` : ""}`
            : site.aadt_source === "local" ? "From UGRC local road counts, not a UDOT station" : undefined} />
        <Stat k="Frontage road" v={site.road_class || "unclassified"}
          sub={site.road_speed ? `posted ${site.road_speed} mph${site.road_lanes ? `, ${site.road_lanes} through lanes` : ""}` : undefined} />
        <Stat k="Rooftops within 3 mi" v={num(site.rooftops_3mi)}
          sub={`${num(site.rooftops_1mi)} within 1 mi · residential address points`} />
        <Stat k="Competition" v={`${site.express_3mi} express within 3 mi`}
          sub={`${site.competitors_3mi} washes of any format within 3 mi · nearest tunnel ${site.dist_nearest_express_mi ?? "none found"} mi`} />
        <Stat k="Trade area" v={`${money(site.median_hh_income)} median household income`}
          sub={`${site.vehicles_per_hh ?? "?"} vehicles per household · ${site.multifamily_pct ?? "?"}% multifamily · ${site.car_commute_pct ?? "?"}% drive to work`} />
        <Stat k="County growth" v={`${num(site.county_permits_2026)} units permitted 2026`}
          sub="Census Building Permits Survey, year to date" />
        <Stat k="Drive time"
          v={isoOffsetMi === null ? "not available here"
             : isoOffsetMi === 0 ? "5 and 10 min shown on map"
             : `5 and 10 min shown on map`}
          sub={isoOffsetMi === null
            ? "No drive-time polygon was computed near this parcel"
            : isoOffsetMi === 0
              ? "Free-flow times from posted speed limits on the UGRC road network, not congested times"
              : `Computed from a point ${isoOffsetMi} mi away, using free-flow posted speeds`} />
        <Stat k="Flood" v={site.in_flood_zone ? "Inside a FEMA SFHA" : "Outside mapped SFHA"}
          sub="Screening flag from generalised FEMA polygons, not a survey" />
      </div>

      <div className="px-4 py-4 flex flex-col gap-2">
        {site.assessor_url && (
          <a href={site.assessor_url} target="_blank" rel="noopener noreferrer"
            className="text-[11.5px] underline" style={{ color: "var(--accent)" }}>
            Verify this parcel on the {site.county} County assessor site
          </a>
        )}
        <a href={`https://www.google.com/maps/search/?api=1&query=${site.lat},${site.lon}`}
          target="_blank" rel="noopener noreferrer"
          className="text-[11.5px] underline" style={{ color: "var(--accent)" }}>
          Open location in Google Maps
        </a>
        <div className="mono text-[10px] mt-1" style={{ color: "var(--ink-3)" }}>
          parcel {site.parcel_id} · {site.lat.toFixed(5)}, {site.lon.toFixed(5)}
        </div>
      </div>
    </div>
  );
}
