import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BellRing,
  Crosshair,
  ExternalLink,
  Loader2,
  MapPin,
  Mic,
  MicOff,
  Navigation,
  RefreshCw,
  Search,
  Siren,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_LOCATION, locateUser, searchPlaces } from "@/lib/weather/api";
import {
  alertSpeechScript,
  demoSevereAlerts,
  fetchNwsAlerts,
  isSevere,
  mergeAlerts,
} from "@/lib/weather/alerts";
import {
  playAckChirp,
  playAlertSound,
  resumeAudio,
  stopAlertSounds,
} from "@/lib/weather/alert-sounds";
import {
  fetchSpcOutlooks,
  riskBadgeVariant,
  riskRank,
  type SpcBundle,
  type SpcDayKey,
} from "@/lib/weather/spc";
import { canSpeak, speak, stopSpeaking, warmVoices } from "@/lib/weather/speech";
import type { GeoLocation, WeatherAlert } from "@/lib/weather/types";
import { cn } from "@/lib/utils";

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function severityVariant(sev: WeatherAlert["severity"]) {
  if (sev === "extreme") return "extreme" as const;
  if (sev === "severe") return "danger" as const;
  if (sev === "moderate") return "warn" as const;
  return "default" as const;
}

function unlockSpeech(): void {
  if (!canSpeak()) return;
  warmVoices();
  try {
    const kick = new SpeechSynthesisUtterance(".");
    kick.volume = 0;
    kick.rate = 2;
    window.speechSynthesis.speak(kick);
  } catch {
    /* ignore */
  }
}

export function WeatherJarvisApp() {
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [spc, setSpc] = useState<SpcBundle | null>(null);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeoLocation[]>([]);
  const [voiceOn, setVoiceOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [autoRead, setAutoRead] = useState(true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [broadcastPhase, setBroadcastPhase] = useState<"idle" | "tone" | "voice">("idle");
  const [demoMode, setDemoMode] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [activeDay, setActiveDay] = useState<SpcDayKey>("day1");
  const [activeGraphic, setActiveGraphic] = useState(0);
  const announcedRef = useRef<Set<string>>(new Set());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceLock = useRef(false);

  useEffect(() => {
    warmVoices();
  }, []);

  const loadForLocation = useCallback(
    async (loc: GeoLocation, opts?: { demo?: boolean; silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        setLocation(loc);

        const [outlooks, nws] = await Promise.all([
          fetchSpcOutlooks(loc.lat, loc.lon),
          fetchNwsAlerts(loc),
        ]);
        setSpc(outlooks);
        setActiveDay("day1");
        setActiveGraphic(0);

        let next = nws;
        if (opts?.demo) {
          next = mergeAlerts(demoSevereAlerts(loc), next);
          setDemoMode(true);
        } else {
          setDemoMode(false);
        }
        setAlerts(next);
        return next;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load SPC data";
        setError(msg);
        toast.error(msg);
        return [] as WeatherAlert[];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const broadcastAlerts = useCallback(
    async (list: WeatherAlert[], opts?: { forceSound?: boolean; forceVoice?: boolean }) => {
      if (announceLock.current) return;
      const severe = list.filter(isSevere);
      if (severe.length === 0) return;

      announceLock.current = true;
      setAnnouncing(true);
      try {
        await resumeAudio();
        warmVoices();

        const doSound = opts?.forceSound ?? soundOn;
        const doVoice = opts?.forceVoice ?? voiceOn;

        if (doSound) {
          setBroadcastPhase("tone");
          const top = severe[0]!;
          await playAlertSound(top.severity === "extreme" ? "extreme" : "severe");
        }

        if (doVoice && canSpeak()) {
          setBroadcastPhase("voice");
          for (const alert of severe) {
            announcedRef.current.add(alert.id);
            setSpeakingId(alert.id);
            try {
              await speak(alertSpeechScript(alert));
            } catch (err) {
              console.warn("[jarvis] speech failed", err);
              toast.error("Could not read alert aloud. Unmute the tab and try Read aloud.");
              break;
            }
          }
        } else {
          for (const alert of severe) announcedRef.current.add(alert.id);
          if (doVoice && !canSpeak()) {
            toast.error("Text-to-speech is not available in this browser.");
          }
        }
      } finally {
        setSpeakingId(null);
        setBroadcastPhase("idle");
        setAnnouncing(false);
        announceLock.current = false;
      }
    },
    [soundOn, voiceOn],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLocating(true);
      try {
        const loc = await locateUser();
        if (!cancelled) await loadForLocation(loc);
      } catch {
        if (!cancelled) {
          toast.message("Location unavailable — showing New York", {
            description: "Allow location access or search for a city.",
          });
          await loadForLocation(DEFAULT_LOCATION);
        }
      } finally {
        if (!cancelled) setLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadForLocation]);

  useEffect(() => {
    if (!autoRead || announcing) return;
    const fresh = alerts.filter(
      (a) => isSevere(a) && a.source !== "demo" && !announcedRef.current.has(a.id),
    );
    if (fresh.length === 0) return;
    void broadcastAlerts(fresh);
  }, [alerts, autoRead, announcing, broadcastAlerts]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSuggestions(await searchPlaces(query));
    }, 280);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const dayProduct = spc?.days.find((d) => d.key === activeDay) ?? spc?.days[0];
  const graphics = dayProduct?.graphics ?? [];
  const graphic = graphics[Math.min(activeGraphic, Math.max(0, graphics.length - 1))];

  const onUseMyLocation = async () => {
    setLocating(true);
    announcedRef.current = new Set();
    unlockSpeech();
    try {
      await resumeAudio();
      const loc = await locateUser();
      await loadForLocation(loc);
      await playAckChirp();
      toast.success(`Located: ${loc.label}`);
    } catch {
      toast.error("Could not access your location. Search for a city instead.");
    } finally {
      setLocating(false);
    }
  };

  const onPickPlace = async (loc: GeoLocation) => {
    setQuery("");
    setSuggestions([]);
    announcedRef.current = new Set();
    await loadForLocation(loc);
  };

  const onReadAlert = async (alert: WeatherAlert) => {
    unlockSpeech();
    await resumeAudio();
    if (soundOn && isSevere(alert)) {
      setBroadcastPhase("tone");
      try {
        await playAlertSound(alert.severity === "extreme" ? "extreme" : "severe");
      } finally {
        setBroadcastPhase("idle");
      }
    }
    if (!canSpeak()) {
      toast.error("Text-to-speech is not available in this browser.");
      return;
    }
    try {
      setSpeakingId(alert.id);
      setBroadcastPhase("voice");
      announcedRef.current.add(alert.id);
      await speak(alertSpeechScript(alert));
    } catch {
      toast.error("Could not speak alert. Unmute the tab and try again.");
    } finally {
      setSpeakingId(null);
      setBroadcastPhase("idle");
    }
  };

  const onStopVoice = () => {
    stopSpeaking();
    stopAlertSounds();
    setSpeakingId(null);
    setBroadcastPhase("idle");
    setAnnouncing(false);
    announceLock.current = false;
  };

  const onDemoSevere = async () => {
    if (!location || announcing) return;
    unlockSpeech();
    await resumeAudio();
    warmVoices();
    announcedRef.current = new Set();
    toast.message("Emergency demo starting", {
      description: "EAS attention signal, then Jarvis reads the warnings.",
    });
    const next = await loadForLocation(location, { demo: true });
    const demoOnly = next.filter((a) => a.source === "demo" && isSevere(a));
    await broadcastAlerts(demoOnly, { forceSound: soundOn, forceVoice: voiceOn });
  };

  const onClearDemo = async () => {
    if (!location) return;
    onStopVoice();
    announcedRef.current = new Set();
    await loadForLocation(location, { demo: false });
  };

  const onRefresh = async () => {
    if (!location) return;
    announcedRef.current = new Set(
      [...announcedRef.current].filter((id) => !id.startsWith("demo-")),
    );
    await loadForLocation(location, { demo: demoMode, silent: true });
    toast.success("SPC outlooks refreshed");
  };

  return (
    <div className="sky-wash min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 right-[-20%] h-[320px] w-[320px] rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute bottom-[-15%] left-[-20%] h-[280px] w-[280px] rounded-full bg-storm/20 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-5xl min-w-0 px-4 pb-16 pt-6 sm:px-6">
        <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-primary">
              <Navigation className="h-5 w-5" strokeWidth={1.75} />
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                SPC severe weather
              </span>
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              Weather Jarvis
            </h1>
            <p className="max-w-xl text-sm text-muted">
              Locates you, shows Storm Prediction Center Day 1–3 outlook graphics,
              and sounds + reads severe weather alerts.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onUseMyLocation}
              disabled={locating || loading}
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crosshair className="h-4 w-4" />
              )}
              Use my location
            </Button>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={!location || loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </header>

        {/* Severe alerts first — highest priority */}
        <Card
          className={cn(
            "mb-4 min-w-0",
            alerts.some(isSevere) && "border-danger/40 alert-pulse",
          )}
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className={cn(
                    "h-5 w-5 shrink-0",
                    alerts.some(isSevere) ? "text-danger" : "text-muted",
                  )}
                />
                <CardTitle>Severe weather alerts</CardTitle>
              </div>
              <Badge variant={alerts.some(isSevere) ? "danger" : "default"}>
                {alerts.length} active
              </Badge>
            </div>
            <CardDescription>
              Live NWS warnings for your point. Severe alerts trigger alarm + voice when
              enabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[420px] space-y-3 overflow-y-auto">
            {alerts.length === 0 && (
              <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated/60 px-4 py-6 text-center text-sm text-muted">
                No active NWS alerts at this location. Use Demo severe to test alarm + voice.
              </div>
            )}
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "rounded-[var(--radius-lg)] border border-border bg-bg-elevated/70 p-3",
                  isSevere(alert) && "border-danger/35 bg-danger/5",
                )}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                  <Badge variant="default">{alert.source.toUpperCase()}</Badge>
                  {speakingId === alert.id && <Badge variant="primary">Speaking…</Badge>}
                </div>
                <p className="text-sm font-semibold text-fg">{alert.event}</p>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">
                  {alert.headline}
                </p>
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onReadAlert(alert)}
                    disabled={announcing}
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    Read aloud
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="mb-4 min-w-0 overflow-visible">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted">
              Your location
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search city if location is blocked…"
                className="pl-10"
                aria-label="Search location"
              />
              {suggestions.length > 0 && (
                <ul className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-1 shadow-xl">
                  {suggestions.map((s) => (
                    <li key={`${s.lat}-${s.lon}-${s.label}`}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2.5 text-left text-sm hover:bg-surface-2"
                        onClick={() => onPickPlace(s)}
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 break-words">{s.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">
                {location?.label ?? (loading ? "Locating…" : "No location yet")}
              </span>
              {spc && (
                <Badge variant={riskBadgeVariant(spc.maxRisk.label)}>
                  Your area (D1–3 max): {spc.maxRisk.label2}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 min-w-0">
          <CardContent className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
            <ToggleRow
              icon={
                voiceOn ? (
                  <Mic className="h-4 w-4 text-primary" />
                ) : (
                  <MicOff className="h-4 w-4 text-muted" />
                )
              }
              title="Read alerts aloud"
              desc="Voice after EAS tone"
              checked={voiceOn}
              onCheckedChange={setVoiceOn}
              ariaLabel="Toggle voice"
            />
            <ToggleRow
              icon={<BellRing className="h-4 w-4 text-warn" />}
              title="Alert sounds"
              desc="Weather-alert EAS tone"
              checked={soundOn}
              onCheckedChange={setSoundOn}
              ariaLabel="Toggle sounds"
            />
            <ToggleRow
              icon={<Volume2 className="h-4 w-4 text-muted" />}
              title="Auto-announce"
              desc="On new severe alerts"
              checked={autoRead}
              onCheckedChange={setAutoRead}
              ariaLabel="Toggle auto announce"
            />

            {broadcastPhase !== "idle" && (
              <div className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger sm:col-span-3">
                {broadcastPhase === "tone"
                  ? "Broadcasting EAS attention signal…"
                  : "Jarvis is reading the weather bulletin…"}
              </div>
            )}

            <div className="flex flex-wrap gap-2 sm:col-span-3">
              <Button
                variant="warn"
                size="sm"
                onClick={onDemoSevere}
                disabled={!location || announcing}
              >
                {announcing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Siren className="h-4 w-4" />
                )}
                Demo severe
              </Button>
              {demoMode && (
                <Button variant="ghost" size="sm" onClick={onClearDemo}>
                  Clear demo
                </Button>
              )}
              {(speakingId || broadcastPhase !== "idle") && (
                <Button variant="outline" size="sm" onClick={onStopVoice}>
                  Stop broadcast
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-6 rounded-[var(--radius-lg)] border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <Card className="mb-6 min-w-0 overflow-hidden">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>SPC convective outlooks</CardTitle>
                <CardDescription>
                  Official Storm Prediction Center graphics — Day 1, 2, 3, and 4–8
                </CardDescription>
              </div>
              {spc && (
                <p className="text-xs text-subtle">Loaded {formatClock(spc.fetchedAt)}</p>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && !spc ? (
              <div className="flex h-48 items-center justify-center gap-2 text-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading SPC outlooks…
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {(spc?.days ?? []).map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => {
                        setActiveDay(d.key);
                        setActiveGraphic(0);
                      }}
                      className={cn(
                        "rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors",
                        activeDay === d.key
                          ? "border-primary/40 bg-primary/10 text-fg"
                          : "border-border bg-bg-elevated/50 text-muted hover:border-border-strong hover:text-fg",
                      )}
                    >
                      <span className="block text-sm font-semibold">{d.shortTitle}</span>
                      {d.key !== "day48" ? (
                        <span className="mt-0.5 block text-[11px]">
                          <Badge variant={riskBadgeVariant(d.risk.label)} className="mt-1">
                            {d.risk.label === "NONE" ? "No risk" : d.risk.label}
                          </Badge>
                        </span>
                      ) : (
                        <span className="mt-1 block text-[11px] text-subtle">Extended</span>
                      )}
                    </button>
                  ))}
                </div>

                {dayProduct && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-fg">{dayProduct.title}</h3>
                      {dayProduct.key !== "day48" && (
                        <Badge variant={riskBadgeVariant(dayProduct.risk.label)}>
                          At your location: {dayProduct.risk.label2}
                        </Badge>
                      )}
                      {dayProduct.risk.forecaster && (
                        <span className="text-xs text-subtle">
                          SPC · {dayProduct.risk.forecaster}
                        </span>
                      )}
                    </div>

                    {dayProduct.summary && dayProduct.key === "day1" && (
                      <p className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated/50 px-3 py-2.5 text-sm leading-relaxed text-muted">
                        <span className="font-medium text-fg">Day 1 summary: </span>
                        {dayProduct.summary}
                      </p>
                    )}

                    {graphics.length > 1 && (
                      <div className="flex flex-wrap gap-2">
                        {graphics.map((g, i) => (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => setActiveGraphic(i)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                              activeGraphic === i
                                ? "border-primary/40 bg-primary/15 text-primary"
                                : "border-border text-muted hover:text-fg",
                            )}
                          >
                            {g.title}
                          </button>
                        ))}
                      </div>
                    )}

                    {graphic && (
                      <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-elevated">
                        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                          <span className="text-xs font-medium text-muted">
                            {graphic.title} · NOAA / NWS Storm Prediction Center
                          </span>
                          <a
                            href={dayProduct.discussionUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            Full discussion
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="bg-[#0a0c10] p-2 sm:p-3">
                          <img
                            src={graphic.url}
                            alt={`${dayProduct.title} — ${graphic.title}`}
                            className="mx-auto h-auto max-h-[min(70vh,720px)] w-full object-contain"
                            loading="eager"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </div>
                    )}

                    {dayProduct.key !== "day48" && riskRank(dayProduct.risk.label) >= 3 && (
                      <div className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-warn/30 bg-warn/10 px-3 py-2.5 text-sm text-warn">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          SPC has outlined a <strong>{dayProduct.risk.label2}</strong> for
                          your coordinates on {dayProduct.shortTitle}. Monitor watches and
                          local NWS warnings.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <footer className="mt-8 flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>
            Graphics & outlooks © NOAA / NWS Storm Prediction Center · alerts via
            api.weather.gov
          </p>
          <p>Unmute the tab for alarm tones and spoken alerts</p>
        </footer>
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted">{desc}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel} />
    </div>
  );
}
