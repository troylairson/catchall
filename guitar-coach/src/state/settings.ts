import { createStore } from './store';

/**
 * Everything that might need adjusting once a real guitar is plugged in lives
 * here. The debug panel renders a slider for each entry in SETTING_SPECS.
 */
export interface Settings {
  // Input
  deviceId: string; // '' = browser default (usually the laptop mic)
  channel: 'mix' | 'left' | 'right';
  inputGainDb: number;

  // Strum (onset) detection
  onsetGateDb: number; // strums quieter than this are ignored
  onsetRiseDb: number; // how sharply the volume must jump to count as a strum
  onsetRefractoryMs: number; // ignore new strums for this long after one
  latencyMs: number; // delay between a real strum and when we hear it (set by setup check)

  // Timing windows
  greatWindowMs: number;
  okWindowMs: number;
  missWindowMs: number;

  // Pitch
  pitchClarity: number; // 0..1, how confident the pitch detector must be
  pitchMinDb: number; // ignore pitch when quieter than this
  tunerToleranceCents: number;

  // Chords
  chordMatchMin: number; // 0..1 similarity needed to accept a chord
  chordMargin: number; // how much better the best match must be than the runner-up

  // Sound
  clickVolume: number; // 0..1
  backingVolume: number; // 0..1
  backingBass: boolean;

  // Look
  leftHanded: boolean;
  debugOpen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  deviceId: '',
  channel: 'mix',
  inputGainDb: 0,
  onsetGateDb: -48,
  onsetRiseDb: 5,
  onsetRefractoryMs: 110,
  latencyMs: 0,
  greatWindowMs: 60,
  okWindowMs: 120,
  missWindowMs: 260,
  pitchClarity: 0.85,
  pitchMinDb: -55,
  tunerToleranceCents: 7,
  chordMatchMin: 0.62,
  chordMargin: 0.03,
  clickVolume: 0.6,
  backingVolume: 0.5,
  backingBass: false,
  leftHanded: false,
  debugOpen: false,
};

export const settings = createStore<Settings>('gc.settings.v1', DEFAULT_SETTINGS);

export interface SettingSpec {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  help: string;
  group: 'Input' | 'Strum detection' | 'Timing' | 'Pitch' | 'Chords' | 'Sound';
}

export const SETTING_SPECS: SettingSpec[] = [
  { key: 'inputGainDb', label: 'Input boost', min: -12, max: 36, step: 1, unit: 'dB', group: 'Input', help: 'Turn up if the meter barely moves when you strum.' },
  { key: 'onsetGateDb', label: 'Strum gate', min: -80, max: -10, step: 1, unit: 'dB', group: 'Strum detection', help: 'Strums quieter than this are ignored. Raise it if clicks/room noise count as strums.' },
  { key: 'onsetRiseDb', label: 'Strum jump', min: 2, max: 24, step: 0.5, unit: 'dB', group: 'Strum detection', help: 'How sudden the volume jump must be. Lower = more sensitive, higher = fewer false strums.' },
  { key: 'onsetRefractoryMs', label: 'Strum cooldown', min: 40, max: 300, step: 5, unit: 'ms', group: 'Strum detection', help: 'One strum can sound like two; anything this soon after a strum is ignored.' },
  { key: 'latencyMs', label: 'Latency', min: -50, max: 400, step: 1, unit: 'ms', group: 'Timing', help: 'Set by the setup check. Shifts all strums earlier by this much.' },
  { key: 'greatWindowMs', label: '"Right on" window', min: 15, max: 150, step: 5, unit: 'ms', group: 'Timing', help: 'Strums this close to the beat count as right on.' },
  { key: 'okWindowMs', label: '"Good" window', min: 40, max: 250, step: 5, unit: 'ms', group: 'Timing', help: 'Strums this close count as good (a little early/late).' },
  { key: 'missWindowMs', label: 'Catch window', min: 100, max: 500, step: 10, unit: 'ms', group: 'Timing', help: 'Strums further than this from any beat count as extra strums.' },
  { key: 'pitchClarity', label: 'Pitch confidence', min: 0.5, max: 0.99, step: 0.01, group: 'Pitch', help: 'Lower if the tuner shows nothing; raise if it jumps around.' },
  { key: 'pitchMinDb', label: 'Pitch min volume', min: -90, max: -20, step: 1, unit: 'dB', group: 'Pitch', help: 'Quieter sounds are ignored by the tuner.' },
  { key: 'tunerToleranceCents', label: 'Tuner "good" range', min: 2, max: 20, step: 1, unit: 'cents', group: 'Pitch', help: 'How close counts as in tune (100 cents = one space on the neck).' },
  { key: 'chordMatchMin', label: 'Chord match', min: 0.3, max: 0.95, step: 0.01, group: 'Chords', help: 'How closely a strum must match the chord. Lower if good chords get rejected.' },
  { key: 'chordMargin', label: 'Chord margin', min: 0, max: 0.2, step: 0.01, group: 'Chords', help: 'How clearly the best chord must beat the next-best guess.' },
  { key: 'clickVolume', label: 'Click volume', min: 0, max: 1, step: 0.05, group: 'Sound', help: 'Metronome click loudness.' },
  { key: 'backingVolume', label: 'Backing volume', min: 0, max: 1, step: 0.05, group: 'Sound', help: 'Drum backing loudness in songs.' },
];
