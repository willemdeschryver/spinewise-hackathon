// Every number a human might want to move during the demo lives here and is exposed in the Tune panel.
export const cfg = {
  // Listening. Speech is detected by the Silero model; the floor is measured in the gaps it leaves.
  vadOn: 0.5,                // speech probability that switches "someone is speaking" on
  vadOff: 0.35,              // and off again (hysteresis)
  vadNoiseMax: 0.2,          // frames under this probability may set the noise floor
  vadHoldMs: 250,
  floorWindowSec: 10,        // how far back the slow noise floor looks
  floorPercentile: 0.05,     // low enough to land in the pauses even when two people talk
  floorRiseDb: 6,            // a steady rise of at least this much over 2.5 s jumps the floor up at once
  floorFastSpreadDb: 6,      // "steady" means the quiet frames sit within this many dB of each other
  floorClarityMax: 0.35,     // without the model: only frames without a clear pitch may set the floor
  vadThresholdDb: 8,         // without the model: speech band must clear its own floor by this much

  // Volume, in dB relative to the room's normal speech level (learnt from the first seconds
  // of talk; "I am speaking normally" pins it). Absorbs microphone gain differences.
  volQuietDb: -8,
  volLoudDb: 8,

  // Pace, in syllables per second. Conversational speech sits around 4 to 5, fast talkers
  // reach 6 to 7; the synthetic "fast" clip is an unnatural 9.
  paceSteady: 5.0,
  paceFast: 7.0,
  paceSmoothSec: 1.2,        // how long a burst has to last before the pace reading follows it
  runSteadySec: 5,          // seconds of talk without a pause (0.35 s or more) before "few pauses"
  runFastSec: 12,           // and "no pauses"
  syllableProminenceDb: 2,
  syllableMinGapMs: 50,
  syllableVoicedMin: 0.3,    // pitch clarity a frame needs before its peak counts as a syllable
                             // (low: a room and a distant mic blur the pitch, the VAD keeps noise out)
  envelopeTauMs: 16,

  // Overlap. The pyannote segmentation model looks at the last segWindowSec of audio every segHopSec.
  segWindowSec: 3,
  segHopSec: 0.15,
  overlapAttackSec: 0.2,
  overlapReleaseSec: 1.5,

  // Overlap heuristics, used only when the segmentation model is not available
  overlapFill: 0.8,          // weight of filled pauses between syllables
  overlapSecondPitch: 0.6,   // weight of a second voice left after cancelling the first
  overlapClarity: 0.15,      // weight of pitch clarity loss
  overlapJump: 0.2,          // weight of a pitch track jumping between voices
  fillRangeHigh: 22,         // prior for one voice's intensity spread (dB) before the room is learnt
  fillRefSec: 60,            // how much history sets the room's own one-voice spread
  fillRefPercentile: 0.75,
  fillRelHigh: 0.8,          // spread / reference above this: one voice
  fillRelLow: 0.55,          // spread / reference below this: pauses are filled
  fillSnrMin: 10,            // filled pauses only count when speech clears the noise by this much
  secondLow: 0.55,           // residual periodicity that starts to count as a second voice
  secondHigh: 0.8,
  clarityHigh: 0.78,
  clarityLow: 0.4,
  jumpLow: 1.5,              // pitch jumps per second
  jumpHigh: 5,

  // Background noise, two ways. Inside the speech band (300 to 3400 Hz): the floor in dB
  // relative to the loud part of the room's normal speech in that band. This is what masks
  // words. A laptop mic across the table gives a fine room about 18 dB of headroom (recordings
  // of 2026-09-14); under 12 dB a listener with hearing loss is losing words.
  noiseQuietDb: -18,
  noiseLoudDb: -10,
  // Broadband: the whole floor relative to the room's normal speech level. Rumble from traffic,
  // ventilation or a fan masks no word but still tires a listener (and a hearing aid amplifies
  // it), so it counts too, with more headroom so a fine room (about 17 dB under in the
  // 2026-09-14 recordings) stays well clear of it.
  noiseWideQuietDb: -13,
  noiseWideLoudDb: -4,
  // Sudden noise: a clap, a door, a dropped cup. Nothing short ever reaches the floor, so a
  // burst is a frame that jumps well above the recent level (summed over two frames, since a
  // clap often straddles a frame edge), flat in spectrum and without a pitch. Each burst adds
  // `burstGain` to the reading, which then decays over `burstReleaseSec`.
  burstJumpDb: 10,
  burstFlatnessMin: 0.2,
  burstClarityMax: 0.4,
  burstGain: 0.45,
  burstReleaseSec: 2.5,
  snrGood: 18,
  snrBad: 8,

  // Visual
  breathCalmHz: 0.1,
  breathFastHz: 0.35,
  sizeBase: 0.27,
  sizeLoud: 0.42,
  sizeQuiet: 0.17,
  visualTau: 0.35,

  // Drive the organism by hand: for tuning the look, or a demo without audio
  sim: { on: false, volume: 0, pace: 0, overlap: 0, noise: 0, voice: 1 },
};

export type Config = typeof cfg;
