import { Pane } from 'tweakpane';
import { cfg } from '../config';

// Live numbers the graphs watch. Updated every frame from the latest metrics.
export interface Live {
  level: number;
  noiseFloor: number;
  speechFloor: number;
  speechPeak: number;
  speechLevel: number;
  vad: number;
  rate: number;
  clarity: number;
  overlap: number;
  speakers: number;
  segMs: number;
  f0: number;
  second: number;
  fill: number;
  strain: number;
}

export interface TuneActions {
  calibrateQuiet(): void;
  calibrateSpeech(): void;
  changed(): void; // any threshold moved: the analysis worker needs the new config
}

export function createTunePane(container: HTMLElement, live: Live, actions: TuneActions): Pane {
  const pane = new Pane({ container, title: 'Tune' });

  const read = pane.addFolder({ title: 'Readings' });
  const graph = (key: keyof Live, min: number, max: number): void => {
    read.addBinding(live, key, { readonly: true, view: 'graph', min, max, interval: 60 });
  };
  graph('level', -90, 0);
  graph('speechLevel', -90, 0);
  graph('noiseFloor', -90, 0);
  graph('speechFloor', -90, 0);
  graph('speechPeak', -90, 0);
  graph('vad', 0, 1);
  graph('rate', 0, 9);
  graph('overlap', 0, 1);
  graph('speakers', 0, 3);
  graph('segMs', 0, 400);
  graph('clarity', 0, 1);
  graph('f0', 0, 400);
  graph('second', 0, 1);
  graph('fill', 0, 1);
  graph('strain', 0, 1);

  const cal = pane.addFolder({ title: 'Calibrate' });
  cal.addButton({ title: 'The room is quiet now' }).on('click', () => actions.calibrateQuiet());
  cal.addButton({ title: 'I am speaking normally' }).on('click', () => actions.calibrateSpeech());

  const listen = pane.addFolder({ title: 'Listening', expanded: false });
  listen.addBinding(cfg, 'vadOn', { min: 0.1, max: 0.95, step: 0.01 });
  listen.addBinding(cfg, 'vadOff', { min: 0.05, max: 0.9, step: 0.01 });
  listen.addBinding(cfg, 'vadNoiseMax', { min: 0.02, max: 0.6, step: 0.01 });
  listen.addBinding(cfg, 'vadHoldMs', { min: 50, max: 800, step: 10 });
  listen.addBinding(cfg, 'segWindowSec', { min: 1.5, max: 10, step: 0.5 });
  listen.addBinding(cfg, 'segHopSec', { min: 0.1, max: 1, step: 0.05 });

  const vol = pane.addFolder({ title: 'Volume and noise', expanded: false });
  vol.addBinding(cfg, 'volQuietDb', { min: -30, max: 0, step: 1 });
  vol.addBinding(cfg, 'volLoudDb', { min: 0, max: 30, step: 1 });
  vol.addBinding(cfg, 'noiseQuietDb', { min: -50, max: -5, step: 1 });
  vol.addBinding(cfg, 'noiseLoudDb', { min: -30, max: 5, step: 1 });
  vol.addBinding(cfg, 'noiseWideQuietDb', { min: -40, max: 0, step: 1 });
  vol.addBinding(cfg, 'noiseWideLoudDb', { min: -30, max: 10, step: 1 });
  vol.addBinding(cfg, 'snrGood', { min: 5, max: 40, step: 1 });
  vol.addBinding(cfg, 'snrBad', { min: 0, max: 20, step: 1 });
  vol.addBinding(cfg, 'floorWindowSec', { min: 3, max: 40, step: 1 });
  vol.addBinding(cfg, 'floorRiseDb', { min: 2, max: 20, step: 0.5 });
  vol.addBinding(cfg, 'floorFastSpreadDb', { min: 1, max: 20, step: 0.5 });

  const pace = pane.addFolder({ title: 'Pace', expanded: false });
  pace.addBinding(cfg, 'paceSteady', { min: 2, max: 9, step: 0.1 });
  pace.addBinding(cfg, 'paceFast', { min: 3, max: 12, step: 0.1 });
  pace.addBinding(cfg, 'paceSmoothSec', { min: 0.3, max: 5, step: 0.1 });
  pace.addBinding(cfg, 'runSteadySec', { min: 1, max: 15, step: 0.5 });
  pace.addBinding(cfg, 'runFastSec', { min: 2, max: 30, step: 0.5 });
  pace.addBinding(cfg, 'syllableProminenceDb', { min: 0.5, max: 8, step: 0.1 });
  pace.addBinding(cfg, 'syllableMinGapMs', { min: 40, max: 250, step: 5 });
  pace.addBinding(cfg, 'syllableVoicedMin', { min: 0, max: 0.9, step: 0.01 });
  pace.addBinding(cfg, 'envelopeTauMs', { min: 10, max: 80, step: 1 });

  const ov = pane.addFolder({ title: 'Overlap', expanded: false });
  ov.addBinding(cfg, 'overlapAttackSec', { min: 0.1, max: 3, step: 0.05 });
  ov.addBinding(cfg, 'overlapReleaseSec', { min: 0.2, max: 6, step: 0.05 });
  ov.addBinding(cfg, 'overlapFill', { min: 0, max: 1, step: 0.05, label: 'fallback: fill' });
  ov.addBinding(cfg, 'fillRelHigh', { min: 0.3, max: 1, step: 0.01 });
  ov.addBinding(cfg, 'fillRelLow', { min: 0.1, max: 0.9, step: 0.01 });
  ov.addBinding(cfg, 'fillSnrMin', { min: 0, max: 30, step: 1 });
  ov.addBinding(cfg, 'overlapSecondPitch', { min: 0, max: 1, step: 0.05, label: 'fallback: second' });
  ov.addBinding(cfg, 'overlapClarity', { min: 0, max: 1, step: 0.05, label: 'fallback: clarity' });
  ov.addBinding(cfg, 'overlapJump', { min: 0, max: 1, step: 0.05, label: 'fallback: jumps' });

  const look = pane.addFolder({ title: 'Look', expanded: false });
  look.addBinding(cfg, 'breathCalmHz', { min: 0.03, max: 0.4, step: 0.01 });
  look.addBinding(cfg, 'breathFastHz', { min: 0.2, max: 1.5, step: 0.01 });
  look.addBinding(cfg, 'sizeBase', { min: 0.1, max: 0.5, step: 0.005 });
  look.addBinding(cfg, 'sizeLoud', { min: 0.2, max: 0.6, step: 0.005 });
  look.addBinding(cfg, 'sizeQuiet', { min: 0.05, max: 0.3, step: 0.005 });
  look.addBinding(cfg, 'visualTau', { min: 0.05, max: 2, step: 0.01 });

  const sim = pane.addFolder({ title: 'Drive by hand', expanded: false });
  sim.addBinding(cfg.sim, 'on', { label: 'take over' });
  sim.addBinding(cfg.sim, 'volume', { min: -1, max: 1, step: 0.01 });
  sim.addBinding(cfg.sim, 'pace', { min: 0, max: 1, step: 0.01 });
  sim.addBinding(cfg.sim, 'overlap', { min: 0, max: 1, step: 0.01 });
  sim.addBinding(cfg.sim, 'noise', { min: 0, max: 1, step: 0.01 });
  sim.addBinding(cfg.sim, 'voice', { min: 0, max: 1, step: 0.01 });

  pane.on('change', () => actions.changed());
  return pane;
}
