# Weather Jarvis

Geolocation weather assistant with:

- **Your location** (browser geolocation or city search)
- **SPC convective outlooks** — Day 1, 2, 3, and Day 4–8 graphics from the NOAA/NWS Storm Prediction Center
- **Severe weather alerts** — live NWS warnings for your point
- **EAS-style alarm tones** + **spoken alert readout** (Web Speech API)

## Stack

React 19, TypeScript, Vite, TanStack Start/Router, Tailwind CSS.

## Develop

```bash
npm install
npm run dev        # http://0.0.0.0:8080
npm run typecheck
npm run build
```

## Data sources

- SPC outlook maps & categorical GeoJSON: [spc.noaa.gov](https://www.spc.noaa.gov/)
- Active alerts: [api.weather.gov](https://api.weather.gov/)

## Privacy

This repository is private. Unmute the browser tab to hear alert tones and voice.
