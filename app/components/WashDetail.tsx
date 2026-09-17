"use client";
import type { Wash } from "@/lib/data";
import { FORMAT_COLOR } from "./MapView";
import { countyLabel } from "./plain";

function Row({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="py-2" style={{ borderBottom: "1px solid var(--line-soft)" }}>
      <div className="text-[10.5px] uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>{k}</div>
      <div className="text-[13px] mt-0.5 break-words" style={{ color: "var(--ink)" }}>{v}</div>
      {sub && <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--ink-3)" }}>{sub}</div>}
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
  const trimmed = raw.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (!u.hostname.includes(".")) return null;
    return { href: u.href, label: u.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

/** Real anchors with thumb sized targets, the same as the site panel. */
function Link({ href, children, sub }: { href: string; children: React.ReactNode; sub?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-md min-h-[48px]"
      style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
      <span className="min-w-0">
        <span className="block text-[13px] break-words" style={{ color: "var(--accent)" }}>{children}</span>
        {sub && <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink-3)" }}>{sub}</span>}
      </span>
      <span aria-hidden className="text-[15px] shrink-0" style={{ color: "var(--ink-3)" }}>↗</span>
    </a>
  );
}

/**
 * One set of names for every place a wash type shows: the map key, the
 * filters and this panel. The data's own labels differ slightly ("Unknown",
 * "Self-serve bays"), which made the panel disagree with the key.
 */
import { FORMAT_NAMES, FORMAT_NAME } from "@/lib/formatNames";
export { FORMAT_NAMES };

/**
 * What each type means, for someone who has never run a car wash. Format
 * unknown has no line: the "How we know the type" row already says why.
 */
const FORMAT_MEANS: Record<string, string> = {
  express_tunnel: "You stay in the car while a conveyor pulls it through. Usually sells monthly memberships.",
  flex_full_serve: "A conveyor tunnel where staff can also clean the inside of the car.",
  in_bay_automatic: "You park in a single bay and a machine moves around the car. Often at a gas station.",
  self_serve: "Open bays where you wash the car yourself with a spray wand.",
  truck_wash: "Built for semis and other large trucks.",
  hand_detail: "Cleaning done by hand. Does not compete with a tunnel wash.",
};

/**
 * Brands arrive in whatever case the source typed ("super sonic car wash").
 * Capitalize words that are all lower case and leave deliberate styling such
 * as "GO Car Wash" alone.
 */
function titleCase(t: string): string {
  const shout = t === t.toUpperCase();
  return t.split(" ").map((word, i) => {
    const w = shout ? word.toLowerCase() : word;
    if (w !== w.toLowerCase()) return w;
    if (i > 0 && /^(and|of|the)$/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

/**
 * Sources store phone numbers as "+18015551234", "8015551234" or already
 * formatted. Show US numbers the way people write them; leave anything else.
 */
function phoneView(raw: string): { text: string; tel: string | null } {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) {
    return { text: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`, tel: `+1${ten}` };
  }
  return { text: raw, tel: d ? raw.replace(/[^\d+]/g, "") : null };
}

/** "2025-03-08" as "March 8, 2025", read as a calendar date, not UTC midnight. */
function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return new Date(+m[1], +m[2] - 1, +m[3])
    .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Hours come in OpenStreetMap shorthand ("Mo-Sa 07:00-20:00; Su off"). Spell
 * out the days and use am and pm. Anything the shorthand allows beyond that
 * is left as it is rather than guessed at.
 */
function hoursText(raw: string): string {
  if (raw.trim() === "24/7") return "Open 24 hours, every day";
  const day: Record<string, string> = {
    Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "holidays",
  };
  return raw
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, d => day[d])
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) => {
      const n = +h % 24, h12 = n % 12 || 12, ap = n < 12 ? "am" : "pm";
      return m === "00" ? `${h12}${ap}` : `${h12}:${m}${ap}`;
    })
    .replace(/\boff\b/g, "closed")
    .replace(/\s*-\s*/g, " to ")
    .replace(/\s*;\s*/g, "; ")
    .replace(/,(?=\S)/g, ", ");
}

/**
 * The pipeline records how a wash's type was worked out in terms that make
 * sense to a data engineer ("name pattern: /\bexpress\b/"). Say it the way a
 * person would.
 */
function howWeKnow(w: Wash): string {
  const ev = w.format_evidence ?? "";
  switch (w.format_source) {
    case "brand": return `Matched to a known car wash brand (${titleCase(ev.replace(/^brand match:\s*/, ""))}).`;
    case "osm_tag": return "Marked by OpenStreetMap volunteers who tagged how the wash works.";
    // "google category:" is the older prefix, kept so data built before the
    // rename still reads cleanly.
    case "category": return `Its business listing calls it: ${ev.replace(/^(?:place|google) category:\s*/i, "")}.`;
    case "name": return "A best guess from words in the business name.";
    case "user": return "Marked by you in your own survey.";
    default: return "There were no clues about what kind of wash this is.";
  }
}

/** "Overture/BrightQuery, OpenStreetMap" becomes "OpenStreetMap, Overture Maps". */
function sourceNames(confirmedBy: string | null): string {
  const names = new Set<string>();
  for (const part of (confirmedBy ?? "").split(",")) {
    const p = part.trim();
    if (!p) continue;
    names.add(p.startsWith("Overture") ? "Overture Maps" : p);
  }
  return [...names].join(", ");
}

export default function WashDetail({ w, onClose, headerExtra }: {
  w: Wash; onClose: () => void;
  /** Extra header controls, used by the phone sheet for its size toggle. */
  headerExtra?: React.ReactNode;
}) {
  const q = encodeURIComponent(`${w.name ?? "car wash"} ${w.address ?? ""} ${w.city ?? ""}`.trim());
  const confidencePct = Math.round((w.format_confidence ?? 0) * 100);
  const sources = sourceNames(w.confirmed_by);
  const website = safeUrl(w.website);
  const socials = (w.socials ?? "").split(",").map(safeUrl)
    .filter((u): u is { href: string; label: string } => !!u && u.href !== website?.href)
    .slice(0, 2);
  const phone = w.phone ? phoneView(w.phone) : null;
  const formatName = FORMAT_NAME[w.format] ?? w.format_label;

  return (
    <div className="fade h-full overflow-y-auto overscroll-contain" style={{ background: "var(--panel)" }}>
      <div className="px-4 pt-3 pb-2.5 sticky top-0 z-10 flex items-start justify-between gap-2"
        style={{ background: "var(--panel)", borderBottom: "1px solid var(--line-soft)" }}>
        <div className="min-w-0 pt-1">
          <div className="text-[10.5px] uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--ink-3)" }}>
            Existing car wash
          </div>
          <div className="text-[15px] font-semibold leading-snug break-words" style={{ color: "var(--ink)" }}>
            {w.name || "Unnamed car wash"}
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: "var(--ink-2)" }}>
            {[w.address, w.city].filter(Boolean).join(", ") || "No street address on record"}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {headerExtra}
          {/* px, not w-11: the root font size is 13px, so rem sizes fall
              short of the 44px a thumb needs. */}
          <button onClick={onClose} aria-label="Close"
            className="w-[44px] h-[44px] rounded-md flex items-center justify-center text-[22px] leading-none"
            style={{ color: "var(--ink-2)", background: "var(--panel-2)" }}>×</button>
        </div>
      </div>

      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-3 h-3 rounded-full shrink-0"
            style={{ border: `1.5px solid ${FORMAT_COLOR[w.format] ?? "#8b93a7"}`,
                     background: `${FORMAT_COLOR[w.format] ?? "#8b93a7"}80` }} />
          <span className="text-[14px]" style={{ color: "var(--ink)" }}>{formatName}</span>
          {w.is_competitor
            ? <span className="text-[10.5px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--accent-dim)", color: "var(--ink-2)" }}>counted as competition</span>
            : <span className="text-[10.5px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--panel-2)", color: "var(--ink-3)" }}>not counted as competition</span>}
        </div>
        {FORMAT_MEANS[w.format] && (
          <div className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {FORMAT_MEANS[w.format]}
          </div>
        )}
      </div>

      <div className="px-4 py-1">
        <Row k="How we know the type"
          v={w.format_source === "none" ? "Unknown" : `About ${confidencePct}% sure`}
          sub={howWeKnow(w)} />

        <Row k="Found in"
          v={`${w.n_sources} map ${w.n_sources === 1 ? "source" : "sources"}`}
          sub={sources || undefined} />

        {w.brand && <Row k="Brand" v={titleCase(w.brand)} />}

        {phone && <Row k="Phone" v={phone.tel
          ? <a href={`tel:${phone.tel}`} className="underline inline-flex items-center min-h-[44px]"
              style={{ color: "var(--accent)" }}>{phone.text}</a>
          : phone.text} />}

        {w.opening_hours && <Row k="Hours" v={hoursText(w.opening_hours)}
          sub="From OpenStreetMap, so it may be out of date" />}

        {w.amenities && <Row k="On site" v={w.amenities.split(",")
          .map(a => a.trim().replace(/^payment:/, "pays by ").replace(/_/g, " "))
          .join(", ")} />}

        {w.postcode && <Row k="ZIP code" v={w.postcode} />}

        {w.last_checked && <Row k="Last confirmed" v={longDate(w.last_checked)}
          sub="The date a map volunteer last confirmed it in person" />}

        <Row k="Location" v={<span className="mono text-[12px]">{w.lat.toFixed(5)}, {w.lon.toFixed(5)}</span>}
          sub={w.county ? `${countyLabel(w.county)} County` : undefined} />
      </div>

      <div className="px-4 py-4 flex flex-col gap-2"
        style={{ borderTop: "1px solid var(--line-soft)" }}>
        <div className="text-[10.5px] uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--ink-3)" }}>
          See it for yourself
        </div>
        <Link href={`https://www.google.com/maps/search/?api=1&query=${q}`}
          sub="Reviews, photos and hours">Google Maps</Link>
        <Link href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${w.lat},${w.lon}`}
          sub="The view from the road">Street View</Link>
        {website && <Link href={website.href} sub="Their website">{website.label}</Link>}
        {socials.map(u => <Link key={u.href} href={u.href}>{u.label}</Link>)}
        {w.osm_id && /^(node|way|relation)\/\d+$/.test(w.osm_id) && (
          <Link href={`https://www.openstreetmap.org/${w.osm_id}`} sub="Where this map point came from">
            OpenStreetMap record
          </Link>
        )}
        <p className="text-[10.5px] mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>
          Star ratings are not copied here because Google&apos;s terms do not allow it. The
          Google Maps link above shows them.
        </p>
      </div>
    </div>
  );
}
