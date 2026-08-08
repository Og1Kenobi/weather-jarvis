/**
 * EAS-style weather alert tones (853 Hz + 960 Hz) via Web Audio.
 */

let sharedCtx: AudioContext | null = null;
let activeNodes: AudioNode[] = [];
let unlocked = false;

function getCtx(): AudioContext {
  if (!sharedCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("Web Audio not supported");
    sharedCtx = new AC();
  }
  return sharedCtx;
}

export function isAudioUnlocked(): boolean {
  return unlocked && !!sharedCtx && sharedCtx.state === "running";
}

/** Silent/near-silent unlock from any click. Safe to call often. */
export async function unlockAudio(): Promise<boolean> {
  try {
    const ctx = getCtx();
    if (ctx.state !== "running") {
      await ctx.resume();
    }
    // Tiny click so Chrome counts a real output
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 440;
    g.gain.value = 0.001;
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.03);
    unlocked = ctx.state === "running";
    return unlocked;
  } catch {
    unlocked = false;
    return false;
  }
}

export async function resumeAudio(): Promise<AudioContext> {
  const ctx = getCtx();
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      /* ignore */
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
      /* ignore */
    }
  }
  activeNodes = [];
}

function track<T extends AudioNode>(node: T): T {
  activeNodes.push(node);
  return node;
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function playEasAttention(ctx: AudioContext, start: number, durationSec: number, gain = 0.2) {
  const master = track(ctx.createGain());
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(gain, start + 0.03);
  master.gain.setValueAtTime(gain, start + Math.max(0.08, durationSec - 0.06));
  master.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
  master.connect(ctx.destination);

  for (const freq of [853, 960]) {
    const osc = track(ctx.createOscillator());
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    osc.connect(master);
    osc.start(start);
    osc.stop(start + durationSec + 0.02);
  }
}

function playSamePreamble(ctx: AudioContext, start: number): number {
  let t = start;
  for (let packet = 0; packet < 2; packet++) {
    const freqs = [1562.5, 2083.3, 1562.5, 2083.3];
    freqs.forEach((freq, i) => {
      const osc = track(ctx.createOscillator());
      const g = track(ctx.createGain());
      const s = t + i * 0.03;
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, s);
      g.gain.setValueAtTime(0.1, s);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.028);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(s);
      osc.stop(s + 0.032);
    });
    t += 0.28;
  }
  return t + 0.08;
}

function playNwrBeeps(ctx: AudioContext, start: number, count = 2): number {
  let t = start;
  for (let i = 0; i < count; i++) {
    const osc = track(ctx.createOscillator());
    const g = track(ctx.createGain());
    osc.type = "sine";
    osc.frequency.setValueAtTime(1000, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
    t += 0.36;
  }
  return t;
}

export type AlertSoundLevel = "minor" | "moderate" | "severe" | "extreme";

export async function playAlertSound(level: AlertSoundLevel = "severe"): Promise<void> {
  stopAlertSounds();
  await unlockAudio();
  const ctx = getCtx();
  if (ctx.state !== "running") {
    await ctx.resume();
  }
  if (ctx.state !== "running") {
    throw new Error("Audio not running");
  }

  const t0 = ctx.currentTime + 0.02;
  let end = t0;

  // Keep tones reasonably short so voice starts sooner (more reliable in Chrome)
  if (level === "minor" || level === "moderate") {
    playEasAttention(ctx, t0, 1.2, 0.14);
    end = t0 + 1.3;
  } else if (level === "severe") {
    const after = playSamePreamble(ctx, t0);
    playEasAttention(ctx, after, 3.5, 0.2);
    end = playNwrBeeps(ctx, after + 3.6, 2);
  } else {
    const after = playSamePreamble(ctx, t0);
    playEasAttention(ctx, after, 5.0, 0.22);
    end = playNwrBeeps(ctx, after + 5.15, 3);
  }

  await wait(Math.max(0, (end - ctx.currentTime) * 1000 + 60));
  stopAlertSounds();
  // Let Chrome speech engine settle after Web Audio
  await wait(80);
}

export async function playAckChirp(): Promise<void> {
  try {
    await unlockAudio();
    const ctx = getCtx();
    if (ctx.state !== "running") return;
    const t0 = ctx.currentTime + 0.01;
    const osc = track(ctx.createOscillator());
    const g = track(ctx.createGain());
    osc.frequency.setValueAtTime(660, t0);
    g.gain.setValueAtTime(0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.13);
    await wait(140);
  } catch {
    /* ignore */
  }
}
