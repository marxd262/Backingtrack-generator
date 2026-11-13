// Bedienelemente der Spielseite: Schlagworte und Tempo (Rack), Schichten mit Verlauf,
// Griffbrett und Akkordrad (Visualisierung), Akkordfolge (Modul Harmonie). Teilt den Zustand mit der Startseite; app.js ruft die
// zurückgegebene Funktion in jedem render() auf.
import { buildEvents, t, TAG_CATEGORIES } from '../index.js';
import { $, LAYERS, ALL_LAYERS, state, layoutStorage, chordName, pressed, setText, setAttr } from './state.js';
import { saveLayout } from './layout-state.js';
import { loopBars } from './position.js';
import { nextDistinctChord, progressionRoles, romanDegree } from '../core/fretboard.js';
import { createFretboard, chordSentence } from './fretboard.js';
import { buildTags, renderTags, toggleTag } from './tags-ui.js';
import { isSoundOnlyChange } from '../core/tags.js';
import { initProgressionEditor, addChord } from './progression-editor.js';
import { initChordColor } from './chord-color.js';
import { drawLanes, laneKey, activeLayers } from './lanes.js';
import { createWheel } from './wheel.js';

export function initTuning({ render, restartIfPlaying, applyLive }) {
  const changed = () => { restartIfPlaying(); render(); };

  for (const name of LAYERS) {
    // nur Anzeige (LED und Name); stumm schaltet allein das Mischpult
    const b = Object.assign(document.createElement('span'), { className: 'lane-label' });
    Object.assign(b.dataset, { layer: name, i18n: `layer.${name}` });
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
  // Folgender Akkord (erster andere, auch über die Naht); im Stand beginnt die Folge bei Takt 0
  const nextChord = () => nextDistinctChord(state.track.bars, state.track.length, state.current?.bar ?? 0, state.track.form);
  const wheelState = () => ({
    key: state.track.key,
    progression: state.track.bars.map((b) => b.chord),
    current: state.playing && state.current ? state.current.chord : null,
    next: state.playing && state.current ? nextChord() : null,
  });
  const fretboard = createFretboard($('fretboard'));
  // Umschalter im Modulkopf: gewählter Wert wird mit der Seite gemerkt
  for (const attr of ['labels', 'frets']) {
    for (const b of document.querySelectorAll(`[data-${attr}]`)) {
      b.addEventListener('click', () => {
        state.layout = { ...state.layout, [attr]: b.dataset[attr] };
        saveLayout(layoutStorage, state.layout);
        render();
      });
    }
  }

  // Tonart-Modul (Tonart, Skala, folgender Akkord), Griffbrett und Textfassung; im Stand der erste Akkord der Folge.
  // Der Countdown schreibt app.js über eigene Bildzeitschleife, nicht hier.
  function renderFretboard() {
    const { track } = state;
    const current = state.current?.chord ?? track.bars[0]?.chord ?? null;
    const next = nextChord();
    fretboard.update({ key: track.key, scale: state.scale, current, next, labels: state.layout.labels, spacing: state.layout.frets });
    for (const attr of ['labels', 'frets']) {
      for (const b of document.querySelectorAll(`[data-${attr}]`)) pressed(b, b.dataset[attr] === state.layout[attr]);
    }
    setText($('play-key'), `${track.key.root}${track.key.mode === 'minor' ? 'm' : ''}`);
    setText($('play-scale'), t(`scale.${state.scale}`));
    setText($('play-next'), next ? chordName(next) : '');
    if ($('key-next').hidden !== !next) $('key-next').hidden = !next;
    setText($('fretboard-text'), chordSentence(track.key, current, next));
  }

  // Folge unter dem Akkordkreis, nur Anzeige: Rollen-Klassen wie im Modul Harmonie
  function renderWheelProgression() {
    const row = $('wheel-prog');
    const { track } = state;
    const roles = progressionRoles(track, state.current?.bar ?? null);
    while (row.children.length < track.bars.length) row.append(Object.assign(document.createElement('span'), { className: 'chip' }));
    while (row.children.length > track.bars.length) row.lastChild.remove();
    track.bars.forEach(({ chord }, i) => {
      setText(row.children[i], chordName(chord));
      setAttr(row.children[i], 'class', `chip role-${roles[i]}`);
      setAttr(row.children[i], 'data-degree', romanDegree(track.key, chord));
    });
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

  // Akkordrad zeichnet nur, wenn es sichtbar ist; beim Einblenden zeichnet der ResizeObserver
  const wheelShown = () => $('wheel').checkVisibility();

  // LED an Instrument-Modul und Spur: an, solange die Wiedergabe läuft, die Schicht nicht stumm ist und sie in diesem Takt spielt
  function renderActivity(events) {
    const active = state.playing && state.current ? activeLayers(events, state.current.bar % loopBars(state.track)) : new Set();
    const on = (layer) => active.has(layer) && Boolean(state.track.layers[layer]);
    for (const led of document.querySelectorAll('.led[data-activity]')) led.classList.toggle('on', on(led.dataset.activity));
    for (const b of $('lane-buttons').children) b.classList.toggle('on', on(b.dataset.layer));
  }

  function drawCanvases() {
    if (state.page !== 'play') return;
    const { events, starts } = laneEvents();
    renderActivity(events);
    const sec = state.current ? starts[state.current.bar % loopBars(state.track)] ?? 0 : 0;
    drawLanes($('lanes'), events, sec, state.track.layers);
    fretboard.resize(); // neue Größe oder anderer Bundabstand: Brett neu aufbauen
    if (wheelShown()) wheel.update(wheelState());
  }
  // neue Größe (Fokus ⇄ Einstellen, Fenster): neu zeichnen
  const resized = new ResizeObserver(drawCanvases);
  for (const id of ['fretboard', 'wheel', 'lanes']) resized.observe($(id));

  // gewählte Schlagworte als Schilder (nur Anzeige); nur bei Änderung neu bauen, render() läuft je Takt
  let wordsKey = '';
  function renderWords(tags) {
    const words = TAG_CATEGORIES.flatMap((c) => (tags[c.id] ?? []).map((tag) => t(`tag.${c.id}.${tag}`)));
    const key = words.join('|');
    if (key === wordsKey) return;
    wordsKey = key;
    $('char-words').replaceChildren(...words.map((w) => Object.assign(document.createElement('li'), { className: 'word-tag', textContent: w })));
  }

  return function renderTuning() {
    if (state.page !== 'play') return;
    const { track } = state;
    renderTags($('tags'), track.tags);
    renderWords(track.tags);
    // nur bei Änderung: <output>.value ersetzt den Textknoten
    const shown = `${track.bpm} ${t('ui.bpm')}`;
    for (const [id, v] of [['tuning-tempo', String(track.bpm)], ['tuning-tempo-out', shown]]) {
      if ($(id).value !== v) $(id).value = v;
    }
    setAttr($('tuning-tempo'), 'aria-valuetext', shown);
    for (const b of $('lane-buttons').children) setAttr(b, 'data-muted', String(!track.layers[b.dataset.layer]));
    renderProgression();
    renderChordColor();
    renderFretboard();
    renderWheelProgression();
    drawCanvases();
  };
}
