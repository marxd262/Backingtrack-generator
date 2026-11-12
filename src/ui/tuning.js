// Bedienelemente der Spielseite: Schlagworte, Tempo, Länge (Leiste "Klang"), Schichten mit Verlauf,
// Griffbrett und Akkordrad (Blöcke), Akkordfolge (Leiste "Akkorde"). Teilt den Zustand mit der Startseite; app.js ruft die
// zurückgegebene Funktion in jedem render() auf.
import { buildEvents, t } from '../index.js';
import { $, LAYERS, ALL_LAYERS, state, layoutStorage, chordName, pressed, setText } from './state.js';
import { saveLayout } from './layout-state.js';
import { loopBars } from './position.js';
import { nextDistinctChord } from '../core/fretboard.js';
import { createFretboard, chordSentence } from './fretboard.js';
import { buildTags, renderTags, toggleTag } from './tags-ui.js';
import { isSoundOnlyChange } from '../core/tags.js';
import { initProgressionEditor, addChord } from './progression-editor.js';
import { initChordColor } from './chord-color.js';
import { drawLanes, laneKey } from './lanes.js';
import { createWheel } from './wheel.js';

export function initTuning({ render, restartIfPlaying, toggleLayer, applyLive }) {
  const changed = () => { restartIfPlaying(); render(); };

  for (const name of LAYERS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
    Object.assign(b.dataset, { layer: name, i18n: `layer.${name}` });
    b.addEventListener('click', () => { toggleLayer(name); render(); });
    $('lane-buttons').append(b);
  }
  $('lane-buttons').parentElement.style.setProperty('--lanes', LAYERS.length); // Verlaufshöhe folgt der Schichtzahl

  buildTags($('tags'), (category, tag) => {
    const before = state.track.tags;
    state.track.tags = toggleTag(before, category, tag);
    // live, ohne Neustart: reiner Klang nur über setTimbre, sonst ändert sich auch der Ereignisstrom
    applyLive({ patterns: !isSoundOnlyChange(before, state.track.tags) });
    render();
  });

  const renderProgression = initProgressionEditor(changed, render);
  const renderChordColor = initChordColor({ changed });
  const wheelState = () => ({
    key: state.track.key,
    progression: state.track.bars.map((b) => b.chord),
    current: state.playing && state.current ? state.current.chord : null,
  });
  const fretboard = createFretboard($('fretboard'));
  for (const b of document.querySelectorAll('[data-labels]')) {
    b.addEventListener('click', () => {
      state.layout = { ...state.layout, labels: b.dataset.labels };
      saveLayout(layoutStorage, state.layout);
      render();
    });
  }

  // Griffbrett, folgender Akkord in der Kopfzeile und Textfassung; im Stand der erste Akkord der Folge
  function renderFretboard() {
    const { track } = state;
    const current = state.current?.chord ?? track.bars[0]?.chord ?? null;
    const next = nextDistinctChord(track.bars, track.length, state.current?.bar ?? 0, track.form);
    fretboard.update({ key: track.key, scale: state.scale, current, next, labels: state.layout.labels });
    for (const b of document.querySelectorAll('[data-labels]')) pressed(b, b.dataset.labels === state.layout.labels);
    setText($('play-next'), next ? `${t('ui.nextChord')}: ${chordName(next)}` : '');
    setText($('fretboard-text'), chordSentence(track.key, current, next));
  }

  const wheel = createWheel($('wheel'), wheelState(), (chord) => (addChord(chord) ? changed() : render()));

  // Ereignisse nur neu bauen, wenn sich der Schlüssel (laneKey) ändert; Tempo und Schichten gehören nicht dazu.
  let memo = { id: '', events: [] };
  function laneEvents() {
    const id = laneKey(state.track);
    if (id !== memo.id) {
      let events = [];
      try { events = buildEvents({ ...state.track, layers: ALL_LAYERS }); } catch { /* ungültiger Track: leerer Verlauf */ }
      memo = { id, events, starts: events.filter((e) => e.type === 'chord').map((e) => e.t) };
    }
    return memo;
  }

  // Akkordrad zeichnet nur bei sichtbarem Block (Ansichten-Schalter); beim Einblenden ruft render() erneut
  const wheelShown = () => !$('wheel').closest('section[data-view]').hidden;

  function drawCanvases() {
    if (state.page !== 'play') return;
    const { events, starts } = laneEvents();
    const sec = state.current ? starts[state.current.bar % loopBars(state.track)] ?? 0 : 0;
    drawLanes($('lanes'), events, sec, state.track.layers);
    if (wheelShown()) wheel.update(wheelState());
  }
  new ResizeObserver(drawCanvases).observe($('lanes'));
  new ResizeObserver(drawCanvases).observe($('wheel'));

  return function renderTuning() {
    if (state.page !== 'play') return;
    const { track } = state;
    renderTags($('tags'), track.tags);
    // nur bei Änderung: <output>.value ersetzt den Textknoten
    for (const [id, v] of [['tuning-tempo', track.bpm], ['tuning-tempo-out', track.bpm]]) {
      if ($(id).value !== String(v)) $(id).value = String(v);
    }
    for (const b of $('lane-buttons').children) pressed(b, track.layers[b.dataset.layer]);
    renderProgression();
    renderChordColor();
    renderFretboard();
    drawCanvases();
  };
}
