import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/provider";
import appCss from "../styles.css?url";

/** Hostname suitable for absolute og:image / x:game:image URLs. */
function publicShareHost(raw: string): string {
  const host = String(raw ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
  if (!host || !/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return "";
  if (
    host === "vercel.app" ||
    host.endsWith(".vercel.app") ||
    host === "vercel.com" ||
    host.endsWith(".vercel.com")
  ) {
    return "";
  }
  return host;
}

function shareHost(): string {
  return publicShareHost(String(import.meta.env.VITE_PUBLIC_HOSTNAME ?? ""));
}

export const Route = createRootRoute({
  head: () => {
    const host = shareHost();
    const ogImage = host ? `https://${host}/og.jpg` : undefined;
    const xBanner = host ? `https://${host}/x-banner.jpg` : undefined;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          title: "Weather Jarvis — SPC outlooks & severe weather alerts",
        },
        {
          name: "description",
          content:
            "Geolocation weather assistant with Storm Prediction Center Day 1–3 graphics, severe alert alarms, and spoken warnings.",
        },
        { property: "og:title", content: "Weather Jarvis — SPC outlooks & severe weather alerts" },
        {
          property: "og:description",
          content:
            "Geolocation weather assistant with Storm Prediction Center Day 1–3 graphics, severe alert alarms, and spoken warnings.",
        },
        { name: "twitter:card", content: "summary_large_image" },
        ...(ogImage
          ? [
              { property: "og:image", content: ogImage },
              { property: "og:image:width", content: "1200" },
              { property: "og:image:height", content: "630" },
              { name: "twitter:image", content: ogImage },
            ]
          : []),
        ...(xBanner ? [{ property: "x:game:image", content: xBanner }] : []),
      ],
      links: [{ rel: "stylesheet", href: appCss }],
    };
  },
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <AuthProvider>
          <Outlet />
          <Toaster
            theme="dark"
            position="top-center"
            toastOptions={{
              classNames: {
                toast: "bg-surface border-border text-fg",
              },
            }}
          />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
