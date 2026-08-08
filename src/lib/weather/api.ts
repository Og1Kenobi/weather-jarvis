import type {
  CurrentWeather,
  DailyPoint,
  GeoLocation,
  HourlyPoint,
  WeatherBundle,
} from "./types";

const STATE_ABBR: Record<string, string> = {
  al: "Alabama",
  ak: "Alaska",
  az: "Arizona",
  ar: "Arkansas",
  ca: "California",
  co: "Colorado",
  ct: "Connecticut",
  de: "Delaware",
  fl: "Florida",
  ga: "Georgia",
  hi: "Hawaii",
  id: "Idaho",
  il: "Illinois",
  in: "Indiana",
  ia: "Iowa",
  ks: "Kansas",
  ky: "Kentucky",
  la: "Louisiana",
  me: "Maine",
  md: "Maryland",
  ma: "Massachusetts",
  mi: "Michigan",
  mn: "Minnesota",
  ms: "Mississippi",
  mo: "Missouri",
  mt: "Montana",
  ne: "Nebraska",
  nv: "Nevada",
  nh: "New Hampshire",
  nj: "New Jersey",
  nm: "New Mexico",
  ny: "New York",
  nc: "North Carolina",
  nd: "North Dakota",
  oh: "Ohio",
  ok: "Oklahoma",
  or: "Oregon",
  pa: "Pennsylvania",
  ri: "Rhode Island",
  sc: "South Carolina",
  sd: "South Dakota",
  tn: "Tennessee",
  tx: "Texas",
  ut: "Utah",
  vt: "Vermont",
  va: "Virginia",
  wa: "Washington",
  wv: "West Virginia",
  wi: "Wisconsin",
  wy: "Wyoming",
  dc: "District of Columbia",
};

/** Parse "Marianna, FL" / "Quincy Florida" into name + optional state filter. */
function parsePlaceQuery(raw: string): { name: string; stateName?: string; stateAbbr?: string } {
  const q = raw.trim().replace(/\s+/g, " ");
  // City, ST or City, State
  const comma = q.match(/^(.+?),\s*([A-Za-z]{2}|[A-Za-z ]+)$/);
  if (comma) {
    const name = comma[1]!.trim();
    const st = comma[2]!.trim();
    if (st.length === 2) {
      const abbr = st.toLowerCase();
      return { name, stateAbbr: abbr, stateName: STATE_ABBR[abbr] };
    }
    return { name, stateName: st };
  }
  // City ST (two-letter at end)
  const tail = q.match(/^(.+?)\s+([A-Za-z]{2})$/);
  if (tail) {
    const abbr = tail[2]!.toLowerCase();
    if (STATE_ABBR[abbr]) {
      return { name: tail[1]!.trim(), stateAbbr: abbr, stateName: STATE_ABBR[abbr] };
    }
  }
  // City Florida
  const words = q.split(" ");
  if (words.length >= 2) {
    const last = words[words.length - 1]!.toLowerCase();
    for (const [abbr, full] of Object.entries(STATE_ABBR)) {
      if (full.toLowerCase() === last) {
        return {
          name: words.slice(0, -1).join(" "),
          stateAbbr: abbr,
          stateName: full,
        };
      }
    }
  }
  return { name: q };
}

export async function reverseGeocodeOnly(lat: number, lon: number): Promise<GeoLocation> {
  return reverseGeocode(lat, lon);
}

type LocalityAdmin = {
  name?: string;
  description?: string;
  order?: number;
  adminLevel?: number;
  isoCode?: string;
};

function isTownshipOrDistrictName(name: string): boolean {
  return /^(township|town\s+of|borough\s+of|parish\s+of|district\s+of|census\s+area)\b/i.test(
    name.trim(),
  ) || /\b(township|CCD|precinct)\b/i.test(name);
}

function cleanCountry(name: string): string {
  if (/united states/i.test(name)) return "United States";
  return name.replace(/\s*\(the\)\s*$/i, "").trim();
}

function pickCityFromBigData(data: {
  city?: string;
  locality?: string;
  localityInfo?: {
    administrative?: LocalityAdmin[];
    informative?: LocalityAdmin[];
  };
}): string | undefined {
  const city = (data.city || "").trim();
  const locality = (data.locality || "").trim();

  // Prefer real towns over "Township of Monroe" style names
  if (locality && (!city || isTownshipOrDistrictName(city))) {
    return locality;
  }
  if (city && !isTownshipOrDistrictName(city)) {
    return city;
  }

  // Walk admin hierarchy: prefer municipality (level 8) over county (6)
  const admins = data.localityInfo?.administrative ?? [];
  const byLevel = [...admins].sort(
    (a, b) => (b.adminLevel ?? 0) - (a.adminLevel ?? 0),
  );
  for (const a of byLevel) {
    const n = (a.name || "").trim();
    if (!n || isTownshipOrDistrictName(n)) continue;
    if ((a.adminLevel ?? 0) >= 7) return n; // city / town / village
  }

  // Informative layer sometimes has the place name
  for (const a of data.localityInfo?.informative ?? []) {
    const n = (a.name || "").trim();
    const d = (a.description || "").toLowerCase();
    if (!n || isTownshipOrDistrictName(n)) continue;
    if (/city|town|village|populated place/i.test(d)) return n;
  }

  return locality || city || undefined;
}

async function reverseGeocodeNws(lat: number, lon: number): Promise<GeoLocation | null> {
  try {
    const res = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        headers: {
          Accept: "application/geo+json",
          "User-Agent": "WeatherJarvis/1.0 (weather-assistant)",
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      properties?: {
        relativeLocation?: {
          properties?: {
            city?: string;
            state?: string;
            distance?: { value?: number };
          };
        };
      };
    };
    const rel = data.properties?.relativeLocation?.properties;
    if (!rel?.city) return null;
    // Only trust if NWS says we're essentially at that city (distance in meters)
    const distM = rel.distance?.value;
    if (typeof distM === "number" && distM > 40_000) {
      // > ~25 miles — still use city as "near X" style
      const state = rel.state || "";
      const label = [`Near ${rel.city}`, state, "United States"].filter(Boolean).join(", ");
      return {
        lat,
        lon,
        city: rel.city,
        region: state,
        country: "United States",
        label,
      };
    }
    const state = rel.state || "";
    const parts = [rel.city, state, "United States"].filter(Boolean);
    return {
      lat,
      lon,
      city: rel.city,
      region: state,
      country: "United States",
      label: parts.join(", "),
    };
  } catch {
    return null;
  }
}

async function reverseGeocode(lat: number, lon: number): Promise<GeoLocation> {
  // 1) BigDataCloud — good coords, but often labels AR townships as "city"
  try {
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("localityLanguage", "en");
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = (await res.json()) as {
        city?: string;
        locality?: string;
        principalSubdivision?: string;
        countryName?: string;
        localityInfo?: {
          administrative?: LocalityAdmin[];
          informative?: LocalityAdmin[];
        };
      };

      let city = pickCityFromBigData(data);
      const region = data.principalSubdivision || "";
      const country = cleanCountry(data.countryName || "United States");

      // If still stuck on a township name, prefer NWS city
      if (!city || isTownshipOrDistrictName(city)) {
        const nws = await reverseGeocodeNws(lat, lon);
        if (nws?.city) {
          return {
            ...nws,
            lat,
            lon,
            // Keep GPS coords exactly — name from NWS, not a point 200mi away
          };
        }
      }

      if (city) {
        // Prefer NWS when BDC city still looks wrong (rare) — merge state abbr
        const nws = await reverseGeocodeNws(lat, lon);
        if (nws?.city && isTownshipOrDistrictName(city)) {
          return nws;
        }
        // If NWS city is different and BDC used a weak name, trust NWS for US
        if (
          nws?.city &&
          nws.city.toLowerCase() !== city.toLowerCase() &&
          (isTownshipOrDistrictName(city) || /county/i.test(city))
        ) {
          return nws;
        }

        const parts = [city, region, country].filter(Boolean);
        return {
          lat,
          lon,
          city,
          region,
          country,
          label: parts.join(", "),
        };
      }
    }
  } catch {
    /* fall through */
  }

  // 2) NWS relative location (excellent for CONUS weather context)
  const nws = await reverseGeocodeNws(lat, lon);
  if (nws) return nws;

  // 3) Last resort: coordinates only (never invent a far-away place name)
  return {
    lat,
    lon,
    label: `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`,
    city: "Your area",
  };
}

/**
 * City search biased to the US. Prefer "City, ST" (e.g. Quincy, FL) so you
 * don't land on the wrong Gadsden / Decatur.
 */
export async function searchPlaces(query: string): Promise<GeoLocation[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const parsed = parsePlaceQuery(q);

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", parsed.name);
  url.searchParams.set("count", "12");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("countryCode", "US");

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      name: string;
      latitude: number;
      longitude: number;
      admin1?: string;
      country?: string;
      country_code?: string;
      population?: number;
      feature_code?: string;
    }>;
  };

  let results = data.results ?? [];

  if (parsed.stateName) {
    const sn = parsed.stateName.toLowerCase();
    const filtered = results.filter((r) => (r.admin1 || "").toLowerCase() === sn);
    if (filtered.length) results = filtered;
  }

  // Prefer populated places / exact name match
  const nameLc = parsed.name.toLowerCase();
  results = [...results].sort((a, b) => {
    const aExact = a.name.toLowerCase() === nameLc ? 1 : 0;
    const bExact = b.name.toLowerCase() === nameLc ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return (b.population ?? 0) - (a.population ?? 0);
  });

  return results.slice(0, 8).map((r) => {
    const parts = [r.name, r.admin1, r.country || "United States"].filter(Boolean);
    return {
      lat: r.latitude,
      lon: r.longitude,
      city: r.name,
      region: r.admin1,
      country: r.country || "United States",
      label: parts.join(", "),
    };
  });
}

export async function locateUser(): Promise<GeoLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("Geolocation is not available in this browser.");
  }
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60_000,
    });
  });
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  return reverseGeocode(lat, lon);
}

export async function fetchWeather(location: GeoLocation): Promise<WeatherBundle> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.lat));
  url.searchParams.set("longitude", String(location.lon));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
    ].join(","),
  );
  url.searchParams.set(
    "hourly",
    ["temperature_2m", "precipitation_probability", "weather_code", "wind_speed_10m", "uv_index", "visibility"].join(
      ",",
    ),
  );
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "sunrise",
      "sunset",
      "uv_index_max",
      "wind_speed_10m_max",
    ].join(","),
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Weather request failed");
  const data = (await res.json()) as {
    timezone: string;
    current: Record<string, number | string>;
    hourly: {
      time: string[];
      temperature_2m: number[];
      precipitation_probability: number[];
      weather_code: number[];
      wind_speed_10m: number[];
      uv_index: number[];
      visibility: number[];
    };
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
      precipitation_probability_max: number[];
      sunrise: string[];
      sunset: string[];
      uv_index_max: number[];
      wind_speed_10m_max: number[];
    };
  };

  const nowIso = String(data.current.time);
  const hourIdx = Math.max(
    0,
    data.hourly.time.findIndex((t) => t >= nowIso.slice(0, 13)),
  );
  const uv = data.hourly.uv_index[hourIdx] ?? 0;
  const visibility = (data.hourly.visibility[hourIdx] ?? 10000) / 1609.34;

  const current: CurrentWeather = {
    time: nowIso,
    temperature: Number(data.current.temperature_2m),
    feelsLike: Number(data.current.apparent_temperature),
    humidity: Number(data.current.relative_humidity_2m),
    windSpeed: Number(data.current.wind_speed_10m),
    windGust: Number(data.current.wind_gusts_10m),
    windDirection: Number(data.current.wind_direction_10m),
    precip: Number(data.current.precipitation),
    cloudCover: Number(data.current.cloud_cover),
    pressure: Number(data.current.pressure_msl),
    weatherCode: Number(data.current.weather_code),
    isDay: Number(data.current.is_day) === 1,
    uvIndex: uv,
    visibility,
  };

  const hourly: HourlyPoint[] = data.hourly.time.slice(hourIdx, hourIdx + 24).map((time, i) => {
    const idx = hourIdx + i;
    return {
      time,
      temperature: data.hourly.temperature_2m[idx] ?? 0,
      precipProb: data.hourly.precipitation_probability[idx] ?? 0,
      weatherCode: data.hourly.weather_code[idx] ?? 0,
      windSpeed: data.hourly.wind_speed_10m[idx] ?? 0,
    };
  });

  const daily: DailyPoint[] = data.daily.time.map((date, i) => ({
    date,
    weatherCode: data.daily.weather_code[i] ?? 0,
    tempMax: data.daily.temperature_2m_max[i] ?? 0,
    tempMin: data.daily.temperature_2m_min[i] ?? 0,
    precipSum: data.daily.precipitation_sum[i] ?? 0,
    precipProbMax: data.daily.precipitation_probability_max[i] ?? 0,
    sunrise: data.daily.sunrise[i] ?? "",
    sunset: data.daily.sunset[i] ?? "",
    uvIndexMax: data.daily.uv_index_max[i] ?? 0,
    windMax: data.daily.wind_speed_10m_max[i] ?? 0,
  }));

  return {
    location,
    timezone: data.timezone,
    current,
    hourly,
    daily,
    fetchedAt: new Date().toISOString(),
  };
}

export const DEFAULT_LOCATION: GeoLocation = {
  lat: 40.7128,
  lon: -74.006,
  city: "New York",
  region: "New York",
  country: "United States",
  label: "New York, New York, United States",
};
