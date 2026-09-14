import type { FrameFeatures } from './features';
import type { Segmentation } from './segmenter';
import { cfg } from '../config';

// Turns per-frame features and the model outputs into the slow, human-scale readings the
// organism reacts to.
export interface Metrics {
  level: number;        // fast broadband envelope, dBFS
  speechLevel: number;  // level of recent speech, dBFS
  speechRef: number;    // the room's normal speech level, dBFS; volume and noise are judged against it
  noiseFloor: number;   // broadband floor, dBFS
  snr: number;          // speechLevel minus noiseFloor, dB
  voice: number;        // 0..1 someone is speaking
  sinceVoice: number;   // seconds since the last speech
  vad: number;          // 0..1 speech probability of the newest frame (Silero)
  rate: number;         // syllables per second
  run: number;          // seconds of talk since the last pause
  overlap: number;      // 0..1
  speakers: number;     // people speaking at once, smoothed (0..3)
  segAge: number;       // seconds since the last segmentation result (99 when there is none)
  segMs: number;        // inference time of that result
  neural: boolean;      // voice and overlap come from the models, not the fallback heuristics
  f0: number;
  clarity: number;
  entropy: number;
  second: number;       // 0..1 a second voice is audible in this frame (heuristic)
  envRange: number;     // dB between the loud and the quiet parts of the last second of speech
  rangeRef: number;     // what that spread looks like for one voice in this room (adaptive)
  fill: number;         // 0..1 the pauses between syllables are being filled by another voice
  floorSpread: number;  // dB spread of the quiet frames over the last 2 s (steady noise is tight)

  volume: number;       // -1..1, negative is too quiet, positive too loud
  pace: number;         // 0..1 problem score
  voices: number;       // 0..1 problem score
  noise: number;        // 0..1 problem score
  snrBad: number;       // 0..1 speech is drowning in the noise
  strain: number;       // 0..1 composite, how hard this room is to follow
  status: { volume: string; pace: string; voices: string; noise: string };
}

// What the models add to a chunk. Both optional: without them the tracker falls back to
// the spectral heuristics.
export interface NeuralInput {
  vad?: number;               // Silero probability for this chunk
  seg?: Segmentation | null;  // a segmentation result that arrived since the last chunk
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const rampUp = (x: number, lo: number, hi: number): number => clamp01((x - lo) / (hi - lo));
const rampDown = (x: number, hi: number, lo: number): number => clamp01((hi - x) / (hi - lo));
const alpha = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

const RATE_WINDOW = 2.5;
const JUMP_WINDOW = 1.5;
const WARMUP_SEC = 2;
const SEG_STALE_SEC = 2;
const GATED = 1e9;

export class MetricsTracker {
  readonly dt: number;
  private t = 0;

  private readonly floorN: number;
  private readonly levelHist: Float32Array;
  private readonly speechHist: Float32Array;
  private readonly scratch: Float32Array;
  private histPos = 0;
  private histLen = 0;
  private floorTick = 0;
  private noiseFloor = -80;
  private speechFloor = -80;
  private readonly fastN: number;
  private readonly fastLevel: Float32Array;
  private readonly fastSpeech: Float32Array;
  private fastPos = 0;
  private riseSec = 0;
  private rising = false;

  private level = -80;
  private speechLevel = -30;
  private speechRef = -30;
  private refSec = 0;
  private speechBandLevel = -34;
  private sinceVoice = 99;
  private voiceRaw = 0;
  private voice = 0;
  private hold = 0;
  private hasVad = false;
  private vadProb = 0;

  private env = -80;
  private env2 = -80;
  private e1 = -80;
  private e2 = -80;
  private valley = -80;
  private lastPeakT = -9;
  private peakTimes: number[] = [];
  private voicedTimes: number[] = [];
  private rate = 0;
  private run = 0;

  private f0Prev = 0;
  private f0PrevT = -9;
  private jumpTimes: number[] = [];
  private envRing: Float32Array | null = null;
  private envVoiced: Uint8Array | null = null;
  private envRingPos = 0;
  private envScratch: Float32Array | null = null;
  private envRange = 0;
  private fill = 0;
  private floorSpread = 0;
  private rangeHist: Float32Array | null = null;
  private rangePos = 0;
  private rangeTick = 0;
  private rangeRef = cfg.fillRangeHigh;
  private overlap = 0;
  private seg: Segmentation | null = null;
  private segAt = -99;
  private speakers = 0;
  private strain = 0;

  private last: Metrics = MetricsTracker.idle();

  constructor(readonly fps: number) {
    this.dt = 1 / fps;
    this.floorN = Math.max(10, Math.round(cfg.floorWindowSec * fps));
    this.levelHist = new Float32Array(this.floorN).fill(-80);
    this.speechHist = new Float32Array(this.floorN).fill(-80);
    this.scratch = new Float32Array(this.floorN);
    this.fastN = Math.max(10, Math.round(2 * fps));
    this.fastLevel = new Float32Array(this.fastN).fill(GATED);
    this.fastSpeech = new Float32Array(this.fastN).fill(GATED);
  }

  static idle(): Metrics {
    return {
      level: -80, speechLevel: -80, speechRef: -30, noiseFloor: -80, snr: 0, voice: 0, sinceVoice: 99, vad: 0,
      rate: 0, run: 0, overlap: 0, speakers: 0, segAge: 99, segMs: 0, neural: false,
      f0: 0, clarity: 0, entropy: 0, second: 0, envRange: 0, rangeRef: 0, fill: 0, floorSpread: 0,
      volume: 0, pace: 0, voices: 0, noise: 0, snrBad: 0, strain: 0,
      status: { volume: 'listening', pace: 'listening', voices: 'listening', noise: 'listening' },
    };
  }

  get current(): Metrics { return this.last; }

  reset(): void {
    Object.assign(this, new MetricsTracker(this.fps));
  }

  // The room is quiet right now: take the current level as the floor immediately.
  calibrateQuiet(): void {
    this.levelHist.fill(this.level);
    this.speechHist.fill(this.env);
    this.histLen = this.floorN;
    this.noiseFloor = this.level;
    this.speechFloor = this.env;
  }

  // Someone is speaking at a comfortable level from where the device sits: make that the
  // reference the volume and noise readings are judged against, and stop the fast initial
  // adaptation so a quiet or loud speaker afterwards does not drag it along.
  calibrateSpeech(): void {
    this.speechRef = this.speechLevel;
    this.refSec = 99;
  }

  // Low percentile of the usable entries in the window. Gated entries hold GATED and sort to
  // the end. A floor needs enough quiet evidence: with only a few usable frames (the odd gap
  // in continuous talk) null keeps the previous floor rather than reading the gap as noise.
  private percentile(hist: Float32Array, n: number, p: number, minFrac: number): number | null {
    const s = this.scratch.subarray(0, n);
    s.set(hist.subarray(0, n));
    s.sort();
    let valid = n;
    while (valid > 0 && s[valid - 1] >= GATED) valid--;
    if (valid < Math.max(5, minFrac * n)) return null;
    return s[Math.min(valid - 1, Math.floor(p * valid))];
  }

  update(f: FrameFeatures, n?: NeuralInput): Metrics {
    const dt = this.dt;
    this.t += dt;
    const warmingUp = this.t < WARMUP_SEC;
    if (n?.vad !== undefined) { this.vadProb = n.vad; this.hasVad = true; }
    // The first window after a start holds the opening transient; results from it are skipped.
    if (n?.seg && this.t > cfg.segWindowSec + 1) { this.seg = n.seg; this.segAt = this.t; }
    const segFresh = this.seg !== null && this.t - this.segAt < SEG_STALE_SEC;

    // Envelopes
    this.level += (f.levelDb > this.level ? alpha(dt, 0.02) : alpha(dt, 0.25)) * (f.levelDb - this.level);

    // Floors: a low percentile of recent frames that carry no voice: frames without a clear
    // pitch (pauses, consonants, most noise), or frames the model is sure hold no speech and
    // that are not right after speech (tonal noise such as hum). Voiced speech never qualifies,
    // so two people talking at once do not read as noise. Every frame takes a slot so the
    // window stays a true 10 s.
    const usable = warmingUp || f.clarity < cfg.floorClarityMax
      || (this.hasVad && this.vadProb < cfg.vadNoiseMax && this.sinceVoice > 0.3);
    this.levelHist[this.histPos] = usable ? f.levelDb : GATED;
    this.speechHist[this.histPos] = usable ? f.speechDb : GATED;
    this.histPos = (this.histPos + 1) % this.floorN;
    this.histLen = Math.min(this.histLen + 1, this.floorN);
    this.fastLevel[this.fastPos] = usable ? f.levelDb : GATED;
    this.fastSpeech[this.fastPos] = usable ? f.speechDb : GATED;
    this.fastPos = (this.fastPos + 1) % this.fastN;
    if (++this.floorTick >= 6) {
      this.floorTick = 0;
      const a = warmingUp ? 0.5 : alpha(6 * dt, 1.0);
      const nf = this.percentile(this.levelHist, this.histLen, cfg.floorPercentile, 0.1);
      const sf = this.percentile(this.speechHist, this.histLen, cfg.floorPercentile, 0.1);
      if (nf !== null) this.noiseFloor += a * (nf - this.noiseFloor);
      if (sf !== null) this.speechFloor += a * (sf - this.speechFloor);
      // Fast path for a noise onset: the slow percentile needs most of its window to see the
      // change. Steady noise puts all quiet frames at nearly the same level, so a sustained
      // rise of the short-window floor with a tight spread jumps the floor at once.
      const fast = this.percentile(this.fastLevel, this.fastN, 0.2, 0.2);
      const fastHi = this.percentile(this.fastLevel, this.fastN, 0.8, 0.2);
      const fastS = this.percentile(this.fastSpeech, this.fastN, 0.2, 0.2);
      this.floorSpread = fast !== null && fastHi !== null ? fastHi - fast : 99;
      this.rising = fast !== null && fast > this.noiseFloor + cfg.floorRiseDb && this.floorSpread < cfg.floorFastSpreadDb;
      this.riseSec = this.rising ? this.riseSec + 6 * dt : 0;
      if (this.riseSec >= 1.5 && fast !== null) {
        this.noiseFloor = fast - 1;
        this.levelHist.fill(fast - 1);
        if (fastS !== null) { this.speechFloor = fastS - 1; this.speechHist.fill(fastS - 1); }
        this.riseSec = 0;
      }
    }

    // Voice activity: the model's probability with hysteresis, or the speech band clearing its
    // own floor. Either way a short hold bridges the gaps inside a phrase.
    const above = f.levelDb > -75 && (this.hasVad
      ? this.vadProb > (this.voiceRaw ? cfg.vadOff : cfg.vadOn)
      : f.speechDb > this.speechFloor + cfg.vadThresholdDb);
    this.hold = above ? cfg.vadHoldMs / 1000 : this.hold - dt;
    this.voiceRaw = this.hold > 0 ? 1 : 0;
    this.voice += alpha(dt, 0.12) * (this.voiceRaw - this.voice);
    if (above) {
      this.sinceVoice = 0;
      this.speechLevel += alpha(dt, 1.0) * (f.levelDb - this.speechLevel);
      this.speechBandLevel += alpha(dt, 1.0) * (f.speechDb - this.speechBandLevel);
      // The room's normal speech level, learnt from the first seconds of talk and then drifting
      // slowly. Microphone gain differs per device, so volume and noise are judged against this.
      this.refSec += dt;
      this.speechRef += alpha(dt, this.refSec < 4 ? 0.7 : 20) * (this.speechLevel - this.speechRef);
    } else {
      this.sinceVoice += dt;
    }

    // Syllable rate: peaks of the speech-band intensity contour while someone speaks.
    // The contour arrives in sub-blocks of about 5 ms; a peak counts when it rises at least
    // syllableProminenceDb above the valley before it and is not too close to the last one.
    const subs = f.envelope.length;
    const sdt = dt / subs;
    const aEnv = alpha(sdt, cfg.envelopeTauMs / 1000);
    if (!this.envRing || !this.envVoiced || !this.envScratch) {
      const n = Math.max(8, Math.round(1.2 / sdt));
      this.envRing = new Float32Array(n).fill(-80);
      this.envVoiced = new Uint8Array(n);
      this.envScratch = new Float32Array(n);
    }
    for (let j = 0; j < subs; j++) {
      const ts = this.t - dt + (j + 1) * sdt;
      this.env += aEnv * (f.envelope[j] - this.env);
      this.env2 += aEnv * (this.env - this.env2);
      const e = this.env2;
      this.envRing[this.envRingPos] = e;
      this.envVoiced[this.envRingPos] = this.voiceRaw;
      this.envRingPos = (this.envRingPos + 1) % this.envRing.length;
      if (this.voiceRaw) {
        // Syllable nuclei are vowels, so a peak only counts while the frame carries a pitch.
        const isPeak = this.e1 > e && this.e1 >= this.e2 && f.clarity >= cfg.syllableVoicedMin;
        const prominent = this.e1 - this.valley >= cfg.syllableProminenceDb;
        const spaced = ts - this.lastPeakT >= cfg.syllableMinGapMs / 1000;
        if (isPeak && prominent && spaced) {
          this.peakTimes.push(ts);
          this.lastPeakT = ts;
          this.valley = e;
        }
        this.valley = Math.min(this.valley, e);
      } else {
        this.valley = e;
      }
      this.e2 = this.e1;
      this.e1 = e;
    }
    if (this.voiceRaw) this.voicedTimes.push(this.t);
    while (this.peakTimes.length && this.peakTimes[0] < this.t - RATE_WINDOW) this.peakTimes.shift();
    while (this.voicedTimes.length && this.voicedTimes[0] < this.t - RATE_WINDOW) this.voicedTimes.shift();
    const voicedSec = this.voicedTimes.length * dt;
    // Two voices at once double the peaks, so the rate holds still while they overlap.
    if (voicedSec > 0.7 && this.overlap < 0.5) {
      this.rate += alpha(dt, cfg.paceSmoothSec) * (this.peakTimes.length / voicedSec - this.rate);
    } else if (this.sinceVoice > 1.5) {
      this.rate += alpha(dt, 1.5) * (0 - this.rate);
    }
    // Talking without pauses is the other half of pace: a listener with hearing loss needs the
    // gaps to catch up. The run counts seconds of talk since the last real pause.
    if (this.voiceRaw) this.run += dt;
    else if (this.sinceVoice > 0.35) this.run = 0;

    // Fallback overlap cues, kept alive so the heuristic can take over if the model is missing.
    // Filled pauses: one voice leaves deep dips between syllables; a second voice fills them,
    // measured relative to what one voice produces in this room.
    if (!this.rangeHist) this.rangeHist = new Float32Array(Math.round(cfg.fillRefSec * this.fps)).fill(cfg.fillRangeHigh);
    let voicedCount = 0;
    for (let i = 0; i < this.envVoiced.length; i++) voicedCount += this.envVoiced[i];
    if (voicedCount >= 0.8 * this.envVoiced.length) {
      this.envScratch.set(this.envRing);
      this.envScratch.sort();
      const n = this.envScratch.length;
      this.envRange = this.envScratch[Math.floor(0.9 * (n - 1))] - this.envScratch[Math.floor(0.1 * (n - 1))];
      this.rangeHist[this.rangePos] = this.envRange;
      this.rangePos = (this.rangePos + 1) % this.rangeHist.length;
      if (++this.rangeTick >= Math.round(this.fps)) {
        this.rangeTick = 0;
        const s = Float32Array.from(this.rangeHist).sort();
        this.rangeRef = s[Math.floor(cfg.fillRefPercentile * (s.length - 1))];
      }
      const clean = this.rising ? 0 : rampUp(this.speechLevel - this.noiseFloor, cfg.fillSnrMin, cfg.fillSnrMin + 6);
      const rel = this.envRange / Math.max(6, this.rangeRef);
      this.fill = clean * rampDown(rel, cfg.fillRelHigh, cfg.fillRelLow);
    } else {
      this.fill *= 1 - alpha(dt, 1.5);
    }
    const voicedFrame = this.voiceRaw === 1 && f.clarity > 0.5 && f.f0 > 0;
    if (voicedFrame) {
      if (this.f0Prev > 0 && this.t - this.f0PrevT < 0.35) {
        const oct = Math.abs(Math.log2(f.f0 / this.f0Prev));
        if (oct > 0.3) this.jumpTimes.push(this.t);
      }
      this.f0Prev = f.f0;
      this.f0PrevT = this.t;
    }
    while (this.jumpTimes.length && this.jumpTimes[0] < this.t - JUMP_WINDOW) this.jumpTimes.shift();
    const jumpsPerSec = this.jumpTimes.length / JUMP_WINDOW;

    // Overlap: the segmentation model's share of the newest hop with two or more speakers.
    // Without it: filled pauses, a second periodicity after cancelling the main voice, a pitch
    // track that keeps jumping between voices, and (weaker) loss of pitch clarity.
    let overlapRaw = 0;
    if (segFresh && this.seg) {
      overlapRaw = this.seg.overlap;
      this.speakers += alpha(dt, 0.5) * (this.seg.speakers - this.speakers);
    } else if (this.hasVad) {
      // Models present but no segmentation yet (warming up, or a run that is late): hold at zero
      // rather than guessing from the heuristics.
      this.speakers += alpha(dt, 0.5) * (this.voice - this.speakers);
    } else {
      if (this.voiceRaw) {
        const w = rampUp(f.speechDb, this.speechBandLevel - 9, this.speechBandLevel - 3);
        const second = rampUp(f.second, cfg.secondLow, cfg.secondHigh);
        const clarDrop = rampDown(f.clarity, cfg.clarityHigh, cfg.clarityLow);
        const jump = rampUp(jumpsPerSec, cfg.jumpLow, cfg.jumpHigh);
        overlapRaw = clamp01(
          cfg.overlapFill * this.fill
          + w * (cfg.overlapSecondPitch * second + cfg.overlapClarity * clarDrop)
          + cfg.overlapJump * jump,
        );
      }
      this.speakers += alpha(dt, 0.5) * (this.voice * (1 + overlapRaw) - this.speakers);
    }
    const aO = overlapRaw > this.overlap ? alpha(dt, cfg.overlapAttackSec) : alpha(dt, cfg.overlapReleaseSec);
    this.overlap += aO * (overlapRaw - this.overlap);

    // Scores
    const recent = this.sinceVoice < 4 && !warmingUp;
    const rel = this.speechLevel - this.speechRef;
    const quiet01 = recent ? rampDown(rel, cfg.volQuietDb, cfg.volQuietDb - 8) : 0;
    const loud01 = recent ? rampUp(rel, cfg.volLoudDb, cfg.volLoudDb + 10) : 0;
    const volume = loud01 - quiet01;
    const paceRate = recent ? rampUp(this.rate, cfg.paceSteady, cfg.paceFast) : 0;
    const paceRun = recent ? rampUp(this.run, cfg.runSteadySec, cfg.runFastSec) : 0;
    const pace = Math.max(paceRate, paceRun);
    const voices = this.overlap;
    const noise = warmingUp ? 0 : rampUp(this.noiseFloor - this.speechRef, cfg.noiseQuietDb, cfg.noiseLoudDb);
    const snr = this.speechLevel - this.noiseFloor;
    const snrBad = recent ? rampDown(snr, cfg.snrGood, cfg.snrBad) : 0;
    const strainRaw = 1 - (1 - 0.7 * Math.max(quiet01, loud01)) * (1 - 0.8 * pace) * (1 - voices) * (1 - 0.8 * noise) * (1 - 0.6 * snrBad);
    this.strain += alpha(dt, 1.2) * (strainRaw - this.strain);

    const status = {
      volume: !recent ? (warmingUp ? 'listening' : 'no speech')
        : volume < -0.6 ? 'too quiet to follow'
        : volume < -0.2 ? 'a bit quiet'
        : volume > 0.65 ? 'too loud'
        : volume > 0.25 ? 'loud'
        : 'comfortable',
      pace: !recent ? 'listening'
        : pace < 0.25 ? (this.rate < 2.4 ? 'slow' : 'steady')
        : paceRun > paceRate ? (pace < 0.65 ? 'few pauses' : 'no pauses')
        : pace < 0.65 ? 'quick'
        : 'too fast',
      voices: !recent ? 'listening'
        : voices < 0.3 ? 'one at a time'
        : voices < 0.6 ? 'some overlap'
        : 'talking over each other',
      noise: warmingUp ? 'listening'
        : recent && snrBad > 0.6 ? 'masking speech'
        : noise < 0.25 ? 'low'
        : noise < 0.5 ? 'some'
        : noise < 0.75 ? 'high'
        : 'very high',
    };

    this.last = {
      level: this.level, speechLevel: this.speechLevel, speechRef: this.speechRef, noiseFloor: this.noiseFloor, snr,
      voice: this.voice, sinceVoice: this.sinceVoice, vad: this.vadProb, rate: this.rate, run: this.run,
      overlap: this.overlap, speakers: this.speakers,
      segAge: this.seg ? this.t - this.segAt : 99, segMs: this.seg?.ms ?? 0, neural: this.hasVad && segFresh,
      f0: f.f0, clarity: f.clarity, entropy: f.entropy, second: f.second, envRange: this.envRange,
      rangeRef: this.rangeRef, fill: this.fill, floorSpread: this.floorSpread,
      volume, pace, voices, noise, snrBad, strain: this.strain, status,
    };
    return this.last;
  }
}
