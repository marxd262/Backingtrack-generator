// Taktzeile: der Takt im Durchlauf (0-basiert, position().bar) als Text, 1-basiert; die Takte eines Durchlaufs gibt state().loopBars.
import { t } from './i18n/index.js';

// ohne gültige Länge keine Zeile statt "Takt NaN von 0"
export const positionLabel = (bar, length) => (length > 0 ? t('ui.bar', { n: (bar % length) + 1, total: length }) : '');
