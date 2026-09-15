// Every word the room reads, in English and Dutch. The Tune panel stays English: it is a
// developer tool. Status words come out of the analysis worker in English and are looked
// up here, so the worker and the offline harness never care about language.

export type Lang = 'en' | 'nl';

const STORE = 'attune.lang';

const dict = {
  brand: ['Attune', 'Attune'],
  source: ['Source', 'Bron'],
  tune: ['Tune', 'Afstellen'],
  help: ['How it works', 'Hoe werkt het?'],
  close: ['Close', 'Sluiten'],
  tourNext: ['Next', 'Volgende'],
  tourBack: ['Back', 'Terug'],
  tourDone: ['Done', 'Klaar'],
  tourStep: ['{n} of {total}', '{n} van {total}'],
  tourTry: ['Try a clip', 'Probeer een fragment'],
  notListeningYet: ['Not listening yet', 'Luistert nog niet'],
  notListening: ['Not listening', 'Luistert niet'],
  askingMic: ['Asking for the microphone', 'Microfoon aanvragen'],
  loadingFile: ['Loading {name}', '{name} laden'],
  loadingClip: ['Loading the clip', 'Fragment laden'],
  playing: ['Playing: {name}', 'Speelt: {name}'],
  startingRecording: ['Starting the recording', 'Opname starten'],
  saved: ['Saved {file} ({s} s)', '{file} opgeslagen ({s} s)'],
  micBlocked: ['Microphone access was blocked. Allow it in the address bar and try again.', 'Toegang tot de microfoon is geweigerd. Sta het toe in de adresbalk en probeer opnieuw.'],
  micMissing: ['No microphone found on this device.', 'Geen microfoon gevonden op dit toestel.'],
  couldNotStart: ['Could not start: {error}', 'Kon niet starten: {error}'],
  listeningThrough: ['Listening through {name}', 'Luistert via {name}'],
  listeningRoom: ['Listening to this room', 'Luistert naar deze ruimte'],
  menuMic: ['Microphone', 'Microfoon'],
  menuFile: ['Open a recording', 'Opname openen'],
  menuSamples: ['Sample clips', 'Voorbeeldfragmenten'],
  menuMonitor: ['Play clips out loud', 'Fragmenten hardop afspelen'],
  menuCharts: ['Show the readings as bars', 'Metingen als balken tonen'],
  menuRecord: ['Record this room for tuning', 'Deze ruimte opnemen om af te stellen'],
  recordPlaceholder: ['label, e.g. two-people', 'label, bv. twee-personen'],
  recordStart: ['Start recording', 'Opname starten'],
  recordStop: ['Stop and save ({s} s)', 'Stoppen en opslaan ({s} s)'],
  startTitle: ['How easy is this room to follow?', 'Hoe makkelijk is deze ruimte te volgen?'],
  startText: [
    'Attune listens to the conversation and shows, at a glance, what makes it hard for someone with hearing loss to keep up: volume, pace, people talking over each other, and background noise.',
    'Attune luistert mee naar het gesprek en toont in één oogopslag wat het voor iemand met gehoorverlies lastig maakt om te volgen: volume, tempo, mensen die door elkaar praten en achtergrondlawaai.',
  ],
  startMic: ['Listen to this room', 'Luister naar deze ruimte'],
  startSample: ['Play a sample meeting', 'Speel een voorbeeldvergadering'],
  startHint: ['Works best with the device lying in the middle of the table.', 'Werkt het best met het toestel midden op tafel.'],
  volume: ['Volume', 'Volume'],
  pace: ['Pace', 'Tempo'],
  voices: ['Voices', 'Stemmen'],
  noise: ['Clarity', 'Verstaanbaarheid'],
  // Cues: the one thing the table could do now.
  cueQuiet: ['Speak up a little', 'Spreek iets luider'],
  cueLoud: ['A little softer', 'Iets zachter'],
  cueRate: ['Slow down a little', 'Iets trager'],
  cueRun: ['Leave a pause now and then', 'Laat af en toe een pauze'],
  cueVoices: ['One at a time', 'Om de beurt'],
  cueNoise: ['Reduce the background noise', 'Minder achtergrondlawaai'],
  cueFine: ['Easy to follow', 'Goed te volgen'],
  // Status words, keyed by the English the worker emits.
  'listening': ['listening', 'luistert'],
  'no speech': ['no speech', 'geen spraak'],
  'too quiet to follow': ['too quiet to follow', 'te stil om te volgen'],
  'a bit quiet': ['a bit quiet', 'wat stil'],
  'too loud': ['too loud', 'te luid'],
  'loud': ['loud', 'luid'],
  'comfortable': ['comfortable', 'aangenaam'],
  'slow': ['slow', 'traag'],
  'steady': ['steady', 'rustig'],
  'few pauses': ['few pauses', 'weinig pauzes'],
  'no pauses': ['no pauses', 'geen pauzes'],
  'quick': ['quick', 'snel'],
  'too fast': ['too fast', 'te snel'],
  'one at a time': ['one at a time', 'om de beurt'],
  'some overlap': ['some overlap', 'soms door elkaar'],
  'talking over each other': ['talking over each other', 'door elkaar'],
  'masking speech': ['masking speech', 'overstemt de spraak'],
  'clear': ['clear', 'helder'],
  'some noise': ['some noise', 'wat lawaai'],
  'noisy': ['noisy', 'lawaaierig'],
  'very noisy': ['very noisy', 'veel lawaai'],
  // Sample clips, keyed by id.
  'sample:story': ['A meeting: calm, then fast, then crosstalk, then noise', 'Een vergadering: rustig, dan snel, dan door elkaar, dan lawaai'],
  'sample:calm': ['Calm, one person', 'Rustig, één persoon'],
  'sample:quiet': ['Too quiet', 'Te stil'],
  'sample:loud': ['Too loud', 'Te luid'],
  'sample:fast': ['Fast talker', 'Snelle spreker'],
  'sample:crosstalk': ['Two people at once', 'Twee mensen tegelijk'],
  'sample:noisy': ['Background noise', 'Achtergrondlawaai'],
} as const;

export type Key = keyof typeof dict;

// The guided tour. Each step poses the organism by hand (cfg.sim) and lets the visitor
// drag one reading to see what it does. Terms are "name: explanation" lines.
export type TourControl = 'volume' | 'pace' | 'voices' | 'noise';
export interface TourStep {
  title: string;
  text: string;
  control?: TourControl;
  low?: string;
  high?: string;
  pose?: number;       // where the slider starts on this step
  terms?: string[];
  samples?: boolean;   // show the sample clips as "try it" buttons
}

const tour: Record<Lang, TourStep[]> = {
  en: [
    {
      title: 'This shape is the room',
      text: 'When the conversation is easy to follow it stays round, mint and calm, breathing slowly. Everything Attune hears changes one thing about it, so the whole table can read the room without reading numbers. On the next steps, drag the slider and watch.',
    },
    {
      title: 'Volume changes its size',
      text: 'Speech that is too quiet shrinks the body. Speech that is too loud swells it and makes it pulse. Both are judged against the normal level in this room, learnt from the first seconds of talk, so a soft-spoken team and a loud one both read as comfortable in the middle.',
      control: 'volume', low: 'too quiet', high: 'too loud', pose: 0.85,
    },
    {
      title: 'Pace changes its breathing',
      text: 'The body breathes at the pace of the talk. Fast syllables, and long stretches without a pause, make it breathe faster and more restless. Someone with hearing loss needs the pauses to catch up, so the gaps count as much as the speed.',
      control: 'pace', low: 'calm', high: 'too fast', pose: 0.85,
    },
    {
      title: 'Voices split it in two',
      text: 'As soon as two people talk over each other, the body starts to pull apart into two. Two voices at once are the hardest thing to follow with hearing loss, so this is the most visible change the room can make.',
      control: 'voices', low: 'one at a time', high: 'everyone at once', pose: 0.85,
    },
    {
      title: 'Noise lights an aurora',
      text: 'When background noise masks the speech, an aurora lights up around the body and its surface goes gritty. The clearer the room, the darker and stiller the sky around it. Only noise inside the speech band counts: ventilation, traffic and a laptop fan stay invisible until they cover words. Whatever the cause, the colour moves from mint to amber to red as the room gets harder.',
      control: 'noise', low: 'clear', high: 'very noisy', pose: 0.85,
    },
    {
      title: 'One line on every edge',
      text: 'Each edge of the screen shows the one thing the table could do right now, facing that seat. It appears when a reading gets bad, stays a few seconds, and goes away when the room recovers. This is the point: the person with hearing loss no longer has to be the one who interrupts.',
      control: 'voices', low: 'one at a time', high: 'everyone at once', pose: 0.85,
    },
    {
      title: 'Choose what it listens to',
      text: 'The Source menu (top right) picks the input. Try a clip below to see the room react to real sound.',
      terms: [
        'Microphone: listens to this room live. Lay the device in the middle of the table. Key m.',
        'Open a recording: plays an audio file from this device as if it were the room.',
        'Sample clips: short synthetic meetings, one per situation. They loop until you pick another source.',
        'Play clips out loud: also sends clips to the speakers. Turn off if the sound feeds back into the mic.',
        'Record this room for tuning: saves raw microphone audio as a WAV file, to tune the thresholds for this room.',
        'Keys: c bars, h hide everything for a projector, f fullscreen, t tuning panel, ? this tour.',
      ],
      samples: true,
    },
  ],
  nl: [
    {
      title: 'Deze vorm is de ruimte',
      text: 'Als het gesprek goed te volgen is, blijft ze rond, mintgroen en rustig, en ademt ze traag. Alles wat Attune hoort verandert één ding aan haar, zodat de hele tafel de ruimte kan lezen zonder cijfers te lezen. Sleep in de volgende stappen de schuif en kijk wat er gebeurt.',
    },
    {
      title: 'Volume verandert haar grootte',
      text: 'Te stille spraak doet het lichaam krimpen. Te luide spraak doet het zwellen en kloppen. Allebei worden ze vergeleken met het normale niveau in deze ruimte, geleerd uit de eerste seconden gesprek, zodat een zachte ploeg en een luide ploeg allebei als aangenaam in het midden lezen.',
      control: 'volume', low: 'te stil', high: 'te luid', pose: 0.85,
    },
    {
      title: 'Tempo verandert haar ademhaling',
      text: 'Het lichaam ademt op het tempo van het gesprek. Snelle lettergrepen, en lange stukken zonder pauze, doen het sneller en onrustiger ademen. Iemand met gehoorverlies heeft de pauzes nodig om bij te blijven, dus de gaten tellen even hard als de snelheid.',
      control: 'pace', low: 'rustig', high: 'te snel', pose: 0.85,
    },
    {
      title: 'Stemmen splitsen haar in twee',
      text: 'Zodra twee mensen door elkaar praten, begint het lichaam uit elkaar te trekken in twee delen. Twee stemmen tegelijk zijn met gehoorverlies het moeilijkst te volgen, dus dit is de meest zichtbare verandering die de ruimte kan maken.',
      control: 'voices', low: 'om de beurt', high: 'iedereen tegelijk', pose: 0.85,
    },
    {
      title: 'Lawaai ontsteekt een noorderlicht',
      text: 'Als achtergrondlawaai de spraak overstemt, licht er een noorderlicht op rond het lichaam en wordt het oppervlak korrelig. Hoe helderder de ruimte, hoe donkerder en stiller de lucht eromheen. Alleen lawaai in de spraakband telt: ventilatie, verkeer en een laptopventilator blijven onzichtbaar tot ze woorden bedekken. Wat de oorzaak ook is, de kleur schuift van mint naar oranje naar rood naarmate de ruimte lastiger wordt.',
      control: 'noise', low: 'helder', high: 'veel lawaai', pose: 0.85,
    },
    {
      title: 'Eén zin aan elke rand',
      text: 'Elke rand van het scherm toont het ene wat de tafel nu kan doen, gericht naar die stoel. De zin verschijnt als een meting slecht wordt, blijft een paar seconden staan en verdwijnt als de ruimte herstelt. Daar draait het om: de persoon met gehoorverlies hoeft niet meer de enige te zijn die onderbreekt.',
      control: 'voices', low: 'om de beurt', high: 'iedereen tegelijk', pose: 0.85,
    },
    {
      title: 'Kies waar ze naar luistert',
      text: 'Het menu Bron (rechtsboven) kiest de invoer. Probeer hieronder een fragment om de ruimte op echt geluid te zien reageren.',
      terms: [
        'Microfoon: luistert live naar deze ruimte. Leg het toestel midden op tafel. Toets m.',
        'Opname openen: speelt een geluidsbestand van dit toestel af alsof het de ruimte is.',
        'Voorbeeldfragmenten: korte synthetische vergaderingen, één per situatie. Ze herhalen tot je een andere bron kiest.',
        'Fragmenten hardop afspelen: stuurt fragmenten ook naar de luidsprekers. Zet uit als het geluid terugkoppelt in de microfoon.',
        'Deze ruimte opnemen om af te stellen: bewaart ruwe microfoonaudio als WAV-bestand, om de drempels op deze ruimte af te stellen.',
        'Toetsen: c balken, h alles verbergen voor een projector, f volledig scherm, t afstelpaneel, ? deze rondleiding.',
      ],
      samples: true,
    },
  ],
};

let current: Lang = 'en';
const listeners: Array<(l: Lang) => void> = [];

export const initLang = (): Lang => {
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORE); } catch { /* storage blocked */ }
  current = stored === 'nl' || stored === 'en' ? stored : navigator.language.toLowerCase().startsWith('nl') ? 'nl' : 'en';
  document.documentElement.lang = current;
  return current;
};

export const lang = (): Lang => current;

export const setLang = (l: Lang): void => {
  if (l === current) return;
  current = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(STORE, l); } catch { /* storage blocked */ }
  for (const cb of listeners) cb(l);
};

export const onLang = (cb: (l: Lang) => void): void => { listeners.push(cb); };

export const t = (key: Key, vars: Record<string, string | number> = {}): string => {
  let s: string = dict[key][current === 'nl' ? 1 : 0];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
};

// Status words from the worker; anything unknown (an error text, say) passes through.
export const tStatus = (word: string): string => (word in dict ? t(word as Key) : word);

export const tourSteps = (): TourStep[] => tour[current];
