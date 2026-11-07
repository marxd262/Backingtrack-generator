// Öffentliche Schnittstelle (für Interactive Scales); lädt auch in reinem Node ohne Browser-Globals.
export { play } from './audio/play.js';
export { buildEvents } from './core/events.js';
export { chordTimeline } from './core/timeline.js';
export { TAG_CATEGORIES, STYLE_PRESETS } from './core/tags.js';
export { validateTrack } from './core/track.js';
export { t, setLanguage, getLanguage } from './i18n/index.js';
