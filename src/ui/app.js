// Startseite: ein Zustandsobjekt, render() schreibt daraus alle Texte und Attribute neu.
import { play, STYLE_PRESETS, validateTrack, t, setLanguage } from '../index.js';
import { detectLanguage } from '../i18n/index.js';
import { progressionFor } from '../core/progressions.js';
import { SCALE_NAMES } from '../core/music.js';

const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Skala ist nur Oberflächen-Zustand; der Generator kennt nur den Modus
const SCALE_MODE = { minorPentatonic: 'minor', majorPentatonic: 'major', blues: 'minor', dorian: 'minor' };
const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
// Dekoratives 16tel-Bild je Stil, 1 = Schlag
const RHYTHMS = { funk: '1001001010100110', psych: '1010101010101010', dreamy: '1000000010000000' };
const STORAGE_KEY = 'backingtrack.lang';

const $ = (id) => document.getElementById(id);
const chordName = (c) => c.root + SYMBOLS[c.quality];
const rollVariant = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 9999) + 1;
const preset = (id) => STYLE_PRESETS.find((p) => p.id === id);

function readLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch { /* Speicher gesperrt: Browsersprache */ }
  return detectLanguage(navigator.language);
}

function saveLang(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch { /* ohne Speicher gilt die Wahl nur bis zum Neuladen */ }
}

const funk = preset('funk');
const state = {
  track: {
    key: { root: 'A', mode: 'minor' },
    bpm: funk.bpm,
    bars: [],
    tags: structuredClone(funk.tags),
    layers: { drums: true, bass: true, chords: true, pad: true },
    seed: rollVariant(), // Variantennummer
    length: 24,
  },
  scale: 'minorPentatonic',
  style: 'funk',
  playing: false,
  lang: readLang(),
  tuningOpen: false, // Feintuning-Ansicht (Task 9b)
  current: null, // { bar, chord } aus onBar
  errors: [], // [{ code, params }], übersetzt erst in render()
};

const deriveBars = () => {
  state.track.bars = progressionFor(state.track.key, state.track.seed).map((chord) => ({ chord, beats: 4 }));
};

// --- Wiedergabe: ein AudioContext für alle Starts, nie zwei Player gleichzeitig ---
let ctx = null;
let player = null;

function start() {
  state.errors = [];
  try {
    ctx ??= new AudioContext(); // nur aus einem Klick heraus aufgerufen
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    player = play(ctx, state.track, {
      onBar: (b) => { state.current = b; render(); },
      onEnd: () => { stop(); render(); },
    });
    state.playing = true;
  } catch {
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
    const p = preset(id);
    state.style = id;
    state.track.bpm = p.bpm;
    state.track.tags = structuredClone(p.tags);
    restartIfPlaying();
    $('style-pop').hidePopover();
  });
  card.className = 'card';
  card.innerHTML = '<span class="card-name"></span><span class="card-bpm"></span><span class="card-hint"></span><span class="rhythm" aria-hidden="true"></span>';
  for (const step of RHYTHMS[id]) card.lastChild.append(Object.assign(document.createElement('i'), { className: step === '1' ? 'on' : '' }));
}

$('tempo').addEventListener('input', (e) => {
  state.track.bpm = Number(e.target.value);
  player?.setTempo(state.track.bpm); // live, ohne Neustart
  render();
});

$('go').addEventListener('click', () => {
  if (state.playing) stop();
  else start();
  render();
});

$('new-variant').addEventListener('click', () => {
  state.track.seed = rollVariant();
  deriveBars();
  restartIfPlaying();
  render();
});

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

// --- Darstellung ---
const pressed = (el, on) => el.setAttribute('aria-pressed', String(on));

function render() {
  const { track, scale, style, playing, lang, current, errors } = state;
  setLanguage(lang);
  document.documentElement.lang = lang;
  document.title = t('ui.title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
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

  $('variant').textContent = t('ui.variant', { n: track.seed });
  $('chords').textContent = track.bars.map((b) => chordName(b.chord)).join(' – ');
  $('go').textContent = t(playing ? 'ui.stop' : 'ui.go');
  $('go').classList.toggle('playing', playing);
  $('now-chord').textContent = current ? chordName(current.chord) : '';
  $('position').textContent = current ? t('ui.bar', { n: (current.bar % track.length) + 1, total: track.length }) : '';
  $('message').textContent = errors.map((e) => t(`err.${e.code}`, e.params)).join(' ');
  $('tuning').hidden = !state.tuningOpen;
}

deriveBars();
render();
