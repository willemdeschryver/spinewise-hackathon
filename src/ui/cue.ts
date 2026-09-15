import type { Metrics } from '../dsp/metrics';

// The one thing the table could do right now, chosen from the worst reading. A cue
// switches on above `enter`, stays until its reading falls below `leave`, and holds for
// `holdSec` so the room is not nagged by a flickering instruction.
export type CueKind = 'quiet' | 'loud' | 'rate' | 'run' | 'voices' | 'noise';

// kind null: nothing to say. fine: the room is easy to follow (shown dimly) or silent.
export interface Cue { kind: CueKind | null; severity: number; fine: boolean }

const FINE: Cue = { kind: null, severity: 0, fine: true };
const NONE: Cue = { kind: null, severity: 0, fine: false };

export class CuePicker {
  private kind: CueKind | null = null;
  private since = 0;
  private t = 0;

  constructor(private readonly enter = 0.5, private readonly leave = 0.3, private readonly holdSec = 3) {}

  pick(m: Metrics, dt: number): Cue {
    this.t += dt;
    const recent = m.sinceVoice < 4;
    const byRun = m.status.pace === 'few pauses' || m.status.pace === 'no pauses';
    const sev: Record<CueKind, number> = {
      quiet: recent ? Math.max(0, -m.volume) : 0,
      loud: recent ? Math.max(0, m.volume) : 0,
      rate: recent && !byRun ? m.pace : 0,
      run: recent && byRun ? m.pace : 0,
      voices: recent ? m.voices : 0,
      noise: Math.max(m.noise, m.snrBad),
    };

    let worst: CueKind = 'quiet';
    for (const k of Object.keys(sev) as CueKind[]) if (sev[k] > sev[worst]) worst = k;

    const held = this.t - this.since < this.holdSec;
    if (this.kind) {
      const cur = sev[this.kind];
      if (cur < this.leave && !held) this.kind = null;
      else if (worst !== this.kind && sev[worst] >= this.enter && sev[worst] > cur + 0.15 && !held) this.start(worst);
    }
    if (!this.kind && sev[worst] >= this.enter) this.start(worst);

    if (this.kind) return { kind: this.kind, severity: sev[this.kind], fine: false };
    return recent ? FINE : NONE;
  }

  private start(kind: CueKind): void {
    this.kind = kind;
    this.since = this.t;
  }
}
