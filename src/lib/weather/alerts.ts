import type { AlertSeverity, GeoLocation, WeatherAlert, WeatherBundle } from "./types";

function mapNwsSeverity(raw?: string): AlertSeverity {
  const s = (raw ?? "").toLowerCase();
  if (s === "extreme") return "extreme";
  if (s === "severe") return "severe";
  if (s === "moderate") return "moderate";
  if (s === "minor") return "minor";
  return "unknown";
}

export async function fetchNwsAlerts(location: GeoLocation): Promise<WeatherAlert[]> {
  try {
    const url = `https://api.weather.gov/alerts/active?point=${location.lat.toFixed(4)},${location.lon.toFixed(4)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": "WeatherJarvis/1.0 (weather-assistant)",
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      features?: Array<{
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
        };
      }>;
    };
    return (data.features ?? []).slice(0, 8).map((f, i) => {
      const p = f.properties ?? {};
      return {
        id: p.id || f.id || `nws-${i}`,
        event: p.event || "Weather Alert",
        headline: p.headline || p.event || "Active weather alert",
        description: (p.description || "Details unavailable.").slice(0, 900),
        instruction: p.instruction || undefined,
        severity: mapNwsSeverity(p.severity),
        urgency: p.urgency || "Unknown",
        certainty: p.certainty || "Unknown",
        onset: p.onset,
        ends: p.ends,
        source: "nws" as const,
        area: p.areaDesc,
      };
    });
  } catch {
    return [];
  }
}

/** Derive advisory-level alerts from live conditions when NWS has none. */
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
    });
  }

  if (c.temperature >= 100) {
    alerts.push({
      id: "jarvis-heat",
      event: "Extreme Heat",
      headline: `Dangerous heat in ${city}`,
      description: `Air temperature is ${Math.round(c.temperature)}°F (feels like ${Math.round(c.feelsLike)}°F). Limit outdoor exposure, stay hydrated, and check on vulnerable neighbors.`,
      severity: c.temperature >= 105 ? "extreme" : "severe",
      urgency: "Immediate",
      certainty: "Observed",
      source: "jarvis",
      area: bundle.location.label,
    });
  } else if (c.temperature <= 10) {
    alerts.push({
      id: "jarvis-cold",
      event: "Extreme Cold",
      headline: `Dangerously cold in ${city}`,
      description: `Temperature is ${Math.round(c.temperature)}°F (feels like ${Math.round(c.feelsLike)}°F). Frostbite risk rises quickly. Limit time outdoors and dress in layers.`,
      severity: c.temperature <= 0 ? "extreme" : "severe",
      urgency: "Immediate",
      certainty: "Observed",
      source: "jarvis",
      area: bundle.location.label,
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
    });
  }

  if (c.visibility < 0.5 && c.visibility > 0) {
    alerts.push({
      id: "jarvis-fog",
      event: "Dense Fog",
      headline: `Very low visibility near ${city}`,
      description: `Visibility is about ${c.visibility.toFixed(1)} miles. Slow down, use low-beam headlights, and increase following distance.`,
      severity: "moderate",
      urgency: "Expected",
      certainty: "Observed",
      source: "jarvis",
      area: bundle.location.label,
    });
  }

  return alerts;
}

export function demoSevereAlerts(location: GeoLocation): WeatherAlert[] {
  const city = location.city || "your area";
  return [
    {
      id: "demo-tornado",
      event: "Tornado Warning",
      headline: `Tornado Warning for ${city}`,
      description: `A radar-indicated tornado was detected near ${city}. This is a life-threatening situation. Take shelter now in a sturdy building, interior room on the lowest floor, away from windows.`,
      instruction:
        "Move to a basement or interior room. Cover your head. Do not try to outrun a tornado in a vehicle.",
      severity: "extreme",
      urgency: "Immediate",
      certainty: "Observed",
      source: "demo",
      area: location.label,
      onset: new Date().toISOString(),
      ends: new Date(Date.now() + 45 * 60_000).toISOString(),
    },
    {
      id: "demo-flood",
      event: "Flash Flood Warning",
      headline: `Flash Flood Warning for ${city}`,
      description: `Heavy rainfall is producing flash flooding across low-lying roads near ${city}. Do not drive through flooded roadways. Turn around, don't drown.`,
      instruction: "Move to higher ground if flooding approaches. Avoid underpasses and creek crossings.",
      severity: "severe",
      urgency: "Immediate",
      certainty: "Likely",
      source: "demo",
      area: location.label,
      onset: new Date().toISOString(),
      ends: new Date(Date.now() + 2 * 3600_000).toISOString(),
    },
  ];
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

export function isSevere(alert: WeatherAlert): boolean {
  return severityRank(alert.severity) >= 3;
}

export function mergeAlerts(...lists: WeatherAlert[][]): WeatherAlert[] {
  const map = new Map<string, WeatherAlert>();
  for (const list of lists) {
    for (const a of list) {
      if (!map.has(a.id)) map.set(a.id, a);
    }
  }
  return [...map.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

/** Weather-radio style spoken bulletin. */
export function alertSpeechScript(alert: WeatherAlert): string {
  const area = alert.area || "your area";
  const sourceLead =
    alert.source === "demo"
      ? "This is a Weather Jarvis demonstration. "
      : alert.source === "nws"
        ? "The National Weather Service has issued the following. "
        : "Weather Jarvis has a local weather advisory. ";

  const body = [
    sourceLead,
    `${alert.event} for ${area}.`,
    alert.headline.endsWith(".") ? alert.headline : `${alert.headline}.`,
    alert.description.slice(0, 320),
  ];
  if (alert.instruction) {
    body.push(`Recommended action: ${alert.instruction.slice(0, 180)}`);
  }
  body.push("End of message.");
  return body.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
