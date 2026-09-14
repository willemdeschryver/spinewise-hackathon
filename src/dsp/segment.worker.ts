/// <reference lib="webworker" />
// Segmentation worker: runs pyannote over the newest few seconds of 16 kHz audio a few times
// per second. It has its own thread so a slow inference never delays the frame-by-frame work
// in the analysis worker. Audio arrives on a MessagePort from the analysis worker; results go
// back on the same port.
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { Segmenter } from './segmenter';
import type { OrtSession } from './ort';

export type SegmentIn =
  | { type: 'init'; port: MessagePort; model: string; windowSec: number; hopSec: number }
  | { type: 'window'; windowSec: number; hopSec: number }
  | { type: 'reset' };

export type SegmentOut = { type: 'ready'; ok: boolean; error?: string };

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;

let session: OrtSession | null = null;
let seg: Segmenter | null = null;
let port: MessagePort | null = null;

const rebuild = (windowSec: number, hopSec: number): void => {
  if (session) seg = new Segmenter(ort, session, windowSec, hopSec);
};

self.onmessage = async (e: MessageEvent<SegmentIn>): Promise<void> => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      port = msg.port;
      port.onmessage = (ev: MessageEvent<Float32Array>) => {
        if (!seg) return;
        seg.push(ev.data);
        if (seg.due) {
          void seg.run().then((r) => port?.postMessage(r)).catch((err) => self.postMessage({ type: 'ready', ok: false, error: String(err) }));
        }
      };
      try {
        session = await ort.InferenceSession.create(msg.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
        rebuild(msg.windowSec, msg.hopSec);
        self.postMessage({ type: 'ready', ok: true } satisfies SegmentOut);
      } catch (err) {
        self.postMessage({ type: 'ready', ok: false, error: String(err) } satisfies SegmentOut);
      }
      break;
    case 'window':
      if (seg && (seg.windowSec !== msg.windowSec || seg.hopSec !== msg.hopSec)) rebuild(msg.windowSec, msg.hopSec);
      break;
    case 'reset':
      seg?.reset();
      break;
  }
};
