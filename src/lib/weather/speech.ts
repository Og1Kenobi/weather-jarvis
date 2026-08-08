export type SpeakOptions = {
  rate?: number;
  pitch?: number;
  volume?: number;
};

let currentUtterance: SpeechSynthesisUtterance | null = null;
let speakChain: Promise<void> = Promise.resolve();
let keepAlive: ReturnType<typeof setInterval> | null = null;

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function isChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /\bChrome\//.test(ua) && !/\bEdg\//.test(ua);
}

function clearKeepAlive() {
  if (keepAlive) {
    clearInterval(keepAlive);
    keepAlive = null;
  }
}

export function warmVoices() {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.getVoices();
  } catch {
    /* ignore */
  }
}

/** Call once from any user gesture — does not speak out loud. */
export function unlockSpeech(): void {
  if (!canSpeak()) return;
  warmVoices();
  try {
    // Touch the API so Chrome attaches user-activation to this frame
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  } catch {
    /* ignore */
  }
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  clearKeepAlive();
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  currentUtterance = null;
  // Reset chain so a failed run cannot block forever
  speakChain = Promise.resolve();
}

export function sanitizeForSpeech(raw: string): string {
  let t = raw;
  t = t.replace(/\r\n/g, "\n");
  t = t.replace(/^\s*[\*\-•▪◦●]\s*/gm, "");
  t = t.replace(/\*+/g, " ");
  t = t.replace(/\.{3,}/g, ". ");
  t = t.replace(/\u2026/g, ". ");
  t = t.replace(/\b(HAZARD|SOURCE|IMPACT)\s*\.+/gi, "$1: ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en(-|_)/i.test(v.lang) || /^en$/i.test(v.lang));
  const pool = en.length ? en : voices;
  return (
    pool.find((v) => /Google US English/i.test(v.name)) ||
    pool.find((v) => /en-US/i.test(v.lang)) ||
    pool.find((v) => /Microsoft/i.test(v.name) && /English/i.test(v.name)) ||
    pool[0] ||
    null
  );
}

function waitForVoices(ms = 1200): Promise<void> {
  if (!canSpeak()) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.onvoiceschanged = null;
      resolve();
    };
    window.speechSynthesis.onvoiceschanged = done;
    window.speechSynthesis.getVoices();
    window.setTimeout(done, ms);
  });
}

/** Chrome drops long utterances — split into short pieces. */
function chunkText(text: string, max = 140): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  const parts = text.split(/(?<=[.!?])\s+/);
  let buf = "";
  for (const p of parts) {
    if ((buf + " " + p).trim().length <= max) {
      buf = (buf + " " + p).trim();
    } else {
      if (buf) out.push(buf);
      if (p.length <= max) buf = p;
      else {
        for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
        buf = "";
      }
    }
  }
  if (buf) out.push(buf);
  return out;
}

function speakChunk(text: string, opts: SpeakOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? 0.95;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;
    u.lang = "en-US";
    const voice = pickVoice();
    if (voice) u.voice = voice;

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (currentUtterance === u) currentUtterance = null;
      if (err) reject(err);
      else resolve();
    };

    u.onend = () => finish();
    u.onerror = (e) => {
      const code = String(e.error || "");
      if (code === "interrupted" || code === "canceled") finish();
      else finish(new Error(code || "speech error"));
    };

    currentUtterance = u;
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      window.speechSynthesis.speak(u);
    } catch (err) {
      finish(err instanceof Error ? err : new Error("speak failed"));
    }

    // Chrome stall nudge
    window.setTimeout(() => {
      if (settled) return;
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
    }, 250);
  });
}

async function speakOnce(text: string, opts: SpeakOptions): Promise<void> {
  const clean = sanitizeForSpeech(text);
  if (!clean) return;

  await waitForVoices();

  // Clear only if something is already going
  try {
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      await new Promise((r) => setTimeout(r, isChrome() ? 150 : 50));
    }
  } catch {
    /* ignore */
  }

  const chunks = isChrome() || clean.length > 200 ? chunkText(clean) : [clean];

  clearKeepAlive();
  if (isChrome()) {
    // Prevent Chrome 15s cutoff
    keepAlive = setInterval(() => {
      try {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      } catch {
        /* ignore */
      }
    }, 9000);
  }

  try {
    for (let i = 0; i < chunks.length; i++) {
      await speakChunk(chunks[i]!, opts);
      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 60));
      }
    }
  } finally {
    clearKeepAlive();
  }
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (!canSpeak()) throw new Error("Speech not supported");

  const job = speakChain
    .catch(() => undefined)
    .then(() => speakOnce(text, opts));

  speakChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

export function isSpeaking(): boolean {
  return canSpeak() && window.speechSynthesis.speaking;
}

export function isSpeechUnlocked(): boolean {
  return canSpeak();
}
