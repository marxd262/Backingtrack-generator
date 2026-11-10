// Stimmen-Register: welche Klangerzeuger ein Instrument (Bass, Akkorde, Pad) zur Wahl hat. Reine Daten und Auflösung, keine Audio-Importe,
// damit validateTrack sie lesen kann; die Klangerzeugung steht in src/audio/voices/. Das Schlagzeug hat keine wählbaren Stimmen.
// Eine Stimme zu ergänzen heißt: Eintrag hier, Klangerzeugung dazu, Namen in beiden Sprachdateien (docs/interface.md).

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

// kind: 'synth' | 'model' | 'sample' (steuert die Gruppen im Dropdown); variants: erste = Standard;
// uses: Klangregler ('gruppe.feld' aus DEFAULT_TIMBRE), auf die die Stimme hörbar reagiert. Fuzz, Overdrive und Distortion gelten für
// jede Stimme (Verzerrerkette hinter den Stimmen) und stehen darum nicht in uses. hidden: true nimmt die Stimme aus dem Dropdown der
// Hauptoberfläche (Track-Feld, setVoices, Validierung und die Hörprobe-Seite kennen sie weiter): so bleibt sie ohne Auswahl erhalten.
export const VOICES = deepFreeze({
  bass: {
    synth: { kind: 'synth', variants: ['classic'], uses: ['bass.sub', 'bass.pluck', 'bass.cutoff', 'bass.resonance', 'bass.roundness'] },
    string: { kind: 'model', hidden: true, variants: ['finger'], uses: ['bass.sub', 'bass.pluck', 'bass.cutoff', 'bass.roundness'] },
    sample: { kind: 'sample', variants: ['finger', 'pick'], uses: ['bass.cutoff'] },
  },
  chords: {
    synth: { kind: 'synth', variants: ['classic'], uses: ['chords.brightness', 'chords.length', 'chords.chorus', 'chords.tremolo'] },
    string: { kind: 'model', hidden: true, variants: ['electric'], uses: ['chords.brightness', 'chords.length'] },
    epiano: { kind: 'synth', variants: ['rhodes'], uses: ['chords.brightness', 'chords.length', 'chords.tremolo'] },
    sample: { kind: 'sample', variants: ['guitar', 'epiano'], uses: ['chords.brightness', 'chords.length'] },
  },
  pad: {
    synth: { kind: 'synth', variants: ['classic'], uses: ['pad.attack', 'pad.cutoff', 'pad.lfoSpeed', 'pad.lfoDepth', 'pad.shimmer', 'pad.thickness'] },
    sample: { kind: 'sample', variants: ['strings', 'warm'], uses: ['pad.attack', 'pad.cutoff'] },
  },
});

export const VOICE_LAYERS = Object.freeze(Object.keys(VOICES));
export const DEFAULT_VOICE = deepFreeze({ id: 'synth', variant: 'classic' });

const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Ob `layer` die Stimme `id` (und, falls angegeben, die Variante) kennt. */
export function isVoice(layer, id, variant) {
  if (!VOICE_LAYERS.includes(layer) || typeof id !== 'string' || !Object.hasOwn(VOICES[layer], id)) return false;
  return variant === undefined || (typeof variant === 'string' && VOICES[layer][id].variants.includes(variant));
}

/** Stimmen-IDs eines Instruments in Registerreihenfolge (leer für Unbekanntes und das Schlagzeug). */
export const voicesFor = (layer) => (VOICE_LAYERS.includes(layer) ? Object.keys(VOICES[layer]) : []);

/**
 * Füllt die Stimmenwahl auf: je Instrument { id, variant }. Fehlt etwas oder ist es ungültig, gilt der Standard (synth/classic);
 * eine gültige Stimme ohne oder mit ungültiger Variante bekommt ihre erste Variante. Ein Text zählt als Stimmen-ID.
 * Neue Kopie, die Eingabe bleibt unverändert.
 */
export function completeVoices(voices) {
  const out = {};
  for (const layer of VOICE_LAYERS) {
    const given = isRecord(voices) ? voices[layer] : undefined;
    const id = typeof given === 'string' ? given : isRecord(given) ? given.id : undefined;
    if (!isVoice(layer, id)) { out[layer] = { ...DEFAULT_VOICE }; continue; }
    const variant = isRecord(given) && given.variant !== undefined && isVoice(layer, id, given.variant) ? given.variant : VOICES[layer][id].variants[0];
    out[layer] = { id, variant };
  }
  return out;
}

const ALWAYS_ON = ['fuzz', 'overdrive', 'distortion']; // die Verzerrerkette liegt hinter jeder Stimme

/**
 * Ob die gewählte Stimme den Klangregler `path` ('gruppe.feld') benutzt. Verzerrer, alle Regler außerhalb von Bass, Akkorden und Pad
 * (Schlagzeug, Summe) und Unbekanntes gelten als benutzt: ein Regler wird nie wegen eines Tippfehlers gesperrt.
 */
export function usesTimbreField(voices, path) {
  const [layer, field] = String(path).split('.');
  if (!VOICE_LAYERS.includes(layer) || field === undefined || ALWAYS_ON.includes(field)) return true;
  return VOICES[layer][completeVoices(voices)[layer].id].uses.includes(path);
}

/** Stimmenwahl eines Tracks (`track.voices`), aufgefüllt. */
export const resolveVoices = (track) => completeVoices(track?.voices);
