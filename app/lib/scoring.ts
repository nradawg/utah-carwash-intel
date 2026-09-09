/**
 * Site scoring. Runs in the browser so every input change re-ranks instantly.
 *
 * Three layers, deliberately not a single number:
 *   1. Hard gates   - binary. A site that fails is not ranked at all.
 *   2. Weighted score - five pillars, 100 points, weights user-adjustable.
 *   3. Explanation  - the factors that actually moved this site, in plain words.
 *
 * Weighting rationale (see /methodology): traffic carries only 15 points
 * because DRB finds car count has almost no predictive value on site
 * performance and MMCG attributes roughly 6% of volume variance to it, while
 * Retail Petroleum Consultants show capture rate FALLING from 1.7% at 10k AADT
 * to 0.5% at 80k. Traffic is a gate, not a driver. Access and competition
 * carry 25 each because their downside is large and discontinuous.
 */

export interface Site {
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
  allowBelowMarket: boolean; // include greenbelt/non-market assessed parcels
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
  spreadMi: 1, allowBelowMarket: false, weights: { ...DEFAULT_WEIGHTS },
};

export interface Factor { key: string; label: string; score: number; weight: number; note: string; }
export interface Scored {
  site: Site; total: number; factors: Factor[];
  strengths: string[]; weaknesses: string[];
  /** Lower-scoring parcels suppressed within spreadMi of this one. */
  nearby: number;
}

/** Clamp a value onto 0..1 across a range. */
const norm = (v: number, lo: number, hi: number) =>
  hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

const fmt = (n: number) => n.toLocaleString("en-US");

/** Hard gates. Returns a reason string when the site fails, else null. */
export function gateFail(s: Site, i: Inputs): string | null {
  if (s.acres < i.acresNeeded) return `only ${s.acres} acres, needs ${i.acresNeeded}`;
  if (s.max_dim_ft < i.minDimFt) return `longest dimension ${s.max_dim_ft} ft, needs ${i.minDimFt} ft`;
  if (i.excludeFlood && s.in_flood_zone) return "inside a FEMA special flood hazard area";
  if (s.road_speed != null && s.road_speed > i.maxSpeed) return `frontage posted ${s.road_speed} mph`;
  if ((s.aadt ?? 0) < i.minAadt) return `traffic ${fmt(s.aadt ?? 0)} below ${fmt(i.minAadt)}`;
  if (s.land_value > i.budget) return `land value $${fmt(s.land_value)} over budget`;
  if (i.vacantOnly && !s.is_vacant) return "has an existing building";
  if (!i.allowBelowMarket && s.value_flag === "below_market") return "land value assessed below market (greenbelt or exempt)";
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
  const demandScore = clamp01(0.38 * density + 0.22 * income + 0.18 * vehicles + 0.12 * multifam + 0.10 * commute);

  // --- Traffic quality ------------------------------------------------------
  // Capture rate falls as volume rises, so this saturates rather than scaling.
  const vol = norm(Math.log10(Math.max(s.aadt ?? 1, 1)), Math.log10(8_000), Math.log10(60_000));
  const trend = norm(s.aadt_growth_pct ?? 0, -5, 45);
  const nonTruck = 1 - norm(s.truck_share ?? 0.04, 0.02, 0.25);
  const measured = s.aadt_source === "udot" ? 1 : s.aadt_source === "local" ? 0.7 : 0.3;
  const trafficScore = clamp01(0.42 * vol + 0.26 * trend + 0.18 * nonTruck + 0.14 * measured);

  // --- Growth and durability ------------------------------------------------
  const permits = norm(s.county_permits_2026, 60, 3_200);
  const roofGrowth = norm(s.aadt_growth_pct ?? 0, 0, 40);
  const vacancy = s.is_vacant ? 1 : 0.45;   // a teardown costs time and money
  const growthScore = clamp01(0.44 * permits + 0.28 * roofGrowth + 0.28 * vacancy);

  const factors: Factor[] = [
    { key: "access", label: "Access & site", score: accessScore, weight: w.access,
      note: `${s.acres} ac, ${s.max_dim_ft} ft frontage, ${s.road_class ?? "unclassified"}${s.road_speed ? `, ${s.road_speed} mph` : ""}` },
    { key: "competition", label: "Competitive position", score: compScore, weight: w.competition,
      note: `${expr} express tunnel${expr === 1 ? "" : "s"} and ${comp - expr} other wash${comp - expr === 1 ? "" : "es"} within ${ring} mi; nearest tunnel ${s.dist_nearest_express_mi ?? "none"} mi` },
    { key: "demand", label: "Demand density", score: demandScore, weight: w.demand,
      note: `${fmt(roofs)} rooftops within ${ring === 1 ? 1 : 3} mi, $${fmt(Math.round(s.median_hh_income ?? 0))} median income, ${s.vehicles_per_hh ?? "?"} vehicles per household` },
    { key: "traffic", label: "Traffic quality", score: trafficScore, weight: w.traffic,
      note: s.aadt ? `${fmt(s.aadt)} AADT (${s.aadt_source === "udot" ? "UDOT count" : "local road count"})${s.aadt_growth_pct != null ? `, ${s.aadt_growth_pct > 0 ? "+" : ""}${s.aadt_growth_pct}% over 10 yr` : ""}` : "no traffic count nearby" },
    { key: "growth", label: "Growth & durability", score: growthScore, weight: w.growth,
      note: `${fmt(s.county_permits_2026)} housing units permitted in ${s.county} County in 2026${s.is_vacant ? ", vacant land" : ", existing building"}` },
  ];

  const wTotal = w.access + w.competition + w.demand + w.traffic + w.growth || 1;
  const total = factors.reduce((a, f) => a + f.score * f.weight, 0) / wTotal * 100;

  const ranked = [...factors].sort((a, b) => b.score - a.score);
  return {
    site: s, total, nearby: 0,
    factors,
    strengths: ranked.filter(f => f.score >= 0.6).slice(0, 2).map(f => `${f.label}: ${f.note}`),
    weaknesses: ranked.filter(f => f.score < 0.45).slice(-2).map(f => `${f.label}: ${f.note}`),
  };
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

export function rank(sites: Site[], inputs: Inputs, limit = 200) {
  const scored: Scored[] = [];
  for (const s of sites) {
    if (gateFail(s, inputs)) continue;
    scored.push(scoreSite(s, inputs));
  }
  scored.sort((a, b) => b.total - a.total);
  const passed = scored.length;

  if (!inputs.spreadMi) return { passed, top: scored.slice(0, limit), distinct: passed };

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

  for (const cand of scored) {
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
