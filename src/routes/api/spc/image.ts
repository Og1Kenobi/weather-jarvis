import { createFileRoute } from "@tanstack/react-router";

/**
 * Proxy official SPC product images so the browser never hits SPC CORS/CSP
 * quirks for embedded graphics.
 *
 * Allowed files only (no open proxy).
 */
const ALLOWED = new Map<string, string>([
  ["day1otlk.png", "https://www.spc.noaa.gov/products/outlook/day1otlk.png"],
  ["day1probotlk_torn.png", "https://www.spc.noaa.gov/products/outlook/day1probotlk_torn.png"],
  ["day1probotlk_hail.png", "https://www.spc.noaa.gov/products/outlook/day1probotlk_hail.png"],
  ["day1probotlk_wind.png", "https://www.spc.noaa.gov/products/outlook/day1probotlk_wind.png"],
  ["day2otlk.png", "https://www.spc.noaa.gov/products/outlook/day2otlk.png"],
  ["day2probotlk_torn.png", "https://www.spc.noaa.gov/products/outlook/day2probotlk_torn.png"],
  ["day2probotlk_hail.png", "https://www.spc.noaa.gov/products/outlook/day2probotlk_hail.png"],
  ["day2probotlk_wind.png", "https://www.spc.noaa.gov/products/outlook/day2probotlk_wind.png"],
  ["day3otlk.png", "https://www.spc.noaa.gov/products/outlook/day3otlk.png"],
  ["day3prob.png", "https://www.spc.noaa.gov/products/outlook/day3prob.png"],
  ["day3prob.gif", "https://www.spc.noaa.gov/products/outlook/day3prob.gif"],
  [
    "day48prob.gif",
    "https://www.spc.noaa.gov/products/exper/day4-8/day48prob.gif",
  ],
]);

export const Route = createFileRoute("/api/spc/image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const file = url.searchParams.get("f") ?? "";
        const upstream = ALLOWED.get(file);
        if (!upstream) {
          return new Response("Unknown SPC product", { status: 400 });
        }

        try {
          const res = await fetch(upstream, {
            headers: {
              "User-Agent": "WeatherJarvis/1.0 (weather-assistant; +local)",
              Accept: "image/*,*/*",
            },
          });
          if (!res.ok) {
            return new Response(`Upstream ${res.status}`, { status: 502 });
          }
          const buf = await res.arrayBuffer();
          const contentType = res.headers.get("content-type") || "image/png";
          return new Response(buf, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=120",
            },
          });
        } catch (e) {
          console.error("[spc-image]", e);
          return new Response("Failed to fetch SPC image", { status: 502 });
        }
      },
    },
  },
});
