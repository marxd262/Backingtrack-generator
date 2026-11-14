// Artikulations-Schicht (Phase 3, core/articulation.js): aus = unveränderter Strom; Stil-Profil aus Groove und Schlagworten; Regeln je Schicht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, STYLE_PRESETS, GROOVES, DRUM_NAMES } from '../../src/index.js';
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
const ON = { ornaments: { on: 1 } };

test('an ist der Standard (Bass und Gitarre); Feinwert on 0, Regler 0 und beide Schichten auf 0 ergeben denselben Strom ohne Artikulationen; ungültiger Regler wirft', () => {
  assert.deepEqual(ART_DEFAULTS, { on: 1, bass: 1, chords: 1, drums: 0, keys: 0, pad: 0 });
  assert.deepEqual(completeArt({ on: 1, bass: -1, chords: 'x', drums: 1 }), { ...ART_DEFAULTS, drums: 1 });
  for (const id of ['funk', 'rock', 'blues']) {
    const plain = buildEvents(mk(id), { ornaments: { on: 0 } });
    assert.deepEqual(buildEvents(mk(id)), buildEvents(mk(id), ON));
    assert.notDeepEqual(buildEvents(mk(id)), plain);
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

test('Schlagzeug ist aus, bis es eingeschaltet wird; an: nur Namen aus DRUM_NAMES', () => {
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

test('Schlagzeug mit Songform: Rock-Refrain halboffene Hi-Hat und Rimshot, sonst Ride mit getretener Hi-Hat auf 2 und 4; Crash mit Choke vor dem Stopp; offene Hi-Hat wird geschlossen', () => {
  const parts = form([['verse', 4], ['chorus', 4], ['break', 2], ['chorus', 4]]);
  for (const seed of SEEDS) {
    const rock = drumsOf(mk('rock', { seed, ...parts }));
    assert.ok(rock.filter((e) => e.bar < 4).every((e) => !['hatHalf', 'rimshot', 'ride'].includes(e.name)), 'Strophe unverändert');
    assert.ok(rock.some((e) => e.bar >= 4 && e.bar < 8 && e.name === 'hatHalf') && !rock.some((e) => e.bar >= 4 && e.bar < 8 && e.name === 'hat'));
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
