// Start- und Spielseite: ein Zustandsobjekt (state.js), render() schreibt daraus alle Texte und Attribute neu.
import { play, STYLE_PRESETS, validateTrack, t, setLanguage } from '../index.js';
import { positionLabel } from './position.js';
import { $, LAYERS, ALL_LAYERS, state, layoutStorage, chordName, rollVariant, preset, pressed, setText, setAttr, saveLang, deriveBars, applyStyle } from './state.js';
import { saveLayout } from './layout-state.js';
import { initTuning } from './tuning.js';
import { initMixer } from './mixer.js';
import { stepVariant } from './variant.js';
import { buildKeyScale } from './key-scale.js';
import { initSidebar } from './sidebar.js';
import { initGroups } from './groups.js';
import { initViews } from './blocks.js';

// Dekoratives 16tel-Bild je Stil, 1 = Schlag
const RHYTHMS = { funk: '1001001010100110', psych: '1010101010101010', dreamy: '1000000010000000' };

// --- Wiedergabe: ein AudioContext für alle Starts, nie zwei Player gleichzeitig ---
let ctx = null;
let player = null;

function start(startBar = 0) {
  state.errors = [];
  const { master, ...layerLevels } = state.mix;
  try {
    ctx ??= new AudioContext(); // nur aus einem Klick heraus aufgerufen
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // alle Schichten erzeugen und stumme per setLayer leise schalten, damit Einschalten live ohne Neustart klingt
    player = play(ctx, { ...state.track, layers: ALL_LAYERS }, {
      loops: Infinity, // läuft bis Stopp
      startBar,
      levels: layerLevels, // Mischpult von der ersten Note an
      master,
      onBar: (b) => { state.current = b; render(); },
      onEnd: () => { stop(); render(); },
    });
    for (const name of LAYERS) if (!state.track.layers[name]) player.setLayer(name, false);
    state.playing = true;
  } catch {
    player?.stop();
    player = null;
    const found = validateTrack(state.track);
    state.errors = found.length ? found : [{ code: 'playFailed', params: {} }];
  }
}

function stop() {
  player?.stop();
  player = null;
  state.playing = false;
  state.current = null;
}

// inPlace: nur der Klang hat sich geändert (Ereignisstrom gleich), also im laufenden Takt weiter statt ab Takt 1;
// sonst hörte man neue Akkord- und Pad-Klänge im langsamen Aufbau erst nach vielen Takten
function restartIfPlaying({ inPlace = false } = {}) {
  if (!state.playing) return;
  const current = inPlace ? state.current : null;
  stop();
  start(current ? current.bar % state.track.length : 0);
  // derselbe Takt beginnt neu: Taktzeile, Verlauf und Griffbrett bleiben dort, statt bis zum ersten onBar leer zu sein;
  // der Akkord kommt aus der (bei einer neuen Variante anderen) Folge
  if (current && state.playing) state.current = { ...current, chord: state.track.bars[current.bar % state.track.bars.length].chord };
}

// Schicht ein/aus: gemeinsamer Zustand von Schichtknöpfen und Mischpult-Tasten, live ohne Neustart
function toggleLayer(name) {
  state.track.layers = { ...state.track.layers, [name]: !state.track.layers[name] };
  player?.setLayer(name, state.track.layers[name]);
}

// --- Aufbau der Auswahl (einmal), Texte kommen aus render() ---
function chip(parent, data, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  Object.assign(b.dataset, data);
  b.addEventListener('click', () => { onClick(); render(); });
  parent.append(b);
  return b;
}

// Tonart und Skala: im Popover der Startseite und in der rechten Leiste der Spielseite
const keyScales = [['key-chips', 'scale-chips'], ['side-key-chips', 'side-scale-chips']].map(([keyChips, scaleChips]) =>
  buildKeyScale({ keyChips: $(keyChips), scaleChips: $(scaleChips) }, { restartIfPlaying, render: () => render() }));

for (const { id } of STYLE_PRESETS) {
  const card = chip($('style-cards'), { style: id }, () => {
    applyStyle(id);
    restartIfPlaying();
    $('style-pop').hidePopover();
  });
  card.className = 'card';
  card.innerHTML = '<span class="card-name"></span><span class="card-bpm"></span><span class="card-hint"></span><span class="rhythm" aria-hidden="true"></span>';
  for (const step of RHYTHMS[id]) card.lastChild.append(Object.assign(document.createElement('i'), { className: step === '1' ? 'on' : '' }));
}

// Tempo-Regler im Popover und in der Leiste "Klang" teilen sich den Zustand
for (const id of ['tempo', 'tuning-tempo']) {
  $(id).addEventListener('input', (e) => {
    state.track.bpm = Number(e.target.value);
    player?.setTempo(state.track.bpm); // live, ohne Neustart
    render();
  });
}

// Seitenwechsel; die Wiedergabe läuft weiter. sidebars (optional) wird ins gemerkte Layout geschrieben.
let opener = 'tune-btn'; // Knopf der Startseite, der die Spielseite zuletzt geöffnet hat
function showPage(page, { sidebars } = {}) {
  if (sidebars) {
    state.layout = { ...state.layout, sidebars: { ...sidebars } };
    saveLayout(layoutStorage, state.layout);
  }
  state.page = page;
  render();
  // offene schmale Schublade ist modal (Titel inert): dann ihre Überschrift
  if (page === 'play') ($('play-title').closest('[inert]') ? document.querySelector('.side:not([hidden]) [tabindex="-1"]') : $('play-title')).focus();
  // "Zur Spielseite" ist im Stand versteckt: dann auf Los
  else ($(opener).checkVisibility() ? $(opener) : $('go')).focus();
}

function openFrom(id, opts) {
  opener = id;
  showPage('play', opts);
}

// Los auf der Startseite: im Stand starten und zur Spielseite, beim Spielen stoppen und bleiben
$('go').addEventListener('click', () => {
  if (state.playing) {
    stop();
    render();
    return;
  }
  start();
  if (state.playing) openFrom('go');
  else render(); // Start gescheitert: die Meldung steht auf der Startseite
});
$('play-go').addEventListener('click', () => {
  if (state.playing) stop();
  else start();
  render();
});
$('tune-btn').addEventListener('click', () => openFrom('tune-btn', { sidebars: { left: true, right: true } }));
$('to-play').addEventListener('click', () => openFrom('to-play'));
$('play-back').addEventListener('click', () => showPage('start'));

// Neue Variante leitet die Folge aus Tonart und Nummer neu ab (eigene Folge entfällt). Während der Wiedergabe geht es im
// laufenden Takt weiter, damit der Aufbau schon voll ist.
function setVariant(seed) {
  state.track.seed = seed;
  deriveBars();
  restartIfPlaying({ inPlace: true });
  render();
}
$('new-variant').addEventListener('click', () => setVariant(rollVariant()));
$('variant-random').addEventListener('click', () => setVariant(rollVariant()));
$('variant-prev').addEventListener('click', () => setVariant(stepVariant(state.track.seed, -1)));
$('variant-next').addEventListener('click', () => setVariant(stepVariant(state.track.seed, 1)));

// Eingabe übernehmen (Enter oder Verlassen); Ungültiges ignorieren, beim Verlassen zeigt das Feld wieder die Variante
$('variant').addEventListener('change', (e) => {
  const n = Number(e.target.value);
  if (e.target.value !== '' && Number.isInteger(n) && n >= 1 && n <= 9999) setVariant(n);
});
$('variant').addEventListener('blur', (e) => { e.target.value = String(state.track.seed); });

for (const b of document.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => {
    state.lang = b.dataset.lang;
    saveLang(state.lang);
    render();
  });
}

// Popover: Escape, Klick daneben und "nur eines offen" macht die native Popover-API; hier aria-expanded und Fokus
for (const button of document.querySelectorAll('[popovertarget]')) {
  const pop = $(button.getAttribute('popovertarget'));
  pop.addEventListener('toggle', (e) => {
    const open = e.newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (open) (pop.querySelector('[aria-pressed="true"], input') ?? pop.querySelector('button'))?.focus();
    // Fokus, der woanders hin gewandert ist (anderer Knopf geklickt), bleibt dort
    else if (document.activeElement === document.body || pop.contains(document.activeElement)) button.focus();
  });
}

const renderTuning = initTuning({ render: () => render(), restartIfPlaying, toggleLayer });
const renderMixer = initMixer({ render: () => render(), player: () => player, toggleLayer });

// Leisten "Klang" (links) und "Akkorde" (rechts): offen/zu steht im gemerkten Layout
const sidebars = ['left', 'right'].map((side) => initSidebar({
  side,
  panel: $(`side-${side}`),
  toggle: $(`toggle-${side}`),
  isOpen: () => state.layout.sidebars[side],
  setOpen: (open) => {
    state.layout = { ...state.layout, sidebars: { ...state.layout.sidebars, [side]: open } };
    saveLayout(layoutStorage, state.layout);
  },
}));

// Gruppen in den Leisten: offen/zu steht ebenfalls im gemerkten Layout
const groupBinding = {
  get: (id) => state.layout.groups[id],
  set: (id, open) => {
    state.layout = { ...state.layout, groups: { ...state.layout.groups, [id]: open } };
    saveLayout(layoutStorage, state.layout);
  },
};
initGroups(document, groupBinding);

// Ansichten: Schalter in der rechten Leiste, Zustand im gemerkten Layout
const views = initViews($('views'), {
  isVisible: (id) => state.layout.views[id] !== false,
  setVisible: (id, on) => {
    if (state.layout.views[id] === on) return;
    state.layout = { ...state.layout, views: { ...state.layout.views, [id]: on } };
    saveLayout(layoutStorage, state.layout);
    render();
  },
});

// --- Darstellung ---
const show = (el, on) => { if (el.hidden === on) el.hidden = !on; };

function render() {
  const { track, scale, style, playing, lang, current, errors, page } = state;
  setLanguage(lang);
  document.documentElement.lang = lang;
  document.title = t('ui.title');
  for (const el of document.querySelectorAll('[data-i18n]')) setText(el, t(el.dataset.i18n));
  for (const el of document.querySelectorAll('[data-i18n-label]')) setAttr(el, 'aria-label', t(el.dataset.i18nLabel));
  for (const el of document.querySelectorAll('[data-i18n-hint]')) {
    setAttr(el, 'title', t(el.dataset.i18nHint));
    setAttr(el, 'aria-description', t(el.dataset.i18nHint));
  }
  for (const b of document.querySelectorAll('[data-lang]')) pressed(b, b.dataset.lang === lang);

  setText($('key-btn'), t('ui.keyScale', { root: track.key.root, scale: t(`scale.${scale}`) }));
  setText($('style-btn'), t(`style.${style}`));
  setText($('tempo-btn'), `${track.bpm} ${t('ui.bpm')}`);
  // nur bei Änderung: <output>.value ersetzt den Textknoten
  for (const id of ['tempo', 'tempo-out']) if ($(id).value !== String(track.bpm)) $(id).value = String(track.bpm);

  for (const k of keyScales) k.render();
  for (const card of $('style-cards').children) {
    const { id, bpm } = preset(card.dataset.style);
    setText(card.querySelector('.card-name'), t(`style.${id}`));
    setText(card.querySelector('.card-bpm'), `${bpm} ${t('ui.bpm')}`);
    setText(card.querySelector('.card-hint'), t(`style.${id}.hint`));
    pressed(card, id === style);
  }

  // während der Eingabe nicht überschreiben (render läuft je Takt)
  if (document.activeElement !== $('variant') && $('variant').value !== String(track.seed)) $('variant').value = String(track.seed);
  setText($('chords'), track.bars.map((b) => chordName(b.chord)).join(' – '));
  const now = current ? chordName(current.chord) : '';
  const bar = current ? positionLabel(current.bar, track.length) : '';
  const message = errors.map((e) => t(`err.${e.code}`, e.params)).join(' ');
  for (const id of ['go', 'play-go']) {
    setText($(id), t(playing ? 'ui.stop' : 'ui.go'));
    $(id).classList.toggle('playing', playing);
  }
  for (const [id, text] of [['now-chord', now], ['play-now', now], ['position', bar], ['play-position', bar],
    ['message', message], ['play-message', message], ['play-variant', t('ui.variantShown', { n: track.seed })]]) {
    setText($(id), text);
  }

  show($('start'), page === 'start');
  show($('play'), page === 'play');
  show($('to-play'), playing);
  for (const s of sidebars) s.render(); // nach dem Seitenwechsel: modal nur, wenn die Schublade sichtbar ist
  views.render(); // vor renderTuning: das Akkordrad zeichnet nur, wenn sein Block sichtbar ist
  renderTuning();
  renderMixer();
}

deriveBars();
render();
