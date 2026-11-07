// Öffentliche Schnittstelle (für Interactive Scales); lädt auch in reinem Node ohne Browser-Globals.
import { normalizeTrack, validateTrack as coreValidateTrack } from './core/track.js';
export { play } from './audio/play.js';
export { buildEvents } from './core/events.js';
export { chordTimeline } from './core/timeline.js';
export { TAG_CATEGORIES, STYLE_PRESETS } from './core/tags.js';
export { VALIDATION_CODES } from './core/track.js';
export { allowedChords } from './core/music.js';
/** Öffentliche Prüfung: wendet erst die Standardwerte an, meldet also dieselben Codes, die buildEvents werfen würde. */
export const validateTrack = (track) => coreValidateTrack(normalizeTrack(track));
export { t, setLanguage, getLanguage } from './i18n/index.js';
