import { FFT } from './fft';

// Per-frame acoustic features. One frame = the last 2048 samples, produced every
// time a 1024-sample chunk arrives (about 47 frames per second at 48 kHz).
export interface FrameFeatures {
  levelDb: number;   // broadband level of the newest chunk, dBFS
  speechDb: number;  // energy in the 300 to 3400 Hz band, dBFS-equivalent
  lowDb: number;     // 20 to 300 Hz
  highDb: number;    // 3400 to 8000 Hz
  flatness: number;  // spectral flatness 0..1 (1 = white noise)
  entropy: number;   // normalised spectral entropy 0..1
  centroid: number;  // Hz
  flux: number;      // onset-ish spectral change 0..1
  f0: number;        // fundamental in Hz (0 when none)
  clarity: number;   // periodicity 0..1 from YIN (1 = one clean pitch)
  second: number;    // 0..1 periodicity left after cancelling the main pitch: a second voice
  f1: number;        // Hz of that second periodicity (0 when none)
  envelope: Float32Array; // speech-band intensity per sub-block of this chunk, dB (about 5 ms steps)
}

const FRAME = 2048;
const MASK = FRAME - 1;
const SUB = 256;

// Direct form I biquad, RBJ cookbook coefficients.
class Biquad {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private constructor(
    private readonly b0: number, private readonly b1: number, private readonly b2: number,
    private readonly a1: number, private readonly a2: number,
  ) {}

  static lowpass(sr: number, fc: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
  }

  static highpass(sr: number, fc: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export class FrameAnalyzer {
  readonly frameSize = FRAME;
  private readonly fft = new FFT(FRAME);
  private readonly ring = new Float32Array(FRAME);
  private pos = 0;
  private filled = 0;
  private readonly frame = new Float32Array(FRAME);
  private readonly win = new Float32Array(FRAME);
  private readonly re = new Float32Array(FRAME);
  private readonly im = new Float32Array(FRAME);
  private readonly power = new Float32Array(FRAME / 2 + 1);
  private readonly prevMag = new Float32Array(FRAME / 2 + 1);
  private readonly yinD: Float32Array;
  private readonly residual = new Float32Array(FRAME);
  private readonly tauMin: number;
  private readonly tauMax: number;
  private readonly binHz: number;
  private readonly bandNorm: number;
  private readonly hp: Biquad;
  private readonly lp: Biquad;
  private envelope = new Float32Array(4);

  constructor(readonly sampleRate: number) {
    for (let i = 0; i < FRAME; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
    this.binHz = sampleRate / FRAME;
    // Hann window power is 0.375 and the one-sided spectrum is doubled, so band dB
    // lines up with time-domain dBFS for a signal that sits inside the band.
    this.bandNorm = 2 / (0.375 * FRAME * FRAME);
    this.tauMin = Math.max(2, Math.floor(sampleRate / 500));      // 500 Hz ceiling
    this.tauMax = Math.min(FRAME / 2, Math.ceil(sampleRate / 60)); // 60 Hz floor
    this.yinD = new Float32Array(this.tauMax + 1);
    this.hp = Biquad.highpass(sampleRate, 300);
    this.lp = Biquad.lowpass(sampleRate, 3400);
  }

  analyze(chunk: Float32Array): FrameFeatures | null {
    // Speech-band intensity contour at sub-block resolution: this is what syllables are counted on.
    const subs = Math.max(1, Math.floor(chunk.length / SUB));
    if (this.envelope.length !== subs) this.envelope = new Float32Array(subs);
    let s = 0;
    for (let j = 0; j < subs; j++) {
      let e = 0;
      const end = Math.min(chunk.length, (j + 1) * SUB);
      for (let i = j * SUB; i < end; i++) {
        const x = chunk[i];
        s += x * x;
        this.ring[this.pos] = x;
        this.pos = (this.pos + 1) & MASK;
        const y = this.lp.process(this.hp.process(x));
        e += y * y;
      }
      this.envelope[j] = 10 * Math.log10(e / (end - j * SUB) + 1e-12);
    }
    const levelDb = 20 * Math.log10(Math.sqrt(s / chunk.length) + 1e-7);
    this.filled += chunk.length;
    if (this.filled < FRAME) return null;

    const frame = this.frame;
    for (let i = 0; i < FRAME; i++) frame[i] = this.ring[(this.pos + i) & MASK];

    const re = this.re, im = this.im, power = this.power;
    for (let i = 0; i < FRAME; i++) { re[i] = frame[i] * this.win[i]; im[i] = 0; }
    this.fft.transform(re, im);
    for (let k = 0; k <= FRAME / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];

    const band = (lo: number, hi: number): number => {
      const k0 = Math.max(1, Math.ceil(lo / this.binHz));
      const k1 = Math.min(FRAME / 2, Math.floor(hi / this.binHz));
      let e = 0;
      for (let k = k0; k <= k1; k++) e += power[k];
      return 10 * Math.log10(e * this.bandNorm + 1e-12);
    };
    const speechDb = band(300, 3400);
    const lowDb = band(20, 300);
    const highDb = band(3400, 8000);

    const kLo = Math.max(1, Math.ceil(100 / this.binHz));
    const kHi = Math.min(FRAME / 2, Math.floor(8000 / this.binHz));
    let sumP = 0, sumLog = 0, sumF = 0, n = 0, fluxNum = 0, fluxDen = 0;
    for (let k = kLo; k <= kHi; k++) {
      const p = power[k] + 1e-14;
      sumP += p;
      sumLog += Math.log(p);
      sumF += p * k;
      n++;
      const m = Math.sqrt(power[k]);
      const dm = m - this.prevMag[k];
      if (dm > 0) fluxNum += dm;
      fluxDen += m;
      this.prevMag[k] = m;
    }
    const flatness = Math.exp(sumLog / n) / (sumP / n);
    let h = 0;
    for (let k = kLo; k <= kHi; k++) {
      const q = (power[k] + 1e-14) / sumP;
      h -= q * Math.log(q);
    }
    const entropy = h / Math.log(n);
    const centroid = (sumF / sumP) * this.binHz;
    const flux = fluxDen > 0 ? fluxNum / fluxDen : 0;

    let f0 = 0, clarity = 0, second = 0, f1 = 0;
    if (levelDb > -75) {
      const y = this.yin(frame, FRAME / 2, 0.2, 0);
      f0 = y.f0;
      clarity = y.clarity;
      if (clarity > 0.5 && y.lag > 0) {
        // Cancel the dominant voice with a one-period comb, then look for a period that is
        // left over and is not a multiple (or divisor) of the first.
        const lag = y.lag;
        const li = Math.floor(lag), fr = lag - li;
        const res = this.residual;
        const n = FRAME - li - 1;
        for (let i = 0; i < n; i++) {
          // x[i + lag] with a fractional lag, minus x[i]: one period of the main voice cancels.
          const ahead = frame[i + li] * (1 - fr) + frame[i + li + 1] * fr;
          res[i] = ahead - frame[i];
        }
        const W = Math.max(256, n - this.tauMax - 1);
        const r = this.yin(res, W, 0.35, lag);
        if (r.lag > 0) {
          second = r.clarity;
          f1 = r.f0;
        }
      }
    }

    return {
      levelDb, speechDb, lowDb, highDb, flatness, entropy, centroid, flux,
      f0, clarity, second, f1, envelope: this.envelope,
    };
  }

  // YIN (de Cheveigne and Kawahara, 2002). Window W samples, lags up to tauMax. When
  // `exclude` is set, lags that are near a multiple or a divisor of it are skipped, so the
  // search finds a genuinely different period.
  private yin(x: Float32Array, W: number, threshold: number, exclude: number): { f0: number; clarity: number; lag: number } {
    const d = this.yinD;
    const tMin = this.tauMin, tMax = this.tauMax;
    let running = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tMax; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) {
        const diff = x[i] - x[i + tau];
        sum += diff * diff;
      }
      running += sum;
      d[tau] = running > 0 ? (sum * tau) / running : 1;
    }
    const related = (t: number): boolean => {
      if (exclude <= 0) return false;
      const ratio = t > exclude ? t / exclude : exclude / t;
      return Math.abs(ratio - Math.round(ratio)) < 0.08;
    };
    let tau = -1;
    for (let t = tMin; t <= tMax; t++) {
      if (d[t] < threshold && !related(t)) {
        while (t + 1 <= tMax && d[t + 1] < d[t]) t++;
        if (related(t)) continue;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      // No dip under the threshold: report the deepest one anyway, so callers get a graded value.
      tau = -1;
      for (let t = tMin; t <= tMax; t++) {
        if (related(t)) continue;
        if (tau < 0 || d[t] < d[tau]) tau = t;
      }
      if (tau < 0) return { f0: 0, clarity: 0, lag: 0 };
    }
    let refined = tau;
    if (tau > tMin && tau < tMax) {
      const s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1];
      const denom = s0 - 2 * s1 + s2;
      if (Math.abs(denom) > 1e-9) refined = tau + (s0 - s2) / (2 * denom);
    }
    const clarity = Math.min(1, Math.max(0, 1 - d[tau]));
    return { f0: this.sampleRate / refined, clarity, lag: refined };
  }
}
