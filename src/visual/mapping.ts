import type { Metrics } from '../dsp/metrics';
import { cfg } from '../config';

// What the shader is told each frame. Every field is 0..1 except size (fraction of the short axis)
// and breath (-1..1).
export interface VisualParams {
  size: number;
  breath: number;
  split: number;
  agit: number;
  aurora: number;
  grain: number;
  strain: number;
  voice: number;
  pulse: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const alpha = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

// Maps the readings onto the organism. One reading, one visible behaviour:
// volume is size, pace is breathing rate, overlap splits the body,
// poor clarity lights an aurora around it and grits its surface.
export class VisualMapper {
  readonly params: VisualParams = {
    size: cfg.sizeBase, breath: 0, split: 0, agit: 0, aurora: 0, grain: 0, strain: 0, voice: 0, pulse: 0,
  };
  private phase = 0;
  private pulse = 0;
  private refLevel = -80;

  update(m: Metrics, dt: number): VisualParams {
    let loud01: number, quiet01: number, pace01: number, overlap: number, noise01: number, snrBad: number, strain: number, voice: number;
    if (cfg.sim.on) {
      const s = cfg.sim;
      loud01 = Math.max(0, s.volume);
      quiet01 = Math.max(0, -s.volume);
      pace01 = s.pace;
      overlap = s.overlap;
      noise01 = s.noise;
      snrBad = 0;
      voice = s.voice;
      strain = 1 - (1 - 0.7 * Math.max(loud01, quiet01)) * (1 - 0.8 * pace01) * (1 - overlap) * (1 - 0.8 * noise01);
    } else {
      loud01 = Math.max(0, m.volume);
      quiet01 = Math.max(0, -m.volume);
      pace01 = m.pace;
      overlap = m.voices;
      noise01 = m.noise;
      snrBad = m.snrBad;
      strain = m.strain;
      voice = m.voice;
      if (m.level > this.refLevel + 10 && loud01 > 0.3) this.pulse = 1;
      this.refLevel += alpha(dt, 0.5) * (m.level - this.refLevel);
    }

    const rate = mix(cfg.breathCalmHz, cfg.breathFastHz, Math.pow(pace01, 0.8));
    this.phase += 2 * Math.PI * rate * dt;
    const breath = Math.sin(this.phase) * (1 + 0.5 * pace01);
    this.pulse *= Math.exp(-dt / 0.45);

    const sizeT = cfg.sizeBase
      + loud01 * (cfg.sizeLoud - cfg.sizeBase)
      - quiet01 * (cfg.sizeBase - cfg.sizeQuiet)
      + 0.015 * voice;
    const agitT = clamp01(0.6 * overlap + 0.25 * pace01 + 0.15 * loud01);
    const grainT = clamp01(0.7 * noise01 + 0.5 * snrBad);

    // The body starts to split as soon as overlap is more than a flicker.
    const splitT = clamp01((overlap - 0.2) / 0.6);

    const p = this.params;
    const a = alpha(dt, cfg.visualTau);
    p.size += a * (sizeT - p.size);
    p.split += a * (splitT - p.split);
    p.agit += a * (agitT - p.agit);
    p.aurora += a * (noise01 - p.aurora);
    p.grain += a * (grainT - p.grain);
    p.strain += a * (strain - p.strain);
    p.voice += a * (voice - p.voice);
    p.breath = breath;
    p.pulse = this.pulse;
    return p;
  }
}
