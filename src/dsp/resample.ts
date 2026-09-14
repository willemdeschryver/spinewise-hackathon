// Streaming sample-rate converter to the 16 kHz the models expect. Windowed-sinc kernel with
// 64 fractional phases, so any input rate works (44.1 or 48 kHz microphones, 24 kHz clips).
const PHASES = 64;

export class Resampler {
  private readonly step: number;         // input samples per output sample
  private readonly half: number;         // kernel taps on each side of the output position
  private readonly kernel: Float32Array; // PHASES + 1 rows of 2 * half taps
  private buf = new Float32Array(0);
  private len = 0;
  private t: number;                     // fractional input index of the next output sample
  private out = new Float32Array(1024);

  constructor(readonly inRate: number, readonly outRate = 16000) {
    this.step = inRate / outRate;
    this.half = Math.max(8, Math.ceil(16 * Math.max(1, this.step)));
    this.t = this.half - 1;
    const cutoff = (0.45 * Math.min(inRate, outRate)) / inRate; // cycles per input sample
    const taps = 2 * this.half;
    this.kernel = new Float32Array((PHASES + 1) * taps);
    for (let p = 0; p <= PHASES; p++) {
      const frac = p / PHASES;
      let sum = 0;
      for (let j = 0; j < taps; j++) {
        const x = j - this.half + 1 - frac;
        const blackman = 0.42 + 0.5 * Math.cos((Math.PI * x) / this.half) + 0.08 * Math.cos((2 * Math.PI * x) / this.half);
        const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
        const v = Math.abs(x) < this.half ? sinc * blackman : 0;
        this.kernel[p * taps + j] = v;
        sum += v;
      }
      for (let j = 0; j < taps; j++) this.kernel[p * taps + j] /= sum; // unity gain per phase
    }
  }

  // Returns the output samples this push completed. The returned view is reused by the next
  // push, so consume it before pushing again.
  push(x: Float32Array): Float32Array {
    if (this.len + x.length > this.buf.length) {
      const nb = new Float32Array(Math.max(2 * this.buf.length, this.len + x.length + 4 * this.half));
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb;
    }
    this.buf.set(x, this.len);
    this.len += x.length;

    const taps = 2 * this.half;
    const maxOut = Math.ceil((this.len - this.t) / this.step) + 2;
    if (this.out.length < maxOut) this.out = new Float32Array(maxOut);
    let n = 0;
    for (;;) {
      const i = Math.floor(this.t);
      if (i + this.half >= this.len) break;
      const row = Math.round((this.t - i) * PHASES) * taps;
      const base = i - this.half + 1;
      let acc = 0;
      for (let j = 0; j < taps; j++) acc += this.kernel[row + j] * this.buf[base + j];
      this.out[n++] = acc;
      this.t += this.step;
    }
    const keepFrom = Math.floor(this.t) - this.half + 1;
    if (keepFrom > 0) {
      this.buf.copyWithin(0, keepFrom, this.len);
      this.len -= keepFrom;
      this.t -= keepFrom;
    }
    return this.out.subarray(0, n);
  }
}
