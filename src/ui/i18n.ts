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

// The onboarding guide: one section per topic, each a title and a few paragraphs. A
// paragraph starting with "* " is rendered as a term with its explanation after the colon.
export interface GuideSection { title: string; body: string[] }

const guide: Record<Lang, GuideSection[]> = {
  en: [
    {
      title: 'What you are looking at',
      body: [
        'The shape in the middle is the room. It breathes with the conversation. When the room is easy to follow it stays round, mint and calm. When it gets harder, it grows, speeds up, splits, fogs over and turns amber, then red.',
        'On each edge of the screen there is one short line: the one thing the table could do right now, such as "Slow down a little" or "One at a time". It faces every seat, so the person with hearing loss no longer has to be the one who interrupts.',
      ],
    },
    {
      title: 'Sources',
      body: [
        'Open the Source menu (top right) to choose what Attune listens to.',
        '* Microphone: listens to this room live. Lay the device in the middle of the table. The browser will ask for permission once. Key: m.',
        '* Open a recording: plays an audio file from this device (WAV, MP3, ...) as if it were the room. Handy to replay a meeting or to test without people around.',
        '* Sample clips: short synthetic meetings, one per situation: calm, too quiet, too loud, a fast talker, two people at once, background noise, and a story that runs through all of them. They loop until you pick another source.',
        '* Play clips out loud: when on, recordings and clips also come out of the speakers. Switch it off if the sound feeds back into the microphone.',
        '* Record this room for tuning: saves 15 to 20 seconds of raw microphone audio as a WAV file in your downloads. Type a short label first (for example "two-people"). These recordings are used to tune the thresholds for this room and this device.',
      ],
    },
    {
      title: 'The four readings',
      body: [
        'Switch them on with "Show the readings as bars" in the Source menu, or key c. Each bar fills and turns red as that reading gets worse.',
        '* Volume: how loud the speech is compared with the normal level in this room. Too quiet and too loud are both hard to follow.',
        '* Pace: syllables per second, and how long someone talks without a pause of a third of a second. Someone with hearing loss needs the gaps to catch up.',
        '* Voices: how much people talk over each other. Two voices at once are the hardest thing to follow.',
        '* Clarity: how far the speech rises above the background noise in the speech band. Ventilation, traffic and a laptop fan do not count unless they mask words.',
      ],
    },
    {
      title: 'Keys',
      body: [
        '* m: microphone. c: readings as bars. h: hide everything except the room, for a projector. f: fullscreen. t: the tuning panel. Esc: close the menu.',
      ],
    },
  ],
  nl: [
    {
      title: 'Wat je ziet',
      body: [
        'De vorm in het midden is de ruimte. Ze ademt mee met het gesprek. Als de ruimte goed te volgen is, blijft ze rond, mintgroen en rustig. Wordt het lastiger, dan groeit ze, versnelt ze, splitst ze, wordt ze mistig en kleurt ze oranje en daarna rood.',
        'Aan elke rand van het scherm staat één korte zin: het ene wat de tafel nu kan doen, zoals "Iets trager" of "Om de beurt". Ze is naar elke stoel gericht, zodat de persoon met gehoorverlies niet meer de enige is die moet onderbreken.',
      ],
    },
    {
      title: 'Bronnen',
      body: [
        'Open het menu Bron (rechtsboven) om te kiezen waar Attune naar luistert.',
        '* Microfoon: luistert live naar deze ruimte. Leg het toestel midden op tafel. De browser vraagt één keer om toestemming. Toets: m.',
        '* Opname openen: speelt een geluidsbestand van dit toestel af (WAV, MP3, ...) alsof het de ruimte is. Handig om een vergadering opnieuw te bekijken of om te testen zonder mensen erbij.',
        '* Voorbeeldfragmenten: korte synthetische vergaderingen, één per situatie: rustig, te stil, te luid, een snelle spreker, twee mensen tegelijk, achtergrondlawaai, en een verhaal dat ze allemaal doorloopt. Ze herhalen tot je een andere bron kiest.',
        '* Fragmenten hardop afspelen: als dit aanstaat, komen opnames en fragmenten ook uit de luidsprekers. Zet het uit als het geluid terugkoppelt in de microfoon.',
        '* Deze ruimte opnemen om af te stellen: bewaart 15 tot 20 seconden ruwe microfoonaudio als WAV-bestand in je downloads. Typ eerst een kort label (bijvoorbeeld "twee-personen"). Met die opnames stellen we de drempels af op deze ruimte en dit toestel.',
      ],
    },
    {
      title: 'De vier metingen',
      body: [
        'Zet ze aan met "Metingen als balken tonen" in het menu Bron, of met toets c. Elke balk vult zich en kleurt rood naarmate die meting slechter wordt.',
        '* Volume: hoe luid de spraak is vergeleken met het normale niveau in deze ruimte. Te stil en te luid zijn allebei moeilijk te volgen.',
        '* Tempo: lettergrepen per seconde, en hoe lang iemand praat zonder een pauze van een derde seconde. Iemand met gehoorverlies heeft die gaten nodig om bij te blijven.',
        '* Stemmen: hoeveel mensen door elkaar praten. Twee stemmen tegelijk zijn het moeilijkst te volgen.',
        '* Verstaanbaarheid: hoe ver de spraak boven het achtergrondlawaai uitkomt in de spraakband. Ventilatie, verkeer en een laptopventilator tellen niet mee, tenzij ze woorden overstemmen.',
      ],
    },
    {
      title: 'Toetsen',
      body: [
        '* m: microfoon. c: metingen als balken. h: alles verbergen behalve de ruimte, voor een projector. f: volledig scherm. t: het afstelpaneel. Esc: menu sluiten.',
      ],
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

export const guideSections = (): GuideSection[] => guide[current];
