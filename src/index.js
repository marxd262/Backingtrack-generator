// Öffentliche Schnittstelle (für Interactive Scales); lädt auch in reinem Node ohne Browser-Globals.
import { normalizeTrack, validateTrack as coreValidateTrack } from './core/track.js';
export { play } from './audio/play.js';
export { buildEvents, DRUM_NAMES, PERCUSSION_NAMES } from './core/events.js';
export { chordTimeline } from './core/timeline.js';
export { TAG_CATEGORIES, STYLE_PRESETS } from './core/tags.js';
export { VALIDATION_CODES } from './core/track.js';
export { allowedChords } from './core/music.js';
export { CHORDS, chordName } from './core/chords.js';
export { chordOptions } from './core/music.js';
export { METERS, GROOVES } from './core/grooves.js';
export { LAYER_IDS, layerDefaults, jobsFor, isJob, completeJobs } from './core/layers.js';
export { VOICES } from './core/voices.js';
/** Öffentliche Prüfung: wendet erst die Standardwerte an, meldet also dieselben Codes, die buildEvents werfen würde. */
export const validateTrack = (track) => coreValidateTrack(normalizeTrack(track));
export { t, setLanguage, getLanguage } from './i18n/index.js';
