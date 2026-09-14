import type { Ort, OrtSession } from './ort';

// pyannote segmentation-3.0: for every 16.875 ms of a window of 16 kHz audio, a distribution
// over seven states (nobody, one of three speakers, one of three pairs). Speaker labels are
// only consistent inside one window, so only counts are kept: someone is speaking, two are
// speaking at once, how many are speaking.
export interface Segmentation {
  t: number;         // seconds of audio consumed when the window ended
  ms: number;        // inference time
  speech: number;    // 0..1, share of the newest hop with anyone speaking
  overlap: number;   // 0..1, share with two or more speaking
  speakers: number;  // expected number of simultaneous speakers over the newest hop
  frames: number;    // frames in the newest hop
}

const SR = 16000;
const STEP = 270; // samples per output frame

export class Segmenter {
  private readonly ring: Float32Array;
  private readonly window: Float32Array;
  private readonly hopSamples: number;
  private pos = 0;
  private filled = 0;
  private fresh = 0;
  private consumed = 0;
  running = false;

  constructor(private readonly ort: Ort, private readonly session: OrtSession, readonly windowSec: number, readonly hopSec: number) {
    this.ring = new Float32Array(Math.round(windowSec * SR));
    this.window = new Float32Array(this.ring.length);
    this.hopSamples = Math.round(hopSec * SR);
  }

  reset(): void {
    this.ring.fill(0);
    this.pos = 0;
    this.filled = 0;
    this.fresh = 0;
    this.consumed = 0;
  }

  push(x: Float32Array): void {
    const n = this.ring.length;
    for (let i = 0; i < x.length; i++) {
      this.ring[this.pos] = x[i];
      this.pos = this.pos + 1 === n ? 0 : this.pos + 1;
    }
    this.filled = Math.min(n, this.filled + x.length);
    this.fresh += x.length;
    this.consumed += x.length;
  }

  // Enough new audio for another hop. When a run takes longer than a hop, the next run simply
  // looks at the newest window; there is no backlog to catch up on.
  get due(): boolean {
    return !this.running && this.filled === this.ring.length && this.fresh >= this.hopSamples;
  }

  async run(): Promise<Segmentation> {
    this.running = true;
    const hop = this.fresh;
    this.fresh = 0;
    const n = this.ring.length;
    this.window.set(this.ring.subarray(this.pos), 0);
    this.window.set(this.ring.subarray(0, this.pos), n - this.pos);
    const t0 = performance.now();
    try {
      const out = await this.session.run({ x: new this.ort.Tensor('float32', this.window, [1, 1, n]) });
      const y = out.y;
      const frames = y.dims[1];
      const d = y.data as Float32Array;
      const take = Math.min(frames, Math.max(1, Math.round(hop / STEP)));
      let speech = 0, overlap = 0, speakers = 0;
      for (let f = frames - take; f < frames; f++) {
        const o = f * 7;
        // The model emits log-probabilities; normalising makes plain logits work too.
        const p0 = Math.exp(d[o]), p1 = Math.exp(d[o + 1]), p2 = Math.exp(d[o + 2]), p3 = Math.exp(d[o + 3]);
        const p4 = Math.exp(d[o + 4]), p5 = Math.exp(d[o + 5]), p6 = Math.exp(d[o + 6]);
        const sum = p0 + p1 + p2 + p3 + p4 + p5 + p6;
        const pair = (p4 + p5 + p6) / sum;
        speech += 1 - p0 / sum;
        overlap += pair;
        speakers += (p1 + p2 + p3) / sum + 2 * pair;
      }
      return {
        t: this.consumed / SR, ms: performance.now() - t0,
        speech: speech / take, overlap: overlap / take, speakers: speakers / take, frames: take,
      };
    } finally {
      this.running = false;
    }
  }
}
