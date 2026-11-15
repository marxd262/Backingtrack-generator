// Artikulations-Schicht (Phase 3, core/articulation.js): aus = unveränderter Strom; Stil-Profil aus Groove und Schlagworten; Regeln je Schicht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents as build, STYLE_PRESETS, GROOVES, DRUM_NAMES } from '../../src/index.js';
import { profileOf, completeArt, planRoll, ART_DEFAULTS } from '../../src/core/articulation.js';
import { barTimeline, checkedTrack } from '../../src/core/timeline.js';
import { createRng } from '../../src/core/rng.js';
import { pickArtZone } from '../../src/audio/voices/sample-zones.js';

const bar = (root, quality) => ({ chord: { root, quality }, beats: 4 });
const style = (id) => STYLE_PRESETS.find((s) => s.id === id);
const mk = (id, over = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: style(id).bpm, seed: 3, length: 8, tags: { ...style(id).tags, development: ['fullFromStart'] },
  bars: [bar('A', 'min'), bar('A', 'min'), bar('D', 'min'), bar('E', 'maj')],
  layers: { drums: true, bass: true, chords: true, pad: true },
  voices: { bass: { id: 'sample', variant: 'finger' }, chords: { id: 'sample', variant: 'guitar' } },
  ...over,
});
// Die Regel-Tests laufen gegen eine feste Basis (nur Bass und Gitarre Priorität A, der Standard vor dem Urteil vom 2026-11-14), damit jede Gruppe
// einzeln prüfbar bleibt: übergebene Feinwerte gelten über dieser Basis. Ohne Feinwerte gilt der echte Standard.
const BASIS = { drums: 0, keys: 0, pad: 0, lead: 0, band: 0, bassB: 0, chordsB: 0, keysB: 0, drumsB: 0 };
const buildEvents = (track, o = {}) => build(track, o.ornaments ? { ...o, ornaments: { ...BASIS, ...o.ornaments } } : o);
const ON = { ornaments: { on: 1 } };

test('an ist der Standard (alle Gruppen außer Gitarre B); Feinwert on 0, Regler 0 und alle Gruppen auf 0 ergeben denselben Strom ohne Artikulationen; ungültiger Regler wirft', () => {
  assert.deepEqual(ART_DEFAULTS, { on: 1, bass: 1, chords: 1, drums: 1, keys: 1, pad: 1, lead: 1, band: 1, bassB: 1, chordsB: 0, keysB: 1, drumsB: 1 });
  assert.deepEqual(completeArt({ on: 1, bass: -1, chords: 'x', drums: 1 }), { ...ART_DEFAULTS, drums: 1 });
  for (const id of ['funk', 'rock', 'blues']) {
    const plain = buildEvents(mk(id), { ornaments: { on: 0 } });
    assert.deepEqual(buildEvents(mk(id)), build(mk(id), { ornaments: ART_DEFAULTS }));
    assert.notDeepEqual(buildEvents(mk(id)), buildEvents(mk(id), ON), 'der Standard spielt mehr als die Basis');
    assert.notDeepEqual(buildEvents(mk(id), ON), plain);
    assert.ok(plain.every((e) => !e.art && !e.ring && e.strumUp === undefined));
    assert.deepEqual(buildEvents(mk(id, { ornaments: 0 })), plain);
    assert.deepEqual(buildEvents(mk(id), { ornaments: { bass: 0, chords: 0 } }), plain);
  }
  assert.throws(() => buildEvents(mk('funk', { ornaments: 2 })), /badOrnaments/);
});

test('Stil-Profil: jeder Stil der App und jeder Groove ergibt das Profil aus SPEC_PHASE3, Abschnitt 6', () => {
  const styles = { funk: 'funk', psych: 'rock', dreamy: 'ballad', blues: 'shuffle', rock: 'rock', hardrock: 'rock', reggae: 'reggae', country: 'country', poppunk: 'rock' };
  assert.deepEqual(Object.fromEntries(STYLE_PRESETS.map((s) => [s.id, profileOf({ tags: s.tags })])), styles);
  const grooves = { straight: 'rock', latin: 'latin', waltz: 'ballad', waltzRock: 'rock', ballad68: 'ballad', rock68: 'rock', shuffle: 'shuffle', slowBlues: 'slowBlues', fiveFour: 'rock' };
  assert.deepEqual(Object.fromEntries(Object.keys(GROOVES).map((id) => [id, profileOf({ groove: id, meter: GROOVES[id].meter.split('/').map(Number), tags: style('rock').tags })])), grooves);
});

test('Sample-Gruppen: eine Artikulation nimmt die Zone mit ihrem art, wenn das Pack eine hat; normale Noten nehmen nie eine art-Zone', () => {
  const zone = (art) => ({ keyLo: 0, keyHi: 127, velLo: 0, velHi: 127, art });
  const plain = zone(undefined), dead = zone('dead');
  assert.equal(pickArtZone([dead, plain], 40, 0.8, 'dead'), dead);
  assert.equal(pickArtZone([dead, plain], 40, 0.8, 'palmMute'), plain); // keine eigene Gruppe: normale Zone, die Stimme rechnet
  assert.equal(pickArtZone([dead, plain], 40, 0.8, undefined), plain);
  assert.equal(pickArtZone([plain], 40, 0.8, 'dead'), plain);
  assert.equal(pickArtZone(null, 40, 0.8, 'dead'), null);
});

// ---- Regeln ----
const GRID = { amount: 0, tight: 0 }; // exakt auf dem Raster, damit Plätze und Vorlauf prüfbar sind
const bassOf = (track, ornaments) => buildEvents(track, { timing: GRID, ornaments }).filter((e) => e.layer === 'bass');
const stepOf = (e) => Math.round(e.beat * 4);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

test('Verzierungs-Plan: die Wiederholung eines Teils behält etwa 70 % der Entscheidungen, derselbe Teil alle', () => {
  const rng = createRng(5), c = { kind: 'verse', phrase: 0, inPhrase: 1, rep: 0 };
  let same = 0;
  for (let i = 0; i < 2000; i++) {
    assert.equal(planRoll(rng, c, `x:${i}`), planRoll(rng, c, `x:${i}`));
    if (planRoll(rng, c, `x:${i}`) === planRoll(rng, { ...c, rep: 1 }, `x:${i}`)) same++;
  }
  assert.ok(same > 1300 && same < 1500, `${same} von 2000`);
});

test('Bass Funk: Dead Notes nur auf e oder a direkt vor einer Note gleichen Tons, leise und kurz; die übrigen Noten staccato', () => {
  let dead = 0;
  for (const seed of SEEDS) {
    const off = bassOf(mk('funk', { seed }), { on: 0 }), on = bassOf(mk('funk', { seed }), { on: 1, chords: 0 });
    on.forEach((n, i) => {
      if (n.art !== 'dead') return;
      dead++;
      assert.equal(stepOf(n) % 2, 1, JSON.stringify(n));
      assert.ok(n.vel >= 0.3 && n.vel <= 0.5 && n.dur <= 0.06, JSON.stringify(n));
      assert.equal(on[i + 1].midi, n.midi);
      assert.ok(Math.abs(on[i + 1].t - n.t - 0.15) < 0.03, 'die Zielnote folgt ein 16tel später (100 BPM, leichter Swing)');
    });
    const sounding = (list) => list.filter((n) => n.art !== 'dead').reduce((sum, n) => sum + n.dur, 0);
    assert.ok(sounding(on) < 0.7 * sounding(off), 'staccato: höchstens 60 % der Notenlänge');
    assert.ok(on.filter((n) => n.art !== 'dead' && n.art !== 'slideIn').every((n) => n.art === 'staccato'));
  }
  assert.ok(dead >= SEEDS.length, `${dead} Dead Notes`);
});

test('Bass slideIn: nur auf der Eins, das Ereignis bleibt dort (den Vorlauf macht die Stimme), 1 bis 7 Halbtöne von unten, 40 bis 100 ms', () => {
  let slides = 0;
  for (const id of ['funk', 'blues', 'rock']) for (const seed of SEEDS) {
    const track = mk(id, { seed, ornaments: 1 }), beat = 60 / track.bpm;
    for (const n of bassOf(track, { on: 1 }).filter((x) => x.art === 'slideIn')) {
      slides++;
      assert.ok(n.beat === 0 && Math.abs(n.t - n.bar * 4 * beat) < 1e-4, `${id} s=${seed}: ${JSON.stringify(n)}`);
      assert.ok([-1, -2, -5, -6, -7].includes(n.artSemi) && n.artTime >= 0.04 && n.artTime <= 0.1);
    }
  }
  assert.ok(slides >= 10, `${slides} Slides`);
});

test('Bass Blues: Annäherungston auf dem letzten Achtel vor dem Akkordwechsel, einen Halbton neben der nächsten Note; sonst legato', () => {
  let approaches = 0;
  for (const seed of SEEDS) {
    const track = mk('blues', { seed, ornaments: 1 }), on = bassOf(track, { on: 1 });
    on.forEach((n, i) => {
      if (n.art === 'approach') {
        approaches++;
        assert.equal(stepOf(n), 14);
        assert.ok(n.bar % 4 !== 0, 'nur vor einem Wechsel (Folge Am Am Dm E)');
        assert.equal(Math.abs(on[i + 1].midi - n.midi), 1, JSON.stringify([n, on[i + 1]]));
      }
      if (n.art === 'legato' && on[i + 1]) assert.ok(n.t + n.dur >= Math.min(on[i + 1].t, (n.bar + 1) * 4 * 60 / track.bpm) - 1e-4, 'hält bis zur nächsten Note oder zum Taktende');
    });
  }
  assert.ok(approaches >= SEEDS.length, `${approaches} Annäherungstöne`);
  // außerhalb des Blues bleibt der Annäherungston in der Tonleiter (Country, A-Moll)
  const scale = new Set([9, 11, 0, 2, 4, 5, 7]);
  for (const seed of SEEDS) for (const n of bassOf(mk('country', { seed, ornaments: 1 }), { on: 1 })) if (n.art === 'approach') assert.ok(scale.has(n.midi % 12), JSON.stringify(n));
});

test('Schicht an: sortiert, im Takt, Bass einstimmig, keine negative Dauer, reproduzierbar; Regler 1 verziert mindestens so viel wie 0,5', () => {
  for (const id of ['funk', 'rock', 'blues', 'reggae', 'dreamy', 'country', 'psych', 'hardrock']) for (const seed of [1, 2, 3]) for (const ornaments of [0.5, 1]) {
    const track = mk(id, { seed, ornaments, length: 16 }), events = buildEvents(track, ON), bars = barTimeline(checkedTrack(track)), label = `${id} s=${seed} o=${ornaments}`;
    assert.deepEqual(events, buildEvents(track, ON), `${label}: reproduzierbar`);
    for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t, `${label}: sortiert`);
    for (const e of events.filter((x) => x.layer)) {
      assert.ok(e.t >= bars[e.bar].start - 1e-6 && e.t < bars[e.bar].end, `${label}: im Takt ${JSON.stringify(e)}`);
      if (e.dur !== undefined) assert.ok(e.dur >= 0, `${label}: Dauer ${JSON.stringify(e)}`);
    }
    const bass = events.filter((e) => e.layer === 'bass');
    for (let i = 1; i < bass.length; i++) assert.ok(bass[i - 1].t + bass[i - 1].dur <= bass[i].t + 1e-6, `${label}: Bass einstimmig bei ${i}`);
    if (ornaments === 1) {
      const count = (o) => buildEvents({ ...track, ornaments: o }, ON).filter((e) => ['dead', 'slideIn', 'approach'].includes(e.art)).length;
      assert.ok(count(1) >= count(0.5), `${label}: ${count(1)} gegen ${count(0.5)}`);
    }
  }
});

// ---- Rhythmusgitarre ----
const chordsOf = (track, ornaments = { on: 1, bass: 0 }) => buildEvents(track, { timing: GRID, ornaments }).filter((e) => e.layer === 'chords');
const key = (e) => `${e.bar}:${stepOf(e)}`;
const form = (parts) => ({ form: { sections: parts.map(([type, bars]) => ({ type, bars })) } });

test('Gitarre Funk: Chucks auf freien 16teln sind die Mehrheit der Anschläge, Chokes nur auf Zählzeiten und höchstens ein 16tel lang, runter-hoch-hoch-hoch', () => {
  for (const seed of SEEDS) {
    const track = mk('funk', { seed }), off = chordsOf(track, { on: 0 }), on = chordsOf(track);
    const written = new Set(off.map(key)), chucks = on.filter((e) => e.art === 'chuck'), strokes = new Set(on.map(key));
    assert.ok(chucks.every((e) => !written.has(key(e)) && e.dur <= 0.03 && e.strum[1] === 3), 'Chucks nur auf freien Plätzen, drei Töne');
    assert.ok(new Set(chucks.map(key)).size > strokes.size / 2, `Mehrheit: ${new Set(chucks.map(key)).size} von ${strokes.size}`);
    for (const e of on.filter((x) => x.art === 'choke')) assert.ok(stepOf(e) % 4 === 0 && e.dur <= 15 / track.bpm + 1e-6, JSON.stringify(e));
    assert.ok(on.every((e) => e.strumUp === 2));
    for (const e of on) { // was vor einem Chuck klingt, endet dort
      const next = chucks.find((x) => x.t > e.t + 1e-6);
      if (next) assert.ok(e.t + e.dur <= next.t + 1e-6 || e.bar !== next.bar, JSON.stringify([e, next]));
    }
  }
});

test('Gitarre Rock mit Songform: Palm Mute in der Strophe öfter als im Refrain, die Eins im Refrain klingt aus, vor dem Stopp ein Choke', () => {
  let verse = 0, chorus = 0;
  for (const seed of SEEDS) {
    const on = chordsOf(mk('rock', { seed, ornaments: 1, ...form([['verse', 8], ['chorus', 8], ['break', 4], ['verse', 4]]) }));
    verse += on.filter((e) => e.art === 'palmMute' && e.bar < 8).length;
    chorus += on.filter((e) => e.art === 'palmMute' && e.bar >= 8 && e.bar < 16).length;
    assert.ok(on.filter((e) => e.bar >= 8 && e.bar < 15 && stepOf(e) === 0).every((e) => e.art === 'letRing' && e.ring === true));
    const stopBar = on.filter((e) => e.bar === 15); // letzter Takt des Refrains: der Break danach beginnt mit einem Stopp
    if (stopBar.length) assert.ok(stopBar.filter((e) => e.t === stopBar.at(-1).t).every((e) => e.art === 'choke'), JSON.stringify(stopBar.at(-1)));
  }
  assert.ok(verse > 3 * chorus && verse > 0, `${verse} gegen ${chorus}`);
});

test('Gitarre: Reggae würgt jeden Stab ab; der letzte Stab des Tracks klingt aus; Arpeggios (Psych) überlappen bis zum Taktende', () => {
  for (const seed of SEEDS) {
    assert.ok(chordsOf(mk('reggae', { seed })).every((e) => e.art === 'choke'));
    const rock = chordsOf(mk('rock', { seed }));
    assert.ok(rock.filter((e) => e.t === rock.at(-1).t).every((e) => e.art === 'letRing'));
    const track = mk('psych', { seed }), beat = 60 / track.bpm, arp = chordsOf(track);
    assert.ok(arp.length > 0 && arp.every((e) => e.ring === true && Math.abs(e.t + e.dur - (e.bar + 1) * 4 * beat) < 1e-4));
  }
});

test('Gitarre: Anschlagrichtung nach Spielweise (16tel: e und a hoch; Achtel: "+" hoch), Aufschläge leiser; Tasten bleiben unberührt', () => {
  for (const seed of SEEDS) {
    const track = mk('rock', { seed }), off = new Map(chordsOf(track, { on: 0 }).map((e) => [`${key(e)}:${e.midi}`, e]));
    for (const e of chordsOf(track)) {
      const bar = [...off.values()].filter((x) => x.bar === e.bar), sixteenths = bar.some((x) => stepOf(x) % 2);
      assert.equal(e.strumUp, sixteenths ? 1 : 2);
      const up = sixteenths ? stepOf(e) % 2 === 1 : stepOf(e) % 4 !== 0, before = off.get(`${key(e)}:${e.midi}`).vel;
      assert.ok(Math.abs(e.vel - (up ? 0.85 : 1) * before) < 0.002, JSON.stringify(e));
    }
    const keys = mk('funk', { seed, voices: { chords: { id: 'sample', variant: 'epiano' } } });
    assert.deepEqual(chordsOf(keys), chordsOf(keys, { on: 0 }));
  }
});

// ---- Schlagzeug ----
const drumsOf = (track, ornaments = { drums: 1 }) => buildEvents(track, { timing: GRID, ornaments }).filter((e) => e.layer === 'drums');

test('Schlagzeug ist abschaltbar; an: nur Namen aus DRUM_NAMES', () => {
  for (const id of ['funk', 'rock', 'dreamy', 'reggae']) for (const seed of SEEDS) {
    const track = mk(id, { seed });
    assert.deepEqual(drumsOf(track, {}), drumsOf(track, { drums: 0 }));
    assert.ok(drumsOf(track).every((e) => DRUM_NAMES.includes(e.name)));
  }
});

test('Schlagzeug: Hi-Hat-Akzente 1 / 0,6 / 0,8 / 0,6 (Achtel 1 / 0,7), Geisternoten 0,15 bis 0,3, Side-Stick in Ballade und Reggae', () => {
  for (const seed of SEEDS) {
    const funk = drumsOf(mk('funk', { seed }));
    for (let bar = 0; bar < 8; bar++) {
      const hats = funk.filter((e) => e.bar === bar && e.name === 'hat'), top = Math.max(...hats.map((e) => e.vel)), sixteenths = hats.some((e) => stepOf(e) % 2);
      for (const e of hats) {
        const want = stepOf(e) % 4 === 0 ? 1 : stepOf(e) % 2 ? 0.6 : sixteenths ? 0.8 : 0.7;
        assert.ok(Math.abs(e.vel / top - want) < 0.12, `${seed}: ${JSON.stringify(e)} gegen ${top}`);
      }
    }
    const ghosts = drumsOf(mk('funk', { seed }), { drums: 0 }).filter((e) => e.name === 'snare' && e.vel < 0.3).length;
    assert.equal(funk.filter((e) => e.name === 'snare' && e.vel >= 0.15 && e.vel < 0.3).length, ghosts);
    for (const id of ['dreamy', 'reggae']) {
      const kit = drumsOf(mk(id, { seed })), fillBar = 7; // ohne Songform: Fill im letzten Takt des Abschnitts
      assert.ok(kit.some((e) => e.name === 'sideStick'), id);
      assert.ok(kit.filter((e) => e.name === 'snare' && e.vel >= 0.3).every((e) => e.bar === fillBar && e.beat >= 2), `${id}: Snare nur im Fill`);
    }
  }
});

test('Schlagzeug mit Songform: Rock-Refrain geschlossene Hi-Hat und Rimshot, sonst Ride mit getretener Hi-Hat auf 2 und 4; Crash mit Choke vor dem Stopp; offene Hi-Hat wird geschlossen', () => {
  const parts = form([['verse', 4], ['chorus', 4], ['break', 2], ['chorus', 4]]);
  for (const seed of SEEDS) {
    const kit = { voices: { drums: { id: 'sample', variant: 'standard' } } };
    const rock = drumsOf(mk('rock', { seed, ...parts, ...kit }));
    assert.ok(!drumsOf(mk('rock', { seed, ...parts, voices: { drums: 'synth' } })).some((e) => e.art === 'choke'), 'das Synth-Kit kann nicht abwürgen: kein Crash vor dem Stopp');
    assert.ok(drumsOf(mk('rock', { seed, ...parts })).some((e) => e.art === 'choke'), 'ohne Stimmenwahl spielt das Sample-Kit (Standard)');
    assert.ok(rock.filter((e) => e.bar < 4).every((e) => !['hatHalf', 'rimshot', 'ride'].includes(e.name)), 'Strophe unverändert');
    assert.ok(rock.some((e) => e.bar >= 4 && e.bar < 8 && e.name === 'hat') && !rock.some((e) => ['hatHalf', 'ride'].includes(e.name)), 'Refrain: die Hi-Hat bleibt geschlossen');
    assert.ok(rock.some((e) => e.name === 'rimshot'));
    const choke = rock.filter((e) => e.art === 'choke');
    assert.deepEqual(choke.map((e) => [e.name, e.bar]), [['crash', 7]], 'ein Crash im Takt vor dem Stopp');
    assert.ok(choke[0].artTime >= 0.05 && choke[0].artTime <= 0.15 && choke[0].t === Math.max(...rock.filter((e) => e.bar === 7).map((e) => e.t)));
    const funk = drumsOf(mk('funk', { seed, ...parts }));
    for (const bar of [4, 5, 6, 10, 11, 12, 13]) {
      const pedals = funk.filter((e) => e.bar === bar && e.name === 'hatPedal' && e.vel === 0.35).map((e) => e.beat);
      if (funk.some((e) => e.bar === bar && e.name === 'ride')) assert.deepEqual(pedals, [1, 3], `Takt ${bar}`);
    }
    assert.ok(funk.some((e) => e.name === 'ride'));
    const open = funk.filter((e) => e.name === 'openHat' && e.bar !== 7);
    for (const e of open) {
      const beat = (Math.floor(e.beat) + 1) % 4, bar = e.bar + (beat === 0 ? 1 : 0);
      if (funk.some((x) => x.bar === bar)) assert.ok(funk.some((x) => x.bar === bar && x.beat === beat && (x.name === 'hat' || x.name === 'hatPedal')), JSON.stringify(e));
    }
  }
});

// ---- Tasten ----
const EPIANO = { voices: { chords: { id: 'sample', variant: 'epiano' } } };
const keysOf = (track, ornaments = { keys: 1 }) => buildEvents(track, { timing: GRID, ornaments }).filter((e) => e.layer === 'chords');

test('Tasten: abschaltbar, nur am E-Piano; Oberstimme lauter, Mittelstimme leiser; kein Ton unter C3', () => {
  for (const id of ['funk', 'rock', 'dreamy']) for (const seed of SEEDS) {
    const track = mk(id, { seed, ...EPIANO }), off = keysOf(track, {}), on = keysOf(track);
    assert.deepEqual(off, keysOf(track, { keys: 0 }));
    assert.deepEqual(keysOf(mk(id, { seed })), keysOf(mk(id, { seed }), {}), 'Gitarre: die Tasten-Regeln greifen nicht');
    assert.equal(on.length, off.length);
    on.forEach((e, i) => {
      assert.ok(e.midi >= 48);
      const want = !e.strum ? 1 : e.strum[0] === 2 ? 1.1 : e.strum[0] === 1 ? 0.9 : 1;
      assert.ok(Math.abs(e.vel - Math.min(1, want * off[i].vel)) < 0.002, JSON.stringify([e, off[i]]));
    });
  }
});

test('Tasten: Ballade hält mit Pedal bis zum Taktende und löst 20 bis 50 ms vor einem Akkordwechsel; Funk spielt Stabs von einem 16tel bis einem Achtel', () => {
  for (const seed of SEEDS) {
    const ballad = mk('dreamy', { seed, ...EPIANO }), bar = 4 * 60 / ballad.bpm;
    for (const e of keysOf(ballad)) {
      const gap = (e.bar + 1) * bar - (e.t + e.dur), changes = e.bar % 4 !== 0 && e.bar < 7; // Folge Am Am Dm E; nach dem letzten Takt kommt kein Wechsel
      assert.equal(e.art, 'pedal');
      assert.ok(changes ? gap >= 0.02 - 1e-4 && gap <= 0.05 + 1e-4 : Math.abs(gap) < 1e-4, JSON.stringify([e, gap]));
    }
    const funk = mk('funk', { seed, ...EPIANO }), sixteenth = 15 / funk.bpm;
    assert.ok(keysOf(funk).every((e) => e.art === 'staccato' && e.dur <= 2 * sixteenth + 1e-6));
    assert.ok(keysOf(funk).some((e) => e.dur >= sixteenth - 1e-6));
  }
});

// ---- Pad ----
const padOf = (track, ornaments = { pad: 1 }) => buildEvents(track, { timing: GRID, ornaments }).filter((e) => e.layer === 'pad');

test('Pad: abschaltbar; Stimmführung hält gemeinsame Töne, bewegt die Stimmen insgesamt nicht weiter als die feste Lage, gleiche Akkordtöne, 48..84', () => {
  const pcs = (list) => [...new Set(list.map((e) => e.midi % 12))].sort().join();
  for (const id of ['funk', 'rock', 'dreamy', 'psych', 'blues']) for (const seed of SEEDS) {
    const track = mk(id, { seed, length: 16 }), off = padOf(track, {}), on = padOf(track);
    assert.deepEqual(off, padOf(track, { pad: 0 }));
    assert.equal(on.length, off.length);
    assert.ok(on.every((e) => e.midi >= 48 && e.midi <= 84));
    const low = (list, bar) => list.filter((e) => e.bar === bar).map((e) => e.midi).sort((x, y) => x - y).slice(0, 3);
    const moved = (list, bar) => { const a = low(list, bar - 1), b = low(list, bar); return a.length && b.length ? a.reduce((sum, m, k) => sum + Math.abs(b[k] - m), 0) : 0; };
    let sumOn = 0, sumOff = 0;
    for (let bar = 0; bar < 16; bar++) {
      assert.equal(pcs(on.filter((e) => e.bar === bar)), pcs(off.filter((e) => e.bar === bar)), `${id} s=${seed} Takt ${bar}`);
      if (!bar) continue;
      sumOn += moved(on, bar); sumOff += moved(off, bar);
      const before = low(on, bar - 1), now = on.filter((e) => e.bar === bar).map((e) => e.midi);
      for (const m of before) if (now.some((x) => x % 12 === m % 12)) assert.ok(now.includes(m), `${id} s=${seed} Takt ${bar}: gemeinsamer Ton ${m} bleibt`);
    }
    assert.ok(sumOn <= sumOff, `${id} s=${seed}: ${sumOn} gegen ${sumOff}`);
  }
});

test('Pad: swell zu Beginn eines Teils (0,3 bis 1,5 s, höchstens die halbe Notenlänge), in der Ballade bei jedem Akkordwechsel', () => {
  for (const seed of SEEDS) {
    const rock = padOf(mk('rock', { seed, length: 16 }));
    assert.deepEqual([...new Set(rock.filter((e) => e.art === 'swell').map((e) => e.bar))], [0, 8]); // ohne Songform: Abschnitte zu 8 Takten
    assert.ok(rock.filter((e) => e.art === 'swell').every((e) => e.artTime >= 0.3 && e.artTime <= Math.min(1.5, e.dur / 2) + 1e-6));
    const ballad = padOf(mk('dreamy', { seed }));
    assert.deepEqual([...new Set(ballad.filter((e) => e.art === 'swell').map((e) => e.bar))], [0, 2, 3, 4, 6, 7]); // Folge Am Am Dm E
  }
});

// ---- Lead ----
const onGrid = (x, step) => Math.abs(x / step - Math.round(x / step)) < 1e-3; // ganze Rasterschritte
test('Lead: abschaltbar; fall nur am Saxofon und am Phrasenende, vibrato nur auf Noten ab einem Schlag, scoop höchstens ein Halbton von unten; Gitarre: bend auf langen Noten aus der Skala, slideIn statt scoop, hammer/pull gebunden', () => {
  const count = {};
  for (const variant of ['sax', 'flute', 'guitar']) for (const seed of SEEDS) {
    const track = mk('rock', { seed, ornaments: 1, layers: { drums: true, bass: true, chords: true, pad: true, lead: true }, jobs: { lead: seed % 2 ? 'melody' : 'callResponse' }, voices: { lead: { id: 'sample', variant } } }); // die Melodie hat fast nur lange Noten (vibrato), Ruf und Antwort kurze (scoop)
    const of = (ornaments) => buildEvents(track, { timing: GRID, ornaments }).filter((e) => e.layer === 'lead');
    const off = of({}), on = of({ lead: 1 }), beat = 60 / track.bpm;
    assert.deepEqual(off, of({ lead: 0 }));
    assert.ok(off.every((e) => !e.art) && on.length === off.length);
    on.forEach((n, i) => {
      if (n.art) count[n.art] = (count[n.art] ?? 0) + 1;
      if (n.art === 'fall') assert.ok(variant === 'sax' && (!on[i + 1] || on[i + 1].t - (n.t + n.dur) >= beat - 1e-6) && n.artSemi <= -2 && n.artSemi >= -5 && n.artTime >= 0.15 && n.artTime <= 0.3, JSON.stringify(n));
      const step = beat / 4; // Rock: 16tel-Raster
      // Einsatz des Vibratos: 25 bis 40 % der Note auf ganze Rasterschritte, mindestens einer, höchstens ein Schlag
      if (n.art === 'vibrato') assert.ok(n.dur >= beat && n.artSemi >= 0.1 && n.artSemi <= 0.2 && onGrid(n.artTime, step) && n.artTime >= step - 1e-6 && n.artTime <= beat + 1e-6 && n.artTime <= 0.4 * n.dur + step / 2 && n.artRate === 5.5, JSON.stringify(n)); // Rock 120: 5,5 Hz
      if (n.art === 'scoop') assert.ok(variant !== 'guitar' && n.artSemi <= -0.5 && n.artSemi >= -1 && n.artTime >= 0.05 && n.artTime <= 0.1, JSON.stringify(n));
      if (['bend', 'slideIn', 'hammer', 'pull'].includes(n.art)) assert.equal(variant, 'guitar', n.art);
      // Zugzeit des Bends: 15 bis 30 % der Note auf ganze Rasterschritte; ein Ton ab drei Schlägen wird mindestens zwei Schritte lang gezogen
      if (n.art === 'bend') assert.ok(onGrid(n.artTime, step) && n.artTime >= step - 1e-6 && n.artTime <= Math.min(0.6, beat) + 1e-6 && n.artTime <= 0.3 * n.dur + step / 2 && (n.dur < 3 * beat || n.artTime >= 2 * step - 1e-6), JSON.stringify(n));
      if (n.art === 'bend') assert.ok(n.dur >= beat && [-1, -2].includes(n.artSemi) && (n.artSemi === -1 || [9, 11, 0, 2, 4, 5, 7].includes((n.midi - 2) % 12)), JSON.stringify(n)); // A-Moll
      if (n.art === 'slideIn') assert.ok([-1, -2].includes(n.artSemi) && n.artTime >= 0.05 && n.artTime <= 0.1, JSON.stringify(n));
      if (n.art === 'hammer' || n.art === 'pull') {
        const step = n.midi - on[i - 1].midi;
        assert.ok(on[i - 1].bar === n.bar && Math.abs(step) >= 1 && Math.abs(step) <= 3 && (step > 0) === (n.art === 'hammer') && Math.abs(on[i - 1].t + on[i - 1].dur - n.t) < 1e-5, JSON.stringify([on[i - 1], n]));
      }
    });
  }
  assert.ok(count.fall > 0 && count.vibrato > 0 && count.scoop > 0 && count.bend > 0 && count.slideIn > 0 && (count.hammer ?? 0) + (count.pull ?? 0) > 0, JSON.stringify(count));
  const slow = buildEvents(mk('dreamy', { bpm: 70, ornaments: 1, layers: { drums: true, bass: true, chords: true, pad: true, lead: true }, jobs: { lead: 'melody' } }), { ornaments: { lead: 1 } }).filter((e) => e.art === 'vibrato');
  assert.ok(slow.length > 0 && slow.every((e) => e.artRate === 4.25), 'bei 70 bpm 4,25 Hz');
});

// ---- Band-Regeln ----
test('Band-Regeln (abschaltbar): Bass rutscht immer in die Eins des Refrains, im Fill-Takt kein Annäherungston, unter dem Fill schweigt die Gitarre und der Stab davor klingt aus; Tasten kurz vor dem Stopp', () => {
  const parts = form([['verse', 4], ['chorus', 4], ['break', 2], ['chorus', 4]]);
  for (const id of ['rock', 'blues', 'funk']) for (const seed of SEEDS) {
    const track = mk(id, { seed, ornaments: 1, ...parts });
    const of = (ornaments) => buildEvents(track, { timing: GRID, ornaments });
    assert.deepEqual(of({}), of({ band: 0 }));
    const on = of({ band: 1 }), bass = on.filter((e) => e.layer === 'bass'), guitar = on.filter((e) => e.layer === 'chords');
    assert.equal(bass.find((e) => e.bar === 4 && e.beat === 0)?.art, 'slideIn', `${id} s=${seed}: Slide in den Refrain`);
    assert.ok(!bass.some((e) => e.bar === 3 && e.art === 'approach'), 'Takt 3 hat den Fill');
    const under = guitar.filter((e) => e.bar === 3 && e.beat >= 2), before = guitar.filter((e) => e.bar === 3 && e.beat < 2);
    if (before.length) assert.equal(under.length, 0, `${id} s=${seed}: unter dem Fill schweigt die Gitarre`);
    const held = guitar.filter((e) => e.bar === 3 && e.strum).at(-1);
    if (held) assert.ok(held.art === 'letRing' && held.ring === true, JSON.stringify(held));
    const keys = buildEvents({ ...track, ...EPIANO }, { timing: GRID, ornaments: { keys: 1 } }).filter((e) => e.layer === 'chords' && e.bar === 7);
    if (keys.length) assert.ok(keys.filter((e) => e.t === keys.at(-1).t).every((e) => e.art === 'staccato' && e.dur <= 15 / track.bpm + 1e-6));
  }
});

// ---- Bass, Priorität B ----
test('Bass B (abschaltbar): Oktav-Pop nur auf "+" und a und bis MIDI 52, hammer/pull nur 1 bis 2 Halbtöne nach der Note davor im selben Takt, slideOff auf der letzten Note und vor dem Stopp, Palm Mute nur in der Strophe', () => {
  const count = {}, parts = form([['verse', 4], ['chorus', 4], ['break', 2], ['chorus', 4]]);
  for (const id of ['funk', 'rock', 'blues']) for (const seed of SEEDS) for (const extra of [{}, parts]) {
    const track = mk(id, { seed, ornaments: 1, ...extra });
    const of = (ornaments) => buildEvents(track, { timing: GRID, ornaments }).filter((e) => e.layer === 'bass');
    const off = of({}), on = of({ bassB: 1 });
    assert.deepEqual(off, of({ bassB: 0 }));
    assert.equal(on.length, off.length);
    on.forEach((n, i) => {
      assert.ok(n.midi >= 28 && n.midi <= 52, JSON.stringify(n));
      if (['octavePop', 'hammer', 'pull', 'slideOff', 'palmMute'].includes(n.art)) count[n.art] = (count[n.art] ?? 0) + 1;
      if (n.art === 'octavePop') assert.ok(stepOf(n) % 4 >= 2 && n.midi === off[i].midi + 12, JSON.stringify(n));
      if (n.art === 'hammer' || n.art === 'pull') {
        const step = n.midi - on[i - 1].midi;
        assert.ok(on[i - 1].bar === n.bar && Math.abs(step) <= 2 && step !== 0 && (step > 0) === (n.art === 'hammer') && on[i - 1].t + on[i - 1].dur >= n.t - 1e-6, JSON.stringify([on[i - 1], n]));
      }
      if (n.art === 'slideOff') assert.ok(n.t + n.dur <= (n.bar + 1) * 4 * 60 / track.bpm + 1e-6 && (!on[i + 1] || on[i + 1].bar !== n.bar) && n.artSemi <= -3 && n.artSemi >= -7 && n.artTime >= 0.1 && n.artTime <= 0.25 && n.dur >= n.artTime, JSON.stringify(n));
      if (n.art === 'palmMute') assert.ok(extra.form ? n.bar < 4 : true, JSON.stringify(n));
    });
  }
  for (const art of ['octavePop', 'hammer', 'slideOff', 'palmMute']) assert.ok(count[art] > 0, JSON.stringify(count));
});

// ---- Gitarre, Priorität B ----
test('Gitarre B (abschaltbar): slideChord nur auf Zählzeiten um einen Bund, embellish löst nach einem Achtel in die Terz auf', () => {
  const count = { slideChord: 0, embellish: 0 };
  for (const seed of SEEDS) {
    const country = mk('country', { seed });
    assert.deepEqual(chordsOf(country, {}), chordsOf(country, { chordsB: 0 }));
    for (const id of ['funk', 'rock', 'dreamy']) {
      const track = mk(id, { seed, ornaments: 1, bpm: 70 }), plain = chordsOf(track, {}), b = chordsOf(track, { chordsB: 1 });
      for (const e of b.filter((x) => x.art === 'slideChord')) { count.slideChord++; assert.ok(stepOf(e) % 4 === 0 && Math.abs(e.artSemi) === 1 && e.artTime >= 0.04 && e.artTime <= 0.08, JSON.stringify(e)); }
      for (const e of b.filter((x) => x.art === 'hammer')) {
        count.embellish++;
        const sus = b.find((x) => x.bar === e.bar && Math.abs(x.t + x.dur - e.t) < 1e-5 && Math.abs(x.midi - e.midi) <= 2 && x.midi !== e.midi);
        assert.ok(sus && plain.some((x) => x.bar === e.bar && x.midi === e.midi), JSON.stringify(e));
      }
    }
  }
  assert.ok(count.slideChord > 0 && count.embellish > 0, JSON.stringify(count));
});

// ---- Tasten und Schlagzeug, Priorität B ----
test('Tasten B und Schlagzeug B (abschaltbar): Roll bricht den Akkord in höchstens 40 ms, Crush setzt die kleine Terz vor die große, Bark betont Zählzeiten; Flam liegt 15 bis 30 ms vor einem Schlag gleichen Namens', () => {
  const count = { roll: 0, crush: 0, bark: 0, flam: 0 };
  for (const seed of SEEDS) {
    for (const [id, tags] of [['dreamy', {}], ['blues', {}], ['funk', {}]]) {
      const track = mk(id, { seed, ornaments: 1, ...EPIANO, ...tags }), off = keysOf(track, {}), on = keysOf(track, { keysB: 1 });
      assert.deepEqual(off, keysOf(track, { keysB: 0 }));
      const starts = new Map();
      for (const e of on) if (e.strum && e.art !== 'crush') { const k = `${e.bar}:${stepOf(e)}`; starts.set(k, [...(starts.get(k) ?? []), e.t]); }
      for (const ts of starts.values()) { const spread = Math.max(...ts) - Math.min(...ts); assert.ok(spread <= 0.06 + 1e-6, `${id}: ${spread}`); if (id === 'dreamy' && spread > 0.01) count.roll++; }
      for (const e of on.filter((x) => x.art === 'crush')) {
        count.crush++;
        assert.ok(e.dur >= 0.03 && e.dur <= 0.06 && on.some((x) => x.midi === e.midi + 1 && Math.abs(x.t - e.t - e.dur) < 1e-5), JSON.stringify(e));
      }
      for (const e of on.filter((x) => x.art === 'bark')) { count.bark++; assert.equal(stepOf(e) % 4, 0); }
    }
    const track = mk('rock', { seed, ornaments: 1, length: 16 }), drums = drumsOf(track, { drumsB: 1 });
    assert.deepEqual(drumsOf(track, {}), drumsOf(track, { drumsB: 0 }));
    for (const e of drums.filter((x) => x.art === 'flam')) {
      count.flam++;
      assert.ok(drums.some((x) => x.name === e.name && !x.art && x.t - e.t >= 0.015 - 1e-6 && x.t - e.t <= 0.03 + 1e-6 && e.vel < x.vel), JSON.stringify(e));
    }
  }
  for (const k of Object.keys(count)) assert.ok(count[k] > 0, JSON.stringify(count));
});

test('alle Regelgruppen zusammen: sortiert, im Takt, Dauer über 0, Bass einstimmig und in 28..52, Schlagnamen bekannt (Stile, Seeds, mit und ohne Songform, Gitarre und E-Piano)', () => {
  const ALL = Object.fromEntries(Object.keys(ART_DEFAULTS).map((k) => [k, 1]));
  const parts = form([['intro', 2], ['verse', 4], ['build', 4], ['chorus', 4], ['break', 2], ['chorus', 4], ['outro', 2]]);
  for (const id of STYLE_PRESETS.map((s) => s.id)) for (const seed of [1, 2, 3]) for (const extra of [{}, parts, EPIANO, { meter: [12, 8] }, { meter: [3, 4] }]) {
    const track = mk(id, { seed, ornaments: 1, length: 16, layers: { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true }, jobs: { lead: 'melody', percussion: 'mixed' }, ...extra });
    if (extra.meter) track.bars = track.bars.map((b) => ({ ...b, beats: extra.meter[0] === 12 ? 4 : 3 }));
    const events = buildEvents(track, { ornaments: ALL }), bars = barTimeline(checkedTrack(track)), label = `${id} s=${seed} ${JSON.stringify(extra).slice(0, 40)}`;
    assert.deepEqual(events, buildEvents(track, { ornaments: ALL }), `${label}: reproduzierbar`);
    for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t, `${label}: sortiert`);
    for (const e of events.filter((x) => x.layer)) {
      assert.ok(e.t >= bars[e.bar].start - 1e-6 && e.t < bars[e.bar].end, `${label}: im Takt ${JSON.stringify(e)}`);
      assert.ok(e.vel >= 0.05 && e.vel <= 1, `${label}: vel ${JSON.stringify(e)}`);
      if (e.type === 'note') assert.ok(e.dur > 0 && Number.isInteger(e.midi), `${label}: Note ${JSON.stringify(e)}`);
      if (e.type === 'hit' && e.layer === 'drums') assert.ok(DRUM_NAMES.includes(e.name), e.name);
    }
    const bass = events.filter((e) => e.layer === 'bass');
    for (let i = 0; i < bass.length; i++) {
      assert.ok(bass[i].midi >= 28 && bass[i].midi <= 52, `${label}: ${JSON.stringify(bass[i])}`);
      if (i) assert.ok(bass[i - 1].t + bass[i - 1].dur <= bass[i].t + 1e-6, `${label}: Bass einstimmig bei ${i}`);
    }
  }
});
