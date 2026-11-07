// Taktzeile: onBar zählt über Durchläufe weiter (0-basiert), angezeigt wird der Takt im Durchlauf (1-basiert).
import { t } from '../i18n/index.js';

// ohne gültige Länge keine Zeile statt "Takt NaN von 0"
export const positionLabel = (bar, length) => (length > 0 ? t('ui.bar', { n: (bar % length) + 1, total: length }) : '');
