// Brücke zwischen dem Oberflächenzustand (state.js) und den Profil-Teilen (core/profile-parts.js): Sitzung lesen, eine geladene
// Sitzung zurückschreiben, Kurzbeschreibung für die Zeile "Aktuelle Sitzung".
import { layoutStorage } from './state.js';
import { saveMix } from './mix-state.js';
import { meterKey } from '../core/grooves.js';

const FIELDS = ['track', 'scale', 'style', 'chordColor', 'chordColorFromStyle', 'mix'];

/** Sitzung aus dem Zustand (ohne Kopie: captureParts und applyParts kopieren selbst). */
export const readSession = (state) => Object.fromEntries(FIELDS.map((k) => [k, state[k]]));

/** Geprüfte Sitzung (aus applyParts) übernehmen; der Mix wird gemerkt, abgeleitete Hinweise und Fehler gelten nicht mehr, tempoRef nur bei neuem Tempo oder neuer Taktart. */
export function writeSession(state, session) {
  // Tempo oder Taktart kommen jetzt vom Profil: der gemerkte Wert des letzten Taktartwechsels gilt nicht mehr (sonst bleibt er)
  if (state.track.bpm !== session.track.bpm || meterKey(state.track.meter) !== meterKey(session.track.meter)) delete state.tempoRef;
  for (const k of FIELDS) state[k] = session[k];
  saveMix(layoutStorage, state.mix);
  state.notice = null;
  state.errors = [];
}

/** "A-Moll-Pentatonik · 100 bpm · Stil: Funk-Rock" */
export const summary = (state, t) => t('ui.profileSessionSummary', {
  key: t('ui.keyScale', { root: state.track.key.root, scale: t(`scale.${state.scale}`) }),
  bpm: state.track.bpm,
  style: t(`style.${state.style}`),
});
