import type { Metrics } from '../dsp/metrics';

export interface Sample { id: string; name: string }

export const SAMPLES: Sample[] = [
  { id: 'story', name: 'A meeting: calm, then fast, then crosstalk, then noise' },
  { id: 'calm', name: 'Calm, one person' },
  { id: 'quiet', name: 'Too quiet' },
  { id: 'loud', name: 'Too loud' },
  { id: 'fast', name: 'Fast talker' },
  { id: 'crosstalk', name: 'Two people at once' },
  { id: 'noisy', name: 'Background noise' },
];

export interface OverlayHandlers {
  onMic(): void;
  onFile(file: File): void;
  onSample(sample: Sample): void;
  onMonitor(on: boolean): void;
  onToggleTune(): void;
  onRecord(label: string): void;
}

type Key = 'volume' | 'pace' | 'voices' | 'noise';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

// The typographic chrome around the organism: status line, source menu, the four readings.
export class Overlay {
  private readonly status = $('#status');
  private readonly start = $('#start');
  private readonly readings = $('#readings');
  private readonly menu = $('#menu');
  private readonly menuButton = $<HTMLButtonElement>('#btn-source');
  private readonly tuneButton = $<HTMLButtonElement>('#btn-tune');
  private readonly fileInput = $<HTMLInputElement>('#file');
  private readonly recordButton = $<HTMLButtonElement>('#btn-record');
  private readonly recordLabel = $<HTMLInputElement>('#rec-label');
  private readonly cells: Record<Key, { value: HTMLElement; bar: HTMLElement }>;
  private acc = 0;
  private tuneOpen = false;
  private recordShown = -1;

  constructor(private readonly h: OverlayHandlers) {
    this.cells = {} as Record<Key, { value: HTMLElement; bar: HTMLElement }>;
    for (const k of ['volume', 'pace', 'voices', 'noise'] as Key[]) {
      const cell = $(`.reading[data-k="${k}"]`);
      this.cells[k] = { value: cell.querySelector('.value')!, bar: cell.querySelector('.bar')! };
    }

    $('#btn-mic').addEventListener('click', () => h.onMic());
    $('#btn-sample').addEventListener('click', () => h.onSample(SAMPLES[0]));
    this.menuButton.addEventListener('click', () => this.toggleMenu());
    this.tuneButton.addEventListener('click', () => this.toggleTune());
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (f) h.onFile(f);
      this.fileInput.value = '';
    });
    $('#chk-monitor').addEventListener('change', (e) => h.onMonitor((e.target as HTMLInputElement).checked));

    const samples = $('#menu-samples');
    for (const s of SAMPLES) {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.textContent = s.name;
      b.addEventListener('click', () => { this.closeMenu(); h.onSample(s); });
      samples.appendChild(b);
    }
    this.menu.querySelector('[data-src="mic"]')!.addEventListener('click', () => { this.closeMenu(); h.onMic(); });
    this.menu.querySelector('[data-src="file"]')!.addEventListener('click', () => { this.closeMenu(); this.fileInput.click(); });
    this.recordButton.addEventListener('click', () => h.onRecord(this.recordLabel.value.trim() || 'room'));

    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && e.target !== this.menuButton) this.closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'Escape': this.closeMenu(); break;
        case 't': this.toggleTune(); break;
        case 'h': document.body.classList.toggle('bare'); break;
        case 'f': this.toggleFullscreen(); break;
        case 'm': h.onMic(); break;
      }
    });
  }

  private toggleMenu(): void {
    if (this.menu.hidden) {
      this.menu.hidden = false;
      this.menuButton.setAttribute('aria-expanded', 'true');
    } else {
      this.closeMenu();
    }
  }

  private closeMenu(): void {
    this.menu.hidden = true;
    this.menuButton.setAttribute('aria-expanded', 'false');
  }

  private toggleTune(): void {
    this.tuneOpen = !this.tuneOpen;
    this.tuneButton.setAttribute('aria-pressed', String(this.tuneOpen));
    this.h.onToggleTune();
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  // null when not recording, otherwise elapsed seconds.
  setRecording(seconds: number | null): void {
    const shown = seconds === null ? -1 : Math.floor(seconds);
    if (shown === this.recordShown) return;
    this.recordShown = shown;
    this.recordButton.classList.toggle('recording', seconds !== null);
    this.recordButton.textContent = seconds === null ? 'Start recording' : `Stop and save (${shown} s)`;
  }

  began(): void {
    this.start.hidden = true;
    this.readings.hidden = false;
  }

  tick(m: Metrics, dt: number): void {
    this.acc += dt;
    if (this.acc < 0.12) return;
    this.acc = 0;
    this.readings.classList.toggle('idle', m.sinceVoice > 4);
    this.set('volume', m.status.volume, Math.abs(m.volume));
    this.set('pace', m.sinceVoice < 4 ? m.status.pace + ' ' + m.rate.toFixed(1) + '/s' : m.status.pace, m.pace);
    this.set('voices', m.status.voices, m.voices);
    this.set('noise', m.status.noise, Math.max(m.noise, m.snrBad));
  }

  private set(k: Key, text: string, severity: number): void {
    const c = this.cells[k];
    if (c.value.textContent !== text) c.value.textContent = text;
    c.bar.style.setProperty('--sev', severity.toFixed(3));
  }
}
