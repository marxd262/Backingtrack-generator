// Startseite: ein Zustandsobjekt (state.js), render() schreibt daraus alle Texte und Attribute neu.
import { play, STYLE_PRESETS, validateTrack, t, setLanguage } from '../index.js';
import { SCALE_NAMES } from '../core/music.js';
import { positionLabel } from './position.js';
import { $, ROOTS, SCALE_MODE, LAYERS, ALL_LAYERS, state, chordName, rollVariant, preset, pressed, setText, setAttr, saveLang, deriveBars, applyStyle } from './state.js';
import { initTuning } from './tuning.js';

// Dekoratives 16tel-Bild je Stil, 1 = Schlag
const RHYTHMS = { funk: '1001001010100110', psych: '1010101010101010', dreamy: '1000000010000000' };

// --- Wiedergabe: ein AudioContext für alle Starts, nie zwei Player gleichzeitig ---
let ctx = null;
let player = null;

function start() {
  state.errors = [];
  try {
    ctx ??= new AudioContext(); // nur aus einem Klick heraus aufgerufen
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // alle Schichten erzeugen und stumme per setLayer leise schalten, damit Einschalten live ohne Neustart klingt
    player = play(ctx, { ...state.track, layers: ALL_LAYERS }, {
      loops: Infinity, // läuft bis Stopp
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

function restartIfPlaying() {
  if (!state.playing) return;
  stop();
  start();
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

for (const root of ROOTS) {
  chip($('key-chips'), { root }, () => {
    state.track.key = { root, mode: SCALE_MODE[state.scale] };
    deriveBars();
    restartIfPlaying();
  }).textContent = root; // Tonnamen international, nicht übersetzt
}

for (const scale of SCALE_NAMES) {
  chip($('scale-chips'), { scale }, () => {
    state.scale = scale;
    state.track.key = { root: state.track.key.root, mode: SCALE_MODE[scale] };
    deriveBars();
    restartIfPlaying();
  });
}

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

// Tempo-Regler im Popover und im Feintuning teilen sich den Zustand
for (const id of ['tempo', 'tuning-tempo']) {
  $(id).addEventListener('input', (e) => {
    state.track.bpm = Number(e.target.value);
    player?.setTempo(state.track.bpm); // live, ohne Neustart
    render();
  });
}

for (const id of ['go', 'tuning-go']) {
  $(id).addEventListener('click', () => {
    if (state.playing) stop();
    else start();
    render();
  });
}

function setVariant(seed) {
  state.track.seed = seed;
  deriveBars();
  restartIfPlaying();
  render();
}
$('new-variant').addEventListener('click', () => setVariant(rollVariant()));

// Eingabe übernehmen (Enter oder Verlassen); Ungültiges ignorieren, beim Verlassen zeigt das Feld wieder die Variante
$('variant').addEventListener('change', (e) => {
  const n = Number(e.target.value);
  if (e.target.value !== '' && Number.isInteger(n) && n >= 1 && n <= 9999) setVariant(n);
});
$('variant').addEventListener('blur', (e) => { e.target.value = String(state.track.seed); });

function setTuning(open) {
  state.tuningOpen = open;
  render();
  (open ? $('tuning-title') : $('tune-btn')).focus();
}
$('tune-btn').addEventListener('click', () => setTuning(!state.tuningOpen));
$('back').addEventListener('click', () => setTuning(false));

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

const renderTuning = initTuning({ render: () => render(), restartIfPlaying, player: () => player });

// --- Darstellung ---
function render() {
  const { track, scale, style, playing, lang, current, errors, tuningOpen } = state;
  setLanguage(lang);
  document.documentElement.lang = lang;
  document.title = t('ui.title');
  for (const el of document.querySelectorAll('[data-i18n]')) setText(el, t(el.dataset.i18n));
  for (const el of document.querySelectorAll('[data-i18n-label]')) setAttr(el, 'aria-label', t(el.dataset.i18nLabel));
  for (const b of document.querySelectorAll('[data-lang]')) pressed(b, b.dataset.lang === lang);

  $('key-btn').textContent = t('ui.keyScale', { root: track.key.root, scale: t(`scale.${scale}`) });
  $('style-btn').textContent = t(`style.${style}`);
  $('tempo-btn').textContent = `${track.bpm} ${t('ui.bpm')}`;
  $('tempo').value = track.bpm;
  $('tempo-out').value = track.bpm;

  for (const b of $('key-chips').children) pressed(b, b.dataset.root === track.key.root);
  for (const b of $('scale-chips').children) {
    b.textContent = t(`scale.${b.dataset.scale}`);
    pressed(b, b.dataset.scale === scale);
  }
  for (const card of $('style-cards').children) {
    const { id, bpm } = preset(card.dataset.style);
    card.querySelector('.card-name').textContent = t(`style.${id}`);
    card.querySelector('.card-bpm').textContent = `${bpm} ${t('ui.bpm')}`;
    card.querySelector('.card-hint').textContent = t(`style.${id}.hint`);
    pressed(card, id === style);
  }

  // während der Eingabe nicht überschreiben (render läuft je Takt)
  if (document.activeElement !== $('variant') && $('variant').value !== String(track.seed)) $('variant').value = String(track.seed);
  $('chords').textContent = track.bars.map((b) => chordName(b.chord)).join(' – ');
  for (const id of ['go', 'tuning-go']) {
    $(id).textContent = t(playing ? 'ui.stop' : 'ui.go');
    $(id).classList.toggle('playing', playing);
  }
  $('now-chord').textContent = current ? chordName(current.chord) : '';
  $('position').textContent = current ? positionLabel(current.bar, track.length) : '';
  $('message').textContent = errors.map((e) => t(`err.${e.code}`, e.params)).join(' ');
  $('tune-btn').setAttribute('aria-expanded', String(tuningOpen));
  document.body.classList.toggle('tuning-open', tuningOpen);
  $('tuning').hidden = !tuningOpen;
  renderTuning();
}

deriveBars();
render();
