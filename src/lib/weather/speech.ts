export type SpeakOptions = {
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Prefer calling from a click handler when true */
  immediate?: boolean;
};

let currentUtterance: SpeechSynthesisUtterance | null = null;
let speakChain: Promise<void> = Promise.resolve();
let speechUnlocked = false;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let chromeResumeTimer: ReturnType<typeof setInterval> | null = null;

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function isSpeechUnlocked(): boolean {
  return speechUnlocked;
}

function isChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // Chrome, Edge Chromium, Brave, Opera — Edge TTS is usually fine; Chrome is picky
  return /\bChrome\//.test(ua) || /\bCriOS\//.test(ua);
}

function isLikelyChromeNotEdge(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // Edge also has Chrome/ in UA — exclude Edg/
  return (/\bChrome\//.test(ua) || /\bCriOS\//.test(ua)) && !/\bEdg\//.test(ua);
}

function clearKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (chromeResumeTimer) {
    clearInterval(chromeResumeTimer);
    chromeResumeTimer = null;
  }
}

/**
 * Chrome often freezes speechSynthesis after cancel() or long idle.
 * Resume + empty queue flush without cancel when possible.
 */
function resetSpeechEngineSoft() {
  if (!canSpeak()) return;
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Prime TTS from a user tap.
 * Chrome: do NOT cancel mid-kick (that bricks speech until reload).
 * Speak a real short phrase so activation sticks.
 */
export async function unlockSpeech(): Promise<boolean> {
  if (!canSpeak()) return false;
  warmVoices();
  await waitForVoices(800);

  return new Promise((resolve) => {
    try {
      resetSpeechEngineSoft();
      // Only cancel if something is actively stuck speaking
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }

      const kick = new SpeechSynthesisUtterance(
        isLikelyChromeNotEdge() ? "Alerts ready." : " ",
      );
      kick.volume = isLikelyChromeNotEdge() ? 0.35 : 0.01;
      kick.rate = 1.1;
      kick.pitch = 1;
      kick.lang = "en-US";
      const voice = pickVoice();
      if (voice) kick.voice = voice;

      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        speechUnlocked = ok;
        resolve(ok);
      };

      kick.onend = () => finish(true);
      kick.onerror = () => {
        // still mark unlocked if page has user activation — retry speak later
        speechUnlocked = true;
        finish(true);
      };

      window.speechSynthesis.speak(kick);
      // Chrome sometimes never fires end for near-silent kicks
      window.setTimeout(() => finish(true), isLikelyChromeNotEdge() ? 1600 : 400);
    } catch {
      speechUnlocked = false;
      resolve(false);
    }
  });
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
}

/**
 * Strip NWS / bulletin punctuation that TTS reads literally.
 */
export function sanitizeForSpeech(raw: string): string {
  let t = raw;

  t = t.replace(/\r\n/g, "\n");
  t = t.replace(/^\s*[\*\-•▪◦●]\s*/gm, "");
  t = t.replace(/(^|\s)\*+(?=\s|$)/g, " ");
  t = t.replace(/\*+/g, " ");

  t = t.replace(/\.{3,}/g, ". ");
  t = t.replace(/\u2026/g, ". ");
  t = t.replace(/_{2,}/g, " ");
  t = t.replace(/={2,}/g, " ");
  t = t.replace(/#{1,}/g, " ");
  t = t.replace(/~{1,}/g, " ");
  t = t.replace(/\|/g, ", ");
  t = t.replace(/[/\\]/g, " ");

  t = t.replace(/\[[^\]]*]/g, " ");
  t = t.replace(/\b(HAZARD|SOURCE|IMPACT|PRECAUTIONARY\/PREPAREDNESS ACTIONS)\s*\.+/gi, "$1: ");

  t = t.replace(/\s+/g, " ");
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([,.;:!?]){2,}/g, "$1");
  t = t.replace(/\s+'/g, "'");
  t = t.trim();

  return t;
}

/** Chrome cuts off speech ~15s — chunk into shorter utterances. */
function chunkForSpeech(text: string, maxLen = 180): string[] {
  const clean = sanitizeForSpeech(text);
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const parts: string[] = [];
  // Split on sentence boundaries first
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).trim().length <= maxLen) {
      buf = (buf + " " + s).trim();
    } else {
      if (buf) parts.push(buf);
      if (s.length <= maxLen) {
        buf = s;
      } else {
        // hard split long sentence
        for (let i = 0; i < s.length; i += maxLen) {
          parts.push(s.slice(i, i + maxLen));
        }
        buf = "";
      }
    }
  }
  if (buf) parts.push(buf);
  return parts.length ? parts : [clean];
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Prefer local/native voices on Chrome — remote Google voices can fail offline/policy
  const en = voices.filter((v) => /^en/i.test(v.lang));
  const prefer = (list: SpeechSynthesisVoice[]) =>
    list.find((v) => /Google US English/i.test(v.name)) ||
    list.find((v) => /Microsoft (Aria|Jenny|Guy|David|Zira)/i.test(v.name)) ||
    list.find((v) => /Samantha|Alex|Natural/i.test(v.name)) ||
    list.find((v) => /en-US/i.test(v.lang)) ||
    list[0];

  const local = en.filter((v) => {
    // localService is true for on-device voices when available
    const anyV = v as SpeechSynthesisVoice & { localService?: boolean };
    return anyV.localService !== false;
  });

  return prefer(local.length ? local : en) || prefer(voices) || voices[0] || null;
}

function waitForVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!canSpeak()) return Promise.resolve([]);
  const existing = window.speechSynthesis.getVoices();
  if (existing.length) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      try {
        window.speechSynthesis.removeEventListener("voiceschanged", done);
      } catch {
        window.speechSynthesis.onvoiceschanged = null;
      }
      resolve(window.speechSynthesis.getVoices());
    };
    try {
      window.speechSynthesis.addEventListener("voiceschanged", done);
    } catch {
      window.speechSynthesis.onvoiceschanged = done;
    }
    // Chrome often needs a getVoices() call to start loading
    window.speechSynthesis.getVoices();
    window.setTimeout(done, timeoutMs);
  });
}

function startChromeKeepAlive() {
  clearKeepAlive();
  if (!isChromium()) return;
  // Classic Chrome bug: utterance stops ~14–15s unless pause/resume poked
  chromeResumeTimer = setInterval(() => {
    try {
      if (!window.speechSynthesis.speaking) return;
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    } catch {
      /* ignore */
    }
  }, 10000);
}

function speakChunk(text: string, opts: SpeakOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!canSpeak()) {
      reject(new Error("Speech not supported"));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = opts.rate ?? 0.95;
    utterance.pitch = opts.pitch ?? 1;
    utterance.volume = opts.volume ?? 1;
    utterance.lang = "en-US";

    const voice = pickVoice();
    if (voice) utterance.voice = voice;

    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (currentUtterance === utterance) currentUtterance = null;
      if (err) reject(err);
      else resolve();
    };

    utterance.onstart = () => {
      speechUnlocked = true;
    };
    utterance.onend = () => finish();
    utterance.onerror = (e) => {
      const err = String(e.error ?? "");
      // Chrome fires not-allowed without sticky activation
      if (err === "interrupted" || err === "canceled") finish();
      else if (err === "not-allowed") {
        finish(new Error("Chrome blocked speech — tap Play tone & read again"));
      } else {
        finish(new Error(err || "speech error"));
      }
    };

    currentUtterance = utterance;
    resetSpeechEngineSoft();

    try {
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      finish(e instanceof Error ? e : new Error("speak failed"));
      return;
    }

    // If still not speaking, one resume nudge (do not re-queue same utterance)
    window.setTimeout(() => {
      if (settled) return;
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          window.speechSynthesis.speak(utterance);
        }
      } catch {
        /* ignore */
      }
    }, 200);

    // Fail if nothing starts
    window.setTimeout(() => {
      if (
        !settled &&
        currentUtterance === utterance &&
        !window.speechSynthesis.speaking &&
        !window.speechSynthesis.pending
      ) {
        finish(new Error("Speech did not start in Chrome — unmute the tab and tap Play again"));
      }
    }, 2500);
  });
}

async function speakOnce(text: string, opts: SpeakOptions): Promise<void> {
  const clean = sanitizeForSpeech(text);
  if (!clean) return;

  // Cancel only when starting a new intentional read (not mid-unlock)
  try {
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      // Chrome needs a beat after cancel before next speak
      await new Promise((r) => setTimeout(r, isLikelyChromeNotEdge() ? 120 : 40));
    }
  } catch {
    /* ignore */
  }

  const chunks =
    isLikelyChromeNotEdge() || clean.length > 220 ? chunkForSpeech(clean, 160) : [clean];

  startChromeKeepAlive();
  try {
    for (const chunk of chunks) {
      await speakChunk(chunk, opts);
      // tiny gap between chunks helps Chrome
      if (chunks.length > 1) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }
  } finally {
    clearKeepAlive();
  }
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (!canSpeak()) throw new Error("Speech not supported");
  await waitForVoices();

  const job = speakChain.then(() => speakOnce(text, opts)).catch((err) => {
    throw err;
  });
  speakChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

export async function speakSequence(
  scripts: string[],
  opts: SpeakOptions = {},
  onStart?: (index: number) => void,
): Promise<void> {
  for (let i = 0; i < scripts.length; i++) {
    onStart?.(i);
    await speak(scripts[i]!, opts);
  }
}

export function isSpeaking(): boolean {
  return canSpeak() && window.speechSynthesis.speaking;
}

export function warmVoices() {
  if (!canSpeak()) return;
  window.speechSynthesis.getVoices();
  try {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      window.speechSynthesis.getVoices();
    });
  } catch {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }
}
