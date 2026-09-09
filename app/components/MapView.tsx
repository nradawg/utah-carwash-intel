"use client";
import { useEffect, useRef } from "react";
import maplibregl, { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Scored } from "@/lib/scoring";
import type { Wash } from "@/lib/data";

/**
 * CARTO dark raster basemap: no API key, no billing, and raster tiles need no
 * vector-tile worker, which makes it far more robust in sandboxed webviews.
 * Attribution is required and is rendered by the map's attribution control.
 */
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      maxzoom: 20,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0a0c10" } },
    { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.92 } },
  ],
};

const FORMAT_COLOR: Record<string, string> = {
  express_tunnel: "#f85149",
  flex_full_serve: "#ff8c42",
  in_bay_automatic: "#d29922",
  self_serve: "#8b949e",
  hand_detail: "#6e7681",
  truck_wash: "#a371f7",
  unknown: "#4b525e",
};

/**
 * MapLibre loads its style inside requestAnimationFrame. Browsers never fire
 * RAF while a document is hidden, so a map constructed in a background tab
 * never finishes initialising and stays blank even after the tab is shown.
 * Fall back to a timer while hidden; hand back to real RAF once visible, so
 * rendering stays vsync-aligned whenever the page is actually on screen.
 */
function ensureRafWhenHidden() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __rafPatched?: boolean };
  if (w.__rafPatched) return;
  w.__rafPatched = true;
  const native = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    document.hidden
      ? (window.setTimeout(() => cb(performance.now()), 16) as unknown as number)
      : native(cb)) as typeof window.requestAnimationFrame;
}

function scoreColor(t: number) {
  if (t >= 70) return "#3fb950";
  if (t >= 58) return "#7ecf4f";
  if (t >= 48) return "#d29922";
  if (t >= 38) return "#e08c3f";
  return "#f85149";
}

export default function MapView({
  top, washes, selected, onSelect, showFormats,
}: {
  top: Scored[]; washes: Wash[]; selected: Scored | null;
  onSelect: (s: Scored | null) => void; showFormats: Set<string>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const topRef = useRef(top);
  topRef.current = top;

  useEffect(() => {
    if (!el.current || map.current) return;
    ensureRafWhenHidden();
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: [-111.87, 40.3],
      zoom: 7.1,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.on("error", (e) => console.error("[maplibre]", e?.error?.message ?? e));
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

    m.on("load", () => {
      m.addSource("washes", { type: "geojson", data: empty() });
      m.addLayer({
        id: "washes", type: "circle", source: "washes",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2.4, 11, 6, 15, 10],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.85,
          "circle-stroke-width": 0.6,
          "circle-stroke-color": "#0a0c10",
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

      m.on("click", "sites", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const idx = f.properties?.idx as number;
        onSelectRef.current(topRef.current[idx] ?? null);
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
          `<strong>${esc(p.name || "Unnamed")}</strong><br/>${esc(p.label)}` +
          `<br/><span style="color:#626b7a">${esc(p.evidence)}</span>`
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

  // sync competitor layer
  useEffect(() => {
    const m = map.current; if (!m) return;
    const push = () => {
      const src = m.getSource("washes") as maplibregl.GeoJSONSource | undefined;
      if (!src) { m.once("load", push); return; }
      src.setData({
        type: "FeatureCollection",
        features: washes.filter(w => showFormats.has(w.format)).map(w => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [w.lon, w.lat] },
          properties: {
            name: w.name ?? "", label: w.format_label,
            evidence: w.format_source === "none" ? "format not determined" : w.format_evidence,
            color: FORMAT_COLOR[w.format] ?? "#4b525e",
          },
        })),
      });
    };
    push();
  }, [washes, showFormats]);

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
            sel: selected?.site.parcel_id === s.site.parcel_id,
          },
        })),
      });
    };
    push();
  }, [top, selected]);

  // fly to selection
  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    m.flyTo({ center: [selected.site.lon, selected.site.lat], zoom: Math.max(m.getZoom(), 13.2), duration: 750 });
  }, [selected]);

  return <div ref={el} className="absolute inset-0" />;
}

const empty = (): GeoJSON.FeatureCollection =>
  ({ type: "FeatureCollection", features: [] });

function esc(s: string) {
  return String(s ?? "").replace(/[<>&"]/g, c =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
}

export { FORMAT_COLOR, scoreColor };
