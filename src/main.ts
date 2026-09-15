import './styles.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';

import { AudioEngine } from './audio/engine';
import { encodeWav, downloadBlob } from './audio/wav';
import { MetricsTracker, type Metrics } from './dsp/metrics';
import type { AnalysisIn, AnalysisOut } from './dsp/analysis.worker';
import type { SegmentIn, SegmentOut } from './dsp/segment.worker';
import { VisualMapper } from './visual/mapping';
import { Renderer } from './visual/renderer';
import { Overlay, sampleName, type Sample } from './ui/overlay';
import { t } from './ui/i18n';
import { createTunePane, type Live } from './ui/tune';
import { cfg } from './config';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const engine = new AudioEngine();
const mapper = new VisualMapper();

let metrics: Metrics = MetricsTracker.idle();
type ModelState = 'loading' | 'ready' | 'failed';
const models: { vad: ModelState; seg: ModelState } = { vad: 'loading', seg: 'loading' };

// All analysis runs in two workers: one per audio chunk (features, speech detection, the
// readings), one for the slower speaker segmentation. They talk to each other directly.
const analysis = new Worker(new URL('./dsp/analysis.worker.ts', import.meta.url), { type: 'module' });
const segment = new Worker(new URL('./dsp/segment.worker.ts', import.meta.url), { type: 'module' });
const sendA = (msg: AnalysisIn, transfer: Transferable[] = []): void => analysis.postMessage(msg, transfer);
const sendS = (msg: SegmentIn, transfer: Transferable[] = []): void => segment.postMessage(msg, transfer);
const modelUrl = (file: string): string => new URL(`${import.meta.env.BASE_URL}models/${file}`, document.baseURI).href;
const channel = new MessageChannel();
sendA({ type: 'init', segPort: channel.port1, vadModel: modelUrl('silero_vad.onnx'), cfg: structuredClone(cfg) }, [channel.port1]);
sendS({ type: 'init', port: channel.port2, model: modelUrl('segmentation.onnx'), windowSec: cfg.segWindowSec, hopSec: cfg.segHopSec }, [channel.port2]);

analysis.onmessage = (e: MessageEvent<AnalysisOut>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'metrics': metrics = msg.m; break;
    case 'ready':
      models.vad = msg.vad ? 'ready' : 'failed';
      if (!msg.vad) overlay.setStatus(`Speech model failed to load: ${msg.error}`);
      break;
    case 'cfg': Object.assign(cfg, msg.cfg); pane.refresh(); break;
    case 'error': overlay.setStatus(`Analysis stopped: ${msg.message}`); break;
  }
};
segment.onmessage = (e: MessageEvent<SegmentOut>) => {
  models.seg = e.data.ok ? 'ready' : 'failed';
  if (!e.data.ok) overlay.setStatus(`Voices model failed to load: ${e.data.error}`);
};
analysis.onerror = segment.onerror = (e: ErrorEvent) => overlay.setStatus(`Worker error: ${e.message}`);

// Raw microphone recording, saved as WAV for tuning against real rooms.
let recChunks: Float32Array[] | null = null;
let recRate = 48000;
let recStart = 0;

engine.onChunk = (chunk, sampleRate) => {
  if (recChunks && engine.kind === 'mic') {
    recChunks.push(Float32Array.from(chunk));
    recRate = sampleRate;
  }
  sendA({ type: 'audio', chunk, sampleRate }, [chunk.buffer]);
};

const toggleRecord = async (label: string): Promise<void> => {
  if (recChunks) {
    const chunks = recChunks;
    recChunks = null;
    overlay.setRecording(null);
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';
    const file = `attune-${safe}-${stamp}.wav`;
    downloadBlob(encodeWav(chunks, recRate), file);
    const s = (chunks.length * 1024 / recRate).toFixed(0);
    overlay.setStatus(() => t('saved', { file, s }));
    return;
  }
  if (engine.kind !== 'mic') await engine.useMic();
  recChunks = [];
  recStart = performance.now();
  overlay.setRecording(0);
};

engine.onSourceChange = () => {
  sendA({ type: 'reset' });
  sendS({ type: 'reset' });
  if (engine.kind === 'none') {
    metrics = MetricsTracker.idle();
    overlay.setStatus(() => t('notListening'));
  } else {
    overlay.setStatus(sourceStatus);
    overlay.began();
  }
};

// What the status line says while a source is live, in the current language.
let sourceStatus: () => string = () => '';

const busy = async (label: () => string, run: () => Promise<void>): Promise<void> => {
  overlay.setStatus(label);
  try {
    await run();
  } catch (err) {
    const e = err as DOMException;
    if (e.name === 'NotAllowedError') {
      overlay.setStatus(() => t('micBlocked'));
    } else if (e.name === 'NotFoundError') {
      overlay.setStatus(() => t('micMissing'));
    } else {
      overlay.setStatus(() => t('couldNotStart', { error: e.message ?? String(e) }));
    }
  }
};

const overlay = new Overlay({
  onMic: () => void busy(() => t('askingMic'), async () => {
    await engine.useMic();
    sourceStatus = () => engine.deviceName ? t('listeningThrough', { name: engine.deviceName }) : t('listeningRoom');
    overlay.setStatus(sourceStatus);
  }),
  onFile: (file) => void busy(() => t('loadingFile', { name: file.name }), async () => {
    sourceStatus = () => t('playing', { name: file.name });
    await engine.useFile(file);
  }),
  onSample: (s: Sample) => void busy(() => t('loadingClip'), async () => {
    sourceStatus = () => t('playing', { name: sampleName(s) });
    await engine.useUrl(`${import.meta.env.BASE_URL}samples/${s.id}.wav`);
  }),
  onMonitor: (on) => engine.setMonitor(on),
  onToggleTune: () => { tuneHost.hidden = !tuneHost.hidden; },
  onRecord: (label) => void busy(() => t('startingRecording'), () => toggleRecord(label)),
});

const tuneHost = document.getElementById('tune') as HTMLElement;
const live: Live = {
  level: -90, noiseFloor: -90, speechFloor: -90, speechPeak: -90, speechLevel: -90, vad: 0, rate: 0, clarity: 0, overlap: 0, speakers: 0,
  segMs: 0, f0: 0, second: 0, fill: 0, strain: 0,
};
const pane = createTunePane(tuneHost, live, {
  calibrateQuiet: () => sendA({ type: 'calibrateQuiet' }),
  calibrateSpeech: () => sendA({ type: 'calibrateSpeech' }),
  changed: () => {
    sendA({ type: 'cfg', cfg: structuredClone(cfg) });
    sendS({ type: 'window', windowSec: cfg.segWindowSec, hopSec: cfg.segHopSec });
  },
});

// On a phone held upright the start card and the tour cover the lower half of the screen,
// so the body moves up while one of them is showing.
const startEl = document.getElementById('start') as HTMLElement;
const tourEl = document.getElementById('tour') as HTMLElement;
const wantedShift = (): number =>
  window.innerHeight > window.innerWidth * 1.3 && (!startEl.hidden || !tourEl.hidden) ? 0.45 : 0;
let shift = wantedShift();

let last = performance.now();
const frame = (now: number): void => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  shift += (1 - Math.exp(-dt / 0.5)) * (wantedShift() - shift);
  const p = mapper.update(metrics, dt);
  renderer.render(now / 1000, p, shift);
  overlay.tick(metrics, dt);
  if (recChunks) overlay.setRecording((now - recStart) / 1000);
  live.level = metrics.level;
  live.noiseFloor = metrics.noiseFloor;
  live.speechFloor = metrics.speechFloor;
  live.speechPeak = metrics.speechPeak;
  live.speechLevel = metrics.speechLevel;
  live.vad = metrics.vad;
  live.rate = metrics.rate;
  live.clarity = metrics.clarity;
  live.overlap = metrics.overlap;
  live.speakers = metrics.speakers;
  live.segMs = metrics.segMs;
  live.f0 = metrics.f0;
  live.second = metrics.second;
  live.fill = metrics.fill;
  live.strain = metrics.strain;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

// Debug handle for the console and for automated checks.
Object.defineProperty(window, '__attune', {
  value: { get metrics() { return metrics; }, get params() { return mapper.params; }, cfg, engine, models },
});
