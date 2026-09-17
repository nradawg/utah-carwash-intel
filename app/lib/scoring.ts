/**
 * Site scoring. Runs in the browser so every input change re-ranks instantly.
 *
 * Three layers, deliberately not a single number:
 *   1. Hard gates   - binary. A site that fails is not ranked at all.
 *   2. Weighted score - five pillars, 100 points, weights user-adjustable.
 *   3. Explanation  - built in plain words for the selected site only, in
 *                     components/plain.ts, so ranking 45k rows builds no strings.
 *
 * Weighting rationale (see /methodology): traffic carries only 15 points
 * because DRB finds car count has almost no predictive value on site
 * performance and MMCG attributes roughly 6% of volume variance to it, while
 * Retail Petroleum Consultants show capture rate FALLING from 1.7% at 10k AADT
 * to 0.5% at 80k. Traffic is a gate, not a driver. Access and competition
 * carry 25 each because their downside is large and discontinuous.
 */

export interface Site {
  /** Stable unique row key. parcel_id is NOT unique: assessors reuse ids. */
  uid: string;
  parcel_id: string; address: string; city: string; county: string;
  lat: number; lon: number; acres: number;
  land_value: number; price_per_acre: number | null;
  prop_class: string; bldg_sqft: number; is_vacant: boolean;
  max_dim_ft: number; min_dim_ft: number; assessor_url: string | null;
  road_speed: number | null; road_class: string | null; road_lanes: number | null;
  aadt: number | null; aadt_source: string; aadt_retail: number | null;
  aadt_growth_pct: number | null; truck_share: number | null; aadt_desc: string | null;
  rooftops_1mi: number; rooftops_3mi: number;
  competitors_1mi: number; competitors_3mi: number; competitors_5mi: number;
  express_1mi: number; express_3mi: number; express_5mi: number;
  dist_nearest_wash_mi: number; dist_nearest_express_mi: number | null;
  in_flood_zone: boolean; county_permits_2026: number;
  tract: string | null; tract_pop: number | null; median_hh_income: number | null;
  tract_households: number | null; vehicles_per_hh: number | null;
  multifamily_pct: number | null; car_commute_pct: number | null;
  median_home_value: number | null;
  value_flag: string; county_value_basis: string;
  // Added by the city growth and parcel link steps. Optional so the app still
  // loads a sites.parquet produced before those columns existed.
  city_name?: string | null; city_pop_2025?: number | null;
  /** Percent change, 2020 Census to 2025 estimate. null outside city limits. */
  city_growth_pct?: number | null;
  parcel_url?: string | null;
  parcel_url_kind?: "parcel" | "search" | "statewide" | "homepage" | null;
  parcel_url_label?: string | null;
  /** Nearest road point for Street View. null when no road is close enough. */
  sv_lat?: number | null; sv_lon?: number | null;
  /** false when the home count for this area is known to be missing, not zero. */
  rooftops_known?: boolean | null;
  /** Short plain name of the road the traffic count is on ("Route 40"). */
  aadt_road?: string | null;
  /** County homes permitted in 2026 per 1,000 residents (July 2025 population). */
  county_permits_per_1k?: number | null;
  /** Assessed total value minus land value, dollars. */
  improvement_value?: number | null;
  /**
   * false when the county has split, merged or renumbered the parcel since the
   * tax roll this row came from. Missing or null counts as current.
   */
  parcel_current?: boolean | null;
}

export interface Inputs {
  acresNeeded: number;       // the facility the user actually wants to build
  minDimFt: number;          // 225 ft fits a 125 ft conveyor plus approach and exit
  budget: number;            // max land cost, dollars
  minAadt: number;
  maxSpeed: number;
  compRing: 1 | 3 | 5;       // miles
  excludeFlood: boolean;
  vacantOnly: boolean;
  spreadMi: number;          // minimum spacing between ranked results, 0 disables
  county: string | null;     // restrict to one county
  place: string;             // free-text match on city or street
  minScore: number;          // hide results below this score
  allowBelowMarket: boolean; // include greenbelt/non-market assessed parcels
  minCityGrowth: number;     // percent growth 2020 to 2025, 0 disables
  skipBuilt: boolean;        // hide lots with a sizable building (hasSizableBuilding)
  includeStale: boolean;     // include parcels the county has since split, merged or renumbered
  weights: Weights;
}

export interface Weights {
  access: number; competition: number; demand: number; traffic: number; growth: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  access: 25, competition: 25, demand: 20, traffic: 15, growth: 15,
};

export const DEFAULT_INPUTS: Inputs = {
  acresNeeded: 1.0, minDimFt: 225, budget: 3_000_000, minAadt: 15_000,
  maxSpeed: 45, compRing: 3, excludeFlood: true, vacantOnly: false,
  spreadMi: 1, county: null, place: "", minScore: 0,
  allowBelowMarket: false, minCityGrowth: 0, skipBuilt: true, includeStale: false,
  weights: { ...DEFAULT_WEIGHTS },
};

export interface Factor { key: string; label: string; score: number; weight: number; }
export interface Scored {
  site: Site; total: number; factors: Factor[];
  /** Lower-scoring parcels suppressed within spreadMi of this one. */
  nearby: number;
}

/** Clamp a value onto 0..1 across a range. */
const norm = (v: number, lo: number, hi: number) =>
  hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The 2014 to 2024 traffic change, or null when it cannot be trusted. Counts on
 * re-drawn segments swing by thousands of percent and say nothing about the
 * road, so anything past plus or minus 100% is left out of the score.
 */
export const usableTrafficGrowth = (s: Site): number | null =>
  s.aadt_growth_pct != null && s.aadt_growth_pct >= -100 && s.aadt_growth_pct <= 100
    ? s.aadt_growth_pct : null;

export interface Part { w: number; v: number }

/**
 * County homes permitted per 1,000 residents, or null when the sites file has
 * no usable figure. A raw count favours big counties; per head it measures
 * how fast the county is actually adding homes.
 */
export const permitsPer1k = (s: Site): number | null => {
  const v = s.county_permits_per_1k;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** The per 1,000 range the Growth factor spreads from 0 to 1. plain.ts words cut points on it. */
export const PERMITS_PER_1K_RANGE = [1, 10] as const;

/**
 * The Growth factor's inputs, each with its weight and its 0..1 value, so the
 * wording in components/plain.ts names what actually moved this lot's score.
 * Town growth is the most local growth signal, so it leads when the lot is
 * inside a town with a Census figure. Outside towns the weight goes back to
 * county permits and empty land. export_gis.py mirrors this exactly.
 */
export function growthParts(s: Site): { town: Part; permits: Part; trend: Part; vacancy: Part } {
  // Older sites files have only the raw county count, so they keep the old range.
  const per1k = permitsPer1k(s);
  const permits = per1k != null
    ? norm(per1k, PERMITS_PER_1K_RANGE[0], PERMITS_PER_1K_RANGE[1])
    : norm(s.county_permits_2026, 60, 3_200);
  const roofGrowth = norm(usableTrafficGrowth(s) ?? 0, 0, 40);
  const vacancy = s.is_vacant ? 1 : 0.45;   // a teardown costs time and money
  const city = s.city_growth_pct;
  return city != null
    ? { permits: { w: 0.35, v: permits }, town: { w: 0.30, v: norm(city, 0, 30) },
        trend: { w: 0.10, v: roofGrowth }, vacancy: { w: 0.25, v: vacancy } }
    : { permits: { w: 0.45, v: permits }, town: { w: 0, v: 0 },
        trend: { w: 0.20, v: roofGrowth }, vacancy: { w: 0.35, v: vacancy } };
}

/**
 * A working property, not a lot to build on: buildings the county values at
 * $400,000 or more, or 10,000 sq ft or more of floor. A supermarket or a
 * hospital passes every other test, so without this they top the ranking.
 * export_gis.py uses the same two cut points.
 */
export const BUILT_VALUE = 400_000;
export const BUILT_SQFT = 10_000;
export const hasSizableBuilding = (s: Site) =>
  (s.improvement_value ?? 0) >= BUILT_VALUE || (s.bldg_sqft ?? 0) >= BUILT_SQFT;

/** Hard gates. Returns a reason string when the site fails, else null. */
export function gateFail(s: Site, i: Inputs): string | null {
  if (s.acres < i.acresNeeded) return `only ${s.acres} acres, needs ${i.acresNeeded}`;
  if (s.max_dim_ft < i.minDimFt) return `longest dimension ${s.max_dim_ft} ft, needs ${i.minDimFt} ft`;
  if (i.excludeFlood && s.in_flood_zone) return "inside a FEMA special flood hazard area";
  if (s.road_speed != null && s.road_speed > i.maxSpeed) return `frontage posted ${s.road_speed} mph`;
  if ((s.aadt ?? 0) < i.minAadt) return `traffic ${fmt(s.aadt ?? 0)} below ${fmt(i.minAadt)}`;
  if (s.land_value > i.budget) return `land value $${fmt(s.land_value)} over budget`;
  if (i.vacantOnly && !s.is_vacant) return "has an existing building";
  if (i.county && s.county !== i.county) return "outside the selected county";
  if (i.place) {
    const q = i.place.toLowerCase();
    if (!(s.city ?? "").toLowerCase().includes(q) &&
        !(s.address ?? "").toLowerCase().includes(q)) return "does not match the place filter";
  }
  if (!i.allowBelowMarket && s.value_flag === "below_market") return "land value assessed below market (greenbelt or exempt)";
  if (i.skipBuilt && hasSizableBuilding(s)) {
    return (s.bldg_sqft ?? 0) >= BUILT_SQFT
      ? `a ${fmt(Math.round(s.bldg_sqft))} sq ft building already stands here`
      : `the county values the buildings here at $${fmt(Math.round(s.improvement_value ?? 0))}`;
  }
  if (!i.includeStale && s.parcel_current === false) return "the county has since split, merged or renumbered this parcel";
  if (i.minCityGrowth > 0) {
    // Unincorporated land has no town figure to test, so it cannot pass.
    const g = s.city_growth_pct;
    if (g == null) return s.city_name ? "no growth figure for this town" : "outside city limits, so there is no town growth figure";
    if (g < i.minCityGrowth) return `${s.city_name ?? "this town"} grew ${g}% since 2020, under ${i.minCityGrowth}%`;
  }
  return null;
}

export function scoreSite(s: Site, i: Inputs): Scored {
  const w = i.weights;
  const ring = i.compRing;
  const comp = ring === 1 ? s.competitors_1mi : ring === 3 ? s.competitors_3mi : s.competitors_5mi;
  const expr = ring === 1 ? s.express_1mi : ring === 3 ? s.express_3mi : s.express_5mi;
  const roofs = ring === 1 ? s.rooftops_1mi : s.rooftops_3mi;

  // --- Access and site physicals -------------------------------------------
  // Speed: 30 mph is optimal, above 45 is disqualifying, very slow is also bad.
  const speed = s.road_speed ?? 35;
  const speedFit = speed <= 45 ? 1 - Math.abs(speed - 32) / 30 : 0;
  const arterial = /Principal Arterial|Minor Arterial/i.test(s.road_class ?? "") ? 1
    : /Collector/i.test(s.road_class ?? "") ? 0.65 : 0.3;
  // Room beyond the minimum buys stacking depth and a vacuum lot.
  const room = norm(s.acres / Math.max(i.acresNeeded, 0.1), 1, 2.2);
  const frontage = norm(s.max_dim_ft, i.minDimFt, 600);
  const accessScore = clamp01(0.32 * Math.max(0, speedFit) + 0.24 * arterial + 0.24 * room + 0.20 * frontage);

  // --- Competition ----------------------------------------------------------
  // Express tunnels are the real competition; an in-bay at a Chevron is not.
  // MMCG document a cliff at the third tunnel within a mile, so penalise
  // steeply rather than linearly.
  const expressPenalty = expr === 0 ? 1 : expr === 1 ? 0.72 : expr === 2 ? 0.42 : 0.12;
  const otherPenalty = 1 - norm(comp - expr, 0, 8) * 0.35;
  const distBonus = norm(s.dist_nearest_express_mi ?? 12, 0.4, 4);
  // Population per express tunnel: 25k-35k per tunnel is the industry band.
  const perTunnel = expr > 0 ? roofs * 2.6 / expr : Infinity;
  const saturation = perTunnel === Infinity ? 1 : norm(perTunnel, 8_000, 30_000);
  const compScore = clamp01(0.40 * expressPenalty + 0.20 * otherPenalty + 0.20 * distBonus + 0.20 * saturation);

  // --- Demand ---------------------------------------------------------------
  // Membership is the business model, so this measures the resident base's
  // ability to carry a recurring charge, not raw headcount.
  const density = norm(roofs, 500, 30_000);
  const income = norm(s.median_hh_income ?? 0, 45_000, 120_000);
  const vehicles = norm(s.vehicles_per_hh ?? 0, 1.2, 2.6);
  // Renters lack driveways and hoses, so multifamily over-indexes for washes.
  const multifam = norm(s.multifamily_pct ?? 0, 0, 35);
  const commute = norm(s.car_commute_pct ?? 0, 55, 92);
  // A missing home count is not an empty area, so it must not score as one.
  // Drop density and let the other measures carry the whole factor.
  const demandScore = s.rooftops_known === false
    ? clamp01((0.22 * income + 0.18 * vehicles + 0.12 * multifam + 0.10 * commute) / (0.22 + 0.18 + 0.12 + 0.10))
    : clamp01(0.38 * density + 0.22 * income + 0.18 * vehicles + 0.12 * multifam + 0.10 * commute);

  // --- Traffic quality ------------------------------------------------------
  // Capture rate falls as volume rises, so this saturates rather than scaling.
  const vol = norm(Math.log10(Math.max(s.aadt ?? 1, 1)), Math.log10(8_000), Math.log10(60_000));
  const trafficGrowth = usableTrafficGrowth(s);
  const trend = norm(trafficGrowth ?? 0, -5, 45);
  const nonTruck = 1 - norm(s.truck_share ?? 0.04, 0.02, 0.25);
  const measured = s.aadt_source === "udot" ? 1 : s.aadt_source === "local" ? 0.7 : 0.3;
  const trafficScore = clamp01(0.42 * vol + 0.26 * trend + 0.18 * nonTruck + 0.14 * measured);

  // --- Growth and durability ------------------------------------------------
  // Summed in the same order as export_gis.py so both floor to the same number.
  const gp = growthParts(s);
  const growthScore = clamp01(s.city_growth_pct != null
    ? gp.permits.w * gp.permits.v + gp.town.w * gp.town.v + gp.trend.w * gp.trend.v + gp.vacancy.w * gp.vacancy.v
    : gp.permits.w * gp.permits.v + gp.trend.w * gp.trend.v + gp.vacancy.w * gp.vacancy.v);

  const factors: Factor[] = [
    { key: "access", label: "Road and lot", score: accessScore, weight: w.access },
    { key: "competition", label: "Competition", score: compScore, weight: w.competition },
    { key: "demand", label: "Homes nearby", score: demandScore, weight: w.demand },
    { key: "traffic", label: "Traffic", score: trafficScore, weight: w.traffic },
    { key: "growth", label: "Growth", score: growthScore, weight: w.growth },
  ];

  const wTotal = w.access + w.competition + w.demand + w.traffic + w.growth || 1;
  const total = factors.reduce((a, f) => a + f.score * f.weight, 0) / wTotal * 100;

  return { site: s, total, nearby: 0, factors };
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

export function rank(sites: Site[], inputs: Inputs, limit = 200) {
  const scored: Scored[] = [];
  for (const s of sites) {
    if (gateFail(s, inputs)) continue;
    scored.push(scoreSite(s, inputs));
  }
  scored.sort((a, b) => b.total - a.total);
  const ranked = inputs.minScore > 0
    ? scored.filter(x => x.total >= inputs.minScore)
    : scored;
  const passed = ranked.length;

  if (!inputs.spreadMi) return { passed, top: ranked.slice(0, limit), distinct: passed };

  // Greedy spatial thinning. Adjacent parcels on one corridor are a single
  // opportunity, not several, and a list of nine lots on the same street is
  // useless for choosing where to build. Keep the best parcel in each
  // neighbourhood and record how many it stands in for.
  //
  // The default spacing is one mile because that is the distance at which
  // washes start taking each other's members: MMCG document a step change in
  // volume when a third tunnel opens within a mile. Two sites closer than that
  // are alternatives to each other, not independent options.
  const MI_PER_DEG_LAT = 69.055;
  const r = inputs.spreadMi;
  const cell = r / MI_PER_DEG_LAT;                 // grid cell ~= the radius
  const grid = new Map<string, Scored[]>();
  const kept: Scored[] = [];

  for (const cand of ranked) {
    const { lat, lon } = cand.site;
    const gy = Math.floor(lat / cell), gx = Math.floor(lon / cell);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    let blocker: Scored | null = null;

    for (let dy = -1; dy <= 1 && !blocker; dy++) {
      for (let dx = -1; dx <= 1 && !blocker; dx++) {
        const bucket = grid.get(`${gy + dy},${gx + dx}`);
        if (!bucket) continue;
        for (const k of bucket) {
          const my = (lat - k.site.lat) * MI_PER_DEG_LAT;
          const mx = (lon - k.site.lon) * MI_PER_DEG_LAT * cosLat;
          if (Math.hypot(mx, my) < r) { blocker = k; break; }
        }
      }
    }

    if (blocker) { blocker.nearby++; continue; }
    kept.push(cand);
    const key = `${gy},${gx}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(cand); else grid.set(key, [cand]);
  }

  return { passed, top: kept.slice(0, limit), distinct: kept.length };
}
