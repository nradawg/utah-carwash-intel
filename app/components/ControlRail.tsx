"use client";
import type { Inputs, Weights } from "@/lib/scoring";
import { DEFAULT_INPUTS, DEFAULT_WEIGHTS } from "@/lib/scoring";
import { FORMAT_COLOR } from "./MapView";
import { countyLabel, grade } from "./plain";
import { FORMAT_NAMES } from "./WashDetail";

const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : `$${Math.round(n / 1000)}k`;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <div className="flex justify-between items-baseline mb-1.5">
        <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-2)" }}>{label}</label>
        {hint && <span className="mono text-[11px]" style={{ color: "var(--ink)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--line-soft)" }}>
      <div className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink)" }}>{title}</div>
        {sub && <div className="text-[11px] mt-1" style={{ color: "var(--ink-3)" }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * On touch screens the global 3px range track is too thin to grab, and inputs
 * under 16px make iOS zoom the page on focus. Scoped to this rail so the
 * desktop look is untouched.
 */
const TOUCH_CSS = `
@media (pointer: coarse) {
  .rail input[type="range"] {
    height: 32px; background: linear-gradient(var(--line), var(--line)) center / 100% 3px no-repeat;
  }
  .rail input[type="range"]::-webkit-slider-thumb { width: 24px; height: 24px; }
  .rail input[type="text"], .rail select { font-size: 16px; padding: 8px 10px; }
  .rail input[type="checkbox"] { width: 20px; height: 20px; }
  .rail .rail-reset { min-height: 44px; }
}`;

export default function ControlRail({
  inputs, setInputs, showFormats, setShowFormats, counts, countyNames, hasCityGrowth = false,
  noLotCounties = [], onShowResults,
}: {
  inputs: Inputs; setInputs: (i: Inputs) => void;
  showFormats: Set<string>; setShowFormats: (s: Set<string>) => void;
  /** shown: how many of the passing lots the map and list show (the top 200 at most). */
  counts: { passed: number; total: number; shown?: number };
  countyNames: string[];
  /** False until sites.parquet carries city_growth_pct. */
  hasCityGrowth?: boolean;
  /** Counties whose tax records name no commercial land, so picking one shows nothing. */
  noLotCounties?: string[];
  /** Set where the rail covers the map (phones), to show a way back to it. */
  onShowResults?: () => void;
}) {
  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) => setInputs({ ...inputs, [k]: v });
  const setW = (k: keyof Weights, v: number) =>
    setInputs({ ...inputs, weights: { ...inputs.weights, [k]: v } });
  const wTotal = Object.values(inputs.weights).reduce((a, b) => a + b, 0);
  // The map and list stop at the top 200.
  const shown = counts.shown ?? Math.min(counts.passed, 200);

  return (
    <div className="rail h-full overflow-y-auto overscroll-contain" style={{ background: "var(--panel)" }}>
      <style>{TOUCH_CSS}</style>
      <Section title="Where" sub="Pick an area first, then fine tune.">
        <Row label="County" hint={inputs.county ? countyLabel(inputs.county) : "all 29"}>
          <select value={inputs.county ?? ""}
            onChange={e => set("county", e.target.value || null)}>
            <option value="">All counties</option>
            {countyNames.map(c => (
              <option key={c} value={c}>
                {countyLabel(c)}{noLotCounties.includes(c) ? " (no lots listed)" : ""}
              </option>
            ))}
          </select>
        </Row>
        <Row label="City or street">
          <input type="text" placeholder="e.g. Ogden, or Redwood Rd"
            value={inputs.place} onChange={e => set("place", e.target.value)} />
        </Row>
        <Row label="Town growth" hint={inputs.minCityGrowth === 0 ? "off" : `${inputs.minCityGrowth}% or more`}>
          <div className="text-[11.5px] mb-1.5" style={{ color: "var(--ink-2)" }}>
            {inputs.minCityGrowth === 0
              ? "Off. Slide right to keep only towns that are growing fast."
              : `Only towns that grew at least ${inputs.minCityGrowth}% since 2020`}
          </div>
          <input type="range" min={0} max={50} step={1} value={inputs.minCityGrowth}
            disabled={!hasCityGrowth && inputs.minCityGrowth === 0}
            onChange={e => set("minCityGrowth", +e.target.value)} className="w-full" />
          <div className="text-[10.5px] mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>
            {!hasCityGrowth
              ? "Town growth figures are not in this data yet."
              : inputs.minCityGrowth > 0
                ? "While this is on, land outside city limits is hidden because it has no town growth figure."
                : "Uses Census population counts from 2020 to 2025. Land outside city limits is hidden while this is on."}
          </div>
        </Row>
        <Row label="Minimum score"
          hint={inputs.minScore === 0 ? "any" : `${inputs.minScore} (${grade(inputs.minScore).word.replace(" spot", "")})`}>
          <input type="range" min={0} max={80} step={5} value={inputs.minScore}
            onChange={e => set("minScore", +e.target.value)} className="w-full" />
        </Row>
      </Section>

      <Section title="Your car wash" sub="The list and map update as you change these.">
        <Row label="Land needed" hint={`${inputs.acresNeeded.toFixed(2)} acres`}>
          <input type="range" min={0.3} max={4} step={0.05} value={inputs.acresNeeded}
            onChange={e => set("acresNeeded", +e.target.value)} className="w-full" />
          <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--ink-3)" }}>
            <span>0.3 (small automatic)</span><span>1.0 (tunnel)</span><span>4.0</span>
          </div>
        </Row>
        <Row label="Minimum lot length" hint={`${inputs.minDimFt} ft`}>
          <input type="range" min={80} max={500} step={5} value={inputs.minDimFt}
            onChange={e => set("minDimFt", +e.target.value)} className="w-full" />
          <div className="text-[10px] mt-1" style={{ color: "var(--ink-3)" }}>
            225 ft fits a 125 ft wash tunnel plus room to drive in and out
          </div>
        </Row>
        <Row label="Land budget" hint={money(inputs.budget)}>
          <div className="text-[10.5px] mb-1.5" style={{ color: "var(--ink-3)" }}>
            Compared with the county assessed land value, which is usually below asking price.
          </div>
          <input type="range" min={100_000} max={12_000_000} step={100_000} value={inputs.budget}
            onChange={e => set("budget", +e.target.value)} className="w-full" />
        </Row>
      </Section>

      <Section title="Must haves" sub="A lot that misses any of these is left off the map.">
        <Row label="Minimum traffic" hint={`${inputs.minAadt.toLocaleString()} cars/day`}>
          <input type="range" min={0} max={60_000} step={1_000} value={inputs.minAadt}
            onChange={e => set("minAadt", +e.target.value)} className="w-full" />
        </Row>
        <Row label="Highest speed limit out front" hint={`${inputs.maxSpeed} mph`}>
          <input type="range" min={25} max={65} step={5} value={inputs.maxSpeed}
            onChange={e => set("maxSpeed", +e.target.value)} className="w-full" />
        </Row>
        <Row label="Count competing washes within" hint={`${inputs.compRing} mi`}>
          <div className="flex gap-1.5">
            {([1, 3, 5] as const).map(r => (
              <button key={r} onClick={() => set("compRing", r)}
                className="flex-1 py-1.5 min-h-[34px] rounded text-[12px] transition-colors"
                style={{
                  background: inputs.compRing === r ? "var(--accent-dim)" : "var(--panel-2)",
                  border: `1px solid ${inputs.compRing === r ? "var(--accent)" : "var(--line)"}`,
                  color: inputs.compRing === r ? "var(--ink)" : "var(--ink-2)",
                }}>{r} mi</button>
            ))}
          </div>
        </Row>
        <Row label="Spread results apart" hint={inputs.spreadMi ? `${inputs.spreadMi} mi` : "off"}>
          <div className="flex gap-1.5">
            {([0, 0.5, 1, 2] as const).map(v => (
              <button key={v} onClick={() => set("spreadMi", v)}
                className="flex-1 py-1.5 min-h-[34px] rounded text-[12px] transition-colors"
                style={{
                  background: inputs.spreadMi === v ? "var(--accent-dim)" : "var(--panel-2)",
                  border: `1px solid ${inputs.spreadMi === v ? "var(--accent)" : "var(--line)"}`,
                  color: inputs.spreadMi === v ? "var(--ink)" : "var(--ink-2)",
                }}>{v === 0 ? "off" : `${v} mi`}</button>
            ))}
          </div>
          <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: "var(--ink-3)" }}>
            Shows only the best lot in each neighborhood, so the list is not nine lots on
            one street. Car washes within a mile of each other compete for the same
            customers, so lots that close are really one choice.
          </div>
        </Row>

        {([
          ["excludeFlood", "Skip mapped flood zones", null],
          ["vacantOnly", "Empty land only (no building)", null],
          ["skipBuilt", "Skip lots with a sizable business already on them",
            "A sizable business means a building of 10,000 sq ft or more, or buildings the county values at " +
            "$400,000 or more. Turning this off also shows developed properties, which would mean tearing a " +
            "building down or buying a working business."],
          ["includeStale", "Include lots the county has since split, merged or renumbered",
            "County tax records are updated once a year, so these lots may no longer exist as listed here."],
          ["allowBelowMarket", "Include land taxed as farmland", null],
        ] as const).map(([k, label, note]) => (
          <div key={k} className="mb-2">
            <label className="flex items-center gap-2 cursor-pointer text-[12px]"
              style={{ color: "var(--ink-2)" }}>
              <input type="checkbox" checked={inputs[k] as boolean}
                onChange={e => set(k, e.target.checked as never)}
                className="accent-[color:var(--accent)] w-3.5 h-3.5 shrink-0" />
              {label}
            </label>
            {note && (
              <div className="text-[10px] mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>{note}</div>
            )}
          </div>
        ))}
        <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: "var(--ink-3)" }}>
          Land taxed as farmland (Utah&apos;s greenbelt rule) shows a very low county value
          that is nothing like its real price.
        </div>
      </Section>

      <Section title="What matters most"
        sub="How much each part counts toward the score. Traffic counts less on purpose: industry data shows car count barely predicts how a wash does.">
        {([
          ["access", "Road and lot"], ["competition", "Competition"],
          ["demand", "Homes nearby"], ["traffic", "Traffic"],
          ["growth", "Growth"],
        ] as const).map(([k, label]) => (
          <Row key={k} label={label} hint={`${Math.round(inputs.weights[k] / wTotal * 100)}%`}>
            <input type="range" min={0} max={40} step={1} value={inputs.weights[k]}
              onChange={e => setW(k, +e.target.value)} className="w-full" />
          </Row>
        ))}
        <button onClick={() => setInputs({ ...inputs, weights: { ...DEFAULT_WEIGHTS } })}
          className="rail-reset text-[11px] underline" style={{ color: "var(--ink-3)" }}>
          reset to the recommended mix
        </button>
      </Section>

      <Section title="Car washes shown on the map">
        {FORMAT_NAMES.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 mb-1.5 cursor-pointer text-[12px]"
            style={{ color: showFormats.has(k) ? "var(--ink-2)" : "var(--ink-3)" }}>
            <input type="checkbox" checked={showFormats.has(k)}
              onChange={e => {
                const n = new Set(showFormats);
                e.target.checked ? n.add(k) : n.delete(k);
                setShowFormats(n);
              }} className="accent-[color:var(--accent)] w-3.5 h-3.5" />
            <span className="w-2 h-2 rounded-full shrink-0"
              style={{ background: FORMAT_COLOR[k] }} />
            {label}
            {k === "hand_detail" && <span style={{ color: "var(--ink-3)" }}>(not counted)</span>}
          </label>
        ))}
      </Section>

      <div className="px-4 py-3.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
        <span className="mono" style={{ color: "var(--ink)" }}>{counts.passed.toLocaleString()}</span> of{" "}
        <span className="mono">{counts.total.toLocaleString()}</span> lots pass your filters.
        <button onClick={() => setInputs({ ...DEFAULT_INPUTS })}
          className="rail-reset block mt-2 underline">reset everything</button>
      </div>

      {onShowResults && (
        // The rail covers the whole map on a phone. Sticky, so the way back
        // to the map, with the count it will show, is always in reach.
        <div className="sticky bottom-0 px-4 py-3"
          style={{ background: "var(--panel)", borderTop: "1px solid var(--line)" }}>
          <button onClick={onShowResults}
            className="w-full min-h-[48px] rounded-md text-[14px] font-semibold"
            style={{ background: "var(--accent)", color: "var(--bg)" }}>
            {counts.passed === 0
              ? "Back to the map (no lots pass)"
              : counts.passed > shown
                ? `See the top ${shown.toLocaleString()} of ${counts.passed.toLocaleString()} lots`
                : `Show ${counts.passed.toLocaleString()} ${counts.passed === 1 ? "lot" : "lots"}`}
          </button>
        </div>
      )}
    </div>
  );
}
