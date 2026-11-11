/**
 * Microphone capture + real-time analysis for the avatar and VAD.
 * Everything here is genuine Web Audio: RMS from raw samples drives the mouth in
 * amplitude mode, and the level meter shows measured input, not decoration.
 */
export type MicStream = {
  stream: MediaStream;
  analyser: AnalyserNode;
  sample(): { rms: number; spectrum: Uint8Array };
  stop(): void;
};

export async function openMicrophone(deviceId?: string): Promise<MicStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This environment has no microphone access (requires HTTPS or localhost).');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  const timeBuf = new Float32Array(analyser.fftSize);
  const freqBuf = new Uint8Array(analyser.frequencyBinCount);
  return {
    stream,
    analyser,
    sample() {
      analyser.getFloatTimeDomainData(timeBuf);
      analyser.getByteFrequencyData(freqBuf);
      let sum = 0;
      for (const v of timeBuf) sum += v * v;
      return { rms: Math.sqrt(sum / timeBuf.length), spectrum: freqBuf };
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

export async function listAudioDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    return await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
}

/** Downsample float32 audio to 16-bit PCM base64 for provider streaming. */
export function floatToPcm16Base64(samples: Float32Array): string {
  const buf = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(buf.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Plays 24kHz PCM16 chunks returned by Gemini Live. */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];

  ensure(): AudioContext {
    this.ctx ??= new AudioContext({ sampleRate: 24_000 });
    return this.ctx;
  }

  enqueueBase64(b64: string, sampleRate = 24_000): void {
    const ctx = this.ensure();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i] ?? 0) / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const start = Math.max(ctx.currentTime + 0.02, this.nextTime);
    src.start(start);
    this.nextTime = start + buffer.duration;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.nextTime = 0;
  }

  get playing(): boolean {
    return this.sources.length > 0;
  }
}
