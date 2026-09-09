"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { loadAll, resolveIso, type Wash, type County, type Manifest } from "@/lib/data";
import { rank, DEFAULT_INPUTS, type Inputs, type Scored, type Site } from "@/lib/scoring";
import ControlRail from "@/components/ControlRail";
import ResultsList from "@/components/ResultsList";
import SiteDetail from "@/components/SiteDetail";
import CountyTable from "@/components/CountyTable";
import Methodology from "@/components/Methodology";
import { FORMAT_COLOR } from "@/components/MapView";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const ALL_FORMATS = new Set([
  "express_tunnel", "flex_full_serve", "in_bay_automatic",
  "self_serve", "truck_wash", "unknown",
]);

type Tab = "map" | "counties" | "methodology";

export default function Page() {
  const [data, setData] = useState<{
    sites: Site[]; washes: Wash[]; counties: County[]; manifest: Manifest;
    isoIndex: Map<string, GeoJSON.Feature[]>;
    isoAssign: Record<string, [string, number]>;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [selected, setSelected] = useState<Scored | null>(null);
  const [showFormats, setShowFormats] = useState<Set<string>>(new Set(ALL_FORMATS));
  const [tab, setTab] = useState<Tab>("map");
  const [showIso, setShowIso] = useState(true);

  useEffect(() => {
    loadAll().then(setData).catch(e => setErr(String(e)));
  }, []);

  // Deferred so dragging a slider stays smooth while 45k rows re-rank.
  const deferred = useDeferredValue(inputs);
  const result = useMemo(() => {
    if (!data) return { passed: 0, top: [] as Scored[], distinct: 0 };
    return rank(data.sites, deferred);
  }, [data, deferred]);

  const busy = inputs !== deferred;

  const iso = useMemo(
    () => data
      ? resolveIso(data.isoIndex, data.isoAssign, selected?.site.uid ?? null)
      : { features: [] as GeoJSON.Feature[], offsetMi: 0 },
    [data, selected]);

  if (err) return <Shell><div className="p-8 text-[13px]" style={{ color: "var(--bad)" }}>
    Failed to load data: {err}
  </div></Shell>;

  if (!data) return <Shell><div className="p-8 text-[13px]" style={{ color: "var(--ink-3)" }}>
    Loading parcel, traffic and competition data…
  </div></Shell>;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 46, background: "var(--panel)", borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-[13px] font-semibold whitespace-nowrap" style={{ color: "var(--ink)" }}>
            Utah Car Wash Site Intelligence
          </span>
          <span className="text-[11px] truncate hidden md:block" style={{ color: "var(--ink-3)" }}>
            {data.sites.length.toLocaleString()} candidate parcels ·{" "}
            {data.manifest.counts.wash_facilities_published?.toLocaleString()} wash facilities ·
            all 29 counties
          </span>
        </div>
        <nav className="flex gap-1 shrink-0">
          {([["map", "Map"], ["counties", "Counties"], ["methodology", "Methodology"]] as [Tab, string][])
            .map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className="px-2.5 py-1 rounded text-[11.5px] transition-colors"
                style={{
                  background: tab === k ? "var(--accent-dim)" : "transparent",
                  color: tab === k ? "var(--ink)" : "var(--ink-3)",
                }}>{label}</button>
            ))}
        </nav>
      </header>

      <div className="flex-1 flex min-h-0">
        {tab === "map" && (
          <>
            <aside className="w-[264px] shrink-0 hidden lg:block"
              style={{ borderRight: "1px solid var(--line)" }}>
              <ControlRail inputs={inputs} setInputs={setInputs}
                showFormats={showFormats} setShowFormats={setShowFormats}
                counts={{ passed: result.passed, total: data.sites.length }} />
            </aside>

            <main className="flex-1 relative min-w-0">
              <MapView top={result.top} washes={data.washes} selected={selected}
                onSelect={setSelected} showFormats={showFormats}
                isoFeatures={iso.features} showIso={showIso} />
              {busy && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded text-[11px] mono"
                  style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                  re-ranking…
                </div>
              )}
              <Legend showIso={showIso} setShowIso={setShowIso} hasSelection={!!selected} />
            </main>

            <aside className="w-[336px] shrink-0 hidden md:block"
              style={{ borderLeft: "1px solid var(--line)" }}>
              {selected
                ? <SiteDetail s={selected} onClose={() => setSelected(null)}
                    isoOffsetMi={iso.features.length ? iso.offsetMi : null} />
                : <ResultsList top={result.top} passed={result.passed}
                    distinct={result.distinct}
                    selected={selected} onSelect={setSelected} />}
            </aside>
          </>
        )}
        {tab === "counties" && (
          <div className="flex-1 min-w-0"><CountyTable counties={data.counties} /></div>
        )}
        {tab === "methodology" && (
          <div className="flex-1 min-w-0"><Methodology m={data.manifest} /></div>
        )}
      </div>
    </div>
  );
}

function Legend({ showIso, setShowIso, hasSelection }: {
  showIso: boolean; setShowIso: (v: boolean) => void; hasSelection: boolean;
}) {
  const scores: [string, string][] = [
    ["#f85149", "<38"], ["#e08c3f", "38"], ["#d29922", "48"],
    ["#7ecf4f", "58"], ["#3fb950", "70+"],
  ];
  const formats: [string, string][] = [
    ["express_tunnel", "Express tunnel"],
    ["flex_full_serve", "Flex / full-serve"],
    ["in_bay_automatic", "In-bay automatic"],
    ["self_serve", "Self-serve"],
    ["unknown", "Format unknown"],
  ];
  return (
    <div className="absolute bottom-6 left-3 px-3 py-2.5 rounded text-[10.5px] leading-none"
      style={{ background: "rgba(17,20,27,.94)", border: "1px solid var(--line)" }}>
      <div className="mb-1.5" style={{ color: "var(--ink-2)" }}>
        Candidate site <span style={{ color: "var(--ink-3)" }}>(filled, by score)</span>
      </div>
      <div className="flex items-center gap-1.5 mb-2.5">
        {scores.map(([c, l]) => (
          <span key={l} className="flex items-center gap-1" style={{ color: "var(--ink-3)" }}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}
          </span>
        ))}
      </div>
      <div className="mb-1.5" style={{ color: "var(--ink-2)" }}>
        Existing wash <span style={{ color: "var(--ink-3)" }}>(ringed, by format)</span>
      </div>
      <div className="flex flex-col gap-1 mb-2.5">
        {formats.map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5" style={{ color: "var(--ink-3)" }}>
            <span className="w-2.5 h-2.5 rounded-full"
              style={{ border: `1.5px solid ${FORMAT_COLOR[k]}`, background: `${FORMAT_COLOR[k]}80` }} />
            {l}
          </span>
        ))}
      </div>
      <label className="flex items-center gap-1.5 cursor-pointer"
        style={{ color: hasSelection ? "var(--ink-2)" : "var(--ink-3)" }}>
        <input type="checkbox" checked={showIso} onChange={e => setShowIso(e.target.checked)}
          className="accent-[color:var(--accent)] w-3 h-3" />
        <span className="w-2.5 h-2.5 rounded-sm"
          style={{ background: "rgba(77,163,255,.22)", border: "1px solid #4da3ff" }} />
        5 and 10 min drive time
      </label>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="h-screen flex items-center justify-center">{children}</div>;
}
