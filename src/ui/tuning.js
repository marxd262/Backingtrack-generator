// Feintuning-Ansicht: Schnellauswahl, Schlagworte, Tempo, Länge, Schichten mit Verlauf, Akkordfolge und Rad.
// Teilt den Zustand mit der Startseite; app.js ruft die zurückgegebene Funktion in jedem render() auf.
import { STYLE_PRESETS, buildEvents, t } from '../index.js';
import { $, LAYERS, ALL_LAYERS, LENGTHS, state, pressed, setText, preset, applyStyle } from './state.js';
import { buildTags, renderTags, toggleTag, sameTags } from './tags-ui.js';
import { initProgressionEditor, addChord } from './progression-editor.js';
import { drawLanes } from './lanes.js';
import { createWheel } from './wheel.js';

export function initTuning({ render, restartIfPlaying, player }) {
  const changed = () => { restartIfPlaying(); render(); };

  for (const { id } of STYLE_PRESETS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
    Object.assign(b.dataset, { style: id, i18n: `style.${id}` });
    b.addEventListener('click', () => { applyStyle(id); changed(); });
    $('quick-pick').append(b);
  }

  for (const n of LENGTHS) $('length').append(new Option('', String(n)));
  $('length').addEventListener('change', (e) => { state.track.length = Number(e.target.value); changed(); });

  for (const name of LAYERS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
    Object.assign(b.dataset, { layer: name, i18n: `layer.${name}` });
    b.addEventListener('click', () => {
      state.track.layers = { ...state.track.layers, [name]: !state.track.layers[name] };
      player()?.setLayer(name, state.track.layers[name]); // live, ohne Neustart
      render();
    });
    $('lane-buttons').append(b);
  }

  buildTags($('tags'), (category, tag) => {
    state.track.tags = toggleTag(state.track.tags, category, tag);
    changed();
  });

  const renderProgression = initProgressionEditor(changed, render);
  const wheelState = () => ({
    key: state.track.key,
    progression: state.track.bars.map((b) => b.chord),
    current: state.playing && state.current ? state.current.chord : null,
  });
  const wheel = createWheel($('wheel'), wheelState(), (chord) => (addChord(chord) ? changed() : render()));

  // Ereignisse nur neu bauen, wenn sich Folge, Schlagworte, Variante oder Länge ändern. Tempo und Schichten
  // fehlen im Schlüssel: die x-Achse sind Takte, stumme Spuren werden nur gedimmt gezeichnet.
  let memo = { id: '', events: [] };
  function laneEvents() {
    const { key, bars, tags, seed, length } = state.track;
    const id = JSON.stringify([key, bars, tags, seed, length]);
    if (id !== memo.id) {
      let events = [];
      try { events = buildEvents({ ...state.track, layers: ALL_LAYERS }); } catch { /* ungültiger Track: leerer Verlauf */ }
      memo = { id, events, starts: events.filter((e) => e.type === 'chord').map((e) => e.t) };
    }
    return memo;
  }

  function drawCanvases() {
    if (!state.tuningOpen) return;
    const { events, starts } = laneEvents();
    const sec = state.current ? starts[state.current.bar % state.track.length] ?? 0 : 0;
    drawLanes($('lanes'), events, sec, state.track.layers);
    wheel.update(wheelState());
  }
  new ResizeObserver(drawCanvases).observe($('lanes'));
  new ResizeObserver(drawCanvases).observe($('wheel'));

  return function renderTuning() {
    if (!state.tuningOpen) return;
    const { track } = state;
    for (const b of $('quick-pick').children) {
      const p = preset(b.dataset.style);
      pressed(b, p.bpm === track.bpm && sameTags(p.tags, track.tags));
    }
    renderTags($('tags'), track.tags);
    // nur bei Änderung: <output>.value ersetzt den Textknoten, die offene Längen-Auswahl bleibt unberührt
    for (const [id, v] of [['tuning-tempo', track.bpm], ['tuning-tempo-out', track.bpm], ['length', track.length]]) {
      if ($(id).value !== String(v)) $(id).value = String(v);
    }
    for (const o of $('length').options) setText(o, t('ui.barsCount', { n: o.value }));
    for (const b of $('lane-buttons').children) pressed(b, track.layers[b.dataset.layer]);
    renderProgression();
    drawCanvases();
  };
}
