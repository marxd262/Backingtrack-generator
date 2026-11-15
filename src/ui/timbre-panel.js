// Klangknöpfe im Rack: je Instrument ein Modul (section.module.instrument[data-layer]), je Klangfeld (core/timbre.js) ein kleiner Knopf
// 0..100 %; die Gesamt-Felder (master) sind mittlere Knöpfe im Mixer (#mixer-master). Ein bewegter Knopf überschreibt nur sein Feld in
// state.track.timbre und gewinnt gegen die Schlagworte; der Wert wirkt live über player.setTimbre. Das Modul legt auch die Plätze
// für Stimme (.inst-voice) und Aufgabe (.inst-job) an, die voices-panel.js und jobs-panel.js füllen: so bleibt die Tab-Reihenfolge
// Stimme, Aufgabe, Knöpfe, Zurücksetzen.
import { t } from '../index.js';
import { $, state, setAttr } from './state.js';
import { DEFAULT_TIMBRE, resolveTrackTimbre } from '../core/timbre.js';
import { usesTimbreField } from '../core/voices.js';
import { LAYER_IDS } from '../core/layers.js';
import { createKnob } from './knob.js';
import { KNOB_SLOTS, RESET_SLOT } from './knob-slots.js';

const el = (tag, props) => Object.assign(document.createElement(tag), props);

export function initTimbrePanel({ render, player }) {
  const rows = []; // { group, field, input }
  const resets = {}; // Zurücksetzen-Knopf je Gruppe
  const push = () => player()?.setTimbre(resolveTrackTimbre(state.track)); // live, ohne Neustart

  // Platz im Raster: Knopfzeilen 1 und 2 sind die Rasterzeilen 1 und 2, dann die Punktlinie (Rasterzeile 3), Knopfzeilen 3 und 4 darunter
  const place = (cell, [row, col]) => { cell.style.gridArea = `${row > 2 ? row + 1 : row} / ${col}`; };

  // Knöpfe einer Gruppe in host; Ursprung des Bogens: Mitte, wenn der Standard 0,5 ist, sonst linker Anschlag.
  // slots (Instrument-Module): fester Platz je Feld; die Knöpfe stehen dann auch im Dokument in dieser Reihenfolge (Tab = Leserichtung).
  function buildKnobs(group, host, size, slots) {
    const fields = DEFAULT_TIMBRE[group] ?? {};
    const order = Object.keys(fields);
    if (slots) order.sort((a, b) => slots[a][0] - slots[b][0] || slots[a][1] - slots[b][1]);
    for (const field of order) {
      const cell = el('div', { className: 'knob-cell' });
      if (slots) place(cell, slots[field]);
      const input = el('input', { type: 'range', id: `timbre-${group}-${field}`, min: '0', max: '100', step: '1' });
      const label = el('label', { htmlFor: input.id, className: 'lbl' });
      label.dataset.i18n = `timbre.${group}.${field}`;
      cell.append(input, label);
      host.append(cell); // erst einhängen, dann der Knopf: die Liste der Knöpfe wirft Entfernte hinaus
      createKnob(input, { size, origin: fields[field] === 0.5 ? 'center' : 'start' });
      input.addEventListener('input', () => {
        const timbre = state.track.timbre;
        state.track.timbre = { ...timbre, [group]: { ...timbre[group], [field]: Number(input.value) / 100 } };
        push();
        render();
      });
      rows.push({ group, field, input });
    }
    if (!Object.keys(fields).length) return; // ohne Knöpfe kein Zurücksetzen
    // Zurücksetzen: runder Taster als letzte Zelle des Rasters, Name darunter wie bei den Knöpfen (so bleibt das Modul eine Reihe hoch)
    const cell = el('div', { className: 'knob-cell' });
    const reset = el('button', { type: 'button', className: 'push timbre-reset', textContent: '\u21BA' });
    reset.dataset.i18nLabel = 'ui.timbreReset';
    const caption = el('span', { className: 'lbl' });
    caption.dataset.i18n = 'ui.timbreReset';
    caption.setAttribute('aria-hidden', 'true'); // der Taster trägt den Namen (aria-label)
    reset.addEventListener('click', () => {
      const { [group]: removed, ...rest } = state.track.timbre;
      state.track.timbre = rest;
      push();
      render();
      // der Knopf ist jetzt deaktiviert und verlöre den Fokus an body: im Modul bleiben;
      // der erste Knopf kann bei der gewählten Stimme ausgegraut sein (focus() wirkt dort nicht): den ersten bedienbaren nehmen
      rows.find((r) => r.group === group && !r.input.disabled)?.input.focus();
    });
    resets[group] = reset;
    cell.append(reset, caption);
    if (slots) place(cell, RESET_SLOT);
    host.append(cell);
  }

  // ein Modul je Schicht (Reihenfolge LAYER_IDS); Percussion hat keine Klangfelder und teilt den Raum mit dem Schlagzeug
  for (const layer of LAYER_IDS) {
    const module = el('section', { className: 'module instrument' });
    module.dataset.layer = layer;
    module.setAttribute('aria-labelledby', `inst-title-${layer}`);
    const title = el('h3', { className: 'module-title', id: `inst-title-${layer}` });
    const led = el('span', { className: 'led' });
    led.dataset.activity = layer; // tuning.js schaltet sie je Takt
    const name = el('span');
    name.dataset.i18n = `layer.${layer}`;
    title.append(led, name);
    // jedes Modul gleich aufgebaut: Stimme, darunter das Raster. Die Aufgabe (Lead, Percussion) belegt im Raster die Zeilen 1 und 2,
    // wo die anderen ihre eigenen Klangknöpfe haben; ohne Klangfelder (Percussion) steht unten der Hinweis statt der Knöpfe.
    const fields = DEFAULT_TIMBRE[layer];
    const knobs = el('div', { className: 'inst-knobs' });
    const divider = el('div', { className: 'inst-divider' });
    divider.setAttribute('aria-hidden', 'true');
    knobs.append(el('div', { className: 'inst-job' }));
    module.append(title, el('div', { className: 'inst-voice' }), knobs);
    $('rack-instruments').append(module);
    if (fields) buildKnobs(layer, knobs, 's', KNOB_SLOTS[layer]);
    else {
      const hint = el('p', { className: 'hint' });
      hint.dataset.i18n = 'ui.percussionHint';
      knobs.append(hint);
    }
    knobs.append(divider);
  }
  // die übrigen Gruppen (Gesamt) gehören zum Mixer
  for (const group of Object.keys(DEFAULT_TIMBRE).filter((id) => !LAYER_IDS.includes(id))) buildKnobs(group, $('mixer-master'), 'm');

  return function renderTimbre() {
    const effective = resolveTrackTimbre(state.track);
    for (const { group, field, input } of rows) {
      const percent = String(Math.round(effective[group][field] * 100));
      // nur bei Änderung: ein gerade gezogener Knopf soll nicht neu gesetzt werden
      if (input.value !== percent) input.value = percent;
      // Knöpfe, die die gewählte Stimme nicht benutzt, sind ausgegraut (die Verzerrer gelten für jede Stimme)
      const off = !usesTimbreField(state.track.voices, `${group}.${field}`);
      if (input.disabled !== off) input.disabled = off;
      // kleine Anzeige über dem Knopf beim Überfahren und Bedienen (CSS, .knob-cell[data-hint]): der Wert, bei ausgegrauten Knöpfen der Grund
      setAttr(input.closest('.knob-cell'), 'data-hint', off ? t('ui.knobUnused') : t('ui.percent', { n: percent }));
      setAttr(input, 'aria-valuetext', t('ui.percent', { n: percent }));
    }
    for (const [group, button] of Object.entries(resets)) {
      const off = Object.keys(state.track.timbre[group] ?? {}).length === 0;
      if (button.disabled !== off) button.disabled = off;
    }
  };
}
