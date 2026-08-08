export type WeatherCode =
  | 0
  | 1
  | 2
  | 3
  | 45
  | 48
  | 51
  | 53
  | 55
  | 56
  | 57
  | 61
  | 63
  | 65
  | 66
  | 67
  | 71
  | 73
  | 75
  | 77
  | 80
  | 81
  | 82
  | 85
  | 86
  | 95
  | 96
  | 99
  | number;

export type AlertSeverity = "extreme" | "severe" | "moderate" | "minor" | "unknown";

/** Product family for toggles / filtering */
export type AlertKind =
  | "tornado"
  | "severeStorm"
  | "flood"
  | "heat"
  | "cold"
  | "wind"
  | "fire"
  | "tropical"
  | "winter"
  | "watch"
  | "advisory"
  | "other";

export type AlertScope = "local" | "office";

export interface GeoLocation {
  lat: number;
  lon: number;
  label: string;
  city?: string;
  region?: string;
  country?: string;
}

export interface CurrentWeather {
  time: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windGust: number;
  windDirection: number;
  precip: number;
  cloudCover: number;
  pressure: number;
  weatherCode: WeatherCode;
  isDay: boolean;
  uvIndex: number;
  visibility: number;
}

export interface HourlyPoint {
  time: string;
  temperature: number;
  precipProb: number;
  weatherCode: WeatherCode;
  windSpeed: number;
}

export interface DailyPoint {
  date: string;
  weatherCode: WeatherCode;
  tempMax: number;
  tempMin: number;
  precipSum: number;
  precipProbMax: number;
  sunrise: string;
  sunset: string;
  uvIndexMax: number;
  windMax: number;
}

export interface WeatherBundle {
  location: GeoLocation;
  timezone: string;
  current: CurrentWeather;
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  fetchedAt: string;
}

export interface WeatherAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  instruction?: string;
  severity: AlertSeverity;
  urgency: string;
  certainty: string;
  onset?: string;
  ends?: string;
  source: "nws" | "jarvis";
  area?: string;
  /** tornado, flood, heat, fire, … */
  kind: AlertKind;
  /** local = covers your point; office = active in your NWS forecast office area */
  scope: AlertScope;
  /** e.g. PAH */
  office?: string;
}

export type Units = "imperial" | "metric";
