// The pitch deck, in Dutch, at /present.html. It is the app with the audio taken out:
// the same organism, posed by hand per slide through cfg.sim (exactly what the guided
// tour does), the same bottom strip with the cue and the readings bars, the same words.
import './styles.css';
import './present.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';

import { MetricsTracker, statusWords } from './dsp/metrics';
import { VisualMapper } from './visual/mapping';
import { Renderer } from './visual/renderer';
import { initLang, setLang, t, tStatus, type Key } from './ui/i18n';
import { cfg } from './config';

type Pose = { volume?: number; pace?: number; overlap?: number; noise?: number; voice?: number };
interface Slide {
  kicker?: string;
  title: string;
  text?: string;
  list?: string[];        // rendered as bullets; a leading "Term: " goes bold
  actions?: Array<{ label: string; href: string; kind: 'primary' | 'outline' | 'link' }>;
  hint?: string;
  cover?: boolean;
  pose: Pose;
  cue?: Key | 'fine';     // what the bottom strip says; nothing when absent
  bars?: boolean;         // the four readings as bars under the cue
  edges?: boolean;        // all four edges, as on a tablet flat on the table
}

const SLIDES: Slide[] = [
  {
    kicker: 'SpineWise hackathon, september 2026',
    title: 'Attune',
    text: 'Hoe makkelijk is deze ruimte te volgen?',
    hint: 'Pijltjes of spatie om verder te gaan, f voor volledig scherm.',
    cover: true,
    pose: {},
    cue: 'fine',
  },
  {
    kicker: 'Het probleem',
    title: 'Wie het minst hoort, moet het vaakst onderbreken.',
    text: 'In een vergadering praat iemand te snel, praten twee mensen door elkaar, zoemt de ventilatie. Met gehoorverlies vallen dan woorden weg. De enige die dat merkt, is de persoon die het al het lastigst heeft. Die moet vragen of het wat trager kan. Na een paar keer vraag je dat niet meer.',
    pose: { pace: 0.6, overlap: 0.35, noise: 0.45 },
  },
  {
    kicker: 'Het idee',
    title: 'Leg het signaal op tafel, niet bij één persoon.',
    text: 'Attune luistert mee en toont in één vorm hoe goed de ruimte te volgen is. Geen cijfers, geen dashboard: een organisme dat iedereen aan tafel zonder nadenken leest. Rond, mintgroen en rustig als het goed zit. De horende mensen zien het, dus de persoon met gehoorverlies hoeft niet meer te onderbreken.',
    pose: {},
    cue: 'fine',
  },
  {
    kicker: 'Vier metingen',
    title: 'Volume, tempo, stemmen, verstaanbaarheid.',
    text: 'Vier dingen maken een gesprek lastig met gehoorverlies. Attune meet ze live, en elk van de vier verandert één ding aan de vorm. Zo blijft leesbaar wat er precies misloopt.',
    pose: {},
    cue: 'fine',
    bars: true,
  },
  {
    kicker: 'Volume',
    title: 'Volume verandert haar grootte',
    text: 'Te stil en het lichaam krimpt. Te luid en het zwelt en klopt. Allebei worden ze vergeleken met het normale niveau in deze ruimte, geleerd uit de eerste seconden gesprek. Een zachte ploeg en een luide ploeg lezen allebei als aangenaam.',
    pose: { volume: 0.85 },
    cue: 'cueLoud',
    bars: true,
  },
  {
    kicker: 'Tempo',
    title: 'Tempo verandert haar ademhaling',
    text: 'Het lichaam ademt op het tempo van het gesprek. Snelle lettergrepen en lange stukken zonder pauze doen het sneller en onrustiger ademen. De pauzes tellen even hard als de snelheid: daarin haalt een luisteraar met gehoorverlies de achterstand in.',
    pose: { pace: 0.85 },
    cue: 'cueRate',
    bars: true,
  },
  {
    kicker: 'Stemmen',
    title: 'Stemmen splitsen haar in twee',
    text: 'Zodra twee mensen door elkaar praten, trekt het lichaam uit elkaar. Twee stemmen tegelijk zijn met gehoorverlies het moeilijkst te volgen, dus dit is de meest zichtbare verandering die de ruimte kan maken.',
    pose: { overlap: 0.85 },
    cue: 'cueVoices',
    bars: true,
  },
  {
    kicker: 'Verstaanbaarheid',
    title: 'Lawaai ontsteekt een noorderlicht',
    text: 'Als achtergrondlawaai de spraak overstemt, licht er een noorderlicht op rond het lichaam en wordt het oppervlak korrelig. Ventilatie, verkeer en een ventilator tellen ook mee: die vermoeien, zelfs als elk woord doorkomt. De kleur schuift van mint naar oranje naar rood.',
    pose: { noise: 0.85 },
    cue: 'cueNoise',
    bars: true,
  },
  {
    kicker: 'De tafel',
    title: 'Eén zin aan elke rand',
    text: 'Elke rand van het scherm toont het ene wat de tafel nu kan doen, gericht naar die stoel. De zin verschijnt als een meting slecht wordt, blijft een paar seconden staan en verdwijnt als de ruimte herstelt. Een tablet plat op tafel leest zo vanuit elke stoel.',
    pose: { overlap: 0.7 },
    cue: 'cueVoices',
    edges: true,
  },
  {
    kicker: 'Onder de motorkap',
    title: 'Alles gebeurt in de browser.',
    list: [
      'Geen server: het geluid verlaat de tafel niet.',
      'Spraak: Silero VAD. Wie praat door wie: pyannote segmentation. Allebei draaien ze lokaal, in een worker.',
      'Tempo en lawaai: lettergrepen uit de intensiteitscurve, de ruisvloer gemeten in de pauzes, in de spraakband.',
      'De vorm: één WebGL-shader. Werkt op een laptop, een tablet op tafel of een projector.',
    ],
    pose: {},
    cue: 'fine',
  },
  {
    kicker: 'Probeer het zelf',
    title: 'Leg het toestel midden op tafel.',
    text: 'Attune werkt in elke moderne browser, ook op een telefoon. Start de microfoon en praat gewoon verder.',
    actions: [
      { label: 'Luister naar deze ruimte', href: './', kind: 'primary' },
      { label: 'Hoe werkt het?', href: './', kind: 'link' },
    ],
    pose: {},
    cue: 'fine',
  },
];

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const KEYS = ['volume', 'pace', 'voices', 'noise'] as const;
const SIDES = ['bottom', 'top', 'left', 'right'] as const;

initLang();
setLang('nl');

const renderer = new Renderer($('#stage') as unknown as HTMLCanvasElement);
const mapper = new VisualMapper();
const idle = MetricsTracker.idle();

// The bottom strip, and the other three edges, built as the app builds them.
const readings = $('#readings');
const cues: HTMLElement[] = [];
const cells: Record<(typeof KEYS)[number], { value: HTMLElement; bar: HTMLElement }[]> = { volume: [], pace: [], voices: [], noise: [] };
for (const side of SIDES) {
  const edge = document.createElement('section');
  edge.className = 'edge';
  edge.dataset.side = side;
  const cue = document.createElement('div');
  cue.className = 'cue';
  cues.push(cue);
  const strip = document.createElement('div');
  strip.className = 'readings';
  edge.append(cue, strip);
  for (const k of KEYS) {
    const cell = document.createElement('div');
    cell.className = 'reading';
    cell.innerHTML = `<span class="label">${t(k)}</span><span class="value"></span><span class="bar"></span>`;
    cells[k].push({ value: cell.querySelector('.value')!, bar: cell.querySelector('.bar')! });
    strip.appendChild(cell);
  }
  readings.appendChild(edge);
}

const inner = $('#slide-inner');
const kicker = $('#kicker');
const title = $('#title');
const text = $('#text');
const list = $('#list');
const actions = $('#actions');
const hint = $('#hint');
const status = $('#status');

const target = { volume: 0, pace: 0, overlap: 0, noise: 0, voice: 1 };
let index = -1;
let swapTimer = 0;

const fill = (s: Slide): void => {
  inner.classList.toggle('cover', !!s.cover);
  kicker.textContent = s.kicker ?? '';
  kicker.hidden = !s.kicker;
  title.textContent = s.title;
  text.textContent = s.text ?? '';
  text.hidden = !s.text;
  list.replaceChildren(...(s.list ?? []).map((line) => {
    const li = document.createElement('li');
    const m = /^([^:]{2,24}): (.*)$/.exec(line);
    if (m) {
      const b = document.createElement('b');
      b.textContent = `${m[1]}: `;
      li.append(b, m[2]);
    } else {
      li.textContent = line;
    }
    return li;
  }));
  list.hidden = !s.list;
  actions.replaceChildren(...(s.actions ?? []).map((a) => {
    const el = document.createElement('a');
    el.className = a.kind;
    el.href = a.href;
    el.textContent = a.label;
    return el;
  }));
  actions.hidden = !s.actions;
  hint.textContent = s.hint ?? '';
  hint.hidden = !s.hint;
};

// The strip follows the slide's pose the way the app's overlay follows the tour: same
// status words, same bars, same cue colours.
const strip = (s: Slide): void => {
  const p = { volume: 0, pace: 0, overlap: 0, noise: 0, ...s.pose };
  const rate = 2.5 + 4 * p.pace;
  const words = statusWords({ recent: true, warmingUp: false, volume: p.volume, pace: p.pace, rate, byRun: false, voices: p.overlap, noise: p.noise, snrBad: 0 });
  const sev = { volume: Math.abs(p.volume), pace: p.pace, voices: p.overlap, noise: p.noise };
  const label = {
    volume: tStatus(words.volume),
    pace: `${tStatus(words.pace)} ${rate.toFixed(1)}/s`,
    voices: tStatus(words.voices),
    noise: tStatus(words.noise),
  };
  for (const k of KEYS) {
    for (const c of cells[k]) {
      c.value.textContent = label[k];
      c.bar.style.setProperty('--sev', sev[k].toFixed(3));
    }
  }
  const worst = Math.max(sev.volume, sev.pace, sev.voices, sev.noise);
  for (const cue of cues) {
    cue.textContent = s.cue ? t(s.cue === 'fine' ? 'cueFine' : s.cue) : '';
    cue.classList.toggle('fine', s.cue === 'fine');
    cue.style.setProperty('--sev', worst.toFixed(3));
  }
  document.body.classList.toggle('charts', !!s.bars);
  document.body.classList.toggle('edges', !!s.edges);
};

const show = (i: number): void => {
  const next = Math.max(0, Math.min(SLIDES.length - 1, i));
  if (next === index) return;
  const first = index < 0;
  index = next;
  const s = SLIDES[index];
  Object.assign(target, { volume: 0, pace: 0, overlap: 0, noise: 0, voice: 1 }, s.pose);
  status.textContent = `${index + 1} van ${SLIDES.length}`;
  history.replaceState(null, '', `#${index + 1}`);
  strip(s);
  window.clearTimeout(swapTimer);
  if (first) {
    fill(s);
    return;
  }
  // The old text fades out first, then the new one fades up, like the cue in the app.
  inner.classList.add('out');
  swapTimer = window.setTimeout(() => {
    fill(s);
    inner.classList.remove('out');
  }, 300);
};

$('#btn-prev').addEventListener('click', () => show(index - 1));
$('#btn-next').addEventListener('click', () => show(index + 1));
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown': case 'Enter': show(index + 1); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': show(index - 1); break;
    case 'Home': show(0); break;
    case 'End': show(SLIDES.length - 1); break;
    case 'f': document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen(); break;
    case 'h': document.body.classList.toggle('bare'); break;
    default: return;
  }
  e.preventDefault();
});
// Tap or click on the picture: right two thirds forward, left third back. Swipes too.
const stage = $('#stage');
stage.addEventListener('click', (e) => show(e.clientX < window.innerWidth / 3 ? index - 1 : index + 1));
let touchX = 0;
window.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
window.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) show(dx < 0 ? index + 1 : index - 1);
});
window.addEventListener('hashchange', () => show(Number(location.hash.slice(1)) - 1 || 0));

show(Number(location.hash.slice(1)) - 1 || 0);

// The body sits to the right of the text on a wide screen and above it on a phone. When it
// swells or splits it moves further out, so it never sits on the words or on the cue.
const wanted = (): { x: number; y: number } => {
  const grow = 0.1 * Math.max(sim.volume, 0) + 0.2 * sim.overlap;
  return window.innerHeight > window.innerWidth * 1.3 ? { x: 0, y: 0.35 + 0.1 * Math.max(sim.volume, 0) }
    : window.innerHeight < 500 ? { x: 0.3 + grow, y: 0 }
    : { x: 0.22 + grow, y: 0.1 * Math.max(sim.volume, 0) };
};
const sim = cfg.sim;
sim.on = true;
const shift = wanted();
let last = performance.now();
const frame = (now: number): void => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  // Poses glide between slides a little slower than the mapper's own smoothing.
  const a = 1 - Math.exp(-dt / 0.7);
  sim.volume += a * (target.volume - sim.volume);
  sim.pace += a * (target.pace - sim.pace);
  sim.overlap += a * (target.overlap - sim.overlap);
  sim.noise += a * (target.noise - sim.noise);
  sim.voice += a * (target.voice - sim.voice);
  const w = wanted();
  shift.x += a * (w.x - shift.x);
  shift.y += a * (w.y - shift.y);
  renderer.render(now / 1000, mapper.update(idle, dt), shift.y, shift.x);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
