// Wirkung der Schlagworte auf den Klang (Verschiebungen zum Standard, Pfad 'gruppe.feld').
// Reine Daten ohne Importe; Standardwerte und Addition stehen in timbre.js.

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

export const TIMBRE_EFFECTS = deepFreeze({
  punchy: { 'drums.kickPunch': 0.35, 'drums.kickLength': -0.15, 'drums.snareSnap': 0.2 },
  boomy: { 'drums.kickLength': 0.4, 'drums.kickPunch': -0.2 },
  snappy: { 'drums.snareSnap': 0.4, 'drums.snareTone': 0.2 },
  crisp: { 'drums.hatBright': 0.4, 'drums.hatLength': -0.2, 'drums.snareTone': 0.15 },
  roomy: { 'drums.room': 0.5 },

  sub: { 'bass.sub': 0.6, 'bass.cutoff': -0.25 },
  fuzz: { 'bass.fuzz': 0.6 },
  plucky: { 'bass.pluck': 0.4, 'bass.cutoff': 0.1 },
  round: { 'bass.roundness': 0.6, 'bass.cutoff': -0.2, 'bass.resonance': -0.2 },
  resonant: { 'bass.resonance': 0.45, 'bass.cutoff': 0.15 },
  gritty: { 'bass.fuzz': 0.3 },

  mellow: { 'chords.brightness': -0.35, 'chords.length': 0.1 },
  biting: { 'chords.brightness': 0.3, 'chords.length': -0.2 },
  chorused: { 'chords.chorus': 0.5 },
  tremolo: { 'chords.tremolo': 0.5 },
  ringing: { 'chords.length': 0.4 },

  swelling: { 'pad.attack': 0.4 },
  airy: { 'pad.shimmer': 0.5, 'pad.cutoff': 0.2 },
  glassy: { 'pad.shimmer': 0.35, 'pad.cutoff': 0.3, 'pad.thickness': -0.2 },
  thick: { 'pad.thickness': 0.5, 'pad.cutoff': -0.1 },
  moving: { 'pad.lfoSpeed': 0.4, 'pad.lfoDepth': 0.3 },

  dark: { 'master.brightness': -0.35, 'chords.brightness': -0.1, 'pad.cutoff': -0.1, 'drums.hatBright': -0.15 },
  bright: { 'master.brightness': 0.35, 'drums.hatBright': 0.15 },
  warm: { 'chords.brightness': -0.2, 'pad.cutoff': -0.2, 'bass.roundness': 0.2, 'master.brightness': -0.1 },
  psychedelic: { 'master.echo': 0.3, 'master.reverb': 0.25, 'chords.chorus': 0.25, 'pad.lfoDepth': 0.2 },
  dreamy: { 'master.reverb': 0.2, 'pad.attack': 0.15 },
});
