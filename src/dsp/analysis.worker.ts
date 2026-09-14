/// <reference lib="webworker" />
// Analysis worker: everything between raw audio and the readings runs here, so the render
// loop on the main thread never waits for DSP or model inference. Audio chunks come in,
// Metrics go out. 16 kHz audio is forwarded to the segmentation worker over a MessagePort,
// which sends its results back on the same port.
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { FrameAnalyzer } from './features';
import { MetricsTracker, type Metrics } from './metrics';
import { Resampler } from './resample';
import { SileroVad } from './vad';
import type { Segmentation } from './segmenter';
import { cfg, type Config } from '../config';

export type AnalysisIn =
  | { type: 'init'; segPort: MessagePort; vadModel: string; cfg: Config }
  | { type: 'audio'; chunk: Float32Array; sampleRate: number }
  | { type: 'cfg'; cfg: Config }
  | { type: 'reset' }
  | { type: 'calibrateQuiet' }
  | { type: 'calibrateSpeech' };

export type AnalysisOut =
  | { type: 'ready'; vad: boolean; error?: string }
  | { type: 'metrics'; m: Metrics }
  | { type: 'cfg'; cfg: Config }
  | { type: 'error'; message: string };

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;

const post = (msg: AnalysisOut): void => self.postMessage(msg);

let analyzer: FrameAnalyzer | null = null;
let tracker: MetricsTracker | null = null;
let resampler: Resampler | null = null;
let vad: SileroVad | null = null;
let segPort: MessagePort | null = null;
let pendingSeg: Segmentation | null = null;
let queue: Promise<void> = Promise.resolve();

async function loadVad(url: string): Promise<void> {
  try {
    const session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    vad = new SileroVad(ort, session);
    post({ type: 'ready', vad: true });
  } catch (err) {
    post({ type: 'ready', vad: false, error: String(err) });
  }
}

async function handleAudio(chunk: Float32Array, sampleRate: number): Promise<void> {
  if (!analyzer || !tracker || !resampler || analyzer.sampleRate !== sampleRate) {
    analyzer = new FrameAnalyzer(sampleRate);
    tracker = new MetricsTracker(sampleRate / chunk.length);
    resampler = new Resampler(sampleRate, 16000);
    vad?.reset();
  }
  const x16 = resampler.push(chunk).slice();
  if (segPort && x16.length) segPort.postMessage(x16);
  let vadProb: number | undefined;
  if (vad) {
    const probs = await vad.push(x16);
    vadProb = probs.length ? Math.max(...probs) : vad.probability;
  }
  const f = analyzer.analyze(chunk);
  if (!f) return;
  const seg = pendingSeg;
  pendingSeg = null;
  post({ type: 'metrics', m: tracker.update(f, { vad: vadProb, seg }) });
}

self.onmessage = (e: MessageEvent<AnalysisIn>): void => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      Object.assign(cfg, msg.cfg);
      segPort = msg.segPort;
      segPort.onmessage = (ev: MessageEvent<Segmentation>) => { pendingSeg = ev.data; };
      void loadVad(msg.vadModel);
      break;
    case 'audio':
      queue = queue
        .then(() => handleAudio(msg.chunk, msg.sampleRate))
        .catch((err) => post({ type: 'error', message: String(err) }));
      break;
    case 'cfg':
      Object.assign(cfg, msg.cfg);
      break;
    case 'reset':
      tracker?.reset();
      vad?.reset();
      pendingSeg = null;
      break;
    case 'calibrateQuiet':
      tracker?.calibrateQuiet();
      break;
    case 'calibrateSpeech':
      tracker?.calibrateSpeech();
      post({ type: 'cfg', cfg });
      break;
  }
};
