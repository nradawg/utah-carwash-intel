"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { loadAll, resolveIso, type Wash, type County, type Manifest } from "@/lib/data";
import { rank, scoreSite, DEFAULT_INPUTS, type Inputs, type Scored, type Site } from "@/lib/scoring";
import ControlRail from "@/components/ControlRail";
import ResultsList from "@/components/ResultsList";
import SiteDetail from "@/components/SiteDetail";
import CountyTable from "@/components/CountyTable";
import CountyPanel from "@/components/CountyPanel";
import WashDetail, { FORMAT_NAMES } from "@/components/WashDetail";
import Boundary from "@/components/Boundary";
import Methodology from "@/components/Methodology";
import { FORMAT_COLOR } from "@/components/MapView";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const ALL_FORMATS = new Set([
  "express_tunnel", "flex_full_serve", "in_bay_automatic",
  "self_serve", "truck_wash", "unknown",
]);

type Tab = "map" | "counties" | "methodology";
/** Phones get one panel at a time, picked from a bottom tab bar. */
type PhoneView = "map" | "sites" | "counties" | "filters";

/**
 * What a history entry of ours holds. `detail` is an open lot or car wash
 * (named in the address), `overTab` says the entry below it is a phone tab,
 * and `tab` is a phone tab other than the map.
 */
type HistState = { detail?: boolean; overTab?: boolean; tab?: PhoneView } | null;
const histState = () => window.history.state as HistState;

/** The record the address names: "#lot=<uid>" or "#wash=<index>". */
function readHash(): { lot?: string; wash?: number } {
  const m = /^#(lot|wash)=(.+)$/.exec(window.location.hash);
  if (!m) return {};
  return m[1] === "lot" ? { lot: decodeURIComponent(m[2]) } : { wash: Number(m[2]) };
}

/** The address with no record named, for closing without adding an entry. */
const bareUrl = () => window.location.pathname + window.location.search;

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
  const [selectedWash, setSelectedWash] = useState<Wash | null>(null);
  const [rightTab, setRightTab] = useState<"sites" | "counties">("sites");
  const [phoneView, setPhoneView] = useState<PhoneView>("map");
  const [sheetFull, setSheetFull] = useState(false);
  /** The phone panel a lot was opened from, so closing it lands back there. */
  const returnTo = useRef<PhoneView>("map");

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

  // The address names the open lot or car wash, and back, iOS swipe back and
  // the forward button all arrive here. Without a history entry per panel,
  // the phone back button left the app instead of closing the panel. The phone
  // tabs other than the map get one entry too, so back from Best spots,
  // Counties or Filters lands on the map instead of leaving the site.
  useEffect(() => {
    if (!data) return;
    const onPop = () => {
      const panel = histState()?.tab;
      if (panel) {
        setSelected(null); setSelectedWash(null); setSheetFull(false);
        setTab("map"); setPhoneView(panel);
        return;
      }
      const h = readHash();
      const site = h.lot != null ? data.sites.find(x => x.uid === h.lot) : undefined;
      const wash = h.wash != null ? data.washes[h.wash] : undefined;
      if (site) {
        setSelected(result.top.find(t => t.site.uid === site.uid) ?? scoreSite(site, deferred));
        setSelectedWash(null); setPhoneView("map");
      } else if (wash) {
        setSelectedWash(wash); setSelected(null); setPhoneView("map");
      } else {
        setSelected(null); setSelectedWash(null); setSheetFull(false);
        // Back from a lot returns to where it was picked. A phone tab has its
        // own entry, so arriving here while one shows means stepping back out
        // of it, to the map.
        setPhoneView(v => v === "map" ? returnTo.current : "map");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [data, result, deferred]);

  // A shared "#lot=<uid>" link opens that lot once the data is in. The lot
  // gets its own entry above a bare one, so back closes it rather than
  // leaving the app, the same as a lot opened by tapping.
  useEffect(() => {
    if (!data) return;
    const h = readHash();
    if (h.lot == null && h.wash == null) {
      // A reload keeps the entry's state, so put back the phone tab it was on.
      const panel = histState()?.tab;
      if (panel) setPhoneView(panel);
      return;
    }
    const site = h.lot != null ? data.sites.find(x => x.uid === h.lot) : undefined;
    const wash = h.wash != null ? data.washes[h.wash] : undefined;
    if (!site && !wash) { window.history.replaceState(null, "", bareUrl()); return; }
    if (site) setSelected(scoreSite(site, DEFAULT_INPUTS)); else if (wash) setSelectedWash(wash);
    // A reload keeps the entry's state, so it is already ours.
    if (!window.history.state?.detail) {
      const hash = window.location.hash;
      window.history.replaceState(null, "", bareUrl());
      window.history.pushState({ detail: true }, "", hash);
    }
    // Runs once, when the data first arrives.
  }, [data]);

  const hasCityGrowth = useMemo(
    () => !!data?.sites.some(s => s.city_growth_pct != null), [data]);

  // Re-score the open site against the current settings, so its wording (the
  // competition radius, the land needed) never describes settings since changed.
  const detailScored = useMemo(
    () => selected ? { ...scoreSite(selected.site, deferred), nearby: selected.nearby } : null,
    [selected, deferred]);

  const iso = useMemo(
    () => data
      ? resolveIso(data.isoIndex, data.isoAssign, selected?.site.uid ?? null)
      : { features: [] as GeoJSON.Feature[], offsetMi: 0 },
    [data, selected]);

  // On a phone, opening the sheet shrinks the map in the same render that
  // selects the site. MapView frames the pick in an effect, before its
  // ResizeObserver has told MapLibre about the smaller canvas, so it fitted the
  // old full height and left the dot hidden under the sheet. Handing the map
  // the selection two frames later lets the resize land first.
  // A car wash gets the same handoff, so the map brings it into view above
  // the sheet rather than behind it.
  const [mapSelected, setMapSelected] = useState<Scored | null>(null);
  const [mapWash, setMapWash] = useState<Wash | null>(null);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { setMapSelected(selected); setMapWash(selectedWash); });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, selectedWash]);
  const mapIso = useMemo(
    () => data
      ? resolveIso(data.isoIndex, data.isoAssign, mapSelected?.site.uid ?? null)
      : { features: [] as GeoJSON.Feature[], offsetMi: 0 },
    [data, mapSelected]);

  if (err) return <Shell><div className="p-8 text-[13px]" style={{ color: "var(--bad)" }}>
    Failed to load data: {err}
  </div></Shell>;

  if (!data) return <Shell><div className="p-8 text-[13px]" style={{ color: "var(--ink-3)" }}>
    Loading lots, traffic and car wash data…
  </div></Shell>;

  const hasDetail = !!(selectedWash || detailScored);

  // One history entry per open panel. Switching straight to another record
  // swaps that entry, so back closes the panel instead of stepping through
  // every dot tapped.
  const markOpen = (hash: string) => {
    const st = histState();
    if (st?.detail) {
      window.history.replaceState(st, "", hash);
    } else {
      returnTo.current = phoneView;
      window.history.pushState({ detail: true, overTab: !!st?.tab }, "", hash);
    }
  };
  // When the entry is ours, step back over it and let popstate close the
  // panel, so the X leaves no stray entry for back to land on. A panel opened
  // from a shared link on a reload may not own one, so just clear the address.
  const closeDetail = () => {
    if (window.history.state?.detail) { window.history.back(); return; }
    if (window.location.hash) window.history.replaceState(null, "", bareUrl());
    setSelected(null); setSelectedWash(null); setSheetFull(false);
  };

  // On a phone, picking something always lands on the map with a half sheet,
  // so the person sees where the dot is before reading about it.
  const pickSite = (s: Scored | null) => {
    if (!s) return closeDetail();
    setSelected(s); setSelectedWash(null); setPhoneView("map"); setSheetFull(false);
    markOpen(`#lot=${encodeURIComponent(s.site.uid)}`);
  };
  const pickWash = (w: Wash | null) => {
    if (!w) return closeDetail();
    setSelectedWash(w); setSelected(null); setPhoneView("map"); setSheetFull(false);
    markOpen(`#wash=${data.washes.indexOf(w)}`);
  };
  // The phone tabs share one history entry: the first tab away from the map
  // adds it and moving between tabs swaps it, so back always means the map.
  const showPanel = (v: Exclude<PhoneView, "map">) => {
    if (histState()?.tab) window.history.replaceState({ tab: v }, "", bareUrl());
    else window.history.pushState({ tab: v }, "", bareUrl());
    setPhoneView(v);
  };
  const goPhone = (v: PhoneView) => {
    const st = histState();
    // Map is the way out of a full screen sheet: first down to the half
    // sheet, then, tapped again, to the whole map.
    if (v === "map" && tab === "map" && phoneView === "map" && hasDetail) {
      if (sheetFull) { setSheetFull(false); return; }
      // Asked for the map, so stay on it rather than return to the list.
      returnTo.current = "map";
      // Picked from a tab: step back over the tab's entry too.
      if (st?.detail && st.overTab) { window.history.go(-2); return; }
      closeDetail();
      return;
    }
    setTab("map");
    if (v !== "map") { showPanel(v); return; }
    setSheetFull(false);
    // Leaving a tab: step back over its entry and popstate shows the map.
    if (st?.tab) { window.history.back(); return; }
    setPhoneView("map");
  };

  // Keyed by record so scroll position and the Copy button state never carry
  // over from the previous pick.
  const renderDetail = (headerExtra?: React.ReactNode) => selectedWash
    ? <Boundary label="car wash">
        <WashDetail key={`${selectedWash.lat},${selectedWash.lon}`}
          w={selectedWash} onClose={closeDetail} headerExtra={headerExtra} />
      </Boundary>
    : detailScored
      ? <Boundary label="site">
          <SiteDetail key={detailScored.site.uid} s={detailScored} inputs={deferred} onClose={closeDetail}
            isoOffsetMi={iso.features.length ? iso.offsetMi : null} showIso={showIso}
            headerExtra={headerExtra} />
        </Boundary>
      : null;

  const countyNames = data.counties.map(c => c.county).sort();
  const noLotCounties = data.counties.filter(c => !c.candidate_parcels).map(c => c.county);

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-4 shrink-0"
        style={{ height: 46, background: "var(--panel)", borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-[13px] font-semibold whitespace-nowrap truncate" style={{ color: "var(--ink)" }}>
            Utah Car Wash Site Intelligence
          </span>
          <span className="text-[11px] truncate hidden md:block" style={{ color: "var(--ink-3)" }}>
            {data.sites.length.toLocaleString()} candidate lots in{" "}
            {data.counties.length - noLotCounties.length} counties ·{" "}
            {data.manifest.counts.wash_facilities_published?.toLocaleString()} car washes mapped
          </span>
        </div>
        <nav className="hidden md:flex gap-1 shrink-0">
          {tab === "map" && (
            // Between md and lg the filter rail has no room, so it opens over the map.
            <button onClick={() => setPhoneView(phoneView === "filters" ? "map" : "filters")}
              className="lg:hidden px-2.5 py-1 rounded text-[11.5px]"
              style={{
                background: phoneView === "filters" ? "var(--accent-dim)" : "transparent",
                color: phoneView === "filters" ? "var(--ink)" : "var(--ink-3)",
              }}>Filters</button>
          )}
          {([["map", "Map"], ["counties", "Counties"], ["methodology", "How it works"]] as [Tab, string][])
            .map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className="px-2.5 py-1 rounded text-[11.5px] transition-colors"
                style={{
                  background: tab === k ? "var(--accent-dim)" : "transparent",
                  color: tab === k ? "var(--ink)" : "var(--ink-3)",
                }}>{label}</button>
            ))}
        </nav>
        <button onClick={() => setTab(tab === "methodology" ? "map" : "methodology")}
          className="md:hidden shrink-0 px-3 h-9 rounded text-[12px]"
          style={{
            background: tab === "methodology" ? "var(--accent-dim)" : "var(--panel-2)",
            color: "var(--ink-2)",
          }}>{tab === "methodology" ? "Back to map" : "How it works"}</button>
      </header>

      <div className="flex-1 flex min-h-0">
        {tab === "map" && (
          <>
            <aside className="w-[264px] shrink-0 hidden lg:block"
              style={{ borderRight: "1px solid var(--line)" }}>
              <ControlRail inputs={inputs} setInputs={setInputs}
                showFormats={showFormats} setShowFormats={setShowFormats}
                counts={{ passed: result.passed, total: data.sites.length, shown: result.top.length }}
                countyNames={countyNames} noLotCounties={noLotCounties}
                hasCityGrowth={hasCityGrowth} />
            </aside>

            <main className="flex-1 relative min-w-0 flex flex-col">
              <div className="relative flex-1 min-h-0">
                <MapView top={result.top} washes={data.washes} selected={mapSelected}
                  selectedWash={mapWash}
                  onSelect={pickSite} onSelectWash={pickWash}
                  showFormats={showFormats}
                  isoFeatures={mapIso.features} showIso={showIso} />
                {busy && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded text-[11px]"
                    style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                    updating…
                  </div>
                )}
                <Legend showIso={showIso} setShowIso={setShowIso} hasSelection={!!selected}
                  hideOnPhone={hasDetail} />
              </div>

              {/* Phone detail sheet. A sibling of the map, never inside its
                  container, so MapLibre's touch handlers cannot swallow taps
                  on the links. Half height keeps the picked dot in view above. */}
              {hasDetail && (
                <div className={`md:hidden flex flex-col min-h-0 ${sheetFull ? "absolute inset-0 z-30" : "h-[58%] shrink-0 relative z-10"}`}
                  style={{ borderTop: "1px solid var(--line)", boxShadow: "0 -10px 30px rgba(0,0,0,.55)" }}>
                  {renderDetail(
                    <button onClick={() => setSheetFull(!sheetFull)}
                      aria-label={sheetFull ? "Show the map" : "Full screen"}
                      className="h-[44px] px-2.5 rounded-md text-[12px] whitespace-nowrap"
                      style={{ color: "var(--ink-2)", background: "var(--panel-2)" }}>
                      {sheetFull ? "Show map" : "Expand"}
                    </button>
                  )}
                </div>
              )}

              {/* Hidden rather than unmounted while a lot is open, so the
                  list is still scrolled to the same place when the person
                  comes back to it. */}
              <div className={`absolute inset-0 z-40 md:hidden ${phoneView === "sites" ? "" : "hidden"}`}
                style={{ background: "var(--panel)" }}>
                <ResultsList top={result.top} passed={result.passed}
                  distinct={result.distinct} inputs={deferred}
                  selected={selected} onSelect={pickSite} />
              </div>

              {(phoneView === "counties" || phoneView === "filters") && (
                <div className={`absolute inset-0 z-40 ${phoneView === "filters"
                    ? "lg:hidden md:right-auto md:w-[300px]"
                    : "md:hidden"}`}
                  style={{ background: "var(--panel)", borderRight: "1px solid var(--line)" }}>
                  {phoneView === "counties" && (
                    <CountyPanel counties={data.counties} active={inputs.county}
                      onPick={c => { setInputs({ ...inputs, county: c }); if (c) showPanel("sites"); }} />
                  )}
                  {phoneView === "filters" && (
                    <ControlRail inputs={inputs} setInputs={setInputs}
                      showFormats={showFormats} setShowFormats={setShowFormats}
                      counts={{ passed: result.passed, total: data.sites.length, shown: result.top.length }}
                      countyNames={countyNames} noLotCounties={noLotCounties}
                      hasCityGrowth={hasCityGrowth}
                      onShowResults={() => goPhone("map")} />
                  )}
                </div>
              )}
            </main>

            <aside className="w-[336px] shrink-0 hidden md:flex flex-col"
              style={{ borderLeft: "1px solid var(--line)" }}>
              <div className="flex shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
                {(["sites", "counties"] as const).map(t => (
                  <button key={t}
                    onClick={() => { setRightTab(t); if (t === "counties" && hasDetail) closeDetail(); }}
                    className="flex-1 py-2 text-[11px] uppercase tracking-[0.14em] transition-colors"
                    style={{
                      background: rightTab === t ? "var(--panel)" : "var(--panel-2)",
                      color: rightTab === t ? "var(--ink)" : "var(--ink-3)",
                      borderBottom: rightTab === t ? "1px solid var(--accent)" : "1px solid transparent",
                    }}>
                    {t === "sites" ? "Best spots" : "Counties"}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-0">
                {rightTab === "counties"
                  ? <CountyPanel counties={data.counties} active={inputs.county}
                      onPick={c => setInputs({ ...inputs, county: c })} />
                  : <>
                      {hasDetail && renderDetail()}
                      {/* Kept mounted under the open lot so closing it returns
                          to the same scroll position in the list. */}
                      <div className={hasDetail ? "hidden" : "h-full"}>
                        <ResultsList top={result.top} passed={result.passed}
                          distinct={result.distinct} inputs={deferred}
                          selected={selected} onSelect={pickSite} />
                      </div>
                    </>}
              </div>
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

      <nav className="md:hidden flex shrink-0"
        style={{
          background: "var(--panel)", borderTop: "1px solid var(--line)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}>
        {([["map", "Map"], ["sites", "Best spots"], ["counties", "Counties"], ["filters", "Filters"]] as [PhoneView, string][])
          .map(([k, label]) => {
            const on = tab === "map" && phoneView === k;
            return (
              <button key={k} onClick={() => goPhone(k)}
                className="flex-1 h-[52px] text-[12px] relative"
                style={{ color: on ? "var(--ink)" : "var(--ink-3)" }}>
                {label}
                {k === "filters" && inputs.county && (
                  <span className="block text-[9.5px] leading-none mt-0.5" style={{ color: "var(--accent)" }}>
                    county on
                  </span>
                )}
                {on && <span className="absolute top-0 left-4 right-4 h-[2px] rounded-full"
                  style={{ background: "var(--accent)" }} />}
              </button>
            );
          })}
      </nav>
    </div>
  );
}

function Legend({ showIso, setShowIso, hasSelection, hideOnPhone }: {
  showIso: boolean; setShowIso: (v: boolean) => void; hasSelection: boolean;
  /** The phone sheet leaves a short map, so the key gets out of the way. */
  hideOnPhone: boolean;
}) {
  // Closed to one line by default on phones, where the full key would cover
  // half the map. Desktop always shows all of it.
  const [open, setOpen] = useState(false);
  const grades: [string[], string][] = [
    [["#f85149", "#e08c3f"], "Weak"], [["#d29922"], "Fair"],
    [["#7ecf4f"], "Good"], [["#3fb950"], "Strong"],
  ];
  return (
    <div className={`${hideOnPhone ? "hidden md:block" : ""} absolute top-3 left-3 right-14 md:right-auto md:top-auto md:bottom-6 max-w-[300px] px-3 py-0.5 md:py-2.5 rounded text-[11px] leading-snug`}
      style={{ background: "rgba(17,20,27,.94)", border: "1px solid var(--line)" }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="md:hidden w-full min-h-[40px] flex items-center justify-between gap-2 text-left"
        style={{ color: "var(--ink-2)" }}>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "#3fb950" }} />
          <span className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ border: `1.5px solid ${FORMAT_COLOR.express_tunnel}`, background: `${FORMAT_COLOR.express_tunnel}80` }} />
          What the dots mean
        </span>
        <span style={{ color: "var(--accent)" }}>{open ? "Hide" : "Show"}</span>
      </button>

      <div className={`${open ? "block" : "hidden"} md:block pb-2.5 md:pb-0`}>
        <div className="flex items-start gap-2" style={{ color: "var(--ink-2)" }}>
          <span className="w-2.5 h-2.5 mt-[3px] rounded-full shrink-0" style={{ background: "#3fb950" }} />
          <span>Filled dot: a commercial lot scored for a car wash. Not necessarily for sale.</span>
        </div>
        <div className="flex items-start gap-2 mt-1" style={{ color: "var(--ink-2)" }}>
          <span className="w-2.5 h-2.5 mt-[3px] rounded-full shrink-0"
            style={{ border: `1.5px solid ${FORMAT_COLOR.express_tunnel}`, background: `${FORMAT_COLOR.express_tunnel}80` }} />
          <span>Ringed dot: an existing car wash. Tap or click either one.</span>
        </div>

        <div className="mt-2.5 pt-2.5"
          style={{ borderTop: "1px solid var(--line-soft)" }}>
          <div className="mb-1.5" style={{ color: "var(--ink-3)" }}>Lot color shows the score</div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mb-2.5">
            {grades.map(([cs, l]) => (
              <span key={l} className="flex items-center gap-1" style={{ color: "var(--ink-3)" }}>
                {cs.map(c => <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />)}
                {l}
              </span>
            ))}
          </div>
          <div className="mb-1.5" style={{ color: "var(--ink-3)" }}>Ring color shows the type of car wash</div>
          <div className="flex flex-col gap-1 mb-2.5">
            {FORMAT_NAMES.map(([k, l]) => (
              <span key={k} className="flex items-center gap-1.5" style={{ color: "var(--ink-3)" }}>
                <span className="w-2.5 h-2.5 rounded-full"
                  style={{ border: `1.5px solid ${FORMAT_COLOR[k]}`, background: `${FORMAT_COLOR[k]}80` }} />
                {l}
              </span>
            ))}
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer min-h-[24px]"
            style={{ color: hasSelection ? "var(--ink-2)" : "var(--ink-3)" }}>
            <input type="checkbox" checked={showIso} onChange={e => setShowIso(e.target.checked)}
              className="accent-[color:var(--accent)] w-3.5 h-3.5" />
            <span className="w-2.5 h-2.5 rounded-sm"
              style={{ background: "rgba(77,163,255,.22)", border: "1px solid #4da3ff" }} />
            5 and 10 minute drive areas
          </label>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh flex items-center justify-center">{children}</div>;
}
