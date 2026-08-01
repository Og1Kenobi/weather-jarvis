/** NOAA Storm Prediction Center (SPC) convective outlooks */

import { createServerFn } from "@tanstack/react-start";

export type SpcRiskLabel = "HIGH" | "MDT" | "ENH" | "SLGT" | "MRGL" | "TSTM" | "NONE";

export type SpcDayKey = "day1" | "day2" | "day3" | "day48";

export interface SpcRisk {
  label: SpcRiskLabel;
  label2: string;
  dn: number;
  fill?: string;
  stroke?: string;
  issueIso?: string;
  validIso?: string;
  expireIso?: string;
  forecaster?: string;
}

export interface SpcGraphic {
  id: string;
  title: string;
  /** Same-origin proxied image path */
  url: string;
}

export interface SpcDayProduct {
  key: SpcDayKey;
  title: string;
  shortTitle: string;
  risk: SpcRisk;
  graphics: SpcGraphic[];
  discussionUrl: string;
  summary?: string;
}

export interface SpcBundle {
  fetchedAt: string;
  days: SpcDayProduct[];
  maxRisk: SpcRisk;
}

const SPC = "https://www.spc.noaa.gov/products/outlook";

const RISK_RANK: Record<string, number> = {
  HIGH: 6,
  MDT: 5,
  ENH: 4,
  SLGT: 3,
  MRGL: 2,
  TSTM: 1,
  NONE: 0,
};

function noneRisk(): SpcRisk {
  return { label: "NONE", label2: "No severe risk outlined", dn: 0 };
}

function proxiedImage(file: string): string {
  const hour = Math.floor(Date.now() / 3_600_000);
  return `/api/spc/image?f=${encodeURIComponent(file)}&v=${hour}`;
}

/** Ray-cast point-in-ring (lon/lat order as GeoJSON). */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(
  lon: number,
  lat: number,
  geometry: { type: string; coordinates: unknown },
): boolean {
  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates as number[][][];
    const outer = coords[0];
    if (!outer || !pointInRing(lon, lat, outer)) return false;
    for (let h = 1; h < coords.length; h++) {
      if (pointInRing(lon, lat, coords[h]!)) return false;
    }
    return true;
  }
  if (geometry.type === "MultiPolygon") {
    const multi = geometry.coordinates as number[][][][];
    return multi.some((poly) =>
      pointInPolygon(lon, lat, { type: "Polygon", coordinates: poly }),
    );
  }
  return false;
}

interface CatFeatureProps {
  DN?: number;
  LABEL?: string;
  LABEL2?: string;
  fill?: string;
  stroke?: string;
  ISSUE_ISO?: string;
  VALID_ISO?: string;
  EXPIRE_ISO?: string;
  FORECASTER?: string;
}

async function fetchCategoricalRisk(
  day: "day1" | "day2" | "day3",
  lat: number,
  lon: number,
): Promise<SpcRisk> {
  try {
    const url = `${SPC}/${day}otlk_cat.lyr.geojson`;
    const res = await fetch(url, {
      headers: { "User-Agent": "WeatherJarvis/1.0 (weather-assistant)", Accept: "application/geo+json,*/*" },
    });
    if (!res.ok) return noneRisk();
    const data = (await res.json()) as {
      features?: Array<{
        properties?: CatFeatureProps;
        geometry?: { type: string; coordinates: unknown };
      }>;
    };

    let best: SpcRisk = noneRisk();
    let bestRank = 0;
    let meta: CatFeatureProps | undefined;

    for (const f of data.features ?? []) {
      if (!f.geometry || !pointInPolygon(lon, lat, f.geometry)) continue;
      const p = f.properties ?? {};
      const label = (p.LABEL ?? "NONE").toUpperCase() as SpcRiskLabel;
      const rank = RISK_RANK[label] ?? p.DN ?? 0;
      if (rank >= bestRank) {
        bestRank = rank;
        meta = p;
        best = {
          label: RISK_RANK[label] != null ? label : "NONE",
          label2: p.LABEL2 || p.LABEL || "Unknown",
          dn: p.DN ?? rank,
          fill: p.fill,
          stroke: p.stroke,
          issueIso: p.ISSUE_ISO,
          validIso: p.VALID_ISO,
          expireIso: p.EXPIRE_ISO,
          forecaster: p.FORECASTER,
        };
      }
    }

    if (best.label === "NONE" && (data.features?.length ?? 0) > 0) {
      const p = data.features![0]!.properties ?? {};
      best = {
        ...noneRisk(),
        issueIso: p.ISSUE_ISO,
        validIso: p.VALID_ISO,
        expireIso: p.EXPIRE_ISO,
        forecaster: p.FORECASTER,
      };
    } else if (meta) {
      best.issueIso = meta.ISSUE_ISO ?? best.issueIso;
      best.validIso = meta.VALID_ISO ?? best.validIso;
      best.expireIso = meta.EXPIRE_ISO ?? best.expireIso;
      best.forecaster = meta.FORECASTER ?? best.forecaster;
    }

    return best;
  } catch {
    return noneRisk();
  }
}

async function fetchDay1Summary(): Promise<string | undefined> {
  try {
    const res = await fetch(`${SPC}/day1otlk.txt`, {
      headers: { "User-Agent": "WeatherJarvis/1.0 (weather-assistant)" },
    });
    if (!res.ok) return undefined;
    const text = await res.text();
    const summaryMatch = text.match(/\.\.\.SUMMARY\.\.\.\s*([\s\S]*?)(?:\n\n|\n\.\.\.)/);
    if (summaryMatch?.[1]) {
      return summaryMatch[1].replace(/\s+/g, " ").trim().slice(0, 480);
    }
    const lines = text
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("ZCZC") && !l.startsWith("ACUS"));
    return lines.slice(4, 10).join(" ").replace(/\s+/g, " ").trim().slice(0, 480) || undefined;
  } catch {
    return undefined;
  }
}

function day1Graphics(): SpcGraphic[] {
  return [
    { id: "d1-cat", title: "Categorical", url: proxiedImage("day1otlk.png") },
    { id: "d1-torn", title: "Tornado", url: proxiedImage("day1probotlk_torn.png") },
    { id: "d1-hail", title: "Hail", url: proxiedImage("day1probotlk_hail.png") },
    { id: "d1-wind", title: "Wind", url: proxiedImage("day1probotlk_wind.png") },
  ];
}

function day2Graphics(): SpcGraphic[] {
  return [
    { id: "d2-cat", title: "Categorical", url: proxiedImage("day2otlk.png") },
    { id: "d2-torn", title: "Tornado", url: proxiedImage("day2probotlk_torn.png") },
    { id: "d2-hail", title: "Hail", url: proxiedImage("day2probotlk_hail.png") },
    { id: "d2-wind", title: "Wind", url: proxiedImage("day2probotlk_wind.png") },
  ];
}

function day3Graphics(): SpcGraphic[] {
  return [
    { id: "d3-cat", title: "Categorical", url: proxiedImage("day3otlk.png") },
    { id: "d3-prob", title: "Probability", url: proxiedImage("day3prob.png") },
  ];
}

function day48Graphics(): SpcGraphic[] {
  return [{ id: "d48-prob", title: "Severe probability", url: proxiedImage("day48prob.gif") }];
}

export function riskRank(label: SpcRiskLabel | string): number {
  return RISK_RANK[String(label).toUpperCase()] ?? 0;
}

export function riskBadgeVariant(
  label: SpcRiskLabel | string,
): "default" | "ok" | "warn" | "danger" | "extreme" | "primary" {
  const r = riskRank(label);
  if (r >= 5) return "extreme";
  if (r >= 4) return "danger";
  if (r >= 3) return "warn";
  if (r >= 1) return "ok";
  return "default";
}

async function buildSpcOutlooks(lat: number, lon: number): Promise<SpcBundle> {
  const [day1Risk, day2Risk, day3Risk, summary] = await Promise.all([
    fetchCategoricalRisk("day1", lat, lon),
    fetchCategoricalRisk("day2", lat, lon),
    fetchCategoricalRisk("day3", lat, lon),
    fetchDay1Summary(),
  ]);

  const days: SpcDayProduct[] = [
    {
      key: "day1",
      title: "Day 1 Convective Outlook",
      shortTitle: "Day 1",
      risk: day1Risk,
      graphics: day1Graphics(),
      discussionUrl: `${SPC}/day1otlk.html`,
      summary,
    },
    {
      key: "day2",
      title: "Day 2 Convective Outlook",
      shortTitle: "Day 2",
      risk: day2Risk,
      graphics: day2Graphics(),
      discussionUrl: `${SPC}/day2otlk.html`,
    },
    {
      key: "day3",
      title: "Day 3 Convective Outlook",
      shortTitle: "Day 3",
      risk: day3Risk,
      graphics: day3Graphics(),
      discussionUrl: `${SPC}/day3otlk.html`,
    },
    {
      key: "day48",
      title: "Day 4–8 Severe Probabilities",
      shortTitle: "Day 4–8",
      risk: noneRisk(),
      graphics: day48Graphics(),
      discussionUrl: "https://www.spc.noaa.gov/products/exper/day4-8/",
    },
  ];

  const maxRisk = [day1Risk, day2Risk, day3Risk].reduce((a, b) =>
    riskRank(b.label) > riskRank(a.label) ? b : a,
  );

  return {
    fetchedAt: new Date().toISOString(),
    days,
    maxRisk,
  };
}

/** Server-side fetch — avoids browser CORS blocks on SPC GeoJSON/text. */
export const getSpcOutlooks = createServerFn({ method: "GET" })
  .validator((input: { lat: number; lon: number }) => {
    if (
      typeof input?.lat !== "number" ||
      typeof input?.lon !== "number" ||
      Number.isNaN(input.lat) ||
      Number.isNaN(input.lon)
    ) {
      throw new Error("lat/lon required");
    }
    return input;
  })
  .handler(async ({ data }) => buildSpcOutlooks(data.lat, data.lon));

/** Client-friendly wrapper */
export async function fetchSpcOutlooks(lat: number, lon: number): Promise<SpcBundle> {
  return getSpcOutlooks({ data: { lat, lon } });
}
