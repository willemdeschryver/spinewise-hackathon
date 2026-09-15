// Runs the browser analysis (features + models + metrics) over WAV clips in Node, so thresholds
// can be tuned against known material without a microphone.
//   npx tsx scripts/eval.ts [clip|file.wav|folder ...]   per-clip timeline (default: samples + recordings/)
//   npx tsx scripts/eval.ts --heuristic ...              same without the models (the fallback path)
//   npx tsx scripts/eval.ts --sweep                      syllable-counter parameter sweep against known rates
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ort from 'onnxruntime-node';
import { FrameAnalyzer, type FrameFeatures } from '../src/dsp/features';
import { MetricsTracker, type Metrics, type NeuralInput } from '../src/dsp/metrics';
import { Resampler } from '../src/dsp/resample';
import { SileroVad } from '../src/dsp/vad';
import { Segmenter } from '../src/dsp/segmenter';
import type { OrtSession } from '../src/dsp/ort';
import { cfg } from '../src/config';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public/samples');
const MODELS = path.join(ROOT, 'public/models');
const TARGET_SR = 48000;
const HOP = 1024;

function readWav(file: string): { x: Float32Array; sr: number } {
  const b = fs.readFileSync(file);
  let off = 12, channels = 1, sr = 0, data: Buffer | null = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { channels = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); }
    else if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  if (!data || !sr) throw new Error(`bad wav ${file}`);
  const n = Math.floor(data.length / 2 / channels);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += data.readInt16LE((i * channels + c) * 2);
    x[i] = s / channels / 32768;
  }
  return { x, sr };
}

// Linear upsampling to the browser rate is enough here: the models get their own proper
// 16 kHz downsampling afterwards, exactly as in the app.
function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const n = Math.floor((x.length * to) / from);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i * from) / to;
    const j = Math.floor(t);
    const f = t - j;
    y[i] = x[j] * (1 - f) + (x[Math.min(j + 1, x.length - 1)] ?? 0) * f;
  }
  return y;
}

// A clip is either a sample name (public/samples/<name>.wav) or a path to any WAV file.
function resolveClip(name: string): string {
  if (fs.existsSync(name) && fs.statSync(name).isFile()) return name;
  return path.join(DIR, `${name}.wav`);
}

const cache = new Map<string, Float32Array>();
function load(name: string): Float32Array {
  let x = cache.get(name);
  if (!x) {
    const w = readWav(resolveClip(name));
    x = resample(w.x, w.sr, TARGET_SR);
    cache.set(name, x);
  }
  return x;
}

// Frame features are the expensive part and do not depend on any tunable, so cache them.
// One entry per chunk; null while the first frame is still filling, as in the app.
const featureCache = new Map<string, (FrameFeatures | null)[]>();
function featuresOf(name: string): (FrameFeatures | null)[] {
  let feats = featureCache.get(name);
  if (!feats) {
    const x = load(name);
    const analyzer = new FrameAnalyzer(TARGET_SR);
    const chunk = new Float32Array(HOP);
    feats = [];
    for (let i = 0; i + HOP <= x.length; i += HOP) {
      chunk.set(x.subarray(i, i + HOP));
      const f = analyzer.analyze(chunk);
      feats.push(f ? { ...f, envelope: Float32Array.from(f.envelope) } : null);
    }
    featureCache.set(name, feats);
  }
  return feats;
}

let useModels = true;
let vadSession: OrtSession | null = null;
let segSession: OrtSession | null = null;
async function sessions(): Promise<{ vad: OrtSession; seg: OrtSession }> {
  vadSession ??= await ort.InferenceSession.create(path.join(MODELS, 'silero_vad.onnx'), { intraOpNumThreads: 1 });
  segSession ??= await ort.InferenceSession.create(path.join(MODELS, 'segmentation.onnx'), { intraOpNumThreads: 1 });
  return { vad: vadSession, seg: segSession };
}

// Model outputs per chunk, the way the analysis worker feeds them to the tracker. Depends only
// on the segmentation window, so it is cached per clip and window.
const neuralCache = new Map<string, NeuralInput[]>();
async function neuralOf(name: string): Promise<NeuralInput[]> {
  const key = `${name}|${cfg.segWindowSec}|${cfg.segHopSec}`;
  let rows = neuralCache.get(key);
  if (rows) return rows;
  const s = await sessions();
  const x = load(name);
  const rs = new Resampler(TARGET_SR, 16000);
  const vad = new SileroVad(ort, s.vad);
  const seg = new Segmenter(ort, s.seg, cfg.segWindowSec, cfg.segHopSec);
  rows = [];
  for (let i = 0; i + HOP <= x.length; i += HOP) {
    const x16 = rs.push(x.subarray(i, i + HOP)).slice();
    const probs = await vad.push(x16);
    seg.push(x16);
    rows.push({
      vad: probs.length ? Math.max(...probs) : vad.probability,
      seg: seg.due ? await seg.run() : null,
    });
  }
  neuralCache.set(key, rows);
  return rows;
}

async function track(name: string): Promise<Metrics[]> {
  const tracker = new MetricsTracker(TARGET_SR / HOP);
  const feats = featuresOf(name);
  const neural = useModels ? await neuralOf(name) : null;
  const out: Metrics[] = [];
  feats.forEach((f, i) => {
    if (!f) return;
    const m = tracker.update(f, neural ? neural[i] : undefined);
    out.push({ ...m, status: { ...m.status } });
  });
  return out;
}

const avgOf = (rows: Metrics[], k: keyof Metrics): number =>
  rows.reduce((s, r) => s + (r[k] as number), 0) / Math.max(1, rows.length);

async function timeline(name: string, binSec = 2): Promise<void> {
  const all = await track(name);
  const fps = TARGET_SR / HOP;
  const bins: Metrics[][] = [];
  all.forEach((m, i) => { (bins[Math.floor(i / fps / binSec)] ??= []).push(m); });
  const avg = (rows: Metrics[], k: keyof Metrics, w = 6): string => avgOf(rows, k).toFixed(2).padStart(w);
  const mode = (rows: Metrics[], k: keyof Metrics['status']): string => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status[k]] = (c[r.status[k]] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  };
  const segMs = all.filter((m) => m.segMs > 0).map((m) => m.segMs);
  const meanSegMs = segMs.length ? segMs.reduce((a, b) => a + b, 0) / segMs.length : 0;
  console.log(`\n== ${path.basename(name, '.wav')}  (${(all.length / fps).toFixed(1)} s)  ${useModels ? `models on, segmentation ${meanSegMs.toFixed(0)} ms per ${cfg.segWindowSec} s window` : 'heuristics only'}`);
  console.log('  t   speech  floor sfloor   peak   rate    vad  ovlp   spk  voice   vol  pace  noise burst strain  statuses');
  bins.forEach((rows, b) => {
    if (!rows) return;
    console.log(
      `${String(b * binSec).padStart(3)} ${avg(rows, 'speechLevel')} ${avg(rows, 'noiseFloor')} ${avg(rows, 'speechFloor')} ${avg(rows, 'speechPeak')} ${avg(rows, 'rate')} ${avg(rows, 'vad')} ${avg(rows, 'overlap', 5)} ${avg(rows, 'speakers', 5)} ${avg(rows, 'voice')} ${avg(rows, 'volume')} ${avg(rows, 'pace', 5)} ${avg(rows, 'noise', 6)} ${avg(rows, 'burst', 5)} ${avg(rows, 'strain')}  ${mode(rows, 'volume')} / ${mode(rows, 'pace')} / ${mode(rows, 'voices')} / ${mode(rows, 'noise')}`,
    );
  });
}

// Known syllable rates of the clips (syllables counted in the script text over trimmed duration).
const TRUTH: Record<string, number> = { calm: 4.1, quiet: 3.9, fast: 9.2 };

async function sweep(): Promise<void> {
  const fps = TARGET_SR / HOP;
  const rows: { tau: number; prom: number; gap: number; rates: number[]; err: number }[] = [];
  for (const tau of [8, 12, 16, 20, 25]) {
    for (const prom of [1.5, 2, 3, 4]) {
      for (const gap of [50, 60, 80, 100]) {
        cfg.envelopeTauMs = tau;
        cfg.syllableProminenceDb = prom;
        cfg.syllableMinGapMs = gap;
        const rates: number[] = [];
        let err = 0;
        for (const [name, truth] of Object.entries(TRUTH)) {
          const all = (await track(name)).slice(Math.round(4 * fps));
          const rate = avgOf(all, 'rate');
          rates.push(rate);
          err += Math.abs(Math.log(rate / truth));
        }
        rows.push({ tau, prom, gap, rates, err });
      }
    }
  }
  rows.sort((a, b) => a.err - b.err);
  console.log('tau  prom  gap   calm(4.1) quiet(3.9) fast(9.2)   err');
  for (const r of rows.slice(0, 15)) {
    console.log(`${String(r.tau).padStart(3)}  ${r.prom.toFixed(1)}  ${String(r.gap).padStart(3)}   ${r.rates.map((x) => x.toFixed(2).padStart(9)).join(' ')}   ${r.err.toFixed(3)}`);
  }
}

// Arguments: sample names, WAV paths, or folders (every WAV inside). No arguments: the
// built-in clips plus everything under recordings/.
const args = process.argv.slice(2).filter((a) => {
  if (a === '--heuristic') { useModels = false; return false; }
  return true;
});
if (args.includes('--sweep')) {
  await sweep();
} else {
  const expand = (a: string): string[] =>
    fs.existsSync(a) && fs.statSync(a).isDirectory()
      ? fs.readdirSync(a).filter((f) => f.toLowerCase().endsWith('.wav')).sort().map((f) => path.join(a, f))
      : [a];
  const REC = path.join(ROOT, 'recordings');
  const all = args.length
    ? args.flatMap(expand)
    : ['calm', 'quiet', 'loud', 'fast', 'crosstalk', 'noisy', ...(fs.existsSync(REC) ? expand(REC) : [])];
  for (const n of all) await timeline(n);
}
