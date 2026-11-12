// Taktzeile: onBar zählt über Durchläufe weiter (0-basiert), angezeigt wird der Takt im Durchlauf (1-basiert).
import { t } from '../i18n/index.js';
import { chordIndex, formLength, isValidForm } from '../core/form.js';

// ohne gültige Länge keine Zeile statt "Takt NaN von 0"
export const positionLabel = (bar, length) => (length > 0 ? t('ui.bar', { n: (bar % length) + 1, total: length }) : '');

// Akkord des Takts (onBar zählt über Durchläufe weiter): mit Form beginnt die Folge in jedem Teil neu
export const chordAtBar = (track, bar) => track.bars[chordIndex(track, bar)].chord;

// Takte eines Durchlaufs, wie der Player sie zählt: mit gültiger Form die Summe der Teile (schützt vor einer abweichenden `length`), sonst `length`
export const loopBars = (track) => (isValidForm(track.form) ? formLength(track.form) : track.length);
