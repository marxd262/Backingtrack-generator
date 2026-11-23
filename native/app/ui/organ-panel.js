// Orgel im Akkord-Modul: zwei Knöpfe in Zeile 2 des Knopfrasters (bei den Akkorden sonst frei), sichtbar nur, solange die Akkorde die
// Tonewheel-Orgel spielen (derived().voices). Leslie: Wähler mit vier Stellungen (aus, langsam, automatisch, schnell; automatisch = schnell in Refrain und Aufbau),
// Orgel-Zerre: 0..100 %, zeigt die Zerre des gewählten Presets (derived().presetDrive), bis der Nutzer dreht (Doppelklick stellt sie wieder her).
// Die Wahl ist die Aktion setLeslie oder setOrganDrive; was der Player davon bekommt, gibt die Hülle ihm (tuning()).
import { t } from './i18n/index.js';
import { session, send, holds } from './session.js';
import { setAttr } from './dom.js';
import { createKnob } from './knob.js';

const el = (tag, props) => Object.assign(document.createElement(tag), props);

export function initOrgan() {
  const { LESLIE_MODES, DEFAULT_ORGAN } = session.tables;
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
    send({ action: 'setLeslie', mode: LESLIE_MODES[Number(leslie.input.value)] }, leslie.input);
    show();
  });
  drive.input.addEventListener('input', () => {
    send({ action: 'setOrganDrive', value: Number(drive.input.value) }, drive.input);
    show();
  });
  // Doppelklick: zurück zur Zerre des Presets (nach dem Knopf selbst, der auf 0 stellt)
  driveKnob.wrap.addEventListener('dblclick', () => send({ action: 'setOrganDrive', value: null }, drive.input));

  function show() {
    const { organ } = session.state;
    const mode = holds(leslie.input) ? leslie.input.value : String(Math.max(0, LESLIE_MODES.indexOf(organ.leslie)));
    if (leslie.input.value !== mode) leslie.input.value = mode;
    const where = t(`ui.leslie.${LESLIE_MODES[Number(mode)]}`);
    setAttr(leslie.input, 'aria-valuetext', where);
    setAttr(leslie.box, 'data-hint', where);
    const percent = holds(drive.input) ? drive.input.value : String(Math.round((organ.drive ?? session.derived.presetDrive) * 100));
    if (drive.input.value !== percent) drive.input.value = percent;
    const amount = t('ui.percent', { n: percent });
    setAttr(drive.input, 'aria-valuetext', amount);
    setAttr(drive.box, 'data-hint', amount);
  }

  return function renderOrgan() {
    const shown = session.derived.voices.chords.id === 'organ';
    for (const { box } of [leslie, drive]) if (box.hidden === shown) box.hidden = !shown;
    show();
  };
}
