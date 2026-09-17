"use client";
import { useEffect, useRef } from "react";
import maplibregl, { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Scored } from "@/lib/scoring";
import type { Wash } from "@/lib/data";
import { FORMAT_NAME } from "@/lib/formatNames";

/**
 * OpenFreeMap dark: free, no API key, no usage cap and no watermark. CARTO's
 * basemaps stamp "API KEY REQUIRED" across unauthenticated tiles, which is why
 * they are not used here despite the tile URLs returning 200.
 * Attribution is carried by the style and rendered by the attribution control.
 */
const STYLE = "https://tiles.openfreemap.org/styles/dark";

/**
 * Competitors use a cool palette and a light ring; ranked sites use a warm
 * red-to-green score ramp and a solid fill. Previously express tunnels and
 * low-scoring sites were both #f85149, and in-bay washes and mid-scoring sites
 * were both #d29922, so the same colour meant two different things.
 * Express tunnels get the highest-salience colour because they are the only
 * format that really competes with another tunnel.
 */
const FORMAT_COLOR: Record<string, string> = {
  express_tunnel: "#ff5fd2",
  flex_full_serve: "#c77dff",
  in_bay_automatic: "#7aa2f7",
  self_serve: "#56cfe1",
  hand_detail: "#7f8794",
  truck_wash: "#9d8df1",
  unknown: "#8b93a7",
};

/**
 * MapLibre loads its style inside requestAnimationFrame. Browsers never fire
 * RAF while a document is hidden, so a map constructed in a background tab
 * never finishes initialising and stays blank even after the tab is shown.
 * Fall back to a timer while hidden, and hand back to real RAF once visible so
 * rendering stays vsync-aligned whenever the page is actually on screen.
 *
 * cancelAnimationFrame must be patched too. Without it MapLibre cannot cancel
 * a pending timer-backed frame, so a queued render fires after map.remove()
 * and throws on the torn-down style. Timer ids are offset into their own range
 * so they can never be confused with native RAF handles.
 */
const TIMER_ID_OFFSET = 1e9;

function ensureRafWhenHidden() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __rafPatched?: boolean };
  if (w.__rafPatched) return;
  w.__rafPatched = true;

  const rafNative = window.requestAnimationFrame.bind(window);
  const cafNative = window.cancelAnimationFrame.bind(window);

  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    if (!document.hidden) return rafNative(cb);
    const timer = window.setTimeout(() => cb(performance.now()), 16);
    return timer + TIMER_ID_OFFSET;
  }) as typeof window.requestAnimationFrame;

  window.cancelAnimationFrame = ((handle: number) => {
    if (handle >= TIMER_ID_OFFSET) clearTimeout(handle - TIMER_ID_OFFSET);
    else cafNative(handle);
  }) as typeof window.cancelAnimationFrame;
}

/**
 * The desktop framing (centre and zoom) is wider than a phone is, so on a
 * phone it cut off St. George and the whole south of the state. Phones fit
 * the state outline instead. Top padding clears the one line map key.
 */
const UTAH_BOUNDS: [[number, number], [number, number]] = [[-114.06, 36.99], [-109.04, 42.01]];
const PHONE_FIT = { padding: { top: 56, bottom: 28, left: 16, right: 16 } };

function scoreColor(t: number) {
  if (t >= 70) return "#3fb950";
  if (t >= 58) return "#7ecf4f";
  if (t >= 48) return "#d29922";
  if (t >= 38) return "#e08c3f";
  return "#f85149";
}

export default function MapView({
  top, washes, selected, selectedWash, onSelect, onSelectWash, showFormats, isoFeatures, showIso,
}: {
  top: Scored[]; washes: Wash[]; selected: Scored | null;
  /** The open car wash, marked with a halo and brought into view. */
  selectedWash: Wash | null;
  onSelect: (s: Scored | null) => void;
  onSelectWash: (w: Wash | null) => void;
  showFormats: Set<string>;
  isoFeatures: GeoJSON.Feature[]; showIso: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onWashRef = useRef(onSelectWash);
  onWashRef.current = onSelectWash;
  const washRef = useRef(washes);
  washRef.current = washes;
  const topRef = useRef(top);
  topRef.current = top;

  useEffect(() => {
    if (!el.current || map.current) return;
    ensureRafWhenHidden();
    const phone = window.matchMedia("(max-width: 767px)").matches;
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      ...(phone
        ? { bounds: UTAH_BOUNDS, fitBoundsOptions: PHONE_FIT }
        : { center: [-111.87, 40.3] as [number, number], zoom: 7.1 }),
      // UGRC's CC BY 4.0 licence asks maps to credit "UGRC SGID (data modified)".
      attributionControl: {
        compact: true,
        customAttribution: "Data: UGRC SGID (data modified), UDOT, US Census Bureau, Overture Maps, © OpenStreetMap contributors",
      },
    });
    map.current = m;
    // The compact credit line opens expanded, and on a phone it covers the
    // bottom of the map. Start it closed there, down to its i button. The
    // style is set before the control is added, so the control is already in
    // place and will not reopen itself.
    if (phone) {
      const attrib = el.current.querySelector(".maplibregl-ctrl-attrib");
      attrib?.classList.remove("maplibregl-compact-show");
      attrib?.removeAttribute("open");
    }
    m.on("error", (e) => console.error("[maplibre]", e?.error?.message ?? e));
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

    m.on("load", () => {
      // Drive-time isochrones sit beneath everything else.
      m.addSource("iso", { type: "geojson", data: empty() });
      m.addLayer({
        id: "iso-10-fill", type: "fill", source: "iso",
        filter: ["==", ["get", "minutes"], 10],
        paint: { "fill-color": "#4da3ff", "fill-opacity": 0.10 },
      });
      m.addLayer({
        id: "iso-5-fill", type: "fill", source: "iso",
        filter: ["==", ["get", "minutes"], 5],
        paint: { "fill-color": "#4da3ff", "fill-opacity": 0.16 },
      });
      m.addLayer({
        id: "iso-line", type: "line", source: "iso",
        paint: {
          "line-color": "#4da3ff",
          "line-width": ["case", ["==", ["get", "minutes"], 5], 1.6, 1],
          "line-opacity": 0.75,
          "line-dasharray": ["case", ["==", ["get", "minutes"], 5], ["literal", [1, 0]], ["literal", [3, 2]]],
        },
      });

      m.addSource("washes", { type: "geojson", data: empty() });
      m.addLayer({
        id: "washes", type: "circle", source: "washes",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2.6, 11, 5.5, 15, 9],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.5,
          "circle-stroke-width": 1.4,
          "circle-stroke-color": ["get", "color"],
        },
      });

      m.addSource("sites", { type: "geojson", data: empty() });
      m.addLayer({
        id: "sites", type: "circle", source: "sites",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"],
            6, ["interpolate", ["linear"], ["get", "score"], 30, 3, 85, 6.5],
            11, ["interpolate", ["linear"], ["get", "score"], 30, 6, 85, 15]],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1.4,
          "circle-stroke-color": "#0a0c10",
        },
      });
      m.addLayer({
        id: "site-halo", type: "circle", source: "sites",
        filter: ["==", ["get", "sel"], true],
        paint: {
          "circle-radius": 20, "circle-color": "#4da3ff",
          "circle-opacity": 0.18, "circle-stroke-width": 1.5,
          "circle-stroke-color": "#4da3ff",
        },
      });
      // The open car wash, matched by its index in the washes list. Nothing
      // matches -1, so the halo is hidden until a wash is picked.
      m.addLayer({
        id: "wash-halo", type: "circle", source: "washes",
        filter: ["==", ["get", "idx"], -1],
        paint: {
          "circle-radius": 20, "circle-color": "#4da3ff",
          "circle-opacity": 0.18, "circle-stroke-width": 1.5,
          "circle-stroke-color": "#4da3ff",
        },
      });

      // One click handler with a tap radius, instead of per-layer handlers
      // that only fire on an exact hit. At state zoom a dot is 3 to 6 px
      // across, which a finger on a phone almost never lands on. Pick the
      // nearest dot within the radius; candidate sites win a tie because they
      // are drawn on top.
      m.on("click", (e) => {
        const coarse = window.matchMedia("(pointer: coarse)").matches;
        const r = coarse ? 16 : 7;
        const hits = m.queryRenderedFeatures(
          [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]],
          { layers: ["sites", "washes"] });
        let best: { f: maplibregl.MapGeoJSONFeature; d: number } | null = null;
        for (const f of hits) {
          const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
          const pt = m.project([lon, lat]);
          const d = Math.hypot(pt.x - e.point.x, pt.y - e.point.y)
            - (f.layer.id === "sites" ? 1 : 0);
          if (d <= r && (!best || d < best.d)) best = { f, d };
        }
        if (!best) return;
        const idx = best.f.properties?.idx as number;
        if (best.f.layer.id === "sites") onSelectRef.current(topRef.current[idx] ?? null);
        else onWashRef.current(washRef.current[idx] ?? null);
      });

      for (const l of ["sites", "washes"]) {
        m.on("mouseenter", l, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", l, () => { m.getCanvas().style.cursor = ""; });
      }
      const pop = new maplibregl.Popup({ closeButton: false, offset: 9 });
      m.on("mouseenter", "washes", (e) => {
        const p = e.features?.[0]?.properties as Record<string, string> | undefined;
        if (!p) return;
        pop.setLngLat((e.lngLat)).setHTML(
          `<strong>${esc(p.name || "Unnamed car wash")}</strong><br/>${esc(p.label)}` +
          `<br/><span style="color:#626b7a">Click for details</span>`
        ).addTo(m);
      });
      m.on("mouseleave", "washes", () => pop.remove());

      ready.current = true;
      m.resize();
    });

    // The container is laid out by flexbox after the map is constructed, so the
    // canvas otherwise stays at its 400x300 default. Track the element instead
    // of relying on window resize.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);

    return () => { ro.disconnect(); m.remove(); map.current = null; ready.current = false; };
  }, []);

  // sync competitor layer. The open wash stays drawn even when its type is
  // switched off in the filters, so its halo always has a dot inside it.
  const washIdx = selectedWash ? washes.indexOf(selectedWash) : -1;
  useEffect(() => {
    const m = map.current; if (!m) return;
    const push = () => {
      const src = m.getSource("washes") as maplibregl.GeoJSONSource | undefined;
      if (!src) { m.once("load", push); return; }
      m.setFilter("wash-halo", ["==", ["get", "idx"], washIdx]);
      src.setData({
        type: "FeatureCollection",
        features: washes.map((w, idx) => ({ w, idx }))
          .filter(({ w, idx }) => showFormats.has(w.format) || idx === washIdx)
          .map(({ w, idx }) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [w.lon, w.lat] },
          properties: {
            idx, name: w.name ?? "", label: FORMAT_NAME[w.format] ?? w.format_label,
            color: FORMAT_COLOR[w.format] ?? "#4b525e",
          },
        })),
      });
    };
    push();
  }, [washes, showFormats, washIdx]);

  // sync ranked sites
  useEffect(() => {
    const m = map.current; if (!m) return;
    const push = () => {
      const src = m.getSource("sites") as maplibregl.GeoJSONSource | undefined;
      if (!src) { m.once("load", push); return; }
      src.setData({
        type: "FeatureCollection",
        features: top.map((s, idx) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [s.site.lon, s.site.lat] },
          properties: {
            idx, score: s.total, color: scoreColor(s.total),
            sel: selected?.site.uid === s.site.uid,
          },
        })),
      });
    };
    push();
  }, [top, selected]);

  // isochrone for the selected site only
  useEffect(() => {
    const m = map.current; if (!m) return;
    const push = () => {
      const src = m.getSource("iso") as maplibregl.GeoJSONSource | undefined;
      if (!src) { m.once("load", push); return; }
      src.setData({
        type: "FeatureCollection",
        features: showIso ? isoFeatures : [],
      });
    };
    push();
  }, [isoFeatures, showIso]);

  // Frame the selection. When a drive-time polygon exists, fit to it: the
  // trade area is the point of selecting a site, and a tight zoom on the
  // parcel hides it entirely.
  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    const ten = showIso
      ? isoFeatures.find(f => f.properties?.minutes === 10)
      : undefined;
    if (ten) {
      let minX = 180, minY = 90, maxX = -180, maxY = -90;
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") {
          const [x, y] = c as [number, number];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        } else if (Array.isArray(c)) c.forEach(walk);
      };
      walk((ten.geometry as GeoJSON.Polygon).coordinates);
      if (minX <= maxX) {
        m.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: 800, maxZoom: 13 });
        return;
      }
    }
    m.flyTo({ center: [selected.site.lon, selected.site.lat], zoom: Math.max(m.getZoom(), 13.2), duration: 750 });
  }, [selected, isoFeatures, showIso]);

  // Bring the open car wash into view. On a phone the half sheet covers the
  // lower part of the map, and the page hands this over only after the map
  // has shrunk to the space above the sheet, so centering here lands the wash
  // in the part still showing.
  useEffect(() => {
    const m = map.current;
    if (!m || !selectedWash) return;
    m.easeTo({ center: [selectedWash.lon, selectedWash.lat], zoom: Math.max(m.getZoom(), 12), duration: 750 });
  }, [selectedWash]);

  // Inline styles, not Tailwind classes: maplibre-gl.css declares
  // `.maplibregl-map { position: relative }` and is bundled after Tailwind's
  // utilities, so it beats `.absolute` at equal specificity. That left the
  // container at position:relative with inset-0 doing nothing, collapsing it
  // to zero height so the map could never render. Inline styles win over any
  // stylesheet regardless of order.
  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}

const empty = (): GeoJSON.FeatureCollection =>
  ({ type: "FeatureCollection", features: [] });

function esc(s: string) {
  return String(s ?? "").replace(/[<>&"]/g, c =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
}

export { FORMAT_COLOR, scoreColor };
