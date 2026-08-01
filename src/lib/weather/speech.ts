export type SpeakOptions = {
  rate?: number;
  pitch?: number;
  volume?: number;
};

let currentUtterance: SpeechSynthesisUtterance | null = null;
let speakChain: Promise<void> = Promise.resolve();

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
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

    // Chrome sometimes ignores speak() if a prior cancel is mid-flight
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }

    const run = () => {
      const utterance = new SpeechSynthesisUtterance(text);
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
        // "interrupted" / "canceled" when we intentionally stop — treat as soft end
        const err = String(e.error ?? "");
        if (err === "interrupted" || err === "canceled") finish();
        else finish(new Error(err || "speech error"));
      };

      currentUtterance = utterance;

      try {
        window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
      window.speechSynthesis.speak(utterance);

      // Chrome bug: utterance can stall; watchdog if speaking never starts
      window.setTimeout(() => {
        if (!settled && currentUtterance === utterance && !window.speechSynthesis.speaking) {
          try {
            window.speechSynthesis.resume();
            window.speechSynthesis.speak(utterance);
          } catch {
            /* ignore */
          }
        }
      }, 250);
    };

    // Small delay after cancel so Chrome accepts the next utterance
    window.setTimeout(run, 60);
  });
}

/**
 * Queue-safe speak. Call this from a user gesture when possible.
 * Awaits voice list first for more reliable first utterance.
 */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (!canSpeak()) throw new Error("Speech not supported");
  await waitForVoices();

  const job = speakChain.then(() => speakOnce(text, opts)).catch((err) => {
    // Don't break the chain forever
    throw err;
  });
  speakChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

/** Speak several scripts in order (e.g. multiple alerts). */
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

/** Warm up voices list (Chrome loads async). Call on first user gesture too. */
export function warmVoices() {
  if (!canSpeak()) return;
  window.speechSynthesis.getVoices();
  const prev = window.speechSynthesis.onvoiceschanged;
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
    if (typeof prev === "function") prev.call(window.speechSynthesis, new Event("voiceschanged"));
  };
}
