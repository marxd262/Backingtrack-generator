// Reine Helfer des Profil-Fensters (ohne DOM): Werksprofile, Sitzung lesen/schreiben, Kurzbeschreibung, Text der Teile-Auswahl,
// Zeilen „Inhalt: …“ und „n Profile, m Unterordner“, Rückfrage beim Löschen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLE_PRESETS } from '../../src/core/tags.js';
import { PART_IDS, PART_PRESETS, sanitizeParts, applyParts } from '../../src/core/profile-parts.js';
import { factoryProfiles, factoryParts } from '../../src/ui/profile-factory.js';
import { readSession, writeSession, summary } from '../../src/ui/profile-session.js';
import { partsSummary, contentsLine, folderLine, deleteQuestion, count } from '../../src/ui/profile-parts-picker.js';
import { t, setLanguage } from '../../src/i18n/index.js';

test('factoryProfiles: ein Eintrag je Stil, Reihenfolge und Schlüssel wie STYLE_PRESETS', () => {
  assert.deepEqual(factoryProfiles(), STYLE_PRESETS.map((p) => ({ key: `factory:${p.id}`, styleId: p.id })));
  assert.equal(factoryProfiles().length, 9);
});

const uiState = () => ({
  track: { key: { root: 'A', mode: 'minor' }, bpm: 100, bars: [{ chord: { root: 'A', quality: 'min' }, beats: 4 }], tags: {}, timbre: {}, layers: {}, seed: 1, variety: true, length: 96, meter: [4, 4] },
  scale: 'minorPentatonic', style: 'funk', chordColor: 'triads', chordColorFromStyle: true, mix: { drums: 1, master: 1 },
  playing: true, lang: 'de', tempoRef: { key: '4/4', quarter: 100, shown: 100 }, notice: 'ui.progressionFull', errors: [{ code: 'playFailed', params: {} }],
});

test('factoryParts: Stil mit kopierten Schlagworten, Tempo der Vorlage in 4/4 (Laden rechnet es wie applyStyle um), Klangregler zurückgesetzt', () => {
  const funk = STYLE_PRESETS.find((p) => p.id === 'funk');
  const parts = factoryParts('funk');
  assert.deepEqual(Object.keys(parts), PART_IDS.filter((id) => ['tempo', 'style', 'sound'].includes(id)));
  assert.deepEqual(parts, { tempo: { bpm: 100, meter: [4, 4] }, style: { style: 'funk', tags: funk.tags }, sound: { timbre: {} } });
  assert.notEqual(parts.style.tags, funk.tags, 'Kopie, nicht die Vorlage');
  parts.style.tags.drums.push('heavy');
  assert.ok(!funk.tags.drums.includes('heavy'));
  // gleich, in welcher Taktart die Kopie entstand: geladen in 6/8 dieselbe Achtelgeschwindigkeit wie „Laden“ des Werksprofils, in 4/4 das Stiltempo
  const in68 = uiState();
  in68.track.meter = [6, 8];
  in68.track.bars[0].beats = 2;
  assert.equal(applyParts(readSession(in68), factoryParts('funk')).session.track.bpm, 67);
  assert.equal(applyParts(readSession(uiState()), factoryParts('funk')).session.track.bpm, 100);
  for (const { id } of STYLE_PRESETS) assert.equal(sanitizeParts(factoryParts(id)).skipped, 0, id); // überlebt den Import
});

test('readSession liest nur die sechs Sitzungsfelder; writeSession setzt sie, löscht tempoRef, Hinweis und Fehler, lässt den Rest', () => {
  const state = uiState();
  assert.deepEqual(Object.keys(readSession(state)), ['track', 'scale', 'style', 'chordColor', 'chordColorFromStyle', 'mix']);
  const r = applyParts(readSession(state), { tempo: { bpm: 77 }, style: { style: 'rock' }, mixer: { mix: { drums: 0.5 } } });
  assert.ok(r.ok);
  writeSession(state, r.session);
  assert.equal(state.track.bpm, 77);
  assert.equal(state.style, 'rock');
  assert.deepEqual(state.mix, { drums: 0.5, master: 1 });
  assert.equal(Object.hasOwn(state, 'tempoRef'), false);
  assert.equal(state.notice, null);
  assert.deepEqual(state.errors, []);
  assert.equal(state.playing, true);
  assert.equal(state.lang, 'de');
});

test('writeSession: tempoRef bleibt, wenn das Profil weder Tempo noch Taktart ändert (nur Mischpult, gleiches Tempo); eine neue Taktart löscht ihn', () => {
  const keep = (parts) => {
    const state = uiState();
    writeSession(state, applyParts(readSession(state), parts).session);
    return state.tempoRef;
  };
  assert.deepEqual(keep({ mixer: { mix: { drums: 0.5 } } }), { key: '4/4', quarter: 100, shown: 100 });
  assert.deepEqual(keep({ tempo: { bpm: 100 } }), { key: '4/4', quarter: 100, shown: 100 });
  const harmony = { key: { root: 'A', mode: 'minor' }, bars: [{ chord: { root: 'A', quality: 'min' }, beats: 4 }], meter: [12, 8] };
  assert.equal(keep({ harmony }), undefined);
});

test('summary: Tonart und Skala, Tempo, Stil in der gewählten Sprache', () => {
  setLanguage('de');
  assert.equal(summary(uiState(), t), 'A-Moll-Pentatonik · 100 bpm · Stil: Funk-Rock');
  setLanguage('en');
  assert.match(summary(uiState(), t), /^A .*· 100 bpm · Style: /);
  setLanguage('de');
});

test('contentsLine: Namen der Teile in PART_IDS-Reihenfolge, egal wie die Teile gespeichert sind', () => {
  setLanguage('de');
  assert.equal(contentsLine({ mixer: {}, tempo: {}, sound: {} }, t), 'Inhalt: Tempo, Klangregler, Mischpult');
  setLanguage('en');
  assert.equal(contentsLine({ variant: {} }, t), 'Contents: Variant');
  setLanguage('de');
});

test('folderLine und deleteQuestion: alles im Ordner gezählt (auch tief), Einzahl und Mehrzahl', () => {
  const p = { type: 'profile', parts: {} };
  const deep = { type: 'folder', items: [p, { type: 'folder', items: [p, { type: 'folder', items: [] }] }] };
  setLanguage('de');
  assert.equal(folderLine(deep, t), '2 Profile, 2 Unterordner');
  assert.equal(folderLine({ type: 'folder', items: [p, { type: 'folder', items: [] }] }, t), '1 Profil, 1 Unterordner');
  assert.equal(folderLine({ items: [] }, t), '0 Profile, 0 Unterordner');
  assert.equal(deleteQuestion(deep, t), 'Ordner mit 4 Einträgen löschen?');
  assert.equal(deleteQuestion({ type: 'folder', items: [p] }, t), 'Ordner mit 1 Eintrag löschen?');
  setLanguage('en');
  assert.equal(folderLine(deep, t), '2 profiles, 2 subfolders');
  assert.equal(folderLine({ type: 'folder', items: [p] }, t), '1 profile, 0 subfolders');
  assert.equal(deleteQuestion({ type: 'folder', items: [p] }, t), 'Delete the folder with 1 entry?');
  setLanguage('de');
});

test('count: Einzahl über den Schlüssel .one, weitere Platzhalter bleiben (Meldungen beim Import)', () => {
  setLanguage('de');
  assert.equal(count(t, 'ui.profileImportedFolder', 1, { name: 'Paket' }), 'Ordner Paket mit 1 Profil aufgenommen.');
  assert.equal(count(t, 'ui.profileImportedFolder', 2, { name: 'Paket' }), 'Ordner Paket mit 2 Profilen aufgenommen.');
  assert.equal(count(t, 'ui.profileImportedFolder', 0, { name: 'Paket' }), 'Ordner Paket mit 0 Profilen aufgenommen.');
  assert.equal(count(t, 'ui.profileSkipped', 1), '1 ungültige Angabe wurde übersprungen.');
  assert.equal(count(t, 'ui.profileSkipped', 3), '3 ungültige Angaben wurden übersprungen.');
  assert.equal(count(t, 'ui.profileDropped', 1), '1 Eintrag wurde übersprungen (zu tief verschachtelt oder zu viele Einträge).');
  assert.equal(count(t, 'ui.profileDropped', 2), '2 Einträge wurden übersprungen (zu tief verschachtelt oder zu viele Einträge).');
  setLanguage('en');
  assert.equal(count(t, 'ui.profileImportedFolder', 1, { name: 'Pack' }), 'Folder Pack with 1 profile added.');
  assert.equal(count(t, 'ui.profileSkipped', 1), '1 invalid entry was skipped.');
  assert.equal(count(t, 'ui.profileDropped', 1), '1 entry was skipped (nested too deep or too many entries).');
  assert.equal(count(t, 'ui.profileDropped', 2), '2 entries were skipped (nested too deep or too many entries).');
  setLanguage('de');
});

test('partsSummary: alle Teile "Alles", sonst "n von 10"', () => {
  setLanguage('de');
  assert.equal(partsSummary(PART_IDS, t), 'Inhalt: Alles');
  assert.equal(partsSummary(PART_PRESETS.sound, t), 'Inhalt: 3 von 10');
  assert.equal(partsSummary([], t), 'Inhalt: 0 von 10');
});
