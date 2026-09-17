/**
 * Plain-English wording for a scored site. The person using this tool is not a
 * site-selection analyst, so every figure is turned into a sentence here, once,
 * instead of leaking "AADT" or "Principal Arterial" into the panels.
 * Only runs for the selected site and the visible list, never inside ranking.
 */
import { growthParts, hasSizableBuilding, permitsPer1k, usableTrafficGrowth, type Inputs, type Scored, type Site } from "@/lib/scoring";

/** Pipeline county keys are CamelCase ("SaltLake"); people read "Salt Lake". */
export const countyLabel = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2");

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** "about 23,000" style rounding: exact counts imply precision the data lacks. */
export function about(n: number) {
  if (n >= 10_000) return fmt(Math.round(n / 1000) * 1000);
  if (n >= 1_000) return fmt(Math.round(n / 100) * 100);
  return fmt(n);
}

/** "23k" for the compact list rows. */
export const kShort = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));

export const pct = (g: number) => `${Math.abs(g).toFixed(Math.abs(g) < 10 ? 1 : 0)}%`;

/** Tax rolls carry acres to three places; two is plenty to read. */
export const acres = (a: number) => String(Math.round(a * 100) / 100);

/** "1 acre", "2.65 acres". */
export const acresText = (a: number) => `${acres(a)} ${acres(a) === "1" ? "acre" : "acres"}`;

/**
 * Source text (UDOT segment names, county land types, link notes) uses a spaced
 * hyphen as a dash. Readers of this tool never see a dash, so it becomes a
 * comma, or "to" where it joins the two ends of a road segment.
 */
export const plainText = (t: string | null | undefined, joiner = ", ") =>
  (t ?? "").replace(/\s+[-\u2013\u2014]+\s+|\s*[\u2013\u2014]+\s*/g, joiner).replace(/\s+/g, " ").trim();

/**
 * A short road name for a sentence, from the traffic count's road name. UDOT
 * segment names can list every name the road takes ("700 S/northerly via 200
 * W"), start with a stray dash, or carry notes like "(One Way WB)". Keep the
 * first name and one alias in brackets ("Route 13 (Main St)"); null when
 * nothing readable is left, so the sentence falls back to general words.
 */
export function roadLabel(raw: string | null | undefined): string | null {
  const t = plainText(raw);
  const inner = t.match(/\(([^()]*)\)/)?.[1] ?? "";
  // The first listed name with a letter in it: "1055/1000 W" is 1000 W, not "1055".
  const first = (x: string) => x
    .split(/\s*\/\s*|\s+&\s+|\s+(?:via|to|from|in)\s+|\s*\b(?:north|south|east|west)erly\b/i)
    .map(p => p.replace(/[()]/g, " ").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").replace(/\s+/g, " ").trim())
    .find(p => /[A-Za-z]/.test(p)) ?? "";
  // Text after a bracket is usually the town ("Pioneer Rd (12400 S) Draper").
  const main = first(/^[^(]*[A-Za-z0-9][^(]*\(/.test(t) ? t.slice(0, t.indexOf("(")) : t);
  const alias = /one ?way|proposed|\b[NSEW]B\b/i.test(inner) ? "" : first(inner);
  if (!main) return null;
  return alias && alias.toLowerCase() !== main.toLowerCase() ? `${main} (${alias})` : main;
}

/**
 * Word grade on the floored score so the word always agrees with the dot
 * colour on the map, which is keyed on the raw score at the same cut points.
 */
export function grade(total: number): { word: string; n: number } {
  const n = Math.floor(total);
  if (n >= 70) return { word: "Strong spot", n };
  if (n >= 58) return { word: "Good spot", n };
  if (n >= 48) return { word: "Fair spot", n };
  return { word: "Weak spot", n };
}

/** Town from Census places when present, else the city on the tax roll. */
export const placeName = (s: Site) => s.city_name || s.city || null;

// Directions and highway prefixes read wrong in title case ("Sr 201").
const UPPER = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "SR", "US", "UT", "I"]);

function titlePart(p: string) {
  const u = p.toUpperCase();
  if (UPPER.has(u)) return u;
  if (/^\d+(ST|ND|RD|TH)$/.test(u)) return p.toLowerCase();   // 12TH -> 12th
  if (/\d/.test(p)) return u;                                   // 89A, N308
  return u.charAt(0) + u.slice(1).toLowerCase();
}

/**
 * Tax roll addresses arrive upper case, sometimes with a literal "None" where a
 * highway number was missing. Unit and suite numbers name a space inside a
 * building, not the lot, so the title drops them; the lot check keeps them
 * because that is how the county record spells the address.
 */
export function streetAddress(raw: string | null | undefined, keepUnit = false): string | null {
  let a = (raw ?? "").replace(/;+/g, " ").replace(/\bNone\b/g, " ").replace(/\s+/g, " ").trim();
  if (!keepUnit) {
    a = a.replace(/\s+(?:APT|UNIT|STE|SUITE|RM|BLDG|SPC|TRLR)\b\s*#?\s*\S.*$/i, "")
      .replace(/\s*#.*$/, "").trim();
  }
  if (!a) return null;
  return a.split(" ").map(w => w.split(/([-/()])/).map(p => p && !/^[-/()]$/.test(p) ? titlePart(p) : p).join("")).join(" ");
}

export function siteTitle(s: Site) {
  const addr = streetAddress(s.address);
  if (addr) return addr;
  const p = placeName(s);
  return p ? `Lot in ${p}` : `Lot in ${countyLabel(s.county)} County`;
}

/** A daily count this high is highway traffic, whatever the nearest road's class says. */
const HIGHWAY_AADT = 50_000;
/**
 * Homes permitted per 1,000 people. The Growth score spreads 1 to 10 onto 0 to
 * 1, so 6 or more is past the middle of that range and under 2 is near its
 * floor. Between the two the panel states the figure with no judgement.
 */
const PER_1K_FAST = 6;
const PER_1K_SLOW = 2;
/** Raw county count cut, only for a sites file without the per 1,000 figure. */
const PERMITS_MANY = 800;

/** "3", "2.4": one decimal, no trailing ".0". */
const oneDecimal = (n: number) => String(Number(n.toFixed(1)));

/**
 * Buildings valued this high are not a few hundred square feet, whatever the
 * size column says (Mountain View Hospital is on record as 384 sq ft beside
 * $45 million of buildings), so a size under TRUSTED_SQFT is not printed.
 */
const LARGE_BUILDING_VALUE = 500_000;
const TRUSTED_SQFT = 2_000;

/**
 * What the county records say is on the lot. "unsized" is a building the
 * county values or dates but gives no real size for: no square feet, or a
 * placeholder like 1 sq ft beside improvements worth far more than paving.
 * The value test is the one is_vacant uses in scripts/ingest_parcels.py.
 * "large" is a costly building whose listed size is too small to believe.
 */
export function buildingKind(s: Site): "none" | "sized" | "large" | "unsized" | "small" {
  if (s.is_vacant) return "none";
  if ((s.improvement_value ?? 0) >= LARGE_BUILDING_VALUE && s.bldg_sqft < TRUSTED_SQFT) return "large";
  if (s.bldg_sqft >= 200) return "sized";
  const imp = s.improvement_value;
  const valued = imp != null && imp >= Math.max(15_000, 0.05 * (s.land_value + imp));
  return s.bldg_sqft === 0 || valued ? "unsized" : "small";
}

/**
 * The warnings that lead the panel, when the lot is not simply land to build
 * on. A sizable building is the skipBuilt screen's test, so this shows on
 * every lot that screen hides (the setting is off, or the lot was opened from a
 * shared link). A lot the county records as empty gets no building warning.
 */
export function warnings(s: Site): string[] {
  const out: string[] = [];
  if (!s.is_vacant && hasSizableBuilding(s)) {
    const what = s.bldg_sqft >= TRUSTED_SQFT
      ? `a ${fmt(s.bldg_sqft)} sq ft building stands here now`
      : `the county values the buildings here at $${fmt(s.improvement_value ?? 0)}`;
    out.push(`Watch out: ${what}, so this would mean buying or replacing a working property.`);
  }
  if (s.parcel_current === false) {
    out.push("Watch out: the county has since split, merged or renumbered this parcel, so its records today may not match the ID and size below.");
  }
  return out;
}

/**
 * The road the lot sits on, as words. `where` reads after a sentence start
 * ("On a main road"); `known` is false when there is no class to describe, so
 * it is never called a drawback; `lead` marks roads worth opening the verdict.
 */
export function roadWords(s: Site): { where: string; main: boolean; known: boolean; lead: boolean } {
  const c = s.road_class ?? "";
  if (!c) return { where: "", main: false, known: false, lead: false };
  if (/Arterial/i.test(c)) return { where: "on a main road", main: true, known: true, lead: true };
  if (/Interstate|Freeway/i.test(c)) return { where: "next to a freeway", main: false, known: true, lead: false };
  // A collector or local class beside a highway sized count is a frontage or
  // side road next to that highway, so it must not be called small.
  if ((s.aadt ?? 0) >= HIGHWAY_AADT && /Collector|Local/i.test(c)) {
    return s.aadt_source === "udot"
      ? { where: "next to a busy state road", main: false, known: true, lead: true }
      : { where: "on a busy road", main: false, known: true, lead: true };
  }
  if (/Collector/i.test(c)) return { where: "on a secondary road", main: false, known: true, lead: true };
  if (/Local/i.test(c)) return { where: "on a local street", main: false, known: true, lead: false };
  return { where: "", main: false, known: false, lead: false };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const miles = (n: number) => `${n} ${plural(n, "mile", "miles")}`;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const washes = (n: number) => `car ${plural(n, "wash", "washes")}`;

/** The phrase with the largest points behind it, skipping inputs with no true phrase. */
const biggest = (opts: [number, string | null][]) =>
  opts.filter((o): o is [number, string] => o[1] != null && o[0] > 0).sort((a, b) => b[0] - a[0])[0]?.[1] ?? null;

function ringCounts(s: Site, ring: 1 | 3 | 5) {
  const comp = ring === 1 ? s.competitors_1mi : ring === 3 ? s.competitors_3mi : s.competitors_5mi;
  const expr = ring === 1 ? s.express_1mi : ring === 3 ? s.express_3mi : s.express_5mi;
  const homesRing = ring === 1 ? 1 : 3;
  const homes = ring === 1 ? s.rooftops_1mi : s.rooftops_3mi;
  return { comp, expr, other: Math.max(0, comp - expr), homesRing, homes };
}

export interface Line { key: string; label: string; score: number; text: string }

/**
 * Everything the detail panel says in words: a one sentence verdict built from
 * the site's actual strongest factors, an optional drawback, and one line per
 * factor. Phrases are chosen from the site's own numbers, never generic.
 */
export function explain(sc: Scored, inputs: Inputs) {
  const s = sc.site;
  const ring = inputs.compRing;
  const { comp, expr, other, homesRing, homes } = ringCounts(s, ring);
  const road = roadWords(s);
  const county = countyLabel(s.county);
  const town = s.city_name ?? null;
  const g = s.city_growth_pct;
  const tg = s.aadt ? usableTrafficGrowth(s) : null;
  const need = Math.max(inputs.acresNeeded, 0.1);
  const roofsKnown = s.rooftops_known !== false;
  const per1k = permitsPer1k(s);
  // Per head when the data has it: a raw count calls every small county slow.
  const manyPermits = per1k != null ? per1k >= PER_1K_FAST : s.county_permits_2026 >= PERMITS_MANY;
  const fewPermits = per1k != null ? per1k < PER_1K_SLOW : !manyPermits;
  const gp = growthParts(s);
  const homesWords = `${about(homes)} ${plural(homes, "home", "homes")}`;
  // A UDOT count is for the nearest state road within 500 feet, which may not
  // be the road the lot faces, so it names that road. A local count is for the
  // lot's own road.
  const udot = s.aadt_source === "udot";
  const roadName = roadLabel(s.aadt_road);
  const countedOn = udot ? (roadName ? `on ${roadName} nearby` : "on the nearest state road") : "on this road";
  const bldg = buildingKind(s);
  const warn = warnings(s);
  // A sizable building already leads the panel in its own warning.
  const builtWarned = !s.is_vacant && hasSizableBuilding(s);

  const lotWord = s.acres >= Math.max(2 * need, 2) ? "big lot"
    : s.acres >= 1.3 * need ? "roomy lot" : "lot";

  // Noun phrases that read after "with" and after "This lot has".
  const good: Record<string, string> = {
    competition: expr === 0 ? `no express car wash on our map within ${miles(ring)}`
      : `only ${expr} express ${washes(expr)} within ${miles(ring)}`,
    demand: roofsKnown ? `about ${homesWords} within ${miles(homesRing)}`
      : s.median_hh_income ? `households earning about $${about(s.median_hh_income)} a year nearby`
      : "households nearby who rely on cars",
    traffic: s.aadt ? `about ${about(s.aadt)} cars a day ${countedOn}` : "steady traffic",
    growth: biggest([
      [gp.town.w * gp.town.v, town && g != null && g >= 10 ? `fast growth nearby (${town} grew ${pct(g)} from 2020 to 2025)` : null],
      [gp.permits.w * gp.permits.v, manyPermits
        ? `lots of new homes being built in ${county} County${per1k != null ? " for its population" : ""}` : null],
      [gp.trend.w * gp.trend.v, tg != null && tg >= 20 ? `rising traffic nearby (up ${pct(tg)} from 2014 to 2024)` : null],
      [gp.vacancy.w * gp.vacancy.v, s.is_vacant ? "empty land with nothing to tear down" : null],
    ]) ?? "steady growth nearby",
  };
  const bad: Record<string, string> = {
    competition: expr > 0
      ? `${expr} express ${washes(expr)} already within ${miles(ring)}`
      : `${comp} other ${washes(comp)} within ${miles(ring)}`,
    demand: !roofsKnown ? "household incomes and car use nearby are on the low side"
      : homes === 0 ? `no home addresses on county records within ${miles(homesRing)}`
      : `only about ${homesWords} within ${miles(homesRing)}`,
    traffic: s.aadt ? `only about ${about(s.aadt)} cars a day ${countedOn}` : "no traffic count for this road",
    // An unrecorded road class is missing data, not a fault of the lot.
    access: road.known && !road.main ? "the road out front is not listed as a main road"
      : s.acres < 1.15 * need ? "the lot is only just big enough"
      : s.road_speed != null && (s.road_speed > 40 || s.road_speed < 25)
        ? `the ${s.road_speed} mph speed limit out front is not ideal`
      : "the lot size or shape is not ideal",
    // The input that cost the most points, among those with a true bad phrase.
    growth: biggest([
      [gp.town.w * (1 - gp.town.v), town && g != null && g < 10
        ? g < 0 ? `${town} is shrinking (down ${pct(g)} from 2020 to 2025)`
          : g < 3 ? `${town} is growing slowly (up ${pct(g)} from 2020 to 2025)`
          : `${town} grew only ${pct(g)} from 2020 to 2025`
        : null],
      [gp.permits.w * (1 - gp.permits.v), fewPermits
        ? `few new homes being built in ${county} County${per1k != null ? " for its population" : ""}` : null],
      [gp.trend.w * (1 - gp.trend.v), tg != null && tg < 5
        ? tg < 0 ? `traffic nearby fell ${pct(tg)} from 2014 to 2024` : `traffic nearby barely grew from 2014 to 2024`
        : null],
      [gp.vacancy.w * (1 - gp.vacancy.v), bldg === "none" || builtWarned ? null
        : bldg === "small" ? "a small structure is on record, so the lot is not listed as empty land"
        : "there is a building on record that would need to come down or be reused"],
    ]) ?? "growth nearby is modest",
  };

  const live = sc.factors.filter(f => f.weight > 0);
  const strong = live.filter(f => f.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, 2);
  const weakest = [...live].sort((a, b) => a.score - b.score)[0];

  let sentence: string;
  const access = strong.find(f => f.key === "access");
  // "next to a busy state road with about 52,000 cars a day" says traffic twice.
  const others = strong
    .filter(f => f.key !== "access" && !(access && road.lead && /busy/.test(road.where) && f.key === "traffic"))
    .map(f => good[f.key]);
  if (access) {
    const subject = road.lead
      ? `${cap(lotWord)} ${road.where}`
      : `${cap(lotWord)} with space for cars to line up`;
    // Avoid "with room ... with no express car wash".
    sentence = others.length ? `${subject} ${road.lead ? "with" : "and"} ${others.join(" and ")}.` : `${subject}.`;
  } else if (others.length) {
    sentence = `This lot has ${others.join(" and ")}.`;
  } else {
    sentence = "Nothing here stands out as a clear strength.";
  }
  const drawback = weakest && weakest.score < 0.4 ? `Watch out: ${bad[weakest.key]}.` : null;

  const score = (k: string) => sc.factors.find(f => f.key === k)?.score ?? 0;
  const d = s.dist_nearest_express_mi;
  const change = (v: number, what: string, years: string) =>
    Math.abs(v) < 1 ? `${what} held steady from ${years}.`
      : `${what} ${v > 0 ? "rose" : "fell"} ${pct(v)} from ${years}.`;

  const lines: Line[] = [
    {
      key: "competition", label: "Competition", score: score("competition"),
      text: (expr === 0
        ? `No express car washes on our map within ${miles(ring)}` + (other > 0 ? `, only ${other} other ${washes(other)}` : "")
        : `${expr} express ${washes(expr)} on our map within ${miles(ring)}` + (other > 0 ? `, plus ${other} other ${washes(other)}` : "")) +
        "." +
        (d == null ? "" : d < 0.1 ? " An express car wash is right next door."
          : ` The closest express car wash is ${miles(Number(d.toFixed(1)))} away.`) +
        " Our map may miss a few washes.",
    },
    {
      key: "demand", label: "Homes nearby", score: score("demand"),
      // Zero usually means the county address file has gaps, not open desert.
      text: (!roofsKnown ? "Home count not available for this area."
        : homes === 0 ? `No home addresses on county records within ${miles(homesRing)}.`
        : `About ${homesWords} within ${miles(homesRing)}.`) +
        (s.median_hh_income ? ` Typical household income is $${about(s.median_hh_income)}.` : "") +
        (s.vehicles_per_hh ? ` Households here have about ${s.vehicles_per_hh.toFixed(1)} cars each.` : ""),
    },
    {
      key: "traffic", label: "Traffic", score: score("traffic"),
      text: (s.aadt
        ? udot
          ? `About ${about(s.aadt)} cars a day ${roadName ? `on ${roadName} nearby` : "on the nearest counted state road"}.`
          : `About ${about(s.aadt)} cars a day on this road${roadName ? ` (${roadName})` : ""}.`
        : "No traffic count found for this road.") +
        // The change is always 2014 to 2024; a swing past 100% is a re-drawn
        // count segment, not the road, and is left out of the score too.
        (tg != null ? ` ${change(tg, "Traffic there", "2014 to 2024")}` : ""),
    },
    {
      key: "access", label: "Road and lot", score: score("access"),
      // The long side of the bounding box, not "X by Y": a box overstates an
      // irregular lot.
      text: `${cap(acresText(s.acres))}, about ${fmt(s.max_dim_ft)} feet at its longest.` +
        // The speed limit is for the nearest road segment. Beside a freeway or
        // busy state road that is often a frontage road, so it gets its own
        // sentence. A road with no recorded type is simply not described.
        (!road.known
          ? s.road_speed ? ` The nearest road has a ${s.road_speed} mph speed limit.` : ""
          : " " + (road.where.startsWith("next to")
            ? `${cap(road.where)}.${s.road_speed ? ` The nearest road has a ${s.road_speed} mph speed limit.` : ""}`
            : `${cap(road.where)}${s.road_speed ? ` with a ${s.road_speed} mph speed limit` : ""}.`)),
    },
    {
      key: "growth", label: "Growth", score: score("growth"),
      // Each sentence is one input to the Growth score, in the order it weighs.
      // The traffic trend also counts here, but it is stated once, under
      // Traffic. undefined means the growth column is not in this data at all;
      // null means it is, and this lot has no town figure.
      text: ((g != null && town
        ? `${town} ${g < 0 ? "shrank" : "grew"} ${pct(g)} from 2020 to 2025${g >= 10 ? ", which is fast" : g >= 0 && g < 3 ? ", which is slow" : ""}. `
        : g === null
          ? town ? `No Census growth figure for ${town}. ` : "Outside city limits, so there is no town growth figure. "
          : "") +
        (per1k != null
          ? `${oneDecimal(per1k)} new ${oneDecimal(per1k) === "1" ? "home" : "homes"} permitted per 1,000 people in ${county} County so far in 2026` +
            (manyPermits ? ", which is fast. " : fewPermits ? ", which is slow. " : ". ")
          : `${fmt(s.county_permits_2026)} new ${plural(s.county_permits_2026, "home", "homes")} permitted in ${county} County so far in 2026` +
            (manyPermits ? ", among the most in Utah. " : ". ")) +
        // What stands on the lot is stated under What this is, not here.
        (bldg === "none" ? "Empty land, nothing to tear down." : "")).trim(),
    },
  ];

  return { sentence, drawback, lines, warnings: warn };
}
