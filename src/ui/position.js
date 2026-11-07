// Taktzeile: onBar zählt über Durchläufe weiter (0-basiert), angezeigt wird der Takt im Durchlauf (1-basiert).
import { t } from '../i18n/index.js';

export const positionLabel = (bar, length) => t('ui.bar', { n: (bar % length) + 1, total: length });
