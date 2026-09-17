"use client";
import { useEffect, useState } from "react";
import type { Inputs, Scored } from "@/lib/scoring";
import { scoreColor } from "./MapView";
import { acresText, buildingKind, countyLabel, explain, grade, placeName, plainText, siteTitle, streetAddress } from "./plain";

const money = (n: number | null) => n == null ? "not listed" : `$${Math.round(n).toLocaleString()}`;

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] uppercase tracking-[0.14em] mb-2.5" style={{ color: "var(--ink-3)" }}>
      {children}
    </div>
  );
}

function Fact({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="py-2" style={{ borderBottom: "1px solid var(--line-soft)" }}>
      <div className="flex justify-between items-baseline gap-3 text-[12.5px]">
        <span style={{ color: "var(--ink-3)" }}>{k}</span>
        <span className="text-right" style={{ color: "var(--ink)" }}>{v}</span>
      </div>
      {sub && <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>{sub}</div>}
    </div>
  );
}

/**
 * A real anchor, never a button with window.open, so it works under popup
 * blockers and long-press on phones. Tall enough to hit with a thumb. The
 * notes wrap in full: they carry the steps for getting past a county login
 * page, and a cut off step is a link that seems not to work.
 */
function OutLink({ href, title, notes }: { href: string; title: string; notes?: string[] }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-md min-h-[48px]"
      style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
      <span className="min-w-0">
        <span className="block text-[13px]" style={{ color: "var(--accent)" }}>{title}</span>
        {notes?.filter(Boolean).map(n => (
          <span key={n} className="block text-[11px] mt-0.5 leading-relaxed break-words" style={{ color: "var(--ink-3)" }}>{n}</span>
        ))}
      </span>
      <span aria-hidden className="text-[15px] shrink-0" style={{ color: "var(--ink-3)" }}>↗</span>
    </a>
  );
}

/**
 * The clipboard API needs a secure context and can be refused on iOS, so fall
 * back to the old select and execCommand route, and if that fails too the ID
 * is still select-all text a person can long-press.
 */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

function CopyButton({ text, onResult }: { text: string; onResult: (ok: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  // "Copied" goes back to "Copy" so a second tap visibly does something. A
  // failed copy keeps the label and the card shows how to copy by hand.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button type="button"
      onClick={async () => { const ok = await copyText(text); setCopied(ok); onResult(ok); }}
      className="shrink-0 px-3.5 rounded-md text-[12.5px] min-h-[44px] min-w-[64px]"
      style={{ background: "var(--accent-dim)", color: "var(--ink)" }}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * The three things a county page shows that prove it is the same lot. Shown
 * for every lot, whatever kind of link the county has, because a search page,
 * a state map and a homepage all need the ID, and even a direct record is
 * worth checking against.
 */
function LotCheck({ s, onMap }: { s: Scored["site"]; onMap: boolean }) {
  const addr = streetAddress(s.address, true);
  const place = placeName(s);
  const [copyFailed, setCopyFailed] = useState(false);
  return (
    <div className="px-3.5 py-2.5 rounded-md" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
      <div className="text-[11px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
        {onMap ? "Check the map shows the same lot:" : "Check the county page shows the same lot:"}
      </div>
      <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--ink-3)" }}>
        The county may add dashes or colons to the number, and street numbers can differ slightly.
        Match the digits and the acres.
      </div>
      <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--ink-3)" }}>
        If the county page or map shows a different parcel, the county may have split or merged this
        lot since its last tax roll.
      </div>
      <div className="flex items-center justify-between gap-3 mt-1.5">
        <span className="min-w-0">
          <span className="block text-[11px]" style={{ color: "var(--ink-3)" }}>Parcel ID</span>
          <span className="block mono text-[13px] select-all break-all" style={{ color: "var(--ink)" }}>{s.parcel_id}</span>
          {copyFailed && (
            <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink-2)" }}>
              Press and hold the number to copy it
            </span>
          )}
        </span>
        <CopyButton text={s.parcel_id} onResult={ok => setCopyFailed(!ok)} />
      </div>
      <div className="text-[12px] mt-2 leading-relaxed" style={{ color: "var(--ink-2)" }}>
        <span style={{ color: "var(--ink-3)" }}>Address: </span>
        {addr ? `${addr}${place ? `, ${place}` : ""}` : "none on county records"}
      </div>
      <div className="text-[12px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        <span style={{ color: "var(--ink-3)" }}>Size: </span>{acresText(s.acres)}
      </div>
    </div>
  );
}

/**
 * One link per county kind, with one instruction each. The label comes from
 * the pipeline, which checked each county's site by hand, so it wins over any
 * wording here; the fallbacks only cover a sites file without labels.
 */
function CountyLink({ s }: { s: Scored["site"] }) {
  const county = countyLabel(s.county);
  // Only real web links; anything else in the column is treated as no link.
  const url = s.parcel_url && /^https?:\/\//i.test(s.parcel_url) ? s.parcel_url : null;
  const kind = url ? s.parcel_url_kind ?? null : null;
  const label = plainText(s.parcel_url_label) || null;

  if (url && kind === "parcel") {
    return <OutLink href={url} title="County record for this lot"
      notes={[label ?? `Opens this lot on the ${county} County website.`]} />;
  }
  if (url && kind === "search") {
    return <OutLink href={url} title="County search for this lot"
      notes={[label ?? `Opens the ${county} County search for this parcel ID.`]} />;
  }
  if (url && kind === "statewide") {
    return <OutLink href={url} title="Utah parcel map"
      notes={[label ?? "Click I agree, then look at the center of the map."]} />;
  }
  // A homepage is not the parcel, so say so rather than let it look broken.
  if (url && kind === "homepage") {
    return <OutLink href={url} title={`${county} County assessor website`}
      notes={["This opens the county website, not the lot. Search there for the parcel ID below."]} />;
  }
  return (
    <div className="text-[11.5px] leading-relaxed px-0.5" style={{ color: "var(--ink-3)" }}>
      There is no direct county link for this lot. Search for the parcel ID below on the {county} County
      assessor website, or use the Utah parcel map.
    </div>
  );
}

/**
 * UGRC's statewide viewer reads #County Name/location/x,y,scale in spherical
 * Web Mercator metres and opens there with parcel lines drawn, for all 29
 * counties. Same formula as statewide_url() in scripts/parcel_links.py.
 */
function parcelMapUrl(countyKey: string, lat: number, lon: number) {
  const R = 20037508.342789244;
  const x = (lon * R) / 180;
  const y = ((Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * R) / 180;
  return `https://parcels.utah.gov/#${encodeURIComponent(countyLabel(countyKey))}/location/${x.toFixed(1)},${y.toFixed(1)},1500`;
}

export default function SiteDetail({ s, inputs, onClose, isoOffsetMi, showIso, headerExtra }: {
  s: Scored; inputs: Inputs; onClose: () => void; isoOffsetMi: number | null;
  /** Whether drive areas are switched on in the map key. Omitted means on. */
  showIso?: boolean;
  /** Extra header controls, used by the phone sheet for its size toggle. */
  headerExtra?: React.ReactNode;
}) {
  const site = s.site;
  const g = grade(s.total);
  const color = scoreColor(g.n);
  const { sentence, drawback, lines, warnings } = explain(s, inputs);
  const county = countyLabel(site.county);
  const place = placeName(site);
  const { lat, lon } = site;
  const hasAddress = !!streetAddress(site.address);
  // Street View opens where the camera stands. The lot centre is often deep
  // inside the lot with no photo, so stand on the nearest road when we have it.
  const sv = site.sv_lat != null && site.sv_lon != null ? [site.sv_lat, site.sv_lon] : [lat, lon];
  const svPoint = `${sv[0].toFixed(6)},${sv[1].toFixed(6)}`;
  const stateMapIsMain = !!site.parcel_url && /^https?:\/\//i.test(site.parcel_url) && site.parcel_url_kind === "statewide";
  const valueNote = "Check with the county before making any offer.";
  const bldg = buildingKind(site);
  // Offsets are hundredths of a mile; under a quarter mile is the same spot to a driver.
  const isoMi = isoOffsetMi != null && isoOffsetMi >= 0.25 ? Number(isoOffsetMi.toFixed(1)) : null;

  return (
    <div className="fade h-full overflow-y-auto overscroll-contain" style={{ background: "var(--panel)" }}>
      <div className="px-4 pt-3 pb-2.5 sticky top-0 z-10 flex items-start justify-between gap-2"
        style={{ background: "var(--panel)", borderBottom: "1px solid var(--line-soft)" }}>
        <div className="min-w-0 pt-1">
          <div className="text-[15px] font-semibold leading-snug break-words" style={{ color: "var(--ink)" }}>
            {siteTitle(site)}
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: "var(--ink-2)" }}>
            {hasAddress
              ? (place ? `${place}, ${county} County` : `${county} County`)
              : "No street address on county records"}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {headerExtra}
          {/* Pixels, not rem: the root font is 13px, so w-11 would be 36px. */}
          <button onClick={onClose} aria-label="Close"
            className="w-[44px] h-[44px] rounded-md flex items-center justify-center text-[22px] leading-none"
            style={{ color: "var(--ink-2)", background: "var(--panel-2)" }}>×</button>
        </div>
      </div>

      <div className="px-4 pt-3 pb-4" style={{ borderBottom: "1px solid var(--line-soft)" }}>
        <div className="flex items-baseline gap-2.5">
          <span className="text-[20px] font-semibold" style={{ color }}>{g.word}</span>
          <span className="mono text-[20px] font-semibold" style={{ color }}>{g.n}</span>
          <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>out of 100</span>
        </div>
        {/* A working property or a changed parcel is the first thing to know. */}
        {warnings.map(w => (
          <p key={w} className="text-[13px] font-medium mt-2.5 px-3 py-2 rounded-md leading-relaxed"
            style={{ color: "var(--warn)", background: "var(--panel-2)", border: "1px solid var(--warn)" }}>{w}</p>
        ))}
        <p className="text-[13.5px] mt-2 leading-relaxed" style={{ color: "var(--ink)" }}>{sentence}</p>
        {drawback && (
          <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: "var(--ink-2)" }}>{drawback}</p>
        )}
      </div>

      <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--line-soft)" }}>
        <Heading>What this is</Heading>
        <p className="text-[12.5px] leading-relaxed mb-2" style={{ color: "var(--ink-2)" }}>
          A commercial lot from {county} County tax records. It is not necessarily for sale.
        </p>
        <Fact k="Size" v={acresText(site.acres)} />
        {/* Tax rolls log sheds and paving as a few square feet of building. */}
        <Fact k="Building" v={bldg === "none" ? "None on record"
          : bldg === "sized" ? `About ${Math.round(site.bldg_sqft).toLocaleString()} sq ft`
          : bldg === "large" ? "A large building is on record (size not listed)"
          : bldg === "unsized" ? "A building is on record (size not listed)"
          : "Only a small structure on record"} />
        <Fact k="Assessed land value" v={money(site.land_value)}
          sub={site.value_flag === "below_market"
            ? `The county values this land below market, usually because it is taxed as farmland. A sale price is likely much higher. ${valueNote}`
            : site.county_value_basis === "non_market"
              ? `This county does not value land at market prices, so compare with care. ${valueNote}`
              : `${site.price_per_acre ? `${money(site.price_per_acre)} per acre. ` : ""}This is the value the county uses for property tax. A sale price is usually higher. ${valueNote}`} />
        {site.prop_class && <Fact k="County land type" v={plainText(site.prop_class)} />}
      </div>

      <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--line-soft)" }}>
        <Heading>How it scores</Heading>
        {lines.map(l => (
          <div key={l.key} className="mb-3.5 last:mb-0">
            <div className="flex items-center gap-2.5">
              <span className="text-[12.5px] font-medium w-[104px] shrink-0" style={{ color: "var(--ink)" }}>{l.label}</span>
              <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
                <span className="block h-full rounded-full" style={{
                  width: `${Math.max(4, l.score * 100)}%`,
                  background: l.score >= 0.6 ? "var(--good)" : l.score >= 0.4 ? "var(--warn)" : "var(--bad)",
                }} />
              </span>
            </div>
            <div className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--ink-2)" }}>{l.text}</div>
          </div>
        ))}
      </div>

      <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--line-soft)" }}>
        <Heading>See it for yourself</Heading>
        <div className="flex flex-col gap-2">
          <OutLink title="Satellite view" notes={["Google Maps. The lot is in the middle of the screen."]}
            href={`https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lon}&zoom=19&basemap=satellite`} />
          <OutLink title="Street View"
            notes={["Google Maps, the view from the road.",
              "If it opens a dark screen, there is no street photo here. Use the satellite view."]}
            href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${svPoint}`} />
          <CountyLink s={site} />
          {!stateMapIsMain && (
            <OutLink href={parcelMapUrl(site.county, lat, lon)} title="Utah parcel map"
              notes={["Works for every lot. Click I agree, then look at the center of the map."]} />
          )}
          {/* Keyed so a failed copy hint does not carry over to the next lot. */}
          <LotCheck key={site.uid} s={site} onMap={stateMapIsMain} />
        </div>
      </div>

      <div className="px-4 py-4">
        <Heading>Good to know</Heading>
        <Fact k="Flood risk" v={site.in_flood_zone ? "In a mapped flood zone" : "Not in a mapped flood zone"}
          sub={site.in_flood_zone
            ? "Check with the county before making any offer. This is a rough check against FEMA flood maps, not a survey."
            : "A rough check against FEMA flood maps, not a survey."} />
        <Fact k="Drive time"
          v={isoOffsetMi === null ? "Not available here" : showIso === false ? "Hidden on the map" : "Blue areas on the map"}
          sub={isoOffsetMi === null
            ? "No 5 or 10 minute drive area was worked out near this lot."
            : showIso === false
              ? "Turn on 5 and 10 minute drive areas in the map key to see them."
              : `The blue areas show about how far people can drive in 5 and 10 minutes with no traffic.${isoMi != null ? ` Measured from a spot about ${isoMi} ${isoMi === 1 ? "mile" : "miles"} from the lot.` : ""}`} />
        <div className="text-[10px] mt-3" style={{ color: "var(--ink-3)" }}>
          Map coordinates <span className="mono">{lat.toFixed(5)}, {lon.toFixed(5)}</span>
        </div>
      </div>
    </div>
  );
}
