// Start- und Spielseite: render() schreibt alle Texte und Attribute aus dem, was die Sitzung zuletzt gab (session.js: state, derived, tables,
// position, der Verlauf, die Meldungen der Engine), neu; die Bedienelemente schicken Aktionen. Was spielt und was gespeichert wird, gehört der
// Sitzung und der Hülle der App; die Seite hält Sprache, Seite und Anzeigezustand (backingtrack.lang, backingtrack.layout).
import { t, setLanguage } from './i18n/index.js';
import { session, listen, send, post, start, holds, beatsNow } from './session.js';
import { $, setText, setAttr, pressed } from './dom.js';
import { positionLabel } from './position.js';
import { loadLayout, saveLayout } from './layout-state.js';
import { layoutStorage, readLang, saveLang } from './page-storage.js';
import { initTuning } from './tuning.js';
import { initMixer } from './mixer.js';
import { initProfiles } from './profiles.js';
import { buildKeyScale, buildKeyScaleSelects } from './key-scale.js';
import { createLcdSelect, syncLcdSelects } from './lcd-select.js';
import { initTimbrePanel } from './timbre-panel.js';
import { initVoices, voiceLoad } from './voices-panel.js';
import { initJobs } from './jobs-panel.js';
import { initOrgan } from './organ-panel.js';
import { initRhythm } from './rhythm.js';
import { initFormPanel } from './form-panel.js';
import { initFormStrip } from './form-strip.js';
import { syncKnobs } from './knob.js';

// Dekoratives 16tel-Bild je Stil, 1 = Schlag
const RHYTHMS = {
  funk: '1001001010100110', psych: '1010101010101010', dreamy: '1000000010000000',
  blues: '1000100110001001', rock: '1000001010100000', hardrock: '1010001010100010',
  reggae: '0000100000001000', country: '1000001010000010', poppunk: '1011101110111011',
};

// --- was die Seite selbst hält: Sprache, Seite, Fokus/Einstellen (Sprache und Speicher des Layouts teilt sie mit der Seite für eigene Tracks) ---
let lang = readLang();
let page = 'start'; // 'start' | 'play'
let layout = loadLayout(layoutStorage); // Fokus/Einstellen, Beschriftung, Bünde
// Die Variante, die die Web-App aus dem Browser würfelt (crypto), bringt die Aktion mit: der Kern würfelt nicht
const rollVariant = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 9999) + 1;

// Die Sprache wählt die Leiste der App für jede Seite; die eigenen Tasten der Seite stehen verborgen (sie gelten weiter, die Leiste hört mit)
document.head.append(Object.assign(document.createElement('style'), { textContent: '.lang { display: none !important; }' }));
function setLang(next) {
  lang = next;
  saveLang(lang);
  post('language', { lang });
  render();
}
listen((what, value) => { if (what === 'language' && (value === 'de' || value === 'en')) setLang(value); });
addEventListener('load', () => post('language', { lang })); // die Leiste zeigt die Sprache der Seite

// Einmalige Übernahme (Task 32): was die alte Seite im Speicher der WebView hielt (Profile, zuletzt gespielte Sitzung, Mischpult), geht an die
// Sitzung (importLegacy; sie nimmt nur, was sie selbst noch nicht gespeichert hat), bis eine Antwort zeigt, dass nichts mehr zu nehmen ist; dann
// folgt der Vermerk. Die alten Einträge bleiben. Im Zweifel kein Vermerk: ein zweites Schicken nimmt nichts über Gespeichertes.
// Nichts mehr zu nehmen heißt: die Antwort sagt zu jedem Text, was die Sitzung mit ihm tat (state().legacy), und keiner ist "failed" (der Speicher
// ließ sich gerade nicht lesen oder schreiben, oder was unter dem Namen liegt, hat ein Problem: der nächste Start kann ihn nehmen).
try {
  const old = Object.fromEntries(['profiles', 'session', 'mix'].map((name) => [name, localStorage.getItem(`backingtrack.${name}`)]));
  if (localStorage.getItem('backingtrack.imported') === null && Object.values(old).some((text) => text !== null)) {
    send({ action: 'importLegacy', ...old }).then(({ legacy }) => {
      if (legacy && !Object.values(legacy).includes('failed')) try { localStorage.setItem('backingtrack.imported', '1'); } catch { /* ohne Speicher kommt sie beim nächsten Laden wieder */ }
    });
  }
} catch { /* Speicher gesperrt: nichts zu übernehmen */ }

// --- Wiedergabe: die Hülle spielt den Song der Sitzung (playSession, stop); die Seite zeigt, wo er steht ---
const playing = () => session.engine.playing;
// Die Web-App zeigt Takt, Akkord und Countdown erst ab dem ersten Takt (state.current), nicht im Vorlauf eines Starts (die Uhr steht 0,15 s):
// hadBar wird wahr, sobald die Uhr in dieser Wiedergabe läuft, und bleibt es über einen Neustart am Takt; ein Neustart ab Takt 1 (die letzte
// Antwort hat restart ohne inPlace: restartIfPlaying ohne inPlace und Weitermachen setzen state.current auf null) zeigt im Vorlauf nichts
let hadBar = false;
let fromStart = false;
const current = () => playing() && hadBar;
let starting = false; // "Los" geschickt, die Engine hat den Start noch nicht gemeldet: ein zweiter Klick tut nichts (wie in der Web-App, solange die Packs laden)
// "Stopp" geschickt, die Engine hat noch nicht gemeldet, dass sie steht, und kein Start kam danach: ein Klick bis dahin startet, wie in der Web-App
// (stop() setzt state.playing sofort)
let stopped = false;
// Takt, Akkord, Countdown und Lichter gehen mit dem Klick aus, wie in stop() der Web-App: startet ein zweiter Klick gleich neu, kommt oft keine
// Meldung, dass die Engine steht, und der Vorlauf zeigte sonst den alten Lauf
function stop() {
  post('stop');
  stopped = true;
  hadBar = false;
  for (const layer of [...sounding.keys()]) endSound(layer);
  render();
}
let startFailed = false; // der letzte Start spielte nicht (die Web-App: err.playFailed), bis zum nächsten Start oder Weitermachen
let errorsHidden = false; // die Web-App löscht die Fehler eines Weitermachens, wenn eine Wiedergabe beginnt (app.js 122 der Web-App)
listen((what) => {
  if (what === 'state' && session.change) fromStart = session.change.restart && !session.change.inPlace;
  if (what === 'playing') {
    if (!playing()) {
      stopped = false;
      hadBar = false;
      for (const layer of [...sounding.keys()]) endSound(layer);
    } else {
      errorsHidden = true;
      if (!session.engine.standing) hadBar = true;
      else if (fromStart) hadBar = false;
    }
  }
  if (what === 'state') for (const layer of [...sounding.keys()]) if (!session.state.track.layers[layer]) endSound(layer); // stumm: die LED geht sofort aus
  if (what !== 'language') render();
});

// Lichter der Schichten (LED im Modultitel und vor dem Spurnamen), drei Stufen über dem Grundzustand "spielt in diesem Takt" (.on, gedämpft):
// .sound: ein Ton der Schicht klingt gerade (volle Helligkeit, so lange wie der Ton; ein gehaltener Pad-Akkord leuchtet also durch),
// .hit: Anschlag (Lichtschein für FLASH_MS; ein Anschlag, der in dieses Leuchten fällt, verlängert es nicht, sonst blinkte dichtes Spiel nicht).
// Schläge (Schlagzeug, Percussion) haben keine Dauer und blitzen nur. Die Schlag-LED im Start/Stopp-Taster blitzt auf jedem Schlag.
// Mit "Bewegung reduzieren" ändert sich nichts im Takt: die LEDs der Schichten leuchten dann wie bisher den ganzen Takt voll.
const FLASH_MS = 70;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const flashing = new Set(); // LED-Gruppen, die gerade leuchten
function flash(key, selector) {
  if (calm.matches || page !== 'play' || flashing.has(key)) return;
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
  if (calm.matches || page !== 'play') return;
  const until = performance.now() + ms;
  if (sounding.get(layer)?.until >= until) return; // ein längerer Ton klingt schon
  clearTimeout(sounding.get(layer)?.timer);
  for (const el of document.querySelectorAll(layerLeds(layer))) el.classList.add('sound');
  sounding.set(layer, { until, timer: setTimeout(() => endSound(layer), ms) });
}
// jedes gespielte Ereignis einer hörbaren Schicht (stumme leuchten nicht); die Dauer zählt beim Tempo des Verlaufs, also mal dieses durch das jetzige
function flashEvent(e) {
  if (!(e.type === 'note' || e.type === 'hit') || !session.state.track.layers[e.layer]) return;
  flash(e.layer, layerLeds(e.layer));
  if (e.type === 'note') holdSound(e.layer, (e.dur * 1000 * session.lanes.bpm) / session.engine.bpm);
}
// Die Ereignisse, deren Schlag (t beim Tempo des Verlaufs) die Wiedergabe seit dem letzten Bild überschritten hat, im Durchlauf von lanes.beats Schlägen;
// ein Sprung (Spulen, Schleife, Neustart) beginnt dort neu, ohne nachzuholen
let ledLanes = null, ledBeats = [], ledAt = -1, ledNext = 0;
function tickLeds() {
  const lanes = session.lanes;
  if (!current() || !lanes?.beats) ledAt = -1;
  else {
    if (lanes !== ledLanes) { ledLanes = lanes; ledBeats = lanes.events.map((e) => (e.t * lanes.bpm) / 60); ledAt = -1; }
    const now = ((beatsNow() % lanes.beats) + lanes.beats) % lanes.beats;
    const wrapped = ledAt >= 0 && now < ledAt && ledAt - now > lanes.beats / 2;
    if (ledAt < 0 || (now < ledAt && !wrapped) || now > ledAt + 2) ledNext = ledBeats.findIndex((b) => b > now);
    else {
      if (wrapped) { while (ledNext >= 0 && ledNext < ledBeats.length) flashEvent(lanes.events[ledNext++]); ledNext = 0; }
      while (ledNext >= 0 && ledNext < ledBeats.length && ledBeats[ledNext] <= now) flashEvent(lanes.events[ledNext++]);
    }
    ledAt = now;
  }
  requestAnimationFrame(tickLeds);
}
requestAnimationFrame(tickLeds);

// Teil am Takt für die Kopfleiste: übersetzter Typ plus laufende Nummer dieses Typs ("Strophe 2"); ohne Form leer
const partLabel = (part) => (part ? `${t(`form.part.${part.type}`)} ${part.n}` : '');

// --- Bedienung der Startseite ---
// Überrasch mich: die Zufallszahlen der Web-App (Math.random) bringt die Aktion mit; was der Nutzer auf der Startseite selbst gewählt hat, weiß die Sitzung
$('surprise').addEventListener('click', () => send({ action: 'surprise', variant: rollVariant(), style: Math.random(), tempo: Math.random(), scale: Math.random(), root: Math.random() }));

// Weitermachen: die Sitzung stellt die gemerkte wieder her, die Hülle spielt sie am gemerkten Takt; dann die Spielseite im Fokus
$('resume').addEventListener('click', async () => {
  stopped = false; // ein Start nach dem Stopp davor: ein Klick auf „Stopp“ hält ihn an (in der Web-App spielt er gleich)
  const answer = await send({ action: 'resume' });
  errorsHidden = false;
  startFailed = false;
  if (answer.resumed) openFrom('resume', { mode: 'focus' });
  else render();
});

// Tempo-Regler im Popover (from "start") und im Modul Rhythmus (from "play")
for (const [id, from] of [['tempo', 'start'], ['tuning-tempo', 'play']]) {
  $(id).addEventListener('input', (e) => {
    send({ action: 'setTempo', bpm: Number(e.target.value), from }, e.target);
    render();
  });
}

// Zustand der Spielseite (Fokus oder Einstellen) setzen und merken
function setMode(mode) {
  if (layout.mode === mode) return;
  layout = { ...layout, mode };
  saveLayout(layoutStorage, layout);
}

// Seitenwechsel; die Wiedergabe läuft weiter. mode (optional) setzt den Zustand der Spielseite.
let opener = 'tune-btn'; // Knopf der Startseite, der die Spielseite zuletzt geöffnet hat
function showPage(next, { mode } = {}) {
  if (mode) setMode(mode);
  page = next;
  render();
  if (page === 'play') $('play-title').focus();
  // "Zur Spielseite" ist im Stand versteckt: dann auf Los
  else ($(opener).checkVisibility() ? $(opener) : $('go')).focus();
}

function openFrom(id, opts) {
  opener = id;
  showPage('play', opts);
}

// Start (start() der Web-App): die Fehler davor fallen weg; spielt er nicht, steht err.playFailed da. true: er spielt
async function playSession() {
  starting = true;
  errorsHidden = true;
  startFailed = false;
  render();
  const report = await start();
  starting = false;
  stopped = false; // die Meldung des Starts kommt nach dem Stopp davor
  startFailed = !report.playing;
  render();
  return report.playing;
}
// Los auf der Startseite: im Stand starten und zur Spielseite, beim Spielen stoppen und bleiben; gescheitert: die Meldung steht auf der Startseite.
// shortcut: ein Klick, solange die Engine einen Start noch nicht gemeldet hat, tut nichts, auch wenn sie schon spielt; in der Web-App ist der Start
// sofort da (die Packs geladen) und der Klick hält an, so enden drei schnelle Klicks beim Spielen hier spielend, dort gestoppt, upgrade: wenn die
// Hülle einen Start schon in seiner ersten Meldung nennt oder ein Nutzer darauf stößt
$('go').addEventListener('click', async () => {
  if (starting) return;
  if (playing() && !stopped) {
    stop();
    return;
  }
  if (await playSession()) openFrom('go', { mode: 'focus' });
});
$('play-go').addEventListener('click', () => {
  if (starting) return;
  if (playing() && !stopped) stop();
  else playSession();
});
$('tune-btn').addEventListener('click', () => openFrom('tune-btn', { mode: 'setup' }));
$('to-play').addEventListener('click', () => openFrom('to-play'));
$('play-back').addEventListener('click', () => showPage('start'));
$('mode-switch').addEventListener('click', () => {
  setMode(layout.mode === 'setup' ? 'focus' : 'setup');
  render();
});

// Neue Variante: die Sitzung leitet die Folge aus Tonart und Nummer neu ab; eine laufende Wiedergabe geht im laufenden Takt weiter
$('new-variant').addEventListener('click', () => send({ action: 'newVariant', variant: rollVariant() }));
$('variant-random').addEventListener('click', () => send({ action: 'newVariant', variant: rollVariant() }));
$('variant-prev').addEventListener('click', () => send({ action: 'stepVariant', dir: -1 }));
$('variant-next').addEventListener('click', () => send({ action: 'stepVariant', dir: 1 }));

// Eingabe übernehmen (Enter oder Verlassen); Ungültiges ignorieren, beim Verlassen zeigt das Feld wieder die Variante
$('variant').addEventListener('change', (e) => {
  const n = Number(e.target.value);
  if (e.target.value !== '' && Number.isInteger(n) && n >= 1 && n <= 9999) send({ action: 'enterVariant', variant: n });
});
$('variant').addEventListener('blur', (e) => { if (session.state) e.target.value = String(session.state.track.seed); });

for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang));

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

// --- Aufbau der Auswahl (einmal, wenn die Festwerte da sind), Texte kommen aus render() ---
let built = null;
function build() {
  const { STYLE_PRESETS, VOICE_LAYERS } = session.tables;
  const keyScales = [
    buildKeyScale({ keyChips: $('key-chips'), scaleChips: $('scale-chips') }),
    buildKeyScaleSelects({ keySelect: $('key-select'), scaleSelect: $('scale-select') }),
  ];
  for (const { id } of STYLE_PRESETS) {
    const card = Object.assign(document.createElement('button'), { type: 'button', className: 'card' });
    card.dataset.style = id;
    card.addEventListener('click', () => {
      send({ action: 'setStyle', style: id, from: 'start' });
      $('style-pop').hidePopover();
    });
    card.innerHTML = '<span class="card-name"></span><span class="card-bpm"></span><span class="card-hint"></span><span class="rhythm" aria-hidden="true"></span>';
    for (const step of RHYTHMS[id]) card.lastChild.append(Object.assign(document.createElement('i'), { className: step === '1' ? 'on' : '' }));
    $('style-cards').append(card);
  }
  // Stil im Modul Charakter: wie die Stilkarten der Startseite
  const styleSelect = $('style-select');
  for (const { id } of STYLE_PRESETS) {
    const o = Object.assign(document.createElement('option'), { value: id });
    o.dataset.i18n = `style.${id}`;
    styleSelect.append(o);
  }
  createLcdSelect(styleSelect, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
  styleSelect.addEventListener('change', () => send({ action: 'setStyle', style: styleSelect.value, from: 'play' }, styleSelect));

  const renderTuning = initTuning({
    page: () => page,
    current,
    layout: () => layout,
    // Umschalter im Kopf des Griffbretts: gewählter Wert wird mit der Seite gemerkt
    choose(attr, value) {
      layout = { ...layout, [attr]: value };
      saveLayout(layoutStorage, layout);
      render();
    },
  });
  const renderMixer = initMixer();
  const renderProfiles = initProfiles();
  const renderRhythm = initRhythm();
  const renderForm = initFormPanel({ page: () => page });
  const renderStrip = initFormStrip({ page: () => page, current });
  const renderTimbre = initTimbrePanel(); // baut die Instrument-Module
  const renderVoices = initVoices(); // nach dem Klangpanel: füllt den Platz Stimme in dessen Modulen
  const renderJobs = initJobs(); // ebenso: Aufgabe
  const renderOrgan = initOrgan(); // ebenso: Leslie und Zerre der Orgel im Akkord-Modul
  // Akkordart-Gruppen im Popover sind <details>: immer offen (keine Klappgruppen)
  for (const el of document.querySelectorAll('#add-qualities details[data-group]')) el.open = true;
  const loading = () => VOICE_LAYERS.some((layer) => voiceLoad(layer) === 'loading');
  return { keyScales, styleSelect, loading, panels: [renderTuning, renderMixer, renderProfiles, renderVoices, renderJobs, renderOrgan, renderTimbre, renderRhythm, renderForm, renderStrip] };
}

// --- Darstellung ---
const langGroup = document.querySelector('.lang');
const topBar = document.querySelector('.top');
const show = (el, on) => { if (el.hidden === on) el.hidden = !on; };
let lastBeat = -1;

function render() {
  const { tables, state, derived, position } = session;
  if (!tables || !state || !derived || !position) return; // bis die Antwort auf sync da ist
  built ??= build();
  const { track, scale, style, errors, loopBars, last } = state;
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

  const bpm = holds($('tempo')) ? $('tempo').value : String(track.bpm); // ein gezogener Regler zeigt die Hand bis zur Antwort
  setText($('key-btn'), t('ui.keyScale', { root: track.key.root, scale: t(`scale.${scale}`) }));
  setText($('style-btn'), t(`style.${style}`));
  setText($('tempo-btn'), `${bpm} ${t('ui.bpm')}`);
  // nur bei Änderung: <output>.value ersetzt den Textknoten
  for (const id of ['tempo', 'tempo-out']) if ($(id).value !== bpm) $(id).value = bpm;

  for (const k of built.keyScales) k.render();
  if (!holds(built.styleSelect) && built.styleSelect.value !== style) built.styleSelect.value = style;
  for (const card of $('style-cards').children) {
    const { id, bpm: styleBpm } = tables.STYLE_PRESETS.find((p) => p.id === card.dataset.style);
    setText(card.querySelector('.card-name'), t(`style.${id}`));
    setText(card.querySelector('.card-bpm'), `${styleBpm} ${t('ui.bpm')}`);
    setText(card.querySelector('.card-hint'), t(`style.${id}.hint`));
    pressed(card, id === style);
  }

  // während der Eingabe nicht überschreiben
  if (document.activeElement !== $('variant') && $('variant').value !== String(track.seed)) $('variant').value = String(track.seed);
  setText($('chords'), position.progression.map((p) => p.name).join(' – '));
  const place = current();
  const now = place ? position.name : '';
  const bar = place ? positionLabel(position.bar, loopBars) : '';
  const message = [...(errorsHidden ? [] : errors), ...(startFailed ? [{ code: 'playFailed', params: {} }] : [])].map((e) => t(`err.${e.code}`, e.params)).join(' ');
  const loadingPacks = starting && !playing() && built.loading();
  for (const id of ['go', 'play-go']) {
    setText($(id), t(playing() ? 'ui.stop' : loadingPacks ? 'voice.status.loading' : 'ui.go'));
    setAttr($(id), 'aria-busy', String(loadingPacks));
    $(id).classList.toggle('playing', playing());
  }
  for (const [id, text] of [['now-chord', now], ['play-now', now], ['position', bar], ['play-position', bar], ['play-part', partLabel(position.part)],
    ['message', message], ['play-message', message], ['play-variant', t('ui.variantShown', { n: track.seed })]]) {
    setText($(id), text);
  }
  // Countdown bis zum nächsten Akkordwechsel und Schlag-LED, nur bei laufender Wiedergabe
  const n = place ? position.countdown : null;
  setText($('play-countdown'), n === null ? '' : t(n === 1 ? 'ui.countdownOne' : 'ui.countdownMany', { n }));
  if ((place ? position.beat : -1) !== lastBeat) {
    lastBeat = place ? position.beat : -1;
    if (place) flash('beat', '#beat-led');
  }

  // im Stand zeigen die leeren Displays der Kopfleiste gedämpft die Länge und den ersten Akkord (nur als Bild: der Text bleibt leer)
  setAttr($('play-position'), 'data-idle', t('ui.positionIdle', { n: loopBars }));
  setAttr($('play-now'), 'data-idle', position.progression[0]?.name ?? '');
  show($('start'), page === 'start');
  show($('play'), page === 'play');
  show($('to-play'), playing());
  show($('last'), Boolean(last));
  // was mit der gemerkten Sitzung nicht stimmt (PROTOKOLL.md Abschnitt 3a): eine Zeile beim Kasten, auch statt seiner
  const stored = state.storage.session;
  show($('last-storage'), Boolean(stored));
  setText($('last-storage'), stored ? t(`ui.storage.session.${stored}`) : '');
  if (last) {
    setText($('last-summary'), t('ui.lastSummary', {
      key: t('ui.keyScale', { root: last.root, scale: t(`scale.${last.scale}`) }),
      style: t(`style.${last.style}`),
      bpm: last.bpm,
      variant: last.seed ?? '',
      bar: last.bar + 1,
      when: last.at ? new Date(last.at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : '',
    }));
  }
  setAttr($('play'), 'data-mode', layout.mode);
  setAttr($('mode-switch'), 'aria-checked', String(layout.mode === 'setup'));
  // Sprachtasten: in der Kopfleiste der Spielseite, sonst oben auf der Startseite (nur bei Wechsel umhängen, sonst ginge der Fokus verloren)
  const langHome = page === 'play' ? $('play-message') : null;
  if (langHome ? langGroup.nextElementSibling !== langHome : langGroup.parentElement !== topBar) {
    if (langHome) langHome.before(langGroup);
    else topBar.append(langGroup);
  }
  for (const panel of built.panels) panel();
  syncKnobs(); // zuletzt: die Eingaben tragen jetzt ihre Werte
  syncLcdSelects();
}
