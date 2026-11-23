// Bedienelemente der Spielseite: Schlagworte und Tempo (Rack), Schichten mit Verlauf, die Folge unter dem Akkordrad und das Tonart-Modul
// (Visualisierung), die Akkordfarbe (Modul Harmonie). Alles kommt aus den Texten der Sitzung (state, derived, position) und dem Verlauf der Hülle;
// app.js ruft die zurückgegebene Funktion in jedem render() auf.
// shortcut: Griffbrett, Akkordrad und Akkordfolge (fretboard.js, wheel.js, progression-editor.js) sind noch die der Web-App und hier nicht
// eingehängt, upgrade: Task 32b-2 baut sie auf die Texte um und hängt sie hier wieder ein.
import { t } from './i18n/index.js';
import { session, send, holds } from './session.js';
import { $, setText, setAttr } from './dom.js';
import { buildTags, renderTags } from './tags-ui.js';
import { initChordColor } from './chord-color.js';
import { drawLanes, activeLayers, barStarts, setLanes } from './lanes.js';

export function initTuning({ page, current }) {
  const { LAYER_IDS, TAG_CATEGORIES } = session.tables;
  setLanes(LAYER_IDS);
  for (const name of LAYER_IDS) {
    // nur Anzeige (LED und Name); stumm schaltet allein das Mischpult
    const b = Object.assign(document.createElement('span'), { className: 'lane-label' });
    Object.assign(b.dataset, { layer: name, i18n: `layer.${name}` });
    $('lane-buttons').append(b);
  }
  $('lane-buttons').parentElement.style.setProperty('--lanes', LAYER_IDS.length); // Verlaufshöhe folgt der Schichtzahl

  buildTags($('tags'), (category, tag) => send({ action: 'toggleTag', category, tag }));
  $('tags').addEventListener('tagshown', () => renderTags($('tags'), session.state.track, $('tag-fx'))); // ein anderes Wort berührt: die Anzeige neu schreiben
  const renderChordColor = initChordColor();

  // Tonart-Modul (Tonart, Skala, folgender Akkord). Der Countdown steht in app.js.
  function renderKey() {
    const { track, scale } = session.state;
    const { next, nextName } = session.position;
    setText($('play-key'), `${track.key.root}${track.key.mode === 'minor' ? 'm' : ''}`);
    setText($('play-scale'), t(`scale.${scale}`));
    setText($('play-next'), next ? nextName : '');
    if ($('key-next').hidden !== !next) $('key-next').hidden = !next;
  }

  // Folge unter dem Akkordkreis, nur Anzeige: Rollen-Klassen wie im Modul Harmonie
  function renderWheelProgression() {
    const row = $('wheel-prog');
    const { progression } = session.position;
    while (row.children.length < progression.length) row.append(Object.assign(document.createElement('span'), { className: 'chip' }));
    while (row.children.length > progression.length) row.lastChild.remove();
    progression.forEach(({ name, degree, role }, i) => {
      setText(row.children[i], name);
      setAttr(row.children[i], 'class', `chip role-${role}`);
      setAttr(row.children[i], 'data-degree', degree);
    });
  }

  const noEvents = [];
  // LED an Instrument-Modul und Spur: an, solange die Wiedergabe läuft, die Schicht nicht stumm ist und sie in diesem Takt spielt
  function renderActivity(events) {
    const active = current() ? activeLayers(events, session.position.bar) : new Set();
    const on = (layer) => active.has(layer) && Boolean(session.state.track.layers[layer]);
    for (const led of document.querySelectorAll('.led[data-activity]')) led.classList.toggle('on', on(led.dataset.activity));
    for (const b of $('lane-buttons').children) b.classList.toggle('on', on(b.dataset.layer));
  }

  function drawCanvases() {
    if (page() !== 'play' || !session.state) return;
    const events = session.lanes?.events ?? noEvents;
    renderActivity(events);
    const sec = current() ? barStarts(events)[session.position.bar] ?? 0 : 0;
    drawLanes($('lanes'), events, sec, session.state.track.layers);
  }
  // neue Größe (Fokus ⇄ Einstellen, Fenster): neu zeichnen
  new ResizeObserver(drawCanvases).observe($('lanes'));

  // gewählte Schlagworte als Schilder (nur Anzeige); nur bei Änderung neu bauen, render() läuft je Schlag
  let wordsKey = '';
  // Wörter, die im jetzigen Zustand nichts bewirken (z. B. Klangwörter bei einer Sample-Stimme), sind blass wie im Schlagwort-Fenster
  function renderWords(track) {
    const effect = session.derived.tagEffect;
    const words = TAG_CATEGORIES.flatMap((c) => (track.tags[c.id] ?? []).map((tag) => ({ text: t(`tag.${c.id}.${tag}`), inert: !effect[tag].effective })));
    const key = words.map((w) => `${w.text}${w.inert ? '~' : ''}`).join('|');
    if (key === wordsKey) return;
    wordsKey = key;
    $('char-words').replaceChildren(...words.map((w) => Object.assign(document.createElement('li'), { className: w.inert ? 'word-tag inert' : 'word-tag', textContent: w.text, title: w.inert ? t('tagfx.none') : '' })));
  }

  return function renderTuning() {
    if (page() !== 'play') return;
    const { track } = session.state;
    renderTags($('tags'), track, $('tag-fx'));
    renderWords(track);
    // das Tempo zeigt die Antwort der Sitzung, solange ein Drehen unbeantwortet ist, die Hand; nur bei Änderung: <output>.value ersetzt den Textknoten
    const bpm = holds($('tuning-tempo')) ? $('tuning-tempo').value : String(track.bpm);
    const shown = `${bpm} ${t('ui.bpm')}`;
    for (const [id, v] of [['tuning-tempo', bpm], ['tuning-tempo-out', shown]]) {
      if ($(id).value !== v) $(id).value = v;
    }
    setAttr($('tuning-tempo'), 'aria-valuetext', shown);
    for (const b of $('lane-buttons').children) setAttr(b, 'data-muted', String(!track.layers[b.dataset.layer]));
    renderChordColor();
    renderKey();
    renderWheelProgression();
    drawCanvases();
  };
}
