// Songform-Oberfläche, reine Helfer ohne DOM: was davon der Seite bleibt, die Texte der Takte und der Beschriftungen und das Ziehen am Griff.
// Blöcke, Beschriftungen, Grenzen und die Bearbeitungen der Teile gibt die Sitzung (derived().form, Aktionen).
import { t } from './i18n/index.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Takte mit Einheit: "8 Takte", "1 Takt". */
export const barsText = (n) => t(n === 1 ? 'form.bars.one' : 'ui.barsCount', { n });

/** Beschriftung von Pegel oder Dichte aus derived().form: ein fertiger Text oder eine Meldung { key, params }, deren Parameter selbst Meldungen sein können. */
export const labelText = (label) => (typeof label === 'object' ? t(label.key, Object.fromEntries(Object.entries(label.params).map(([k, v]) => [k, labelText(v)]))) : label);

/** Neue Länge in Takten aus einem Ziehen des Griffs: dx Pixel bei pxPerBar Pixeln je Takt, auf ganze Takte gerundet und auf min..max begrenzt. */
export const barsFromDrag = (startBars, dx, pxPerBar, { min, max }) => (pxPerBar > 0 ? clamp(Math.round(startBars + dx / pxPerBar), min, max) : startBars);
