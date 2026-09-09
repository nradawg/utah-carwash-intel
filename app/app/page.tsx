"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { loadAll, type Wash, type County, type Manifest } from "@/lib/data";
import { rank, DEFAULT_INPUTS, type Inputs, type Scored, type Site } from "@/lib/scoring";
import ControlRail from "@/components/ControlRail";
import ResultsList from "@/components/ResultsList";
import SiteDetail from "@/components/SiteDetail";
import CountyTable from "@/components/CountyTable";
import Methodology from "@/components/Methodology";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const ALL_FORMATS = new Set([
  "express_tunnel", "flex_full_serve", "in_bay_automatic",
  "self_serve", "truck_wash", "unknown",
]);

type Tab = "map" | "counties" | "methodology";

export default function Page() {
  const [data, setData] = useState<{
    sites: Site[]; washes: Wash[]; counties: County[]; manifest: Manifest;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [selected, setSelected] = useState<Scored | null>(null);
  const [showFormats, setShowFormats] = useState<Set<string>>(new Set(ALL_FORMATS));
  const [tab, setTab] = useState<Tab>("map");

  useEffect(() => {
    loadAll().then(setData).catch(e => setErr(String(e)));
  }, []);

  // Deferred so dragging a slider stays smooth while 45k rows re-rank.
  const deferred = useDeferredValue(inputs);
  const result = useMemo(() => {
    if (!data) return { passed: 0, top: [] as Scored[] };
    return rank(data.sites, deferred);
  }, [data, deferred]);

  const busy = inputs !== deferred;

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
                onSelect={setSelected} showFormats={showFormats} />
              {busy && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded text-[11px] mono"
                  style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                  re-ranking…
                </div>
              )}
              <Legend />
            </main>

            <aside className="w-[336px] shrink-0 hidden md:block"
              style={{ borderLeft: "1px solid var(--line)" }}>
              {selected
                ? <SiteDetail s={selected} onClose={() => setSelected(null)} />
                : <ResultsList top={result.top} passed={result.passed}
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

function Legend() {
  return (
    <div className="absolute bottom-6 left-3 px-2.5 py-2 rounded text-[10.5px]"
      style={{ background: "rgba(17,20,27,.92)", border: "1px solid var(--line)" }}>
      <div className="mb-1.5" style={{ color: "var(--ink-3)" }}>Site score</div>
      <div className="flex items-center gap-1.5">
        {[["#f85149", "<38"], ["#e08c3f", "38"], ["#d29922", "48"], ["#7ecf4f", "58"], ["#3fb950", "70+"]]
          .map(([c, l]) => (
            <span key={l} className="flex items-center gap-1" style={{ color: "var(--ink-3)" }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}
            </span>
          ))}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="h-screen flex items-center justify-center">{children}</div>;
}
