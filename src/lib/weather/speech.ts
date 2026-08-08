export type SpeakOptions = {
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Skip cancel delay when already inside a user gesture */
  immediate?: boolean;
};

let currentUtterance: SpeechSynthesisUtterance | null = null;
let speakChain: Promise<void> = Promise.resolve();
let speechUnlocked = false;

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function isSpeechUnlocked(): boolean {
  return speechUnlocked;
}

/**
 * Prime TTS from a user tap. Browsers often block speech until a gesture.
 */
export function unlockSpeech(): boolean {
  if (!canSpeak()) return false;
  warmVoices();
  try {
    // Silent kick — marks speech as user-activated in Chrome/Safari
    window.speechSynthesis.cancel();
    const kick = new SpeechSynthesisUtterance(" ");
    kick.volume = 0.01;
    kick.rate = 2;
    kick.lang = "en-US";
    window.speechSynthesis.speak(kick);
    window.speechSynthesis.cancel();
    speechUnlocked = true;
    return true;
  } catch {
    speechUnlocked = false;
    return false;
  }
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  currentUtterance = null;
}

/**
 * Strip NWS / bulletin punctuation that TTS reads literally
 * (asterisk, ellipsis dots, ALL-CAPS section tags, etc.).
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

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => /en(-|_)?US/i.test(v.lang) && /Google|Samantha|Alex|Natural|Microsoft/i.test(v.name)) ||
    voices.find((v) => /en(-|_)?US/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    voices[0] ||
    null
  );
}

function waitForVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!canSpeak()) return Promise.resolve([]);
  const existing = window.speechSynthesis.getVoices();
  if (existing.length) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.onvoiceschanged = done;
    window.setTimeout(done, timeoutMs);
  });
}

function speakOnce(text: string, opts: SpeakOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!canSpeak()) {
      reject(new Error("Speech not supported"));
      return;
    }

    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }

    const run = () => {
      const clean = sanitizeForSpeech(text);
      if (!clean) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = opts.rate ?? 0.92;
      utterance.pitch = opts.pitch ?? 0.95;
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

      utterance.onend = () => finish();
      utterance.onerror = (e) => {
        const err = String(e.error ?? "");
        if (err === "interrupted" || err === "canceled") finish();
        else finish(new Error(err || "speech error"));
      };

      currentUtterance = utterance;
      speechUnlocked = true;

      try {
        window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
      window.speechSynthesis.speak(utterance);

      // Chrome can stall; nudge if never starts
      window.setTimeout(() => {
        if (!settled && currentUtterance === utterance && !window.speechSynthesis.speaking) {
          try {
            window.speechSynthesis.resume();
            window.speechSynthesis.speak(utterance);
          } catch {
            /* ignore */
          }
        }
      }, 300);

      // Watchdog: if still silent after 2s, surface error
      window.setTimeout(() => {
        if (!settled && currentUtterance === utterance && !window.speechSynthesis.speaking) {
          finish(new Error("Speech did not start — unmute the tab and tap Play again"));
        }
      }, 2000);
    };

    // Immediate path keeps user-gesture activation on mobile
    if (opts.immediate) {
      run();
    } else {
      window.setTimeout(run, 40);
    }
  });
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
  const prev = window.speechSynthesis.onvoiceschanged;
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
    if (typeof prev === "function") prev.call(window.speechSynthesis, new Event("voiceschanged"));
  };
}
