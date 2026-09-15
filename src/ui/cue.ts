import type { Metrics } from '../dsp/metrics';

// The one thing the table could do right now, chosen from the worst reading. A cue
// switches on above `enter`, stays until its reading falls below `leave`, and holds for
// `holdSec` so the room is not nagged by a flickering instruction.
export interface Cue { text: string; severity: number; fine: boolean }

type Kind = 'quiet' | 'loud' | 'rate' | 'run' | 'voices' | 'noise';

const TEXT: Record<Kind, string> = {
  quiet: 'Speak up a little',
  loud: 'A little softer',
  rate: 'Slow down a little',
  run: 'Leave a pause now and then',
  voices: 'One at a time',
  noise: 'Reduce the background noise',
};

const FINE: Cue = { text: 'Easy to follow', severity: 0, fine: true };
const NONE: Cue = { text: '', severity: 0, fine: true };

export class CuePicker {
  private kind: Kind | null = null;
  private since = 0;
  private t = 0;

  constructor(private readonly enter = 0.5, private readonly leave = 0.3, private readonly holdSec = 3) {}

  pick(m: Metrics, dt: number): Cue {
    this.t += dt;
    const recent = m.sinceVoice < 4;
    const byRun = m.status.pace === 'few pauses' || m.status.pace === 'no pauses';
    const sev: Record<Kind, number> = {
      quiet: recent ? Math.max(0, -m.volume) : 0,
      loud: recent ? Math.max(0, m.volume) : 0,
      rate: recent && !byRun ? m.pace : 0,
      run: recent && byRun ? m.pace : 0,
      voices: recent ? m.voices : 0,
      noise: Math.max(m.noise, m.snrBad),
    };

    let worst: Kind = 'quiet';
    for (const k of Object.keys(sev) as Kind[]) if (sev[k] > sev[worst]) worst = k;

    const held = this.t - this.since < this.holdSec;
    if (this.kind) {
      const cur = sev[this.kind];
      if (cur < this.leave && !held) this.kind = null;
      else if (worst !== this.kind && sev[worst] >= this.enter && sev[worst] > cur + 0.15 && !held) this.start(worst);
    }
    if (!this.kind && sev[worst] >= this.enter) this.start(worst);

    if (this.kind) return { text: TEXT[this.kind], severity: sev[this.kind], fine: false };
    return recent ? FINE : NONE;
  }

  private start(kind: Kind): void {
    this.kind = kind;
    this.since = this.t;
  }
}
