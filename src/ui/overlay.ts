import { statusWords, type Metrics } from '../dsp/metrics';
import { cfg } from '../config';
import { CuePicker, type CueKind } from './cue';
import { initLang, lang, onLang, setLang, t, tStatus, tourSteps, type Key, type Lang, type TourStep } from './i18n';

export interface Sample { id: string }

export const SAMPLES: Sample[] = [
  { id: 'story' }, { id: 'calm' }, { id: 'quiet' }, { id: 'loud' }, { id: 'fast' }, { id: 'crosstalk' }, { id: 'noisy' },
];

export const sampleName = (s: Sample): string => t(`sample:${s.id}` as Key);

export interface OverlayHandlers {
  onMic(): void;
  onFile(file: File): void;
  onSample(sample: Sample): void;
  onMonitor(on: boolean): void;
  onToggleTune(): void;
  onRecord(label: string): void;
}

type ReadingKey = 'volume' | 'pace' | 'voices' | 'noise';
type Side = 'bottom' | 'top' | 'left' | 'right';

const KEYS: ReadingKey[] = ['volume', 'pace', 'voices', 'noise'];
const SIDES: Side[] = ['bottom', 'top', 'left', 'right'];
// How long the cue takes to fade out before its text changes; matches .cue.out in the CSS.
const CUE_FADE_MS = 900;

const CUE_KEY: Record<CueKind, Key> = { quiet: 'cueQuiet', loud: 'cueLoud', rate: 'cueRate', run: 'cueRun', voices: 'cueVoices', noise: 'cueNoise' };

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

// The typographic chrome around the organism: status line, source menu, the tour, and
// one edge block per side of the screen, turned to face that side so a tablet lying flat
// on the table reads correctly from every seat. Each block carries the action cue (the
// one thing the table could do now) and, when the charts overlay is on, the four readings
// as bars. Everything visible is in English or Dutch, switched live.
//
// The tour takes the organism over through cfg.sim (the same hook as "Drive by hand" in
// the Tune panel) so the visitor can drag one reading and watch the shape, the cue and
// the bars respond, with or without a source running.
export class Overlay {
  private readonly status = $('#status');
  private readonly start = $('#start');
  private readonly readings = $('#readings');
  private readonly menu = $('#menu');
  private readonly tour = $('#tour');
  private readonly tourRange = $<HTMLInputElement>('#tour-range');
  private readonly menuButton = $<HTMLButtonElement>('#btn-source');
  private readonly tuneButton = $<HTMLButtonElement>('#btn-tune');
  private readonly fileInput = $<HTMLInputElement>('#file');
  private readonly recordButton = $<HTMLButtonElement>('#btn-record');
  private readonly recordLabel = $<HTMLInputElement>('#rec-label');
  private readonly chartsCheck = $<HTMLInputElement>('#chk-charts');
  private readonly cells: Record<ReadingKey, { label: HTMLElement; value: HTMLElement; bar: HTMLElement }[]>;
  private readonly cues: HTMLElement[] = [];
  private readonly sampleButtons: HTMLButtonElement[] = [];
  private readonly picker = new CuePicker();
  private statusText: () => string = () => t('notListeningYet');
  private cueKey: Key | '' = '';      // the text in the DOM right now
  private cueFadeSince = 0;           // when the cue started fading out, 0 while it is not
  private acc = 0;
  private tuneOpen = false;
  private recordSeconds: number | null = null;
  private live = false;          // a source has started
  private tourStep: number | null = null;
  private tourLive = false;           // the step's reading follows the microphone, not the slider

  constructor(private readonly h: OverlayHandlers) {
    initLang();
    this.cells = { volume: [], pace: [], voices: [], noise: [] };
    for (const side of SIDES) {
      const edge = document.createElement('section');
      edge.className = 'edge';
      edge.dataset.side = side;
      if (side !== 'bottom') edge.setAttribute('aria-hidden', 'true');
      const cue = document.createElement('div');
      cue.className = 'cue';
      cue.setAttribute('aria-live', side === 'bottom' ? 'polite' : 'off');
      this.cues.push(cue);
      const strip = document.createElement('div');
      strip.className = 'readings';
      edge.append(cue, strip);
      for (const k of KEYS) {
        const cell = document.createElement('div');
        cell.className = 'reading';
        cell.dataset.k = k;
        cell.innerHTML = '<span class="label"></span><span class="value"></span><span class="bar"></span>';
        this.cells[k].push({ label: cell.querySelector('.label')!, value: cell.querySelector('.value')!, bar: cell.querySelector('.bar')! });
        strip.appendChild(cell);
      }
      this.readings.appendChild(edge);
    }
    let charts = false;
    try { charts = localStorage.getItem('attune.charts') === '1'; } catch { /* storage blocked */ }
    this.setCharts(charts);
    this.chartsCheck.addEventListener('change', () => this.setCharts(this.chartsCheck.checked));

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
      b.addEventListener('click', () => { this.closeMenu(); h.onSample(s); });
      samples.appendChild(b);
      this.sampleButtons.push(b);
    }
    this.menu.querySelector('[data-src="mic"]')!.addEventListener('click', () => { this.closeMenu(); h.onMic(); });
    this.menu.querySelector('[data-src="file"]')!.addEventListener('click', () => { this.closeMenu(); this.fileInput.click(); });
    this.recordButton.addEventListener('click', () => h.onRecord(this.recordLabel.value.trim() || 'room'));

    for (const b of document.querySelectorAll<HTMLButtonElement>('.lang button')) {
      b.addEventListener('click', () => setLang(b.dataset.lang as Lang));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-open-guide]')) {
      b.addEventListener('click', () => { this.closeMenu(); this.openGuide(); });
    }
    $('#btn-tour-close').addEventListener('click', () => this.endTour());
    $('#btn-tour-back').addEventListener('click', () => this.showStep(this.tourStep! - 1));
    $('#btn-tour-next').addEventListener('click', () => {
      if (this.tourStep! + 1 < tourSteps().length) this.showStep(this.tourStep! + 1);
      else this.endTour();
    });
    this.tourRange.addEventListener('input', () => this.pose());
    $('#btn-tour-live').addEventListener('click', () => this.setTourLive(!this.tourLive));
    const tryButtons = $('#tour-sample-buttons');
    for (const s of SAMPLES) {
      const b = document.createElement('button');
      b.addEventListener('click', () => { this.endTour(); h.onSample(s); });
      tryButtons.appendChild(b);
      this.sampleButtons.push(b);
    }

    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && e.target !== this.menuButton) this.closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'Escape': this.closeMenu(); this.endTour(); break;
        case 't': this.toggleTune(); break;
        case 'h': document.body.classList.toggle('bare'); break;
        case 'c': this.setCharts(!this.chartsCheck.checked); break;
        case 'f': this.toggleFullscreen(); break;
        case 'm': h.onMic(); break;
        case '?': this.openGuide(); break;
      }
    });

    onLang(() => this.renderLang());
    this.renderLang();
  }

  // Everything static, plus whatever dynamic text is cached, in the current language.
  private renderLang(): void {
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as Key);
    for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh as Key);
    for (const b of document.querySelectorAll<HTMLButtonElement>('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang()));
    this.sampleButtons.forEach((b, i) => { b.textContent = sampleName(SAMPLES[i % SAMPLES.length]); });
    for (const k of KEYS) for (const c of this.cells[k]) c.label.textContent = t(k);
    this.status.textContent = this.statusText();
    this.renderRecord();
    if (this.tourStep !== null) this.showStep(this.tourStep, true);
    this.cueKey = '';
    this.acc = 1; // redraw the readings and the cue on the next tick
  }

  private openGuide(): void {
    if (this.tourStep !== null) return;
    this.closeMenu();
    this.start.hidden = true;
    this.readings.hidden = false;
    this.tour.hidden = false;
    this.showStep(0);
  }

  private endTour(): void {
    if (this.tourStep === null) return;
    this.tourStep = null;
    this.tour.hidden = true;
    this.setTourLive(false);
    cfg.sim.on = false;
    if (!this.live) {
      this.start.hidden = false;
      this.readings.hidden = true;
    }
  }

  // keepSlider: re-rendering for a language switch, so the visitor's slider stays put.
  private showStep(i: number, keepSlider = false): void {
    const steps = tourSteps();
    const step: TourStep = steps[i];
    this.tourStep = i;
    $('#tour-step').textContent = t('tourStep', { n: i + 1, total: steps.length });
    $('#tour-title').textContent = step.title;
    $('#tour-text').textContent = step.text;
    $('#btn-tour-back').hidden = i === 0;
    $('#btn-tour-next').textContent = i + 1 < steps.length ? t('tourNext') : t('tourDone');

    const control = $('#tour-control');
    control.hidden = !step.control;
    if (step.control) {
      $('#tour-low').textContent = step.low ?? '';
      $('#tour-high').textContent = step.high ?? '';
      this.tourRange.min = step.control === 'volume' ? '-1' : '0';
      if (!keepSlider) this.tourRange.value = String(step.pose ?? 0);
      this.renderTourLive();
    }

    const terms = $('#tour-terms');
    terms.replaceChildren();
    for (const line of step.terms ?? []) {
      const [term, ...rest] = line.split(': ');
      const p = document.createElement('p');
      const b = document.createElement('b');
      b.textContent = term + ':';
      p.append(b, ' ', rest.join(': '));
      terms.appendChild(p);
    }
    $('#tour-samples').hidden = !step.samples;
    this.pose();
  }

  // Live input for the step: the reading under test comes from the room instead of the
  // slider, which then just shows it. The other readings stay at rest, so what the visitor
  // does (talk louder, clap, talk over someone) shows up in exactly one behaviour.
  private setTourLive(on: boolean): void {
    if (on === this.tourLive) return;
    this.tourLive = on;
    this.renderTourLive();
    if (on && !this.live) this.h.onMic();
    this.pose();
  }

  private renderTourLive(): void {
    const b = $('#btn-tour-live');
    b.setAttribute('aria-pressed', String(this.tourLive));
    b.textContent = this.tourLive ? t('tourSlider') : t('tourLive');
    this.tourRange.disabled = this.tourLive;
  }

  private liveValue(m: Metrics, control: TourStep['control']): number {
    switch (control) {
      case 'volume': return m.volume;
      case 'pace': return m.pace;
      case 'voices': return m.voices;
      case 'noise': return Math.max(m.noise, m.snrBad);
      default: return 0;
    }
  }

  // Hand the organism the pose for the current step: one reading at the slider, the rest at rest.
  private pose(): void {
    if (this.tourStep === null) return;
    const step = tourSteps()[this.tourStep];
    const v = step.control ? Number(this.tourRange.value) : 0;
    const sim = cfg.sim;
    sim.on = true;
    sim.voice = 1;
    sim.volume = step.control === 'volume' ? v : 0;
    sim.pace = step.control === 'pace' ? v : 0;
    sim.overlap = step.control === 'voices' ? v : 0;
    sim.noise = step.control === 'noise' ? v : 0;
  }

  // While the tour drives the organism, the cue and the bars follow the pose too.
  private posed(m: Metrics): Metrics {
    const s = cfg.sim;
    const rate = 2.5 + 4 * s.pace;
    return {
      ...m, volume: s.volume, pace: s.pace, voices: s.overlap, noise: s.noise, snrBad: 0, rate, sinceVoice: 0,
      status: statusWords({ recent: true, warmingUp: false, volume: s.volume, pace: s.pace, rate, byRun: false, voices: s.overlap, noise: s.noise, snrBad: 0 }),
    };
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

  private setCharts(on: boolean): void {
    this.chartsCheck.checked = on;
    document.body.classList.toggle('charts', on);
    try { localStorage.setItem('attune.charts', on ? '1' : '0'); } catch { /* storage blocked */ }
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  // A thunk, so the line re-renders in the other language when the user switches.
  setStatus(text: string | (() => string)): void {
    this.statusText = typeof text === 'string' ? () => text : text;
    this.status.textContent = this.statusText();
  }

  // null when not recording, otherwise elapsed seconds.
  setRecording(seconds: number | null): void {
    const shown = seconds === null ? null : Math.floor(seconds);
    if (shown === this.recordSeconds) return;
    this.recordSeconds = shown;
    this.renderRecord();
  }

  private renderRecord(): void {
    const s = this.recordSeconds;
    this.recordButton.classList.toggle('recording', s !== null);
    this.recordButton.textContent = s === null ? t('recordStart') : t('recordStop', { s });
  }

  began(): void {
    this.live = true;
    this.start.hidden = true;
    this.readings.hidden = false;
  }

  tick(real: Metrics, dt: number): void {
    this.acc += dt;
    if (this.acc < 0.12) return;
    if (this.tourStep !== null && this.tourLive) {
      const step = tourSteps()[this.tourStep];
      if (step.control) {
        this.tourRange.value = this.liveValue(real, step.control).toFixed(3);
        this.pose();
        cfg.sim.voice = real.voice;
      }
    }
    const m = cfg.sim.on ? this.posed(real) : real;
    const cue = this.picker.pick(m, this.acc);
    this.acc = 0;
    this.readings.classList.toggle('idle', m.sinceVoice > 4);
    const key: Key | '' = cue.kind ? CUE_KEY[cue.kind] : cue.fine ? 'cueFine' : '';
    const tint = cue.severity.toFixed(3);
    // A new line never snaps in: the old one fades out first, then the new one fades up.
    const now = performance.now();
    let swap = false;
    if (key !== this.cueKey) {
      if (!this.cueFadeSince) this.cueFadeSince = now;
      else if (now - this.cueFadeSince >= CUE_FADE_MS) { swap = true; this.cueFadeSince = 0; }
    } else {
      this.cueFadeSince = 0;
    }
    for (const el of this.cues) {
      if (swap) {
        el.textContent = key ? t(key) : '';
        el.classList.toggle('fine', cue.fine);
      }
      el.classList.toggle('out', this.cueFadeSince > 0);
      el.style.setProperty('--sev', tint);
    }
    if (swap) this.cueKey = key;
    const recent = m.sinceVoice < 4;
    this.set('volume', tStatus(m.status.volume), Math.abs(m.volume));
    this.set('pace', recent ? `${tStatus(m.status.pace)} ${m.rate.toFixed(1)}/s` : tStatus(m.status.pace), m.pace);
    this.set('voices', tStatus(m.status.voices), m.voices);
    this.set('noise', tStatus(m.status.noise), Math.max(m.noise, m.snrBad));
  }

  private set(k: ReadingKey, text: string, severity: number): void {
    const sev = severity.toFixed(3);
    for (const c of this.cells[k]) {
      if (c.value.textContent !== text) c.value.textContent = text;
      c.bar.style.setProperty('--sev', sev);
    }
  }
}
