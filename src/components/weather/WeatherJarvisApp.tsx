import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BellRing,
  ChevronDown,
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
  ALERT_KIND_META,
  alertSpeechScript,
  defaultAlertKindPrefs,
  fetchNwsAlerts,
  isKindEnabled,
  isSevere,
  isWarningEvent,
  loadAlertKindPrefs,
  saveAlertKindPrefs,
  type AlertKindPrefs,
  type LocationNwsContext,
} from "@/lib/weather/alerts";
import {
  isAudioUnlocked,
  playAckChirp,
  playAlertSound,
  unlockAudio,
  stopAlertSounds,
} from "@/lib/weather/alert-sounds";
import {
  fetchSpcOutlooks,
  riskBadgeVariant,
  riskRank,
  type SpcBundle,
  type SpcDayKey,
} from "@/lib/weather/spc";
import {
  canSpeak,
  speak,
  stopSpeaking,
  unlockSpeech,
  warmVoices,
} from "@/lib/weather/speech";
import type { AlertKind, GeoLocation, WeatherAlert } from "@/lib/weather/types";
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

function productKind(event: string): string {
  if (isWarningEvent(event)) return "WARNING";
  if (/\bwatch\b/i.test(event)) return "WATCH";
  if (/\badvisory\b/i.test(event)) return "ADVISORY";
  return "ALERT";
}

function kindLabel(kind: AlertKind): string {
  return ALERT_KIND_META.find((k) => k.id === kind)?.label ?? kind;
}

function soundLevelFor(alert: WeatherAlert): "moderate" | "severe" | "extreme" {
  if (alert.severity === "extreme") return "extreme";
  if (alert.severity === "severe" || isWarningEvent(alert.event) || isSevere(alert)) {
    return "severe";
  }
  return "moderate";
}

export function WeatherJarvisApp() {
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [nwsContext, setNwsContext] = useState<LocationNwsContext>({});
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
  const [kindPrefs, setKindPrefs] = useState<AlertKindPrefs>(() => defaultAlertKindPrefs());
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [broadcastPhase, setBroadcastPhase] = useState<"idle" | "tone" | "voice">("idle");
  const [announcing, setAnnouncing] = useState(false);
  const [activeDay, setActiveDay] = useState<SpcDayKey>("day1");
  const [activeGraphic, setActiveGraphic] = useState(0);
  const [kindsOpen, setKindsOpen] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const announcedRef = useRef<Set<string>>(new Set());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceLock = useRef(false);
  const kindPrefsRef = useRef(kindPrefs);
  const mediaReadyRef = useRef(false);

  useEffect(() => {
    warmVoices();
    const loaded = loadAlertKindPrefs();
    setKindPrefs(loaded);
    kindPrefsRef.current = loaded;
  }, []);

  useEffect(() => {
    kindPrefsRef.current = kindPrefs;
    saveAlertKindPrefs(kindPrefs);
  }, [kindPrefs]);

  /**
   * One silent arm from any click/key — no special button required.
   * Browser autoplay policy still needs one gesture per page load.
   */
  useEffect(() => {
    let armed = mediaReadyRef.current;
    const arm = () => {
      if (armed) return;
      armed = true;
      unlockSpeech();
      void unlockAudio().then((ok) => {
        mediaReadyRef.current = ok || isAudioUnlocked() || canSpeak();
        setMediaReady(mediaReadyRef.current);
      });
      // Always mark ready after gesture — sticky activation is enough for speech
      mediaReadyRef.current = true;
      setMediaReady(true);
    };
    window.addEventListener("pointerdown", arm, { capture: true });
    window.addEventListener("keydown", arm, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", arm, { capture: true } as EventListenerOptions);
      window.removeEventListener("keydown", arm, { capture: true } as EventListenerOptions);
    };
  }, []);

  const enableMedia = useCallback(async (): Promise<boolean> => {
    warmVoices();
    unlockSpeech();
    const ok = await unlockAudio();
    mediaReadyRef.current = true;
    setMediaReady(true);
    return ok || isAudioUnlocked() || canSpeak();
  }, []);

  const visibleAlerts = useMemo(
    () => alerts.filter((a) => isKindEnabled(a, kindPrefs)),
    [alerts, kindPrefs],
  );

  const loadForLocation = useCallback(
    async (loc: GeoLocation, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        setLocation(loc);

        const [outlooks, nwsResult] = await Promise.all([
          fetchSpcOutlooks(loc.lat, loc.lon),
          fetchNwsAlerts(loc),
        ]);
        setSpc(outlooks);
        setActiveDay("day1");
        setActiveGraphic(0);
        setAlerts(nwsResult.alerts);
        setNwsContext(nwsResult.context);
        return nwsResult.alerts;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load weather data";
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
    async (
      list: WeatherAlert[],
      opts?: { forceSound?: boolean; forceVoice?: boolean; fromUser?: boolean },
    ) => {
      if (announceLock.current) return;
      const prefs = kindPrefsRef.current;
      const severe = list.filter((a) => isSevere(a) && isKindEnabled(a, prefs));
      if (severe.length === 0) return;

      // Wait for first page gesture unless user pressed Play / Read
      if (!opts?.fromUser && !mediaReadyRef.current) return;

      announceLock.current = true;
      setAnnouncing(true);
      try {
        await unlockAudio();
        unlockSpeech();
        warmVoices();

        const doSound = opts?.forceSound ?? soundOn;
        const doVoice = opts?.forceVoice ?? voiceOn;

        if (doSound) {
          setBroadcastPhase("tone");
          try {
            await playAlertSound(soundLevelFor(severe[0]!));
          } catch (err) {
            console.warn("[jarvis] tone failed", err);
            // Don't hard-fail the whole broadcast — still try voice
          }
        }

        if (doVoice && canSpeak()) {
          setBroadcastPhase("voice");
          for (const alert of severe) {
            setSpeakingId(alert.id);
            try {
              await speak(alertSpeechScript(alert));
              announcedRef.current.add(alert.id);
            } catch (err) {
              console.warn("[jarvis] speech failed", err);
              // Retry once after re-arming
              try {
                await unlockAudio();
                unlockSpeech();
                await speak(alertSpeechScript(alert));
                announcedRef.current.add(alert.id);
              } catch {
                toast.error("Could not read this alert. Tap Play tone & read to retry.");
                break;
              }
            }
          }
        } else {
          for (const alert of severe) announcedRef.current.add(alert.id);
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
    // Only auto-play after media was unlocked by a tap (autoplay policy)
    if (!autoRead || announcing || !mediaReady) return;
    const prefs = kindPrefsRef.current;
    const fresh = alerts.filter(
      (a) =>
        isSevere(a) &&
        isKindEnabled(a, prefs) &&
        !announcedRef.current.has(a.id),
    );
    if (fresh.length === 0) return;
    void broadcastAlerts(fresh);
  }, [alerts, autoRead, announcing, broadcastAlerts, kindPrefs, mediaReady]);

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
  const alarmCount = visibleAlerts.filter(isSevere).length;
  const warningCount = visibleAlerts.filter((a) => isWarningEvent(a.event)).length;
  const officeCount = visibleAlerts.filter((a) => a.scope === "office").length;
  const nwsOffice = nwsContext.office || alerts.find((a) => a.office)?.office;
  const kindsOnCount = ALERT_KIND_META.filter((k) => kindPrefs[k.id]).length;

  const setKind = (id: AlertKind, on: boolean) => {
    setKindPrefs((prev) => ({ ...prev, [id]: on }));
  };

  const setAllKinds = (on: boolean) => {
    setKindPrefs(
      Object.fromEntries(ALERT_KIND_META.map((k) => [k.id, on])) as AlertKindPrefs,
    );
  };

  const onUseMyLocation = async () => {
    setLocating(true);
    announcedRef.current = new Set();
    await enableMedia();
    try {
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
    await enableMedia();
    await loadForLocation(loc);
  };

  const onPlayAlerts = async () => {
    await enableMedia();
    const prefs = kindPrefsRef.current;
    const toPlay = visibleAlerts.filter(
      (a) => isSevere(a) && isKindEnabled(a, prefs),
    );
    const list = toPlay.length > 0 ? toPlay : visibleAlerts.slice(0, 1);
    if (list.length === 0) {
      toast.message("No alerts to play right now.");
      return;
    }
    for (const a of list) announcedRef.current.delete(a.id);
    await broadcastAlerts(list, {
      forceSound: soundOn,
      forceVoice: voiceOn,
      fromUser: true,
    });
  };

  const onReadAlert = async (alert: WeatherAlert) => {
    await enableMedia();
    if (soundOn) {
      setBroadcastPhase("tone");
      try {
        await playAlertSound(soundLevelFor(alert));
      } catch {
        /* try voice anyway */
      } finally {
        setBroadcastPhase("idle");
      }
    }
    if (!voiceOn) return;
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
      toast.error("Could not speak alert — tap Read aloud once more.");
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

  const onRefresh = async () => {
    if (!location) return;
    announcedRef.current = new Set();
    await loadForLocation(location, { silent: true });
    toast.success("Alerts & SPC outlooks refreshed");
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
              Set your real location once — GPS or city search. We load alerts for your
              spot, your county, and your NWS office automatically.
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

        {/* Location first — this is how alerts are scoped */}
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
                placeholder='Your city — e.g. "Quincy, FL" or "Marianna, FL"'
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
              <span className="truncate font-medium text-fg">
                {location?.label ?? (loading ? "Locating…" : "No location yet")}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {nwsContext.countyName && (
                <Badge variant="ok">County: {nwsContext.countyName}</Badge>
              )}
              {nwsOffice && <Badge variant="primary">NWS {nwsOffice}</Badge>}
              {spc && (
                <Badge variant={riskBadgeVariant(spc.maxRisk.label)}>
                  SPC D1–3: {spc.maxRisk.label2}
                </Badge>
              )}
            </div>
            <p className="text-xs text-subtle">
              Tip: tap <strong className="text-muted">Use my location</strong> (allow GPS) or
              search <strong className="text-muted">City, ST</strong> so we don’t pick a
              same-named city in another state.
            </p>
          </CardContent>
        </Card>

        <Card
          className={cn("mb-4 min-w-0", alarmCount > 0 && "border-danger/40 alert-pulse")}
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className={cn(
                    "h-5 w-5 shrink-0",
                    alarmCount > 0 ? "text-danger" : "text-muted",
                  )}
                />
                <CardTitle>Weather alerts</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {warningCount > 0 && (
                  <Badge variant="danger">
                    {warningCount} warning{warningCount === 1 ? "" : "s"}
                  </Badge>
                )}
                {officeCount > 0 && (
                  <Badge variant="warn">{officeCount} nearby</Badge>
                )}
                <Badge variant={alarmCount > 0 ? "danger" : "default"}>
                  {visibleAlerts.length} shown
                </Badge>
              </div>
            </div>
            <CardDescription>
              For <span className="text-fg">{location?.city || "your location"}</span>
              {nwsContext.countyName ? (
                <>
                  {" "}
                  · county <span className="text-fg">{nwsContext.countyName}</span>
                </>
              ) : null}
              . “Your area” = you or your county. “Nearby” = same NWS office, other counties.
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[520px] space-y-3 overflow-y-auto">
            {visibleAlerts.length > 0 && !mediaReady && (
              <div className="rounded-[var(--radius-lg)] border border-primary/30 bg-primary/10 px-3 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-relaxed text-muted sm:text-sm">
                    Tap anywhere once to arm alert sound & voice for this visit. After that,
                    new alerts play on their own when Auto-announce is on.
                  </p>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={onPlayAlerts}
                    disabled={announcing}
                    className="shrink-0"
                  >
                    {announcing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Siren className="h-4 w-4" />
                    )}
                    Arm & play now
                  </Button>
                </div>
              </div>
            )}
            {visibleAlerts.length > 0 && mediaReady && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onPlayAlerts}
                  disabled={announcing}
                >
                  {announcing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Siren className="h-4 w-4" />
                  )}
                  Replay alerts
                </Button>
              </div>
            )}
            {visibleAlerts.length === 0 && (
              <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated/60 px-4 py-6 text-center text-sm text-muted">
                {alerts.length > 0
                  ? "Alerts are hidden by your type toggles below. Turn some kinds back on."
                  : "No active NWS alerts for this location or county. Confirm the city/state above, or try Use my location."}
              </div>
            )}
            {visibleAlerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "rounded-[var(--radius-lg)] border border-border bg-bg-elevated/70 p-3",
                  isSevere(alert) && "border-danger/35 bg-danger/5",
                  isWarningEvent(alert.event) && "border-l-4 border-l-danger",
                )}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                  <Badge
                    variant={
                      productKind(alert.event) === "WARNING"
                        ? "danger"
                        : productKind(alert.event) === "WATCH"
                          ? "warn"
                          : "default"
                    }
                  >
                    {productKind(alert.event)}
                  </Badge>
                  <Badge variant="default">{kindLabel(alert.kind)}</Badge>
                  <Badge variant={alert.scope === "local" ? "ok" : "warn"}>
                    {alert.scope === "local"
                      ? "Your area"
                      : `Nearby · NWS ${alert.office || ""}`}
                  </Badge>
                  {speakingId === alert.id && <Badge variant="primary">Speaking…</Badge>}
                </div>
                <p className="text-sm font-semibold text-fg">{alert.event}</p>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">
                  {alert.headline}
                </p>
                {alert.area && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-subtle">{alert.area}</p>
                )}
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

        <Card className="mb-4 min-w-0">
          <button
            type="button"
            className="flex w-full items-start justify-between gap-3 p-4 text-left sm:p-5 sm:pb-4"
            onClick={() => setKindsOpen((o) => !o)}
            aria-expanded={kindsOpen}
            aria-controls="alert-types-panel"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">Alert types</CardTitle>
                <Badge variant="default">
                  {kindsOnCount}/{ALERT_KIND_META.length} on
                </Badge>
              </div>
              <CardDescription className="mt-1">
                {kindsOpen
                  ? "Choose what to show and what can sound / auto-announce"
                  : "Tap to expand filters for tornado, storm, flood, heat, fire…"}
              </CardDescription>
            </div>
            <ChevronDown
              className={cn(
                "mt-0.5 h-5 w-5 shrink-0 text-muted transition-transform duration-200",
                kindsOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          {kindsOpen && (
            <CardContent id="alert-types-panel" className="space-y-3 pt-0">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAllKinds(true);
                  }}
                >
                  All on
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAllKinds(false);
                  }}
                >
                  All off
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ALERT_KIND_META.map((k) => (
                  <label
                    key={k.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2.5",
                      kindPrefs[k.id]
                        ? "border-primary/30 bg-primary/5"
                        : "border-border bg-bg-elevated/40 opacity-70",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{k.label}</p>
                      <p className="text-[11px] text-muted">{k.blurb}</p>
                    </div>
                    <Switch
                      checked={kindPrefs[k.id]}
                      onCheckedChange={(v) => setKind(k.id, v)}
                      aria-label={`Toggle ${k.label} alerts`}
                    />
                  </label>
                ))}
              </div>
            </CardContent>
          )}
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
              desc="Enabled types only"
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

            {(speakingId || broadcastPhase !== "idle") && (
              <div className="flex flex-wrap gap-2 sm:col-span-3">
                <Button variant="outline" size="sm" onClick={onStopVoice}>
                  Stop broadcast
                </Button>
              </div>
            )}
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
