import type { Metrics } from '../dsp/metrics';
import { CuePicker, type CueKind } from './cue';
import { guideSections, initLang, lang, onLang, setLang, t, tStatus, type Key, type Lang } from './i18n';

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
const CUE_KEY: Record<CueKind, Key> = { quiet: 'cueQuiet', loud: 'cueLoud', rate: 'cueRate', run: 'cueRun', voices: 'cueVoices', noise: 'cueNoise' };

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

// The typographic chrome around the organism: status line, source menu, guide, and one
// edge block per side of the screen, turned to face that side so a tablet lying flat on
// the table reads correctly from every seat. Each block carries the action cue (the one
// thing the table could do now) and, when the charts overlay is on, the four readings as
// bars. Everything visible is in English or Dutch, switched live.
export class Overlay {
  private readonly status = $('#status');
  private readonly start = $('#start');
  private readonly readings = $('#readings');
  private readonly menu = $('#menu');
  private readonly guide = $('#guide');
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
  private cueKey: Key | '' = '';
  private acc = 0;
  private tuneOpen = false;
  private recordSeconds: number | null = null;

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
    $('#btn-guide-close').addEventListener('click', () => this.closeGuide());
    this.guide.addEventListener('click', (e) => { if (e.target === this.guide) this.closeGuide(); });

    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && e.target !== this.menuButton) this.closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'Escape': this.closeMenu(); this.closeGuide(); break;
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
    SAMPLES.forEach((s, i) => { this.sampleButtons[i].textContent = sampleName(s); });
    for (const k of KEYS) for (const c of this.cells[k]) c.label.textContent = t(k);
    this.status.textContent = this.statusText();
    this.renderRecord();
    this.renderGuide();
    this.cueKey = '';
    this.acc = 1; // redraw the readings and the cue on the next tick
  }

  private renderGuide(): void {
    const body = $('#guide-body');
    body.replaceChildren();
    for (const section of guideSections()) {
      const h = document.createElement('h2');
      h.textContent = section.title;
      body.appendChild(h);
      for (const para of section.body) {
        const p = document.createElement('p');
        if (para.startsWith('* ')) {
          const [term, ...rest] = para.slice(2).split(': ');
          const b = document.createElement('b');
          b.textContent = term;
          p.className = 'term';
          p.append(b, ' ', rest.join(': '));
        } else {
          p.textContent = para;
        }
        body.appendChild(p);
      }
    }
  }

  private openGuide(): void {
    this.guide.hidden = false;
    $('#btn-guide-close').focus();
  }

  private closeGuide(): void {
    this.guide.hidden = true;
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
    this.start.hidden = true;
    this.readings.hidden = false;
  }

  tick(m: Metrics, dt: number): void {
    this.acc += dt;
    if (this.acc < 0.12) return;
    const cue = this.picker.pick(m, this.acc);
    this.acc = 0;
    this.readings.classList.toggle('idle', m.sinceVoice > 4);
    const key: Key | '' = cue.kind ? CUE_KEY[cue.kind] : cue.fine ? 'cueFine' : '';
    const tint = cue.severity.toFixed(3);
    for (const el of this.cues) {
      if (key !== this.cueKey) el.textContent = key ? t(key) : '';
      el.classList.toggle('fine', cue.fine);
      el.style.setProperty('--sev', tint);
    }
    this.cueKey = key;
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
