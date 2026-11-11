/**
 * Browser speech: real Web Speech API usage (no simulation). Used as a zero-key
 * fallback for TTS and, where the browser supports it, speech recognition.
 * Provider audio (OpenAI TTS / Gemini Live) takes precedence when configured.
 */
export type SpeakHandle = {
  stop(): void;
  promise: Promise<void>;
  mode: 'browser';
};

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function listBrowserVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return window.speechSynthesis.getVoices();
}

export function speakBrowser(text: string, opts: { voiceName?: string; rate?: number; pitch?: number; onBoundary?: (charIndex: number) => void } = {}): SpeakHandle {
  if (!speechSupported()) {
    return { stop: () => undefined, promise: Promise.resolve(), mode: 'browser' };
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const voice = (opts.voiceName && voices.find((v) => v.name === opts.voiceName)) || voices.find((v) => v.lang.startsWith('en')) || voices[0];
  if (voice) utter.voice = voice;
  utter.rate = Math.min(2, Math.max(0.5, opts.rate ?? 1));
  utter.pitch = Math.min(2, Math.max(0.5, opts.pitch ?? 1));
  if (opts.onBoundary) utter.onboundary = (e) => opts.onBoundary?.(e.charIndex);
  const promise = new Promise<void>((resolve) => {
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
  });
  synth.speak(utter);
  return {
    stop: () => {
      synth.cancel();
    },
    promise,
    mode: 'browser',
  };
}

type RecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

/**
 * Thin, honest wrapper over the Web Speech API. Emits final + interim transcripts and
 * reports the browser error codes verbatim (e.g. "not-allowed" when mic permission is
 * denied). When the API is absent it reports `supported = false` instead of pretending.
 */
export class RecognitionBridge {
  readonly supported: boolean;
  private rec: RecognitionLike | null = null;
  private stopped = false;
  onFinal: (text: string) => void = () => undefined;
  onInterim: (text: string) => void = () => undefined;
  onError: (message: string) => void = () => undefined;
  onEnd: () => void = () => undefined;

  constructor(private readonly lang = 'en-US') {
    const Ctor = recognitionCtor();
    this.supported = Ctor !== null;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) this.onFinal(text);
        else interim += text;
      }
      if (interim) this.onInterim(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.onError(`Browser speech recognition: ${e.error}`);
    };
    rec.onend = () => {
      // Chrome stops recognition after silence; restart while the session is live.
      if (!this.stopped) {
        try {
          rec.start();
        } catch {
          this.onEnd();
        }
      } else {
        this.onEnd();
      }
    };
    this.rec = rec;
  }

  start(): void {
    this.stopped = false;
    try {
      this.rec?.start();
    } catch {
      /* already running */
    }
  }

  stop(): void {
    this.stopped = true;
    try {
      this.rec?.stop();
    } catch {
      /* not running */
    }
  }
}
