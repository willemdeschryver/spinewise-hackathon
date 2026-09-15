// Mixes the TTS lines from tts.ps1 into the demo clips under public/samples.
// Each clip isolates one problem; "story" strings them together for a walkthrough.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 24000;
const IN = path.join(os.tmpdir(), 'attune-tts');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/samples');

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV`);
  let off = 12, channels = 1, rate = SR, bits = 16, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      channels = b.readUInt16LE(off + 10);
      rate = b.readUInt32LE(off + 12);
      bits = b.readUInt16LE(off + 22);
    } else if (id === 'data') {
      data = b.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size & 1);
  }
  if (!data) throw new Error(`${file} has no data chunk`);
  if (bits !== 16) throw new Error(`${file}: expected 16-bit PCM`);
  if (rate !== SR) throw new Error(`${file}: expected ${SR} Hz, got ${rate}`);
  const n = Math.floor(data.length / 2 / channels);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += data.readInt16LE((i * channels + c) * 2);
    x[i] = s / channels / 32768;
  }
  return x;
}

function writeWav(file, x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, b);
}

const db = (g) => 20 * Math.log10(g);
const gain = (d) => Math.pow(10, d / 20);
const sec = (s) => Math.round(s * SR);

// Level of the parts that are actually speech, ignoring pauses.
function activeRms(x) {
  const block = sec(0.05);
  const rms = [];
  for (let i = 0; i + block <= x.length; i += block) {
    let s = 0;
    for (let j = i; j < i + block; j++) s += x[j] * x[j];
    rms.push(Math.sqrt(s / block));
  }
  const peak = Math.max(...rms);
  const active = rms.filter((r) => r > peak * gain(-25));
  return Math.sqrt(active.reduce((a, r) => a + r * r, 0) / active.length);
}

function trim(x, thresholdDb = -50) {
  const block = sec(0.02);
  const thr = gain(thresholdDb);
  const loud = (i) => {
    let s = 0;
    for (let j = i; j < Math.min(x.length, i + block); j++) s += x[j] * x[j];
    return Math.sqrt(s / block) > thr;
  };
  let a = 0, b = x.length;
  while (a + block < x.length && !loud(a)) a += block;
  while (b - block > a && !loud(b - block)) b -= block;
  return x.subarray(Math.max(0, a - sec(0.1)), Math.min(x.length, b + sec(0.25)));
}

function normalized(x, targetDb) {
  const g = gain(targetDb) / activeRms(x);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return y;
}

function fade(x, ms = 30) {
  const n = Math.min(sec(ms / 1000), Math.floor(x.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
  return x;
}

let seed = 1234567;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };

// Paul Kellet's pink noise filter, sounds like ventilation or a distant crowd.
function pink(n, targetDb) {
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i] * x[i];
  const g = gain(targetDb) / Math.sqrt(s / n);
  for (let i = 0; i < n; i++) x[i] *= g;
  return x;
}

function hum(n, targetDb, f = 100) {
  const x = new Float32Array(n);
  const g = gain(targetDb);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    x[i] = g * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * 2 * f * t + 0.3)) * Math.SQRT2 * 0.9;
  }
  return x;
}

function white(n, targetDb) {
  const x = new Float32Array(n);
  const g = gain(targetDb) * Math.sqrt(12);
  for (let i = 0; i < n; i++) x[i] = rand() * g;
  return x;
}

// Sum of {x, at} layers, at in seconds; length grows to fit.
function mix(layers, minLen = 0) {
  let len = minLen;
  for (const l of layers) len = Math.max(len, sec(l.at ?? 0) + l.x.length);
  const y = new Float32Array(len);
  for (const l of layers) {
    const o = sec(l.at ?? 0);
    for (let i = 0; i < l.x.length; i++) y[o + i] += l.x[i];
  }
  return y;
}

function softClip(x) {
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * 1.1);
  return x;
}

function withFloor(x, floorDb = -62) {
  return mix([{ x }, { x: white(x.length, floorDb) }]);
}

const dur = (x) => x.length / SR;

const voice = Object.fromEntries(
  ['david_calm', 'zira_calm', 'mark_fast', 'zira_fast', 'bart_calm', 'david_calm2', 'zira_calm2']
    .map((n) => [n, fade(trim(readWav(path.join(IN, `${n}.wav`))))]),
);

fs.mkdirSync(OUT, { recursive: true });

const clips = {
  calm: withFloor(normalized(voice.david_calm, -24)),
  quiet: withFloor(normalized(voice.zira_calm, -42)),
  loud: withFloor(softClip(normalized(voice.david_calm, -6))),
  fast: withFloor(mix([
    { x: normalized(voice.mark_fast, -24) },
    { x: normalized(voice.zira_fast, -24), at: dur(voice.mark_fast) + 0.6 },
  ])),
  crosstalk: withFloor(mix([
    { x: normalized(voice.david_calm, -25) },
    { x: normalized(voice.zira_calm, -25), at: 1.2 },
  ])),
  noisy: (() => {
    const v = normalized(voice.david_calm2, -24);
    return mix([{ x: v }, { x: pink(v.length, -27) }, { x: hum(v.length, -36) }]);
  })(),
};

// The walkthrough: calm, fast, crosstalk, noisy, calm again.
{
  const gap = 1.0;
  const seg = [];
  let t = 0.5;
  const add = (x, extra = []) => {
    seg.push({ x, at: t });
    for (const e of extra) seg.push({ x: e.x, at: t + (e.at ?? 0) });
    t += dur(x) + gap;
  };
  add(normalized(voice.david_calm, -24));
  add(normalized(voice.mark_fast, -24));
  add(normalized(voice.zira_calm, -25), [{ x: normalized(voice.bart_calm, -25), at: 1.0 }]);
  const noisyVoice = normalized(voice.david_calm2, -24);
  const noiseLen = noisyVoice.length + sec(1.0);
  add(noisyVoice, [{ x: fade(pink(noiseLen, -27), 800), at: -0.5 }, { x: fade(hum(noiseLen, -36), 800), at: -0.5 }]);
  add(normalized(voice.zira_calm2, -24));
  clips.story = withFloor(mix(seg, sec(t + 0.5)));
}

for (const [name, x] of Object.entries(clips)) {
  const file = path.join(OUT, `${name}.wav`);
  writeWav(file, x);
  console.log(`${name.padEnd(10)} ${dur(x).toFixed(1).padStart(5)} s  active ${db(activeRms(x)).toFixed(1)} dBFS`);
}
