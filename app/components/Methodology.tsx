"use client";
import type { Manifest } from "@/lib/data";

export default function Methodology({ m }: { m: Manifest }) {
  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--panel)" }}>
      <div className="max-w-3xl px-6 py-6">
        <h2 className="text-[15px] font-semibold mb-1" style={{ color: "var(--ink)" }}>Methodology and data provenance</h2>
        <p className="text-[12px] mb-5 leading-relaxed" style={{ color: "var(--ink-2)" }}>
          Every number in this tool comes from a named public source. Where a value is
          inferred rather than observed, it is labelled as inferred. Where coverage is
          incomplete, the gap is stated below rather than filled in.
          Data generated {m.generated}.
        </p>

        <h3 className="text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: "var(--ink-3)" }}>Sources</h3>
        <table className="w-full text-[11.5px] mb-6">
          <tbody>
            {m.sources.map(s => (
              <tr key={s.name} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <td className="py-2 pr-3 align-top" style={{ color: "var(--ink)" }}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline"
                    style={{ color: "var(--accent)" }}>{s.name}</a>
                </td>
                <td className="py-2 pr-3 align-top" style={{ color: "var(--ink-2)" }}>{s.vintage}</td>
                <td className="py-2 align-top" style={{ color: "var(--ink-3)" }}>{s.licence}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: "var(--ink-3)" }}>
          Known limits
        </h3>
        <ul className="mb-6 space-y-2">
          {m.coverage_caveats.map((c, i) => (
            <li key={i} className="text-[11.5px] leading-relaxed pl-4 relative" style={{ color: "var(--ink-2)" }}>
              <span className="absolute left-0" style={{ color: "var(--warn)" }}>•</span>{c}
            </li>
          ))}
        </ul>

        <h3 className="text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: "var(--ink-3)" }}>
          Why traffic is weighted low
        </h3>
        <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--ink-2)" }}>
          Most site-selection models lead with traffic count. The industry evidence does not
          support that. DRB, which holds transaction data across thousands of washes, reports
          that car count has almost no predictive value on site performance. MMCG attributes
          roughly 6% of the variance in wash volumes to traffic. Retail Petroleum Consultants,
          using Southwest transaction data, show capture rate falling from 1.7% of passing
          traffic at 10,000 vehicles per day to 0.5% at 80,000, so eight times the traffic
          does not deliver eight times the cars.
        </p>
        <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--ink-2)" }}>
          Traffic is therefore treated as a screen with a floor, plus a modest weighted factor
          for quality of traffic rather than quantity. Access carries more weight because a
          left turn across traffic is widely held in the industry to cost 30 to 50% of
          potential visits, a figure that is industry convention rather than a traced study.
          Competition carries equal weight because its downside is discontinuous: MMCG document
          a cliff when a third tunnel opens within one mile.
        </p>
        <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          Demand density is weighted above traffic because the modern express wash is a
          subscription business. Mister Car Wash reported that 79% of wash sales came from
          unlimited members in the fourth quarter of 2025. That makes the resident base&apos;s
          capacity to carry a recurring monthly charge the variable that matters, rather than
          the number of cars passing the door.
        </p>

        <h3 className="text-[11px] uppercase tracking-[0.14em] mt-6 mb-2.5" style={{ color: "var(--ink-3)" }}>
          Drive-time isochrones
        </h3>
        <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--ink-2)" }}>
          DRB argues that a 10-minute drive time is a better trade area than a 3 to 5 mile
          ring, because a ring ignores what the road network actually does. A freeway pulls
          customers from much further along its axis, while a mountain range or a lake leaves
          half a ring empty. That is visible in Salt Lake valley, where the polygons stretch
          north and south along Interstate 15 and are pinched sharply east and west.
        </p>
        <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--ink-2)" }}>
          These are computed here rather than fetched from a routing service. A routable graph
          of 1.35 million nodes and 2.8 million edges is built from UGRC road centrelines,
          weighted by each segment&apos;s posted speed limit, and Dijkstra from each origin gives
          everything reachable inside the time budget. Two caveats worth stating: these are
          free-flow times derived from posted limits with a factor applied for intersections
          and turns, so they are optimistic against rush hour; and they are precomputed for a
          set of origins spaced 0.4 miles apart, so a selected parcel may borrow the polygon
          from a nearby origin. When it does, the site panel says how far away that origin was.
        </p>

        <h3 className="text-[11px] uppercase tracking-[0.14em] mt-6 mb-2.5" style={{ color: "var(--ink-3)" }}>
          How format is determined
        </h3>
        <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          Most mapped car washes carry no machine-readable format tag. Format is resolved in
          order of reliability: an observed OpenStreetMap tag, then a verified brand lookup
          built by checking each Utah operator&apos;s own website, then the place category, then
          the business name. Anything unresolved is shown as Unknown rather than guessed.
          Hover any competitor on the map to see which rule classified it. Detailing shops and
          mobile detailers are held separately and excluded from competitor counts, because
          they do not compete with a conveyor tunnel.
        </p>
      </div>
    </div>
  );
}
