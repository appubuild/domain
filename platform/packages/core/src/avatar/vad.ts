/**
 * Energy + zero-crossing voice activity detector with hangover and hysteresis.
 * This is the dependency-free floor; Silero VAD (@ricky0123/vad-web) can be swapped in
 * per platform via the `VadBackend` interface when its assets are available offline.
 */
export type VadConfig = {
  /** RMS threshold above which a frame counts as speech (0..1). */
  threshold: number;
  /** Consecutive speech frames required to open the gate. */
  attackFrames: number;
  /** Consecutive silent frames required to close the gate. */
  releaseFrames: number;
  sampleRate: number;
  frameMs: number;
};

export const DEFAULT_VAD: VadConfig = { threshold: 0.055, attackFrames: 3, releaseFrames: 14, sampleRate: 16_000, frameMs: 20 };

export type VadDecision = 'silence' | 'speech' | 'speech-start' | 'speech-end';

export class EnergyVad {
  private speechRun = 0;
  private silenceRun = 0;
  private speaking = false;
  private noiseFloor = 0.012;
  constructor(private config: VadConfig = DEFAULT_VAD) {}

  configure(patch: Partial<VadConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get noise(): number {
    return this.noiseFloor;
  }

  /** Feed one analysis frame of raw PCM samples (-1..1). */
  processFrame(samples: Float32Array): VadDecision {
    const rms = rmsTimeDomain(samples);
    // Adaptive floor: fast down, slow up, clamped so a noisy room cannot mask speech.
    if (!this.speaking) {
      this.noiseFloor = rms < this.noiseFloor ? lerp(this.noiseFloor, rms, 0.2) : lerp(this.noiseFloor, rms, 0.02);
    }
    const dynamic = Math.max(this.config.threshold, this.noiseFloor * 2.6);
    const voiced = rms > dynamic && zeroCrossingRate(samples) < 0.35;

    if (voiced) {
      this.speechRun++;
      this.silenceRun = 0;
      if (!this.speaking && this.speechRun >= this.config.attackFrames) {
        this.speaking = true;
        return 'speech-start';
      }
      if (this.speaking) return 'speech';
    } else {
      this.silenceRun++;
      this.speechRun = 0;
      if (this.speaking && this.silenceRun >= this.config.releaseFrames) {
        this.speaking = false;
        return 'speech-end';
      }
    }
    return this.speaking ? 'speech' : 'silence';
  }
}

export function rmsTimeDomain(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

export function zeroCrossingRate(samples: Float32Array): number {
  if (samples.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if (((samples[i] ?? 0) >= 0) !== ((samples[i - 1] ?? 0) >= 0)) crossings++;
  }
  return crossings / (samples.length - 1);
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}
