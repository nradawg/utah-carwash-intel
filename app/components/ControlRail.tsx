"use client";
import type { Inputs, Weights } from "@/lib/scoring";
import { DEFAULT_INPUTS, DEFAULT_WEIGHTS } from "@/lib/scoring";
import { FORMAT_COLOR } from "./MapView";

const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : `$${Math.round(n / 1000)}k`;

const FORMATS: [string, string][] = [
  ["express_tunnel", "Express tunnel"],
  ["flex_full_serve", "Flex / full-serve"],
  ["in_bay_automatic", "In-bay automatic"],
  ["self_serve", "Self-serve bays"],
  ["truck_wash", "Truck wash"],
  ["unknown", "Format unknown"],
  ["hand_detail", "Detailers (not counted)"],
];

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

export default function ControlRail({
  inputs, setInputs, showFormats, setShowFormats, counts,
}: {
  inputs: Inputs; setInputs: (i: Inputs) => void;
  showFormats: Set<string>; setShowFormats: (s: Set<string>) => void;
  counts: { passed: number; total: number };
}) {
  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) => setInputs({ ...inputs, [k]: v });
  const setW = (k: keyof Weights, v: number) =>
    setInputs({ ...inputs, weights: { ...inputs.weights, [k]: v } });
  const wTotal = Object.values(inputs.weights).reduce((a, b) => a + b, 0);

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--panel)" }}>
      <Section title="Your facility" sub="Everything re-ranks as you change these.">
        <Row label="Land needed" hint={`${inputs.acresNeeded.toFixed(2)} acres`}>
          <input type="range" min={0.3} max={4} step={0.05} value={inputs.acresNeeded}
            onChange={e => set("acresNeeded", +e.target.value)} className="w-full" />
          <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--ink-3)" }}>
            <span>0.3 (in-bay)</span><span>1.0 (express)</span><span>4.0</span>
          </div>
        </Row>
        <Row label="Minimum lot length" hint={`${inputs.minDimFt} ft`}>
          <input type="range" min={80} max={500} step={5} value={inputs.minDimFt}
            onChange={e => set("minDimFt", +e.target.value)} className="w-full" />
          <div className="text-[10px] mt-1" style={{ color: "var(--ink-3)" }}>
            225 ft fits a 125 ft conveyor plus approach and exit
          </div>
        </Row>
        <Row label="Land budget" hint={money(inputs.budget)}>
          <input type="range" min={100_000} max={12_000_000} step={100_000} value={inputs.budget}
            onChange={e => set("budget", +e.target.value)} className="w-full" />
        </Row>
      </Section>

      <Section title="Screens" sub="Hard gates. A site that fails is not ranked.">
        <Row label="Minimum traffic" hint={`${inputs.minAadt.toLocaleString()} AADT`}>
          <input type="range" min={0} max={60_000} step={1_000} value={inputs.minAadt}
            onChange={e => set("minAadt", +e.target.value)} className="w-full" />
        </Row>
        <Row label="Maximum posted speed" hint={`${inputs.maxSpeed} mph`}>
          <input type="range" min={25} max={65} step={5} value={inputs.maxSpeed}
            onChange={e => set("maxSpeed", +e.target.value)} className="w-full" />
        </Row>
        <Row label="Competition radius" hint={`${inputs.compRing} mi`}>
          <div className="flex gap-1.5">
            {([1, 3, 5] as const).map(r => (
              <button key={r} onClick={() => set("compRing", r)}
                className="flex-1 py-1.5 rounded text-[12px] transition-colors"
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
                className="flex-1 py-1.5 rounded text-[12px] transition-colors"
                style={{
                  background: inputs.spreadMi === v ? "var(--accent-dim)" : "var(--panel-2)",
                  border: `1px solid ${inputs.spreadMi === v ? "var(--accent)" : "var(--line)"}`,
                  color: inputs.spreadMi === v ? "var(--ink)" : "var(--ink-2)",
                }}>{v === 0 ? "off" : `${v} mi`}</button>
            ))}
          </div>
          <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: "var(--ink-3)" }}>
            Keeps only the best parcel in each neighbourhood, so the list shows distinct
            opportunities instead of nine lots on one street. Washes within a mile take
            each other&apos;s members, so closer parcels are alternatives, not separate options.
          </div>
        </Row>

        {([
          ["excludeFlood", "Exclude FEMA flood zones"],
          ["vacantOnly", "Vacant land only"],
          ["allowBelowMarket", "Include below-market assessed land"],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 mb-2 cursor-pointer text-[12px]"
            style={{ color: "var(--ink-2)" }}>
            <input type="checkbox" checked={inputs[k] as boolean}
              onChange={e => set(k, e.target.checked as never)}
              className="accent-[color:var(--accent)] w-3.5 h-3.5" />
            {label}
          </label>
        ))}
        <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: "var(--ink-3)" }}>
          Below-market parcels are assessed under Utah&apos;s greenbelt rule at agricultural
          value, so their price is not a market price.
        </div>
      </Section>

      <Section title="Weights"
        sub="Traffic is weighted low on purpose. Industry data shows car count barely predicts wash performance.">
        {([
          ["access", "Access & site"], ["competition", "Competitive position"],
          ["demand", "Demand density"], ["traffic", "Traffic quality"],
          ["growth", "Growth & durability"],
        ] as const).map(([k, label]) => (
          <Row key={k} label={label} hint={`${Math.round(inputs.weights[k] / wTotal * 100)}%`}>
            <input type="range" min={0} max={40} step={1} value={inputs.weights[k]}
              onChange={e => setW(k, +e.target.value)} className="w-full" />
          </Row>
        ))}
        <button onClick={() => setInputs({ ...inputs, weights: { ...DEFAULT_WEIGHTS } })}
          className="text-[11px] underline" style={{ color: "var(--ink-3)" }}>
          reset to researched defaults
        </button>
      </Section>

      <Section title="Competitors shown">
        {FORMATS.map(([k, label]) => (
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
          </label>
        ))}
      </Section>

      <div className="px-4 py-3.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
        <span className="mono" style={{ color: "var(--ink)" }}>{counts.passed.toLocaleString()}</span> of{" "}
        <span className="mono">{counts.total.toLocaleString()}</span> parcels clear your screens.
        <button onClick={() => setInputs({ ...DEFAULT_INPUTS })}
          className="block mt-2 underline">reset everything</button>
      </div>
    </div>
  );
}
