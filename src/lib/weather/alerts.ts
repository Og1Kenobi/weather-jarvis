import type {
  AlertKind,
  AlertScope,
  AlertSeverity,
  GeoLocation,
  WeatherAlert,
  WeatherBundle,
} from "./types";

const NWS_HEADERS = {
  Accept: "application/geo+json",
  "User-Agent": "WeatherJarvis/1.0 (weather-assistant)",
} as const;

export const ALERT_KIND_META: Array<{
  id: AlertKind;
  label: string;
  blurb: string;
  defaultOn: boolean;
}> = [
  { id: "tornado", label: "Tornado", blurb: "Tornado warnings", defaultOn: true },
  { id: "severeStorm", label: "Severe storm", blurb: "Severe thunderstorm", defaultOn: true },
  { id: "flood", label: "Flood", blurb: "Flood & flash flood", defaultOn: true },
  { id: "heat", label: "Heat", blurb: "Extreme / excessive heat", defaultOn: true },
  { id: "cold", label: "Cold", blurb: "Wind chill & freeze", defaultOn: true },
  { id: "wind", label: "Wind", blurb: "High / extreme wind, dust", defaultOn: true },
  { id: "fire", label: "Fire weather", blurb: "Red flag & fire weather", defaultOn: true },
  { id: "tropical", label: "Tropical", blurb: "Hurricane & tropical storm", defaultOn: true },
  { id: "winter", label: "Winter", blurb: "Blizzard, ice, winter storm", defaultOn: true },
  { id: "watch", label: "Watches", blurb: "Tornado / SVR / flood watches", defaultOn: true },
  { id: "advisory", label: "Advisories", blurb: "Heat, wind, fog, etc.", defaultOn: false },
  { id: "other", label: "Other", blurb: "Statements & everything else", defaultOn: false },
];

export type AlertKindPrefs = Record<AlertKind, boolean>;

export function defaultAlertKindPrefs(): AlertKindPrefs {
  return Object.fromEntries(ALERT_KIND_META.map((k) => [k.id, k.defaultOn])) as AlertKindPrefs;
}

export function classifyAlertKind(event: string): AlertKind {
  const e = event.toLowerCase();

  if (/tornado\s+warning/.test(e)) return "tornado";
  if (/severe\s+thunderstorm/.test(e) && !/\bwatch\b/.test(e)) return "severeStorm";
  if (/(flash\s+)?flood/.test(e) && !/\bwatch\b/.test(e)) return "flood";
  if (/hurricane|tropical\s+storm|typhoon|storm\s+surge/.test(e) && !/\bwatch\b/.test(e))
    return "tropical";
  if (/blizzard|ice\s+storm|winter\s+storm|winter\s+weather|heavy\s+snow|freezing\s+rain/.test(e))
    return "winter";
  if (/wind\s+chill|hard\s+freeze|freeze\s+warning|extreme\s+cold/.test(e)) return "cold";
  if (/extreme\s+heat|excessive\s+heat|heat\s+warning|heat\s+advisory/.test(e)) return "heat";
  if (/red\s+flag|fire\s+weather|fire\s+warning/.test(e)) return "fire";
  if (/high\s+wind|extreme\s+wind|dust\s+storm|wind\s+advisory|gale\s+warning/.test(e))
    return "wind";
  if (/\bwatch\b/.test(e)) return "watch";
  if (/\badvisory\b/.test(e) || /\bstatement\b/.test(e)) return "advisory";
  if (/tornado/.test(e)) return "tornado";
  if (/\bwarning\b/.test(e)) return "other";
  return "other";
}

const ALARM_EVENT_PATTERNS = [
  /tornado\s+warning/i,
  /severe\s+thunderstorm\s+warning/i,
  /flash\s+flood\s+warning/i,
  /flood\s+warning/i,
  /extreme\s+wind\s+warning/i,
  /high\s+wind\s+warning/i,
  /dust\s+storm\s+warning/i,
  /blizzard\s+warning/i,
  /ice\s+storm\s+warning/i,
  /winter\s+storm\s+warning/i,
  /hurricane\s+warning/i,
  /tropical\s+storm\s+warning/i,
  /tsunami\s+warning/i,
  /extreme\s+heat\s+warning/i,
  /excessive\s+heat\s+warning/i,
  /wind\s+chill\s+warning/i,
  /red\s+flag\s+warning/i,
];

function boostSeverityForEvent(event: string, severity: AlertSeverity): AlertSeverity {
  const e = event.toLowerCase();
  if (/tornado\s+warning|extreme\s+wind|hurricane\s+warning|tsunami/.test(e)) {
    return severityRank(severity) >= 4 ? severity : "extreme";
  }
  if (/\bwarning\b/.test(e)) {
    return severityRank(severity) >= 3 ? severity : "severe";
  }
  if (/\bwatch\b/.test(e) && /tornado|severe thunderstorm|flash flood|hurricane|fire weather/.test(e)) {
    return severityRank(severity) >= 2 ? severity : "moderate";
  }
  return severity;
}

function mapNwsSeverity(raw?: string): AlertSeverity {
  const s = (raw ?? "").toLowerCase();
  if (s === "extreme") return "extreme";
  if (s === "severe") return "severe";
  if (s === "moderate") return "moderate";
  if (s === "minor") return "minor";
  return "unknown";
}

export function isWarningEvent(event: string): boolean {
  return /\bwarning\b/i.test(event);
}

export function isWatchEvent(event: string): boolean {
  return /\bwatch\b/i.test(event);
}

export function shouldAlarm(alert: WeatherAlert): boolean {
  if (severityRank(alert.severity) >= 3) return true;
  if (ALARM_EVENT_PATTERNS.some((re) => re.test(alert.event))) return true;
  if (isWarningEvent(alert.event) && severityRank(alert.severity) >= 2) return true;
  return false;
}

export function isSevere(alert: WeatherAlert): boolean {
  return shouldAlarm(alert);
}

export function isKindEnabled(alert: WeatherAlert, prefs: AlertKindPrefs): boolean {
  return prefs[alert.kind] !== false;
}

type NwsFeature = {
  id?: string;
  properties?: {
    id?: string;
    event?: string;
    headline?: string;
    description?: string;
    instruction?: string;
    severity?: string;
    urgency?: string;
    certainty?: string;
    onset?: string;
    ends?: string;
    areaDesc?: string;
    senderName?: string;
    geocode?: { UGC?: string[]; SAME?: string[] };
  };
};

type OfficeFootprint = {
  id: string;
  zones: Set<string>;
  states: string[];
};

type NwsPointMeta = {
  office?: string;
  /** County UGC e.g. FLC039 */
  county?: string;
  /** Forecast zone e.g. FLZ017 */
  forecastZone?: string;
  fireZone?: string;
  localZones: string[];
  countyName?: string;
};

export type LocationNwsContext = {
  office?: string;
  countyCode?: string;
  countyName?: string;
  forecastZone?: string;
};

export type FetchAlertsResult = {
  alerts: WeatherAlert[];
  context: LocationNwsContext;
};

const officeCache = new Map<string, OfficeFootprint>();

function mapFeature(
  f: NwsFeature,
  i: number,
  scope: AlertScope,
  office?: string,
): WeatherAlert {
  const p = f.properties ?? {};
  const event = p.event || "Weather Alert";
  const baseSev = mapNwsSeverity(p.severity);
  return {
    id: p.id || f.id || `nws-${scope}-${i}`,
    event,
    headline: p.headline || p.event || "Active weather alert",
    description: (p.description || "Details unavailable.").slice(0, 1200),
    instruction: p.instruction || undefined,
    severity: boostSeverityForEvent(event, baseSev),
    urgency: p.urgency || "Unknown",
    certainty: p.certainty || "Unknown",
    onset: p.onset,
    ends: p.ends,
    source: "nws",
    area: p.areaDesc,
    kind: classifyAlertKind(event),
    scope,
    office,
  };
}

async function fetchAlertCollection(url: string): Promise<NwsFeature[]> {
  try {
    const res = await fetch(url, { headers: NWS_HEADERS });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: NwsFeature[] };
    return data.features ?? [];
  } catch {
    return [];
  }
}

function zoneCodeFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const code = url.split("/").pop();
  return code || undefined;
}

/** Land state codes only — NWS `area=` rejects marine GM etc. */
function landStates(states: string[]): string[] {
  return states.filter((s) => /^[A-Z]{2}$/.test(s) && s !== "GM" && s !== "PZ" && s !== "PK");
}

async function resolveNwsPoint(lat: number, lon: number): Promise<NwsPointMeta> {
  try {
    const res = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: NWS_HEADERS },
    );
    if (!res.ok) return { localZones: [] };
    const data = (await res.json()) as {
      properties?: {
        cwa?: string;
        forecastOffice?: string;
        county?: string;
        forecastZone?: string;
        fireWeatherZone?: string;
        relativeLocation?: {
          properties?: { city?: string; state?: string };
        };
      };
    };
    const p = data.properties ?? {};
    let office = p.cwa;
    if (!office && p.forecastOffice) {
      const m = p.forecastOffice.match(/\/offices\/([A-Z0-9]+)$/i);
      if (m) office = m[1]!.toUpperCase();
    }
    const county = zoneCodeFromUrl(p.county);
    const forecastZone = zoneCodeFromUrl(p.forecastZone);
    const fireZone = zoneCodeFromUrl(p.fireWeatherZone);
    const localZones = [county, forecastZone, fireZone].filter(Boolean) as string[];

    let countyName: string | undefined;
    if (p.county) {
      try {
        const zRes = await fetch(p.county, {
          headers: {
            Accept: "application/ld+json",
            "User-Agent": NWS_HEADERS["User-Agent"],
          },
        });
        if (zRes.ok) {
          const z = (await zRes.json()) as { name?: string; state?: string };
          if (z.name) {
            countyName = z.state ? `${z.name} County, ${z.state}` : z.name;
            // NWS often already includes "County" in name for some; avoid double
            if (z.name.toLowerCase().includes("county") && z.state) {
              countyName = `${z.name}, ${z.state}`;
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    return { office, county, forecastZone, fireZone, localZones, countyName };
  } catch {
    return { localZones: [] };
  }
}

async function loadOfficeFootprint(officeId: string): Promise<OfficeFootprint | null> {
  const cached = officeCache.get(officeId);
  if (cached) return cached;
  try {
    const res = await fetch(`https://api.weather.gov/offices/${officeId}`, {
      headers: {
        Accept: "application/ld+json",
        "User-Agent": NWS_HEADERS["User-Agent"],
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      responsibleCounties?: string[];
      responsibleForecastZones?: string[];
      responsibleFireZones?: string[];
    };
    const zones = new Set<string>();
    for (const list of [
      data.responsibleCounties,
      data.responsibleForecastZones,
      data.responsibleFireZones,
    ]) {
      for (const url of list ?? []) {
        const code = url.split("/").pop();
        if (code) zones.add(code);
      }
    }
    const states = landStates([...new Set([...zones].map((z) => z.slice(0, 2)))].sort());
    const fp: OfficeFootprint = { id: officeId, zones, states };
    officeCache.set(officeId, fp);
    return fp;
  } catch {
    return null;
  }
}

function featureInFootprint(f: NwsFeature, fp: OfficeFootprint): boolean {
  const ugc = f.properties?.geocode?.UGC ?? [];
  return ugc.some((u) => fp.zones.has(u));
}

function featureTouchesZones(f: NwsFeature, zones: string[]): boolean {
  if (zones.length === 0) return false;
  const set = new Set(zones);
  const ugc = f.properties?.geocode?.UGC ?? [];
  return ugc.some((u) => set.has(u));
}

function isOfficeHighImpact(event: string): boolean {
  const kind = classifyAlertKind(event);
  return (
    isWarningEvent(event) ||
    isWatchEvent(event) ||
    kind === "tornado" ||
    kind === "severeStorm" ||
    kind === "flood" ||
    kind === "tropical" ||
    kind === "fire" ||
    kind === "winter" ||
    kind === "heat" ||
    kind === "wind" ||
    kind === "cold"
  );
}

function featureId(f: NwsFeature): string | undefined {
  return f.properties?.id || f.id;
}

/**
 * Alerts for your real location:
 * 1) exact lat/lon (inside the hazard polygon)
 * 2) your county / forecast zone (NWS lists the county even when the polygon is partial)
 * 3) high-impact products elsewhere in your NWS office area
 */
export async function fetchNwsAlerts(location: GeoLocation): Promise<FetchAlertsResult> {
  const empty: FetchAlertsResult = { alerts: [], context: {} };
  try {
    const lat = location.lat;
    const lon = location.lon;
    const meta = await resolveNwsPoint(lat, lon);
    const office = meta.office;
    const footprint = office ? await loadOfficeFootprint(office) : null;
    const context: LocationNwsContext = {
      office,
      countyCode: meta.county,
      countyName: meta.countyName,
      forecastZone: meta.forecastZone,
    };

    const pointUrl = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;

    const zoneParam = meta.localZones.join(",");
    const zoneUrl = zoneParam
      ? `https://api.weather.gov/alerts/active?zone=${encodeURIComponent(zoneParam)}`
      : null;

    const areaUrl =
      footprint && footprint.states.length > 0
        ? `https://api.weather.gov/alerts/active?area=${encodeURIComponent(footprint.states.join(","))}&status=actual`
        : null;

    const [pointFeats, zoneFeats, areaFeats] = await Promise.all([
      fetchAlertCollection(pointUrl),
      zoneUrl ? fetchAlertCollection(zoneUrl) : Promise.resolve([] as NwsFeature[]),
      areaUrl ? fetchAlertCollection(areaUrl) : Promise.resolve([] as NwsFeature[]),
    ]);

    const byId = new Map<string, WeatherAlert>();

    const add = (f: NwsFeature, i: number, scope: AlertScope) => {
      const id = featureId(f) || `nws-${scope}-${i}`;
      const existing = byId.get(id);
      if (existing && !(existing.scope === "office" && scope === "local")) return;
      byId.set(id, mapFeature(f, i, scope, office));
    };

    pointFeats.forEach((f, i) => add(f, i, "local"));

    zoneFeats.forEach((f, i) => {
      if (featureTouchesZones(f, meta.localZones)) add(f, i, "local");
    });

    if (footprint) {
      areaFeats.forEach((f, i) => {
        if (!featureInFootprint(f, footprint)) return;
        const event = f.properties?.event || "";
        if (featureTouchesZones(f, meta.localZones)) {
          add(f, i, "local");
          return;
        }
        if (!isOfficeHighImpact(event)) return;
        add(f, i, "office");
      });
    }

    const alerts = [...byId.values()]
      .sort((a, b) => {
        const scope = Number(a.scope === "local") - Number(b.scope === "local");
        if (scope !== 0) return -scope;
        const w = Number(isWarningEvent(b.event)) - Number(isWarningEvent(a.event));
        if (w !== 0) return w;
        return severityRank(b.severity) - severityRank(a.severity);
      })
      .slice(0, 24);

    return { alerts, context };
  } catch {
    return empty;
  }
}

export function deriveConditionAlerts(bundle: WeatherBundle): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  const c = bundle.current;
  const city = bundle.location.city || "your area";

  if (c.windGust >= 50 || c.windSpeed >= 40) {
    alerts.push({
      id: "jarvis-wind",
      event: "High Wind Advisory",
      headline: `Strong winds near ${city}`,
      description: `Sustained winds around ${Math.round(c.windSpeed)} mph with gusts near ${Math.round(c.windGust)} mph. Secure loose outdoor items and use caution when driving high-profile vehicles.`,
      severity: c.windGust >= 60 ? "severe" : "moderate",
      urgency: "Expected",
      certainty: "Likely",
      source: "jarvis",
      area: bundle.location.label,
      kind: "wind",
      scope: "local",
    });
  }

  if (c.temperature >= 100) {
    alerts.push({
      id: "jarvis-heat",
      event: "Extreme Heat Warning",
      headline: `Dangerous heat in ${city}`,
      description: `Air temperature is ${Math.round(c.temperature)}°F (feels like ${Math.round(c.feelsLike)}°F). Limit outdoor exposure, stay hydrated, and check on vulnerable neighbors.`,
      severity: c.temperature >= 105 ? "extreme" : "severe",
      urgency: "Immediate",
      certainty: "Observed",
      source: "jarvis",
      area: bundle.location.label,
      kind: "heat",
      scope: "local",
    });
  } else if (c.temperature <= 10) {
    alerts.push({
      id: "jarvis-cold",
      event: "Wind Chill Warning",
      headline: `Dangerously cold in ${city}`,
      description: `Temperature is ${Math.round(c.temperature)}°F (feels like ${Math.round(c.feelsLike)}°F). Frostbite risk rises quickly. Limit time outdoors and dress in layers.`,
      severity: c.temperature <= 0 ? "extreme" : "severe",
      urgency: "Immediate",
      certainty: "Observed",
      source: "jarvis",
      area: bundle.location.label,
      kind: "cold",
      scope: "local",
    });
  }

  if (c.weatherCode >= 95) {
    alerts.push({
      id: "jarvis-storm",
      event: "Thunderstorm",
      headline: `Thunderstorm activity near ${city}`,
      description:
        "Thunderstorms are active nearby. Move indoors if you hear thunder. Avoid tall isolated objects and open water until the storm passes.",
      severity: c.weatherCode >= 96 ? "severe" : "moderate",
      urgency: "Immediate",
      certainty: "Observed",
      source: "jarvis",
      area: bundle.location.label,
      kind: "severeStorm",
      scope: "local",
    });
  }

  if (c.visibility < 0.5 && c.visibility > 0) {
    alerts.push({
      id: "jarvis-fog",
      event: "Dense Fog Advisory",
      headline: `Very low visibility near ${city}`,
      description: `Visibility is about ${c.visibility.toFixed(1)} miles. Slow down, use low-beam headlights, and increase following distance.`,
      severity: "moderate",
      urgency: "Expected",
      certainty: "Observed",
      source: "jarvis",
      area: bundle.location.label,
      kind: "advisory",
      scope: "local",
    });
  }

  return alerts;
}

export function severityRank(s: AlertSeverity): number {
  switch (s) {
    case "extreme":
      return 4;
    case "severe":
      return 3;
    case "moderate":
      return 2;
    case "minor":
      return 1;
    default:
      return 0;
  }
}

export function mergeAlerts(...lists: WeatherAlert[][]): WeatherAlert[] {
  const map = new Map<string, WeatherAlert>();
  for (const list of lists) {
    for (const a of list) {
      const existing = map.get(a.id);
      if (!existing || (existing.scope === "office" && a.scope === "local")) {
        map.set(a.id, a);
      }
    }
  }
  return [...map.values()].sort((a, b) => {
    const scope = Number(a.scope === "local") - Number(b.scope === "local");
    if (scope !== 0) return -scope;
    const alarm = Number(shouldAlarm(b)) - Number(shouldAlarm(a));
    if (alarm !== 0) return alarm;
    const w = Number(isWarningEvent(b.event)) - Number(isWarningEvent(a.event));
    if (w !== 0) return w;
    return severityRank(b.severity) - severityRank(a.severity);
  });
}

function cleanSpeechChunk(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/^\s*[\*\-•▪◦●]+\s*/gm, "")
    .replace(/\*+/g, " ")
    .replace(/\.{3,}/g, ". ")
    .replace(/\u2026/g, ". ")
    .replace(/\b(HAZARD|SOURCE|IMPACT)\s*\.+/gi, "$1: ")
    .replace(/\s+/g, " ")
    .trim();
}

export function alertSpeechScript(alert: WeatherAlert): string {
  const area = cleanSpeechChunk(alert.area || "your area");
  const scopeNote =
    alert.scope === "office" && alert.source === "nws"
      ? ` This is active in the NWS ${alert.office || "office"} forecast area near you, not necessarily on your exact location.`
      : "";
  const sourceLead =
    alert.source === "nws"
      ? "The National Weather Service has issued the following. "
      : "Weather Jarvis has a local weather advisory. ";

  const headline = cleanSpeechChunk(alert.headline);
  const description = cleanSpeechChunk(alert.description.slice(0, 400));
  const instruction = alert.instruction
    ? cleanSpeechChunk(alert.instruction.slice(0, 200))
    : "";

  const body = [
    sourceLead,
    `${cleanSpeechChunk(alert.event)} for ${area}.`,
    scopeNote,
    headline.endsWith(".") ? headline : `${headline}.`,
    description,
  ];
  if (instruction) {
    body.push(`Recommended action: ${instruction}`);
  }
  body.push("End of message.");
  return body.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

const PREFS_KEY = "weather-jarvis-alert-kinds";

export function loadAlertKindPrefs(): AlertKindPrefs {
  const base = defaultAlertKindPrefs();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<AlertKindPrefs>;
    return { ...base, ...parsed };
  } catch {
    return base;
  }
}

export function saveAlertKindPrefs(prefs: AlertKindPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
