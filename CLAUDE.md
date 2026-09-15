# Attune (SpineWise hackathon, September 2026)

Browser-only web app that listens to a meeting room and shows, as one breathing
organism, how hard the room is to follow for someone with hearing loss. Four
readings drive it: volume, pace of speech, people talking over each other, and
background noise. Aimed at the whole table: the hearing people are the ones who
need to see it, so the person with hearing loss no longer has to interrupt and ask.

No backend. Static site, works on a laptop, a tablet on the table, or a projector.

## Run

- `npm install`, then `npm run dev` and open http://localhost:5173
- `npm run dev:lan` serves over https on the LAN so a phone or tablet can use its mic
- `npm run build` type-checks and writes `dist/` (deploy anywhere static)
- `npm run samples` regenerates `public/samples/*.wav` (Windows only: uses the
  built-in speech engine, then `scripts/make-samples.mjs` mixes the clips)

Keys in the app: `t` tune panel, `h` hide all chrome (projection), `f` fullscreen,
`m` microphone, `c` readings bars, `?` the guide, `Esc` closes the menu and the guide.

## Where things are

- `src/audio/engine.ts`: AudioContext, mic / file / sample sources. Everything
  feeds `public/worklet/capture-processor.js`, which batches 1024-sample mono
  chunks to the main thread. Mic is opened with echo cancellation, noise
  suppression and auto gain off, otherwise the browser flattens what we measure.
- `src/main.ts` only renders and forwards: every chunk goes to the analysis
  worker, Metrics come back about 47 times a second.
- `src/dsp/analysis.worker.ts`: per-chunk work. Resamples to 16 kHz
  (`resample.ts`), runs Silero VAD (`vad.ts`, 32 ms speech probability),
  computes the spectral features (`features.ts`: 2048-sample Hann FFT, band
  energies, YIN pitch and clarity, a 5 ms speech-band intensity contour) and
  updates `metrics.ts`. Forwards the 16 kHz audio to the segmentation worker
  over a MessagePort and merges its results.
- `src/dsp/segment.worker.ts`: pyannote segmentation-3.0 (`segmenter.ts`) over
  the newest `segWindowSec` of audio every `segHopSec`. Seven powerset classes
  per 16.9 ms frame (nobody, three single speakers, three pairs); we keep only
  speech share, overlap share and expected speaker count of the newest hop.
  Its own thread, so a slow inference never delays the per-chunk work.
- Models live in `public/models/` (both MIT): `silero_vad.onnx` (2.3 MB, from
  snakers4/silero-vad v5) and `segmentation.onnx` (6 MB, pyannote/segmentation-3.0
  as exported by k2-fsa/sherpa-onnx; `segmentation.int8.onnx` is the smaller
  quantised variant, unused). onnxruntime-web runs them on the WASM backend,
  single-threaded; the wasm binary is imported with `?url` so Vite serves it.
- `src/dsp/metrics.ts`: the slow readings. Speech = Silero probability with
  hysteresis (`vadOn`/`vadOff`) and a 250 ms hold. Noise floor = 5th percentile
  of the last 10 s of frames that are non-speech by the model, unpitched, and
  not right after speech, plus a fast path that jumps the floor within about
  2 s when those frames rise together with a tight spread (steady noise).
  The noise reading compares the floor inside the speech band (300 to 3400 Hz)
  with the loud part of the room's normal speech in that band (`speechPeak`, an
  80th percentile over the last 3 s of talk), so traffic rumble, ventilation
  and a laptop fan do not count and a laptop mic across the table reads a fine
  room as "low" (about 18 dB of headroom in the 2026-09-14 recordings).
  Syllable rate = peaks of the intensity contour (2 dB dips, pitched frames,
  while speech is on), smoothed over `paceSmoothSec`. Overlap = the model's
  overlap share, attack 0.5 s, release 1.5 s. Without the models (load failure)
  the old spectral heuristics take over automatically: speech band above its
  floor for VAD, filled pauses plus residual pitch for overlap. `neural` in
  Metrics says which path is live. Statuses are the sentence-case words in the
  readings strip.
- `scripts/eval.ts`: offline harness with the same modules on onnxruntime-node.
  `npx tsx scripts/eval.ts` runs the built-in clips plus `recordings/` and prints
  a 2 s timeline per clip; `--heuristic` runs the fallback path; `--sweep` fits
  the syllable counter against the clips' known rates. Use it before touching
  thresholds; it is much faster than listening.
- `src/visual/mapping.ts`: readings to shader uniforms, with smoothing. One
  reading, one visible behaviour: volume is size, pace is breathing rate,
  overlap splits the body, poor clarity lights an aurora around it and grits its
  surface, strain shifts the colour from mint to amber to red.
- `src/visual/organism.frag`: the whole picture is one fullscreen fragment
  shader (simplex fbm, smooth-min of two lobes, radial aurora, grain, vignette).
- `src/ui/overlay.ts`: status line, source menu, edge blocks, start screen. One
  block per screen edge, each turned to face that edge so a tablet flat on the table
  reads from every seat. A block shows the action cue (`src/ui/cue.ts`: the worst
  reading above 0.5 becomes "Slow down a little", "One at a time", ..., with
  hysteresis and a 3 s hold) and, when "Show the readings as bars" is on (key `c`,
  remembered in localStorage), the four readings as bar charts.
- `src/ui/i18n.ts`: every visible word in English and Dutch, plus the guided tour
  ("How it works", key `?`): seven steps beside the live organism, each posing it by
  hand through `cfg.sim` with a slider for one reading (volume, pace, voices, noise)
  so the visitor sees what that reading changes; the last step explains the sources
  with "try a clip" buttons. While `cfg.sim.on`, the overlay feeds the cue and the
  bars from the pose (`statusWords` in `metrics.ts`), not from the audio.
  Language comes from localStorage, else the browser, switched live with the EN/NL
  buttons in the header. Status words leave the worker in English and are looked
  up in the overlay, so the worker and the harness never see a language. The Tune
  panel stays English.
- `src/ui/tune.ts`: Tweakpane panel. Live graphs (including `vad`, `speakers`,
  `segMs` inference time), calibration buttons, every threshold from
  `src/config.ts`, and "Drive by hand" to pose the organism without audio. Any
  change is posted to the workers; "I am speaking normally" writes thresholds
  in the worker and posts them back.

## Tuning against real recordings

The sample clips are synthetic. Real rooms add reverb and mic processing, so
tune on recordings made with the demo device in the demo room:

1. In the app: Source, type a label, "Start recording", do the thing for
   15 to 20 s, "Stop and save". The WAV lands in the browser's downloads,
   raw mic audio (no browser processing).
2. Move the files into `recordings/` (gitignored, may hold colleagues'
   voices). Keep the labels honest: `quiet-room`, `one-normal`, `one-fast`,
   `one-far`, `one-loud`, `two-overlap`, `noise-plus-talk`.
3. `npx tsx scripts/eval.ts` prints a timeline for every built-in clip and
   every recording. Adjust `src/config.ts`, re-run, repeat.

## Tuning in the room

Microphone gain differs per device, so volume and noise are judged relative
to the room's normal speech level (`speechRef`), learnt from the first seconds
of talk and drifting slowly after that. In the Tune panel: "The room is quiet
now" resets the floor, "I am speaking normally" pins the reference to the
voice at the table. Pace has two halves: syllables per second (from the
intensity contour) and seconds of talk without a pause of 0.35 s or more
(`run`), because a listener with hearing loss needs the gaps. Real recordings
(`recordings/`, 2026-09-14) showed a speaker asked to "talk fast" does not
change syllable rate much (5.4 vs 5.3 per second) but drops the pauses.

## Conventions

- Vanilla TypeScript, no framework. DSP and models run in workers, in typed
  modules that also run under Node for the harness; the worklet only captures.
- All tunables live in `src/config.ts` and appear in the Tune panel.
- No generated docs in this repo. Plans and notes go to
  `~/Contexts/pro/spinewise/work/`.
