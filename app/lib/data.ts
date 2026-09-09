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

export async function loadAll() {
  const [sites, washes, counties, manifest] = await Promise.all([
    parquet<Site & Record<string, unknown>>("./data/sites.parquet"),
    parquet<Wash & Record<string, unknown>>("./data/carwashes.parquet"),
    fetch("./data/counties.json").then(r => r.json() as Promise<County[]>),
    fetch("./data/manifest.json").then(r => r.json() as Promise<Manifest>),
  ]);
  return { sites, washes, counties, manifest };
}
