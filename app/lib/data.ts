import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import type { Site } from "./scoring";

export interface Wash {
  name: string | null; lat: number; lon: number; address: string | null;
  city: string | null; brand: string | null; format: string; format_label: string;
  format_confidence: number; format_source: string; format_evidence: string;
  sources: string; n_sources: number; facility_class: string;
  is_mobile: boolean; is_competitor: boolean;
}

export interface County {
  county: string; candidate_parcels: number; median_price_per_acre: number | null;
  median_aadt: number | null; avg_hh_income: number | null;
  permits_2026: number; population: number;
  washes: number; express: number;
  pop_per_tunnel: number | null; pop_per_wash: number | null;
}

export interface Manifest {
  generated: string;
  sources: { name: string; url: string; licence: string; vintage: string }[];
  coverage_caveats: string[];
  counts: Record<string, number | null>;
}

/**
 * Parquet int64 columns decode to BigInt, which throws the moment it meets a
 * plain number in arithmetic. Coerce every value once at load rather than
 * defending against it at every use site.
 */
function deBigInt<T extends Record<string, unknown>>(rows: T[]): T[] {
  for (const r of rows) {
    for (const k in r) {
      if (typeof r[k] === "bigint") {
        (r as Record<string, unknown>)[k] = Number(r[k] as bigint);
      }
    }
  }
  return rows;
}

async function parquet<T extends Record<string, unknown>>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const file = await res.arrayBuffer();
  const rows = (await parquetReadObjects({ file, compressors })) as T[];
  return deBigInt(rows);
}

export type IsoIndex = Map<string, GeoJSON.Feature[]>;

export async function loadAll() {
  const [sites, washes, counties, manifest, iso] = await Promise.all([
    parquet<Site & Record<string, unknown>>("./data/sites.parquet"),
    parquet<Wash & Record<string, unknown>>("./data/carwashes.parquet"),
    fetch("./data/counties.json").then(r => r.json() as Promise<County[]>),
    fetch("./data/manifest.json").then(r => r.json() as Promise<Manifest>),
    fetch("./data/isochrones.json")
      .then(r => (r.ok ? r.json() : { features: [] }))
      .catch(() => ({ features: [] })) as Promise<GeoJSON.FeatureCollection>,
  ]);

  // Index by parcel so selecting a site is a lookup, not a scan of 800 polygons.
  const assign: Record<string, [string, number]> =
    (iso as unknown as { assign?: Record<string, [string, number]> }).assign ?? {};
  const isoIndex: IsoIndex = new Map();
  for (const f of iso.features ?? []) {
    const id = String(f.properties?.uid ?? "");
    const list = isoIndex.get(id);
    if (list) list.push(f); else isoIndex.set(id, [f]);
  }
  return { sites, washes, counties, manifest, isoIndex, isoAssign: assign };
}

/**
 * Isochrones are precomputed for a thinned set of origins, so a selected
 * parcel may not have its own. Fall back to the nearest computed origin and
 * report how far away it was, because a drive-time polygon drawn from a point
 * 300 m away should say so rather than imply it was computed at this parcel.
 */
export function resolveIso(
  isoIndex: IsoIndex,
  assign: Record<string, [string, number]>,
  uid: string | null,
): { features: GeoJSON.Feature[]; offsetMi: number } {
  if (!uid) return { features: [], offsetMi: 0 };
  const exact = isoIndex.get(uid);
  if (exact) return { features: exact, offsetMi: 0 };
  const mapped = assign[uid];
  if (!mapped) return { features: [], offsetMi: 0 };
  return { features: isoIndex.get(mapped[0]) ?? [], offsetMi: mapped[1] };
}
