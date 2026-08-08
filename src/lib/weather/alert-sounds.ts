/**
 * NOAA / EAS-style weather alert tones via Web Audio API.
 * Classic attention signal: simultaneous 853 Hz + 960 Hz.
 *
 * Browsers keep AudioContext suspended until a user gesture — call
 * unlockAudio() / resumeAudio() from a click before expecting sound.
 */

let sharedCtx: AudioContext | null = null;
let activeNodes: AudioNode[] = [];
let unlocked = false;

function getCtx(): AudioContext {
  if (!sharedCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("Web Audio is not supported in this browser");
    sharedCtx = new AC();
  }
  return sharedCtx;
}

export function isAudioUnlocked(): boolean {
  return unlocked && !!sharedCtx && sharedCtx.state === "running";
}

/** Call from a click/tap. Returns true if audio can play. */
export async function unlockAudio(): Promise<boolean> {
  try {
    const ctx = getCtx();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    // Silent buffer kick — some mobile browsers need a real play() in the gesture
    const buffer = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0);
    unlocked = ctx.state === "running";
    return unlocked;
  } catch {
    unlocked = false;
    return false;
  }
}

export async function resumeAudio(): Promise<AudioContext> {
  const ctx = getCtx();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* still suspended without gesture */
    }
  }
  if (ctx.state === "running") unlocked = true;
  return ctx;
}

export function stopAlertSounds() {
  for (const node of activeNodes) {
    try {
      if ("stop" in node && typeof (node as OscillatorNode).stop === "function") {
        (node as OscillatorNode).stop();
      }
      node.disconnect();
    } catch {
      /* already stopped */
    }
  }
  activeNodes = [];
}

function track<T extends AudioNode>(node: T): T {
  activeNodes.push(node);
  return node;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Dual-tone EAS attention signal (853 Hz + 960 Hz). */
function playEasAttention(
  ctx: AudioContext,
  start: number,
  durationSec: number,
  gain = 0.16,
) {
  const master = track(ctx.createGain());
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(gain, start + 0.04);
  master.gain.setValueAtTime(gain, start + durationSec - 0.08);
  master.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
  master.connect(ctx.destination);

  for (const freq of [853, 960]) {
    const osc = track(ctx.createOscillator());
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    osc.detune.setValueAtTime(freq === 853 ? -2 : 2, start);
    osc.connect(master);
    osc.start(start);
    osc.stop(start + durationSec + 0.02);
  }
}

/** Short SAME-style digital header chirps before the attention signal. */
function playSamePreamble(ctx: AudioContext, start: number): number {
  let t = start;
  for (let packet = 0; packet < 3; packet++) {
    const packetGain = track(ctx.createGain());
    packetGain.gain.setValueAtTime(0.0001, t);
    packetGain.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
    packetGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    packetGain.connect(ctx.destination);

    const freqs = [1562.5, 2083.3, 1562.5, 2083.3, 1562.5, 2083.3];
    freqs.forEach((freq, i) => {
      const osc = track(ctx.createOscillator());
      const g = track(ctx.createGain());
      const s = t + i * 0.028;
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, s);
      g.gain.setValueAtTime(0.08, s);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.026);
      osc.connect(g);
      g.connect(packetGain);
      osc.start(s);
      osc.stop(s + 0.03);
    });
    t += 0.22;
    t += packet < 2 ? 0.35 : 0.15;
  }
  return t;
}

/** Brief NWR-style alarm beeps after attention (severe). */
function playNwrBeeps(ctx: AudioContext, start: number, count = 3): number {
  let t = start;
  for (let i = 0; i < count; i++) {
    const osc = track(ctx.createOscillator());
    const g = track(ctx.createGain());
    osc.type = "sine";
    osc.frequency.setValueAtTime(1000, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
    t += 0.42;
  }
  return t;
}

export type AlertSoundLevel = "minor" | "moderate" | "severe" | "extreme";

/**
 * Plays a weather-radio style alert and resolves when finished
 * so speech can start immediately after.
 */
export async function playAlertSound(level: AlertSoundLevel = "severe"): Promise<void> {
  stopAlertSounds();
  const ok = await unlockAudio();
  const ctx = getCtx();
  if (!ok && ctx.state !== "running") {
    throw new Error("Audio blocked — tap the page once to enable sound");
  }

  const t0 = ctx.currentTime + 0.03;
  let end = t0;

  if (level === "minor" || level === "moderate") {
    playEasAttention(ctx, t0, 1.4, 0.1);
    end = t0 + 1.5;
  } else if (level === "severe") {
    const afterPreamble = playSamePreamble(ctx, t0);
    playEasAttention(ctx, afterPreamble, 6.0, 0.17);
    end = playNwrBeeps(ctx, afterPreamble + 6.15, 3);
  } else {
    const afterPreamble = playSamePreamble(ctx, t0);
    playEasAttention(ctx, afterPreamble, 8.0, 0.19);
    end = playNwrBeeps(ctx, afterPreamble + 8.2, 5);
  }

  const ms = Math.max(0, (end - ctx.currentTime) * 1000 + 80);
  await wait(ms);
}

export async function playAckChirp(): Promise<void> {
  const ok = await unlockAudio();
  const ctx = getCtx();
  if (!ok && ctx.state !== "running") return;

  const t0 = ctx.currentTime + 0.01;
  const osc1 = track(ctx.createOscillator());
  const osc2 = track(ctx.createOscillator());
  const g = track(ctx.createGain());
  osc1.type = "sine";
  osc2.type = "sine";
  osc1.frequency.setValueAtTime(520, t0);
  osc2.frequency.setValueAtTime(780, t0 + 0.07);
  g.gain.setValueAtTime(0.08, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  osc1.connect(g);
  osc2.connect(g);
  g.connect(ctx.destination);
  osc1.start(t0);
  osc1.stop(t0 + 0.1);
  osc2.start(t0 + 0.07);
  osc2.stop(t0 + 0.2);
  await wait(220);
}
