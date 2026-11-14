// Artikulations-Schicht (Phase 3, core/articulation.js): aus = unveränderter Strom; Stil-Profil aus Groove und Schlagworten; Regeln je Schicht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, STYLE_PRESETS, GROOVES } from '../../src/index.js';
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

test('aus ist der Standard: gleicher Strom wie ohne die Schicht; Regler 0 schaltet alles ab; ungültiger Regler wirft', () => {
  assert.equal(ART_DEFAULTS.on, 0);
  assert.deepEqual(completeArt({ on: 1, bass: -1, chords: 'x' }), { ...ART_DEFAULTS, on: 1 });
  for (const id of ['funk', 'rock', 'blues']) {
    assert.deepEqual(buildEvents(mk(id)), buildEvents(mk(id), { ornaments: { on: 0 } }));
    assert.deepEqual(buildEvents(mk(id, { ornaments: 0 }), ON), buildEvents(mk(id)));
    assert.deepEqual(buildEvents(mk(id), { ornaments: { on: 1, bass: 0, chords: 0 } }), buildEvents(mk(id)));
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
    const off = bassOf(mk('funk', { seed })), on = bassOf(mk('funk', { seed }), { on: 1, chords: 0 });
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

test('Bass slideIn: nur auf der Eins, der Zielton kommt pünktlich (Beginn + artTime = Taktanfang), 1 bis 7 Halbtöne von unten, 40 bis 100 ms', () => {
  let slides = 0;
  for (const id of ['funk', 'blues', 'rock']) for (const seed of SEEDS) {
    const track = mk(id, { seed, ornaments: 1 }), beat = 60 / track.bpm;
    for (const n of bassOf(track, { on: 1 }).filter((x) => x.art === 'slideIn')) {
      slides++;
      const target = n.t + n.artTime;
      if (n.t === 0) continue; // im allerersten Takt entfällt der Vorlauf
      assert.ok(Math.abs(target / (4 * beat) - Math.round(target / (4 * beat))) < 1e-4, `${id} s=${seed}: ${JSON.stringify(n)}`);
      assert.ok([-1, -2, -5, -6, -7].includes(n.artSemi) && n.artTime >= 0.04 && n.artTime <= 0.1);
      assert.equal(n.bar, Math.round(target / (4 * beat)) - 1, 'vorgezogen in den Takt davor');
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
