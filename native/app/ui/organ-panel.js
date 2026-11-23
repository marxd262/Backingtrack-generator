// Orgel im Akkord-Modul: zwei Knöpfe in Zeile 2 des Knopfrasters (bei den Akkorden sonst frei), sichtbar nur, solange die Akkorde die
// Tonewheel-Orgel spielen. Leslie: Wähler mit vier Stellungen (aus, langsam, automatisch, schnell; automatisch = schnell in Refrain und Aufbau),
// Orgel-Zerre: 0..100 %, zeigt die Zerre des gewählten Presets, bis der Nutzer dreht (Doppelklick stellt sie wieder her).
// Die Wahl steht in state.organ, geht als Feinwert an den Player (setTuning, wirkt ab dem nächsten Ton) und steht im Profil-Teil Klangregler.
import { t } from '../index.js';
import { state, setAttr } from './state.js';
import { createKnob } from './knob.js';
import { completeVoices } from '../core/voices.js';
import { LESLIE_MODES, DEFAULT_ORGAN, organTuning, presetDrive } from './organ-tuning.js';

const el = (tag, props) => Object.assign(document.createElement(tag), props);

export function initOrgan({ render, player }) {
  const grid = document.querySelector('.instrument[data-layer="chords"] .inst-knobs');
  // vor den Effekten einhängen: Tab-Reihenfolge wie die Leserichtung im Raster
  const before = grid.querySelector('.knob-cell:has(#timbre-chords-fuzz)');
  function cell(id, column, labelKey, attrs) {
    const box = el('div', { className: 'knob-cell', hidden: true });
    box.style.gridArea = `2 / ${column}`;
    const input = el('input', { type: 'range', id, ...attrs });
    const label = el('label', { htmlFor: id, className: 'lbl' });
    label.dataset.i18n = labelKey;
    box.append(input, label);
    grid.insertBefore(box, before);
    return { box, input };
  }
  const leslie = cell('organ-leslie', 1, 'ui.leslie', { min: '0', max: String(LESLIE_MODES.length - 1), step: '1' });
  const drive = cell('organ-drive', 2, 'ui.organDrive', { min: '0', max: '100', step: '1' });
  createKnob(leslie.input, { origin: 'start', size: 's', resetValue: LESLIE_MODES.indexOf(DEFAULT_ORGAN.leslie) });
  const driveKnob = createKnob(drive.input, { origin: 'start', size: 's' });

  leslie.input.addEventListener('input', () => {
    state.organ = { ...state.organ, leslie: LESLIE_MODES[Number(leslie.input.value)] };
    render();
  });
  drive.input.addEventListener('input', () => {
    state.organ = { ...state.organ, drive: Number(drive.input.value) / 100 };
    render();
  });
  // Doppelklick: zurück zur Zerre des Presets (nach dem Knopf selbst, der auf 0 stellt)
  driveKnob.wrap.addEventListener('dblclick', () => {
    state.organ = { ...state.organ, drive: null };
    render();
  });

  let pushed = JSON.stringify(organTuning(state.organ));
  return function renderOrgan() {
    const { id, variant } = completeVoices(state.track.voices).chords;
    const shown = id === 'organ';
    for (const { box } of [leslie, drive]) if (box.hidden === shown) box.hidden = !shown;
    const mode = String(Math.max(0, LESLIE_MODES.indexOf(state.organ.leslie)));
    if (leslie.input.value !== mode) leslie.input.value = mode;
    const where = t(`ui.leslie.${LESLIE_MODES[Number(mode)]}`);
    setAttr(leslie.input, 'aria-valuetext', where);
    setAttr(leslie.box, 'data-hint', where);
    const percent = String(Math.round((state.organ.drive ?? presetDrive(variant)) * 100));
    if (drive.input.value !== percent) drive.input.value = percent;
    const amount = t('ui.percent', { n: percent });
    setAttr(drive.input, 'aria-valuetext', amount);
    setAttr(drive.box, 'data-hint', amount);
    // jede Änderung (Knopf, Profil, Weitermachen) geht einmal an den laufenden Player
    const tuning = organTuning(state.organ);
    const key = JSON.stringify(tuning);
    if (key !== pushed) { pushed = key; player()?.setTuning(tuning); }
  };
}
