"use client";
import type { Wash } from "@/lib/data";
import { FORMAT_COLOR } from "./MapView";

function Row({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="py-2" style={{ borderBottom: "1px solid var(--line-soft)" }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>{k}</div>
      <div className="text-[12.5px] mt-0.5 break-words" style={{ color: "var(--ink)" }}>{v}</div>
      {sub && <div className="text-[10.5px] mt-0.5" style={{ color: "var(--ink-3)" }}>{sub}</div>}
    </div>
  );
}

/**
 * Community-maintained URLs are frequently missing a scheme ("www.foo.com") or
 * are simply malformed. new URL() throws on those, which previously took the
 * whole page down when a record with a bad website was opened.
 */
function safeUrl(raw: string | null): { href: string; label: string } | null {
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(candidate);
    if (!u.hostname.includes(".")) return null;
    return { href: u.href, label: u.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-[11.5px] underline block" style={{ color: "var(--accent)" }}>
      {children}
    </a>
  );
}

/** Human-readable OSM opening_hours are already terse; just show them as given. */
export default function WashDetail({ w, onClose }: { w: Wash; onClose: () => void }) {
  const q = encodeURIComponent(`${w.name ?? "car wash"} ${w.address ?? ""} ${w.city ?? ""}`.trim());
  const confidencePct = Math.round((w.format_confidence ?? 0) * 100);
  const sources = (w.confirmed_by ?? "").split(", ").filter(Boolean);

  return (
    <div className="fade h-full overflow-y-auto" style={{ background: "var(--panel)" }}>
      <div className="px-4 pt-4 pb-3 sticky top-0 z-10"
        style={{ background: "var(--panel)", borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: "var(--ink-3)" }}>
              Existing wash
            </div>
            <div className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              {w.name || "Unnamed car wash"}
            </div>
            <div className="text-[11.5px] mt-0.5" style={{ color: "var(--ink-2)" }}>
              {[w.address, w.city].filter(Boolean).join(", ") || "no address on record"}
            </div>
          </div>
          <button onClick={onClose} className="text-[16px] leading-none px-1"
            style={{ color: "var(--ink-3)" }} aria-label="close">×</button>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ border: `1.5px solid ${FORMAT_COLOR[w.format]}`,
                     background: `${FORMAT_COLOR[w.format]}80` }} />
          <span className="text-[13px]" style={{ color: "var(--ink)" }}>{w.format_label}</span>
          {w.is_competitor
            ? <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--accent-dim)", color: "var(--ink-2)" }}>counted as competition</span>
            : <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--panel-2)", color: "var(--ink-3)" }}>not counted</span>}
        </div>
      </div>

      <div className="px-4 py-1">
        <Row k="How the format was determined"
          v={w.format_source === "none" ? "Could not be determined" : `${confidencePct}% confidence`}
          sub={w.format_evidence} />

        <Row k="Confirmed by"
          v={`${w.n_sources} independent ${w.n_sources === 1 ? "survey" : "surveys"}`}
          sub={sources.join(" · ") || undefined} />

        {w.brand && <Row k="Brand" v={w.brand}
          sub={w.brand_wikidata ? `Wikidata ${w.brand_wikidata}` : undefined} />}

        {w.phone && <Row k="Phone" v={
          <a href={`tel:${w.phone.replace(/[^\d+]/g, "")}`} className="underline"
            style={{ color: "var(--accent)" }}>{w.phone}</a>} />}

        {w.opening_hours && <Row k="Opening hours" v={w.opening_hours}
          sub="As recorded in OpenStreetMap" />}

        {w.amenities && <Row k="On site" v={w.amenities.split(",").join(", ").replace(/_/g, " ")} />}

        {w.postcode && <Row k="Postcode" v={w.postcode} />}

        {w.last_checked && <Row k="Last surveyed" v={w.last_checked}
          sub="Date a mapper last verified this on the ground" />}

        <Row k="Coordinates" v={<span className="mono text-[11.5px]">{w.lat.toFixed(5)}, {w.lon.toFixed(5)}</span>}
          sub={w.county ? `${w.county} County` : undefined} />
      </div>

      <div className="px-4 py-4 flex flex-col gap-2"
        style={{ borderTop: "1px solid var(--line-soft)" }}>
        <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: "var(--ink-3)" }}>
          Verify and see more
        </div>
        {(() => { const u = safeUrl(w.website);
          return u ? <Link href={u.href}>{u.label}</Link> : null; })()}
        <Link href={`https://www.google.com/maps/search/?api=1&query=${q}`}>
          Open on Google Maps for reviews, photos and hours
        </Link>
        <Link href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${w.lat},${w.lon}`}>
          Street View at this location
        </Link>
        {w.osm_id && (
          <Link href={`https://www.openstreetmap.org/${w.osm_id}`}>
            View the OpenStreetMap record
          </Link>
        )}
        {(w.socials ?? "").split(",").map(safeUrl).filter(Boolean).slice(0, 2).map(u => (
          <Link key={u!.href} href={u!.href}>{u!.label}</Link>
        ))}
        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>
          Ratings and review counts are not republished here. Google&apos;s terms do not permit
          storing them, so the link above goes to the source instead.
        </p>
      </div>
    </div>
  );
}
