import type {
  CurrentWeather,
  DailyPoint,
  GeoLocation,
  HourlyPoint,
  WeatherBundle,
} from "./types";

export async function reverseGeocodeOnly(lat: number, lon: number): Promise<GeoLocation> {
  return reverseGeocode(lat, lon);
}

async function reverseGeocode(lat: number, lon: number): Promise<GeoLocation> {
  try {
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("localityLanguage", "en");
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("reverse geocode failed");
    const data = (await res.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      countryName?: string;
    };
    const city = data.city || data.locality || "Your area";
    const region = data.principalSubdivision || "";
    const country = data.countryName || "";
    const parts = [city, region, country].filter(Boolean);
    return {
      lat,
      lon,
      city,
      region,
      country,
      label: parts.join(", "),
    };
  } catch {
    return {
      lat,
      lon,
      label: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
      city: "Your area",
    };
  }
}

export async function searchPlaces(query: string): Promise<GeoLocation[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", q);
  url.searchParams.set("count", "6");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      name: string;
      latitude: number;
      longitude: number;
      admin1?: string;
      country?: string;
    }>;
  };
  return (data.results ?? []).map((r) => {
    const parts = [r.name, r.admin1, r.country].filter(Boolean);
    return {
      lat: r.latitude,
      lon: r.longitude,
      city: r.name,
      region: r.admin1,
      country: r.country,
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
