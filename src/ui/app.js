// Start- und Spielseite: ein Zustandsobjekt (state.js), render() schreibt daraus alle Texte und Attribute neu.
import { play, STYLE_PRESETS, validateTrack, t, setLanguage } from '../index.js';
import { positionLabel, chordAtBar, loopBars } from './position.js';
import { $, LAYERS, ALL_LAYERS, ROOTS, state, layoutStorage, chordName, rollVariant, preset, pressed, setText, setAttr, saveLang, deriveBars, applyStyle, rollNewForm, setFormTemplate } from './state.js';
import { saveLayout } from './layout-state.js';
import { initTuning } from './tuning.js';
import { initMixer } from './mixer.js';
import { initProfiles } from './profiles.js';
import { stepVariant } from './variant.js';
import { buildKeyScale, buildKeyScaleSelects } from './key-scale.js';
import { createLcdSelect } from './lcd-select.js';
import { resolveTrackTimbre } from '../core/timbre.js';
import { beatsUntilChange } from '../core/fretboard.js';
import { sectionAt, formLength } from '../core/form.js';
import { initTimbrePanel } from './timbre-panel.js';
import { initVoices } from './voices-panel.js';
import { loadVoices, missingPacks } from '../audio/load-voices.js';
import { initJobs } from './jobs-panel.js';
import { initOrgan } from './organ-panel.js';
import { organTuning } from './organ-tuning.js';
import { initRhythm } from './rhythm.js';
import { syncKnobs } from './knob.js';
import { syncLcdSelects } from './lcd-select.js';
import { initFormPanel } from './form-panel.js';
import { initFormStrip } from './form-strip.js';
import { readSession, writeSession } from './profile-session.js';
import { saveLast, loadLast } from './session-store.js';
import { applyParts } from '../core/profile-parts.js';
import { chooseRoot } from './key-scale.js';
import { SCALE_NAMES } from '../core/music.js';
import { convertTempo, meterKey } from '../core/grooves.js';

// Dekoratives 16tel-Bild je Stil, 1 = Schlag
const RHYTHMS = {
  funk: '1001001010100110', psych: '1010101010101010', dreamy: '1000000010000000',
  blues: '1000100110001001', rock: '1000001010100000', hardrock: '1010001010100010',
  reggae: '0000100000001000', country: '1000001010000010', poppunk: '1011101110111011',
};

// --- Wiedergabe: ein AudioContext für alle Starts, nie zwei Player gleichzeitig ---
let ctx = null;
let player = null;
let loadingPacks = false; // Start wartet auf die Sample-Packs

// Start erst, wenn die Packs der gewählten Sample-Stimmen da sind (Wunsch des Nutzers 2026-11-15), sonst spielte der Synth-Rückfall die
// ersten Takte. Ein Pack, das nicht lädt, gibt nach seinem Fehler (spätestens nach dem Zeitlimit des Samplers) frei; dann spielt dort der Synth.
async function startWhenLoaded(startBar = 0) {
  if (loadingPacks) return; // zweiter Klick während des Ladens
  if (missingPacks(state.track).length) {
    try { ctx ??= new AudioContext(); } catch { /* start() meldet den Fehler */ } // noch im Klick anlegen: nach dem Warten zählt er nicht mehr als Nutzergeste
    loadingPacks = true;
    render();
    await loadVoices(state.track);
    loadingPacks = false;
  }
  start(startBar);
}

// Lichter der Schichten (LED im Modultitel und vor dem Spurnamen), drei Stufen über dem Grundzustand "spielt in diesem Takt" (.on, gedämpft):
// .sound: ein Ton der Schicht klingt gerade (volle Helligkeit, so lange wie der Ton; ein gehaltener Pad-Akkord leuchtet also durch),
// .hit: Anschlag (Lichtschein für FLASH_MS; ein Anschlag, der in dieses Leuchten fällt, verlängert es nicht, sonst blinkte dichtes Spiel nicht).
// Schläge (Schlagzeug, Percussion) haben keine Dauer und blitzen nur. Die Schlag-LED im Start/Stopp-Taster blitzt auf jedem Schlag.
// Mit "Bewegung reduzieren" ändert sich nichts im Takt: die LEDs der Schichten leuchten dann wie bisher den ganzen Takt voll.
const FLASH_MS = 70;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const flashing = new Set(); // LED-Gruppen, die gerade leuchten
function flash(key, selector) {
  if (calm.matches || state.page !== 'play' || flashing.has(key)) return;
  const leds = document.querySelectorAll(selector);
  for (const el of leds) el.classList.add('hit');
  flashing.add(key);
  setTimeout(() => { flashing.delete(key); for (const el of leds) el.classList.remove('hit'); }, FLASH_MS);
}
const layerLeds = (layer) => `.led[data-activity="${layer}"], #lane-buttons [data-layer="${layer}"]`;
const sounding = new Map(); // Schicht -> { until, timer }: bis wann ihr längster Ton klingt
function endSound(layer) {
  clearTimeout(sounding.get(layer)?.timer);
  sounding.delete(layer);
  for (const el of document.querySelectorAll(layerLeds(layer))) el.classList.remove('sound');
}
function holdSound(layer, ms) {
  if (calm.matches || state.page !== 'play') return;
  const until = performance.now() + ms;
  if (sounding.get(layer)?.until >= until) return; // ein längerer Ton klingt schon
  clearTimeout(sounding.get(layer)?.timer);
  for (const el of document.querySelectorAll(layerLeds(layer))) el.classList.add('sound');
  sounding.set(layer, { until, timer: setTimeout(() => endSound(layer), ms) });
}
// jedes gespielte Ereignis einer hörbaren Schicht (stumme leuchten nicht); die Dauer zählt beim Starttempo, also mal Starttempo durch jetziges
function flashEvent(e) {
  if (!(e.type === 'note' || e.type === 'hit') || !state.track.layers[e.layer]) return;
  flash(e.layer, layerLeds(e.layer));
  if (e.type === 'note') holdSound(e.layer, (e.dur * 1000 * playBpm) / state.track.bpm);
}

// Countdown bis zum nächsten Akkordwechsel und Schlag-LED: eigene Bildzeitschleife (nicht über render()), nur bei laufender Wiedergabe,
// schreibt nur bei Änderung. Die Liedzeit des Players bezieht sich auf das Starttempo, daher dessen bpm.
let countdownFrame = 0;
let playBpm = 0;
let lastBeat = -1;
function tickCountdown() {
  const n = player ? beatsUntilChange({ ...state.track, bpm: playBpm }, player.songTime()) : null;
  setText($('play-countdown'), n === null ? '' : t(n === 1 ? 'ui.countdownOne' : 'ui.countdownMany', { n }));
  const beat = player ? Math.floor((player.songTime() * playBpm) / 60 + 1e-6) : -1;
  if (beat !== lastBeat) {
    lastBeat = beat;
    if (player) flash('beat', '#beat-led');
  }
  countdownFrame = player ? requestAnimationFrame(tickCountdown) : 0;
}

// Teil am Takt `bar` für die Kopfleiste: übersetzter Typ plus laufende Nummer dieses Typs ("Strophe 2"); ohne Form leer
function partLabel(track, bar) {
  const total = formLength(track.form);
  const hit = total > 0 ? sectionAt(track.form, bar % total) : null;
  if (!hit) return '';
  const n = track.form.sections.slice(0, hit.index + 1).filter((s) => s.type === hit.section.type).length;
  return `${t(`form.part.${hit.section.type}`)} ${n}`;
}

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
      pans: state.pan,
      tuning: organTuning(state.organ), // Leslie und Zerre der Orgel; im Standard leer
      onEvent: flashEvent,
      onBar: (b) => { state.current = b; render(); },
      onEnd: () => { stop(); render(); },
    });
    for (const name of LAYERS) if (!state.track.layers[name]) player.setLayer(name, false);
    state.playing = true;
    playBpm = state.track.bpm;
    cancelAnimationFrame(countdownFrame);
    tickCountdown();
  } catch {
    player?.stop();
    player = null;
    const found = validateTrack(state.track);
    state.errors = found.length ? found : [{ code: 'playFailed', params: {} }];
  }
}

// Zuletzt gespielt (Startseite, "Weitermachen"): beim Stopp und beim Verlassen der Seite wird die Sitzung samt laufendem Takt gemerkt
let lastPlayed = loadLast(layoutStorage);
const rememberSession = () => {
  if (state.playing && state.current) lastPlayed = saveLast(layoutStorage, readSession(state), state.current.bar % loopBars(state.track));
};
addEventListener('pagehide', rememberSession);

function stop() {
  rememberSession();
  player?.stop();
  player = null;
  cancelAnimationFrame(countdownFrame);
  for (const layer of [...sounding.keys()]) endSound(layer);
  lastBeat = -1;
  setText($('play-countdown'), '');
  state.playing = false;
  state.current = null;
}

// inPlace: nur der Klang hat sich geändert (Ereignisstrom gleich), also im laufenden Takt weiter statt ab Takt 1;
// sonst hörte man neue Akkord- und Pad-Klänge im langsamen Aufbau erst nach vielen Takten
function restartIfPlaying({ inPlace = false } = {}) {
  if (!state.playing) return;
  const current = inPlace ? state.current : null;
  stop();
  start(current ? current.bar % loopBars(state.track) : 0); // nie hinter dem Ende (play wirft sonst RangeError)
  // derselbe Takt beginnt neu: Taktzeile, Verlauf und Griffbrett bleiben dort, statt bis zum ersten onBar leer zu sein;
  // der Akkord kommt aus der (bei einer neuen Variante anderen) Folge
  if (current && state.playing) state.current = { ...current, chord: chordAtBar(state.track, current.bar) };
}

// Schlagwort- und Stilwechsel live an den laufenden Player geben statt neu zu starten: Klang per setTimbre, Tempo per setTempo,
// Muster per setTrack (tauscht den Ereignisstrom ab dem nächsten ungeplanten Ereignis). Liefert setTrack false (Länge oder
// Taktlängen anders) oder wirft es, bleibt der Neustart an der gleichen Position; ohne laufenden Player gibt es nichts zu tun.
function applyLive({ patterns = false, tempo = false } = {}) {
  if (!player) return;
  try {
    player.setTimbre(resolveTrackTimbre(state.track));
    if (tempo) player.setTempo(state.track.bpm);
    if (patterns && !player.setTrack({ ...state.track, layers: ALL_LAYERS })) restartIfPlaying({ inPlace: true });
  } catch {
    restartIfPlaying({ inPlace: true });
  }
}

// Schicht ein/aus (Stummtaste im Mischpult; die Spurnamen zeigen es nur an), live ohne Neustart
function toggleLayer(name) {
  state.track.layers = { ...state.track.layers, [name]: !state.track.layers[name] };
  player?.setLayer(name, state.track.layers[name]);
  if (!state.track.layers[name]) endSound(name); // stumm: die LED geht sofort aus
}

// Was der Nutzer auf der Startseite selbst gewählt hat (Tonart oder Skala, Stil, Tempo, Variantennummer): "Überrasch mich" lässt es stehen
const touched = { key: false, style: false, tempo: false, variant: false };
$('key-pop').addEventListener('click', (e) => { if (e.target.closest('button')) touched.key = true; });

// Überrasch mich: würfelt Stil (mit seinen Schlagworten), Tempo (Stiltempo ±10 %), Tonart, Skala und Variante neu
const pick = (list) => list[Math.floor(Math.random() * list.length)];
$('surprise').addEventListener('click', () => {
  const bpm = state.track.bpm;
  if (!touched.style) applyStyle(pick(STYLE_PRESETS).id);
  const styleBpm = convertTempo(preset(state.style).bpm, '4/4', meterKey(state.track.meter));
  state.track.bpm = touched.tempo ? bpm : Math.min(200, Math.max(40, Math.round(styleBpm * (0.9 + Math.random() * 0.2))));
  if (!touched.variant) state.track.seed = rollVariant();
  if (!touched.key) {
    state.scale = pick(SCALE_NAMES);
    chooseRoot(pick(ROOTS)); // setzt den Modus der Skala und leitet die Folge neu ab
  } else deriveBars();
  rollNewForm();
  restartIfPlaying({ inPlace: true });
  render();
});

// Weitermachen: die gemerkte Sitzung ganz wiederherstellen (wie ein Profil laden) und am gemerkten Takt weiterspielen, Spielseite im Fokus
$('resume').addEventListener('click', async () => {
  const last = lastPlayed;
  if (!last) return;
  if (state.playing) stop();
  const r = applyParts(readSession(state), last.parts);
  if (!r.ok) { state.errors = r.errors; render(); return; } // ganz oder gar nicht
  writeSession(state, r.session);
  await startWhenLoaded(Math.min(last.bar, loopBars(state.track) - 1));
  if (state.playing) openFrom('resume', { mode: 'focus' });
  else render();
});

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

// Tonart und Skala: Chips im Popover der Startseite, LCD-Auswahlen im Modul Harmonie der Spielseite
const keyScales = [
  buildKeyScale({ keyChips: $('key-chips'), scaleChips: $('scale-chips') }, { restartIfPlaying, render: () => render() }),
  buildKeyScaleSelects({ keySelect: $('key-select'), scaleSelect: $('scale-select') }, { restartIfPlaying, render: () => render() }),
];

for (const { id } of STYLE_PRESETS) {
  const card = chip($('style-cards'), { style: id }, () => {
    applyStyle(id);
    touched.style = true;
    applyLive({ patterns: true, tempo: true });
    $('style-pop').hidePopover();
  });
  card.className = 'card';
  card.innerHTML = '<span class="card-name"></span><span class="card-bpm"></span><span class="card-hint"></span><span class="rhythm" aria-hidden="true"></span>';
  for (const step of RHYTHMS[id]) card.lastChild.append(Object.assign(document.createElement('i'), { className: step === '1' ? 'on' : '' }));
}

// Stil im Modul Charakter: wie die Stilkarten der Startseite
const styleSelect = $('style-select');
for (const { id } of STYLE_PRESETS) {
  const o = Object.assign(document.createElement('option'), { value: id });
  o.dataset.i18n = `style.${id}`;
  styleSelect.append(o);
}
createLcdSelect(styleSelect, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
styleSelect.addEventListener('change', () => {
  applyStyle(styleSelect.value);
  applyLive({ patterns: true, tempo: true });
  render();
});

// Tempo-Regler im Popover und im Modul Rhythmus teilen sich den Zustand
for (const id of ['tempo', 'tuning-tempo']) {
  $(id).addEventListener('input', (e) => {
    if (id === 'tempo') touched.tempo = true;
    state.track.bpm = Number(e.target.value);
    player?.setTempo(state.track.bpm); // live, ohne Neustart
    render();
  });
}

// Zustand der Spielseite (Fokus oder Einstellen) setzen und merken
function setMode(mode) {
  if (state.layout.mode === mode) return;
  state.layout = { ...state.layout, mode };
  saveLayout(layoutStorage, state.layout);
}

// Seitenwechsel; die Wiedergabe läuft weiter. mode (optional) setzt den Zustand der Spielseite.
let opener = 'tune-btn'; // Knopf der Startseite, der die Spielseite zuletzt geöffnet hat
function showPage(page, { mode } = {}) {
  if (mode) setMode(mode);
  state.page = page;
  render();
  if (page === 'play') $('play-title').focus();
  // "Zur Spielseite" ist im Stand versteckt: dann auf Los
  else ($(opener).checkVisibility() ? $(opener) : $('go')).focus();
}

function openFrom(id, opts) {
  opener = id;
  showPage('play', opts);
}

// Los auf der Startseite: im Stand starten und zur Spielseite, beim Spielen stoppen und bleiben
$('go').addEventListener('click', async () => {
  if (state.playing) {
    stop();
    render();
    return;
  }
  await startWhenLoaded();
  if (state.playing) openFrom('go', { mode: 'focus' });
  else render(); // Start gescheitert: die Meldung steht auf der Startseite
});
$('play-go').addEventListener('click', async () => {
  if (state.playing) stop();
  else await startWhenLoaded();
  render();
});
$('tune-btn').addEventListener('click', () => openFrom('tune-btn', { mode: 'setup' }));
$('to-play').addEventListener('click', () => openFrom('to-play'));
$('play-back').addEventListener('click', () => showPage('start'));
$('mode-switch').addEventListener('click', () => {
  setMode(state.layout.mode === 'setup' ? 'focus' : 'setup');
  render();
});

// Neue Variante leitet die Folge aus Tonart und Nummer neu ab (eigene Folge entfällt). Während der Wiedergabe geht es im
// laufenden Takt weiter, damit der Aufbau schon voll ist.
function setVariant(seed) {
  state.track.seed = seed;
  deriveBars();
  rollNewForm(); // die nicht gesperrten Teile der Form
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
  if (e.target.value !== '' && Number.isInteger(n) && n >= 1 && n <= 9999) { touched.variant = true; setVariant(n); }
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

const renderTuning = initTuning({ render: () => render(), restartIfPlaying, applyLive });
const renderMixer = initMixer({ render: () => render(), player: () => player, toggleLayer, chooseAll: (kind) => voices.chooseAll(kind) });
const renderProfiles = initProfiles({ render: () => render(), restartIfPlaying, applyLive });
const renderRhythm = initRhythm({ render: () => render(), restartIfPlaying, applyLive });
const renderForm = initFormPanel({ render: () => render(), restartIfPlaying, applyLive });
const renderStrip = initFormStrip({ render: () => render(), restartIfPlaying, applyLive });
const renderTimbre = initTimbrePanel({ render: () => render(), player: () => player }); // baut die Instrument-Module
const voices = initVoices({ render: () => render(), player: () => player }); // nach dem Klangpanel: füllt den Platz Stimme in dessen Modulen
const renderJobs = initJobs({ render: () => render(), changed: () => applyLive({ patterns: true }) }); // ebenso: Aufgabe
const renderOrgan = initOrgan({ render: () => render(), player: () => player }); // ebenso: Leslie und Zerre der Orgel im Akkord-Modul

// Akkordart-Gruppen im Popover sind <details>: immer offen (keine Klappgruppen)
for (const el of document.querySelectorAll('#add-qualities details[data-group]')) el.open = true;

// --- Darstellung ---
const langGroup = document.querySelector('.lang');
const topBar = document.querySelector('.top');
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
  if (styleSelect.value !== style) styleSelect.value = style;
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
  const bar = current ? positionLabel(current.bar, loopBars(track)) : '';
  const message = errors.map((e) => t(`err.${e.code}`, e.params)).join(' ');
  for (const id of ['go', 'play-go']) {
    setText($(id), t(playing ? 'ui.stop' : loadingPacks ? 'voice.status.loading' : 'ui.go'));
    setAttr($(id), 'aria-busy', String(loadingPacks));
    $(id).classList.toggle('playing', playing);
  }
  for (const [id, text] of [['now-chord', now], ['play-now', now], ['position', bar], ['play-position', bar], ['play-part', partLabel(track, current?.bar ?? 0)],
    ['message', message], ['play-message', message], ['play-variant', t('ui.variantShown', { n: track.seed })]]) {
    setText($(id), text);
  }

  // im Stand zeigen die leeren Displays der Kopfleiste gedämpft die Länge und den ersten Akkord (nur als Bild: der Text bleibt leer)
  setAttr($('play-position'), 'data-idle', t('ui.positionIdle', { n: loopBars(track) }));
  setAttr($('play-now'), 'data-idle', track.bars.length ? chordName(track.bars[0].chord) : '');
  show($('start'), page === 'start');
  show($('play'), page === 'play');
  show($('to-play'), playing);
  show($('last'), Boolean(lastPlayed));
  if (lastPlayed) {
    const p = lastPlayed.parts;
    setText($('last-summary'), t('ui.lastSummary', {
      key: t('ui.keyScale', { root: p.harmony.key.root, scale: t(`scale.${p.harmony.scale}`) }),
      style: t(`style.${p.style.style}`),
      bpm: p.tempo.bpm,
      variant: p.variant.seed,
      bar: lastPlayed.bar + 1,
      when: lastPlayed.at ? new Date(lastPlayed.at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : '',
    }));
  }
  // vor renderTuning: das Akkordrad zeichnet nur, wenn es sichtbar ist
  setAttr($('play'), 'data-mode', state.layout.mode);
  setAttr($('mode-switch'), 'aria-checked', String(state.layout.mode === 'setup'));
  // Sprachtasten: in der Kopfleiste der Spielseite, sonst oben auf der Startseite (nur bei Wechsel umhängen, sonst ginge der Fokus verloren)
  const langHome = page === 'play' ? $('play-message') : null;
  if (langHome ? langGroup.nextElementSibling !== langHome : langGroup.parentElement !== topBar) {
    if (langHome) langHome.before(langGroup);
    else topBar.append(langGroup);
  }
  renderTuning();
  renderMixer();
  renderProfiles();
  voices.render();
  renderJobs();
  renderOrgan();
  renderTimbre();
  renderRhythm();
  renderForm();
  renderStrip();
  syncKnobs(); // zuletzt: die Eingaben tragen jetzt ihre Werte
  syncLcdSelects();
}

deriveBars();
setFormTemplate('auto'); // Standard: Songform passend zum Stil, Ziel 96 Takte
render();
