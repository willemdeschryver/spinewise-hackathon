import type { Ort, OrtSession, OrtTensor } from './ort';

// Silero VAD v5: a speech probability for every 32 ms of 16 kHz audio. The model wants each
// 512-sample frame preceded by the last 64 samples of the previous one, and carries a
// recurrent state between calls.
const FRAME = 512;
const CONTEXT = 64;

export class SileroVad {
  private state: OrtTensor;
  private readonly sr: OrtTensor;
  private readonly input = new Float32Array(CONTEXT + FRAME);
  private readonly pending = new Float32Array(FRAME);
  private fill = 0;
  private last = 0;

  constructor(private readonly ort: Ort, private readonly session: OrtSession) {
    this.state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
    this.sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  }

  // Probability from the most recent frame.
  get probability(): number { return this.last; }

  reset(): void {
    this.state = new this.ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
    this.input.fill(0);
    this.fill = 0;
    this.last = 0;
  }

  // Feeds 16 kHz samples; resolves with one probability per frame completed by this call.
  async push(x: Float32Array): Promise<number[]> {
    const probs: number[] = [];
    let off = 0;
    while (off < x.length) {
      const n = Math.min(FRAME - this.fill, x.length - off);
      this.pending.set(x.subarray(off, off + n), this.fill);
      this.fill += n;
      off += n;
      if (this.fill < FRAME) break;
      this.input.set(this.pending, CONTEXT);
      const out = await this.session.run({
        input: new this.ort.Tensor('float32', this.input, [1, CONTEXT + FRAME]),
        state: this.state,
        sr: this.sr,
      });
      this.state = out.stateN;
      this.last = (out.output.data as Float32Array)[0];
      probs.push(this.last);
      this.input.copyWithin(0, FRAME, CONTEXT + FRAME); // the tail of this frame is the next context
      this.fill = 0;
    }
    return probs;
  }
}
