import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
import { TAG_CATEGORIES, STYLE_PRESETS, INERT_TAGS, resolveTags, isSoundOnlyChange } from '../../src/core/tags.js';
import { resolveTimbre, DEFAULT_TIMBRE } from '../../src/core/timbre.js';

const NUMBERS = ['drive', 'swing', 'syncopation', 'bassLow', 'bassMovement', 'padWidth'];
const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

test('Kategorien in fester Reihenfolge', () => {
  assert.deepEqual(
    TAG_CATEGORIES.map((c) => c.id),
    ['drums', 'bass', 'synths', 'rhythm', 'mood', 'development', 'drumSound', 'bassSound', 'chordSound', 'padSound'],
  );
});

test('ohne Schlagworte gelten die Standardwerte (auch bei undefined/null)', () => {
  const expected = {
    drive: 0.5, swing: 0, syncopation: 0.5, bassLow: 0.5, bassMovement: 0.5,
    arp: false, padWidth: 0.5, buildUp: 'normal',
  };
  for (const input of [{}, undefined, null]) {
    assert.deepEqual(resolveTags(input, createRng(1)), expected);
  }
});

test('driving erhöht drive gegenüber dem Standard', () => {
  const base = resolveTags({}, createRng(1));
  assert.ok(resolveTags({ drums: ['driving'] }, createRng(1)).drive > base.drive);
});

test('mehrere Schlagworte in einer Kategorie werfen nicht', () => {
  assert.doesNotThrow(() => resolveTags({ drums: ['driving', 'dry'] }, createRng(1)));
});

test('unbekanntes Schlagwort wirft Error mit der Id', () => {
  assert.throws(() => resolveTags({ drums: ['nope'] }, createRng(1)), (e) => e instanceof Error && /nope/.test(e.message));
});

test('unbekannte Kategorie wirft Error mit der Id', () => {
  assert.throws(() => resolveTags({ nope: ['driving'] }, createRng(1)), (e) => e instanceof Error && /nope/.test(e.message));
});

test('Schlagwort aus fremder Kategorie ist unbekannt', () => {
  assert.throws(() => resolveTags({ bass: ['driving'] }, createRng(1)), /driving/);
});

test('arpeggio setzt arp, Entwicklung setzt buildUp', () => {
  assert.equal(resolveTags({ synths: ['arpeggio'] }, createRng(1)).arp, true);
  assert.equal(resolveTags({ development: ['buildsSlowly'] }, createRng(1)).buildUp, 'slow');
  assert.equal(resolveTags({ development: ['fullFromStart'] }, createRng(1)).buildUp, 'instant');
  assert.equal(resolveTags({ development: ['withBreakouts'] }, createRng(1)).buildUp, 'normal');
});

test('straight setzt swing auf 0 und senkt syncopation', () => {
  const p = resolveTags({ rhythm: ['straight'] }, createRng(1));
  assert.equal(p.swing, 0);
  assert.ok(p.syncopation < 0.5);
});

test('alle Kombinationen liefern zulässige Parameter', () => {
  const all = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c.tags]));
  for (const seed of seeds) {
    const p = resolveTags(all, createRng(seed));
    for (const k of NUMBERS) assert.ok(p[k] >= 0 && p[k] <= 1, `${k}=${p[k]}`);
    assert.ok(['slow', 'normal', 'instant'].includes(p.buildUp));
  }
});

test('gegensätzliche Schlagworte: beide Ausgänge kommen vor, je Seed reproduzierbar', () => {
  const tags = { drums: ['driving', 'loose'] };
  const drives = seeds.map((s) => resolveTags(tags, createRng(s)).drive);
  assert.ok(drives.some((d) => d > 0.5));
  assert.ok(drives.some((d) => d < 0.5));
  assert.deepEqual(drives, seeds.map((s) => resolveTags(tags, createRng(s)).drive));

  const builds = seeds.map((s) => resolveTags({ development: ['buildsSlowly', 'fullFromStart'] }, createRng(s)).buildUp);
  assert.ok(builds.includes('slow') && builds.includes('instant'));
});

test('verändert die Eingabe nicht', () => {
  const tags = { drums: ['driving', 'loose'], synths: ['arpeggio'] };
  const copy = structuredClone(tags);
  resolveTags(tags, createRng(1));
  assert.deepEqual(tags, copy);
});

test('INERT_TAGS: genau die Schlagworte ohne Wirkung, alle gültig', () => {
  const ids = TAG_CATEGORIES.flatMap((c) => c.tags);
  for (const tag of INERT_TAGS) assert.ok(ids.includes(tag), tag);
  assert.deepEqual([...INERT_TAGS].sort(), ['withBreakouts']);
  // unabhängig von der Liste: ohne Wirkung heißt, allein gewählt ergibt es die Standardwerte (Muster und Klang)
  const defaults = JSON.stringify([resolveTags({}, createRng(1)), resolveTimbre({})]);
  for (const c of TAG_CATEGORIES) {
    for (const tag of c.tags) {
      const inert = JSON.stringify([resolveTags({ [c.id]: [tag] }, createRng(1)), resolveTimbre({ [c.id]: [tag] })]) === defaults;
      assert.equal(INERT_TAGS.includes(tag), inert, tag);
    }
  }
});

test('Presets: bpm und nur bekannte Schlagworte', () => {
  assert.deepEqual(STYLE_PRESETS.map((p) => [p.id, p.bpm]), [
    ['funk', 100], ['psych', 112], ['dreamy', 80],
    ['blues', 88], ['rock', 124], ['hardrock', 148], ['reggae', 76], ['country', 112], ['poppunk', 172],
  ]);
  const known = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c.tags]));
  for (const preset of STYLE_PRESETS) {
    for (const [cat, list] of Object.entries(preset.tags)) {
      assert.ok(known[cat], `Kategorie ${cat}`);
      for (const t of list) assert.ok(known[cat].includes(t), `${preset.id}: ${t}`);
    }
    assert.doesNotThrow(() => resolveTags(preset.tags, createRng(1)));
  }
});

const SOUND_CATEGORIES = ['drumSound', 'bassSound', 'chordSound', 'padSound'];

test('Presets: alle vier Klang-Kategorien vorhanden, Stil-Klang wie festgelegt', () => {
  const sound = (id) => Object.fromEntries(SOUND_CATEGORIES.map((c) => [c, STYLE_PRESETS.find((p) => p.id === id).tags[c]]));
  assert.deepEqual(sound('funk'), { drumSound: ['punchy', 'snappy'], bassSound: ['plucky'], chordSound: ['biting'], padSound: [] });
  assert.deepEqual(sound('psych'), { drumSound: [], bassSound: ['fuzz'], chordSound: ['chorused'], padSound: ['swelling', 'glassy'] });
  assert.deepEqual(sound('dreamy'), { drumSound: ['roomy'], bassSound: ['round'], chordSound: ['mellow'], padSound: ['airy', 'swelling'] });
});

test('Gitarren-Stile: Charakter-Eckwerte der aufgelösten Parameter und des Klangs', () => {
  const resolved = (id) => {
    const p = STYLE_PRESETS.find((s) => s.id === id);
    return { params: resolveTags(p.tags, createRng(1)), timbre: resolveTimbre(p.tags), bpm: p.bpm, tags: p.tags };
  };
  const blues = resolved('blues');
  assert.ok(blues.params.swing >= 0.4 && blues.params.drive <= 0.5, 'Blues: Swing, lockerer Beat');
  for (const id of ['rock', 'hardrock', 'poppunk']) {
    const r = resolved(id);
    assert.equal(r.params.swing, 0, `${id}: gerade`);
    assert.ok(r.params.drive >= 0.7, `${id}: treibend`);
  }
  assert.ok(resolved('hardrock').params.drive >= 0.9 && resolved('hardrock').params.bassLow >= 0.7, 'Hardrock: schwer und tief');
  assert.ok(resolved('hardrock').timbre.bass.fuzz >= 0.5 && resolved('hardrock').timbre.master.brightness < 0.5, 'Hardrock: verzerrt und dunkel');
  assert.ok(resolved('rock').timbre.master.brightness > 0.5 && resolved('rock').timbre.chords.brightness > 0.5, 'Rock: hell und bissig');
  const reggae = resolved('reggae');
  assert.ok(reggae.params.drive <= 0.4 && reggae.params.syncopation >= 0.7, 'Reggae: Halbzeit, synkopiert');
  assert.ok(reggae.timbre.bass.sub >= 0.5 && reggae.timbre.chords.length < 0.5, 'Reggae: Sub-Bass, kurze Akkorde');
  const country = resolved('country');
  assert.ok(country.params.swing === 0 && country.params.bassMovement >= 0.7 && country.timbre.bass.pluck > 0.5, 'Country: gerade, wechselnder zupfender Bass');
  assert.ok(resolved('poppunk').bpm >= 150, 'Pop-Punk: schnell');
  for (const id of ['blues', 'rock', 'hardrock', 'reggae', 'country', 'poppunk']) {
    assert.deepEqual(resolved(id).tags.development, ['fullFromStart'], `${id}: setzt sofort ein`);
  }
});

test('Presets: Klang-Schlagworte ändern die Muster-Parameter nicht', () => {
  for (const preset of STYLE_PRESETS) {
    const patternOnly = Object.fromEntries(Object.entries(preset.tags).filter(([cat]) => !SOUND_CATEGORIES.includes(cat)));
    for (const seed of seeds) {
      assert.deepEqual(resolveTags(preset.tags, createRng(seed)), resolveTags(patternOnly, createRng(seed)), `${preset.id} seed ${seed}`);
    }
  }
});

test('Presets: Klangmodelle paarweise verschieden, jedes weicht bei Bass, Akkorden und Pad vom Standard ab (funk: Pad neutral)', () => {
  const timbres = STYLE_PRESETS.map((p) => resolveTimbre(p.tags));
  for (let i = 0; i < timbres.length; i++) {
    for (let j = i + 1; j < timbres.length; j++) {
      assert.notDeepEqual(timbres[i], timbres[j], `${STYLE_PRESETS[i].id} gegen ${STYLE_PRESETS[j].id}`);
    }
    for (const group of ['bass', 'chords', 'pad']) {
      // funk hat kein Pad-Schlagwort; sein Pad wich nur über warm ab, das funk nicht mehr führt (trockener, bissiger Stil)
      if (STYLE_PRESETS[i].id === 'funk' && group === 'pad') assert.deepEqual(timbres[i].pad, DEFAULT_TIMBRE.pad);
      else assert.notDeepEqual(timbres[i][group], DEFAULT_TIMBRE[group], `${STYLE_PRESETS[i].id}: ${group}`);
    }
  }
});

test('isSoundOnlyChange: nur reine Klang-Schlagworte geändert', () => {
  const funk = STYLE_PRESETS.find((p) => p.id === 'funk').tags;
  const cases = [
    ['fuzz dazu', funk, { ...funk, bassSound: ['plucky', 'fuzz'] }, true],
    ['glassy weg', { padSound: ['glassy', 'airy'] }, { padSound: ['airy'] }, true],
    ['driving dazu', {}, { drums: ['driving'] }, false],
    ['dreamy dazu (ändert auch die Pad-Stimmen)', {}, { mood: ['dreamy'] }, false],
    ['fuzz und driving dazu', {}, { bassSound: ['fuzz'], drums: ['driving'] }, false],
    ['gleiche Auswahl', funk, structuredClone(funk), false],
    ['gleiche Auswahl, andere Reihenfolge', { padSound: ['airy', 'glassy'] }, { padSound: ['glassy', 'airy'] }, false],
    ['warm, dark, bright, psychedelic, gritty dazu', {}, { synths: ['warm'], mood: ['dark', 'bright', 'psychedelic'], bass: ['gritty'] }, true],
    ['leere Kategorie fehlt', { padSound: [] }, {}, false],
    ['unbekanntes Schlagwort', {}, { padSound: ['shiny'] }, false],
    ['__proto__', {}, { padSound: ['__proto__'] }, false],
    ['null', null, { bassSound: ['fuzz'] }, false],
    ['undefined', { bassSound: ['fuzz'] }, undefined, false],
    ['beide fehlen', undefined, null, false],
    ['keine Liste', { bassSound: 'fuzz' }, { bassSound: ['fuzz', 'sub'] }, false],
    ['Zahl', 3, { bassSound: ['fuzz'] }, false],
  ];
  for (const [label, prev, next, expected] of cases) assert.equal(isSoundOnlyChange(prev, next), expected, label);
  // jedes Schlagwort der vier Klang-Kategorien allein ist reiner Klang, jedes Muster-Schlagwort nicht
  for (const c of TAG_CATEGORIES) {
    for (const tag of c.tags) {
      const soundOnly = SOUND_CATEGORIES.includes(c.id) || ['gritty', 'warm', 'dark', 'bright', 'psychedelic'].includes(tag);
      assert.equal(isSoundOnlyChange({}, { [c.id]: [tag] }), soundOnly, tag);
    }
  }
});
