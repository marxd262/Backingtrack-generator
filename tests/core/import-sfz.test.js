// SFZ-Import (scripts/import-sfz.mjs) ohne Audio: Lesen (#include, #define, Vererbung), Standardzustand (Controller, Keyswitches, Trigger),
// Anschlagkurve, Auswahl der Stufen und Round-Robins, Choke-Gruppen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { expandSfz, parseSfz, defaultRegions, velAmp, binRanges, selectZones, chokeGroups, keyNumber, SFZ_PACKS } from '../../scripts/import-sfz.mjs';
import { VOICES } from '../../src/core/voices.js';
import { packIdFor } from '../../src/audio/voices/pack-id.js';

const files = (map) => (path) => {
  const hit = Object.entries(map).find(([name]) => resolve('/lib', name) === path);
  if (!hit) throw new Error(`fehlt: ${path}`);
  return hit[1];
};
const regionsOf = (map) => defaultRegions(parseSfz(expandSfz(resolve('/lib/Stereo/main.sfz'), files(map))), resolve('/lib/Stereo')).regions;

test('expandSfz: #include relativ zur Hauptdatei, mehrere #define je Zeile, Neudefinition gilt ab ihrer Stelle, längster Name gewinnt', () => {
  const text = expandSfz(resolve('/lib/Stereo/main.sfz'), files({
    'Stereo/main.sfz': '#define $MIC OH #define $MIC_X falsch\n#include "../Data/a.txt" // Kommentar\n<region> sample=$MIC_$ART.flac',
    'Data/a.txt': '#define $ART kick\n<region> sample=$ART.wav /* weg */\n#define $ART snare',
  }));
  assert.match(text, /sample=kick\.wav/);
  assert.match(text, /sample=OH_snare\.flac/); // $MIC_ ist nicht definiert: $MIC, dann "_"; danach gilt $ART = snare
  assert.doesNotMatch(text, /Kommentar|weg|falsch/);
});

test('parseSfz: Vererbung global > master > group > region, neue Kopfzeilen setzen die tieferen zurück, Lautstärken addieren sich', () => {
  const { regions } = parseSfz('<global> volume=-6 loop_mode=one_shot <master> master_volume=2 <group> key=36 group_volume=1 <region> sample=a b.wav volume=1 <group> lokey=40 <region> sample=c.wav');
  assert.equal(regions.length, 2);
  assert.deepEqual([regions[0].sample, regions[0].key, regions[0].volume, regions[0].loop_mode], ['a b.wav', '36', -2, 'one_shot']);
  assert.deepEqual([regions[1].key, regions[1].lokey, regions[1].volume], [undefined, '40', -4]);
});

test('defaultRegions: Controller auf set_hdcc, Bedingungen locc/hicc, Modulation mit Kurven, umgepolte Mikrofone, Keyswitch, Trigger', () => {
  const regions = regionsOf({
    'Stereo/main.sfz': '<control> set_hdcc20=0.5 set_hdcc21=1 set_cc22=0 default_path=../Samples/ '
      + '<global> locc20=1 amplitude_oncc20=200 pan_oncc21=-100 pan_oncc10=100 pan_curvecc10=1 '
      + '<region> key=c2 sample=oh.wav phase=invert <region> key=36 sample=bleed.wav locc22=1 <region> key=36 sample=*silence '
      + '<region> key=36 sample=aftertouch.wav on_locc130=127 <region> key=36 sample=sw.wav sw_last=24 sw_default=24 '
      + '<region> key=36 sample=sw2.wav sw_last=25 sw_default=24 <region> key=36 sample=rel.wav trigger=release',
  });
  assert.deepEqual(regions.map((r) => [r.sample, r.silent]), [['oh.wav', false], ['*silence', true], ['sw.wav', false], ['rel.wav', false]]); // stumm bleibt für Choke-Gruppen
  const [oh] = regions;
  assert.equal(oh.lokey, 36); // c2 = 36
  assert.equal(oh.path, resolve('/lib/Samples/oh.wav'));
  assert.ok(Math.abs(oh.gain + 1) < 1e-9, 'Pegel 0,5 · 200 % = 1, umgepolt'); // set_hdcc20 0,5 mal 200 %
  assert.equal(oh.pan, -100); // cc21 = 1 linear mal -100, cc10 Mitte bipolar 0
  assert.equal(regions.at(-1).trigger, 'release');
});

test('keyNumber: Zahlen und Notennamen (c4 = 60)', () => {
  assert.deepEqual(['60', 'c4', 'C#4', 'db4', 'a0', 'b-1'].map(keyNumber), [60, 60, 61, 61, 21, 11]);
  assert.throws(() => keyNumber('h4'));
});

test('velAmp: Kurvenpunkte linear (Karoryfer: Stufe 0-40 erreicht 1 bei 40), sonst Quadrat, amp_veltrack mischt mit 1', () => {
  assert.equal(velAmp({ amp_velcurve_40: '1' }, 20), 0.5);
  assert.equal(velAmp({ amp_velcurve_40: '1' }, 90), 1);
  assert.ok(Math.abs(velAmp({}, 63.5) - 0.25) < 1e-9);
  assert.equal(velAmp({ amp_veltrack: '0' }, 10), 1);
});

test('binRanges und selectZones: Stufen zusammenfassen, Round-Robins aus dem lautesten Bereich der Stufe, nötigenfalls aus dem nächstleiseren', () => {
  assert.deepEqual(binRanges([[1, 25], [26, 50], [51, 76], [77, 101], [102, 127]], 3).map((b) => b.length), [2, 1, 2]);
  const r = (lovel, hivel, rr, sample) => ({ lovel, hivel, rr, sample });
  const regions = [r(1, 25, 1, 'a'), r(26, 50, 1, 'b'), r(26, 50, 2, 'c'), r(51, 76, 1, 'd'), r(77, 127, 1, 'e'), r(77, 127, 2, 'f'), r(77, 127, 2, 'f-oh')];
  const zones = selectZones(regions, [2, 2]);
  assert.deepEqual(zones.map((z) => [z.velLo, z.velHi, z.regions.map((x) => x.sample).join('+')]), [[1, 50, 'b'], [1, 50, 'c'], [51, 127, 'e'], [51, 127, 'f+f-oh']]);
});

test('chokeGroups: Mikrofone mit eigenen Gruppennummern, ein Schlag würgt mehrere ab (auch über stumme Regionen)', () => {
  const hat = [{ group: '179' }, { group: '94' }], open = [{ group: '180', off_by: '179', off_time: '0.21' }, { group: '95', off_by: '94' }];
  assert.deepEqual(chokeGroups({ kick: [{}], hat, openHat: open }), { kick: {}, hat: { chokes: [3] }, openHat: { offBy: 3, offTime: 0.21 } });
  // Naked Drums: das Pedal löst stumme Regionen der Gruppen aus, auf die off_by der geschlossenen und der offenen Hi-Hat zeigt
  const pedal = [{ group: '1' }, { group: '201', silent: true }, { group: '203', silent: true }];
  const out = chokeGroups({ hat: [{ group: '13', off_by: '201' }], openHat: [{ group: '15', off_by: '203' }], hatPedal: pedal });
  assert.deepEqual([out.hat.offBy, out.openHat.offBy, out.hatPedal.chokes], [1, 2, [1, 2]]);
});

test('Packs im Format 2, die eine Stimme spielt: in src/assets/samples, unter 12 MB, Samples lückenlos, Zonen zeigen auf Samples, Lizenz liegt bei', () => {
  const dir = new URL('../../src/assets/samples/', import.meta.url);
  // angefangene Einträge ohne Stimme (Bässe, 2026-11-16 pausiert) liegen nicht im Repo
  const used = new Set(Object.entries(VOICES).flatMap(([layer, voices]) => (voices.sample?.variants ?? []).map((v) => packIdFor(layer, v))));
  assert.ok(used.has('drums-naked') && used.has('drums-muldjord'));
  for (const [id, spec] of Object.entries(SFZ_PACKS).filter(([id]) => used.has(id))) {
    const meta = JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8'));
    assert.deepEqual([meta.version, meta.id, meta.channels, meta.license], [2, id, spec.channels, spec.license], id);
    assert.match(meta.file, new RegExp(`^${id}\.[0-9a-f]{10}\.flac$`), id);
    assert.ok(statSync(new URL(meta.file, dir)).size < 12e6, `${id}: Größe`);
    meta.samples.forEach((s, i) => assert.equal(s.offset, i ? meta.samples[i - 1].offset + meta.samples[i - 1].frames : 0, `${id}: Sample ${i}`));
    for (const z of meta.zones) for (const k of [z.sample, z.room].filter((x) => x !== undefined)) assert.ok(Number.isInteger(k) && k < meta.samples.length, `${id}: Zone`);
    assert.ok(existsSync(new URL(`LICENSE-${id}.md`, dir)), `${id}: Lizenz`);
  }
});

test('binRanges mit Liste: neue Stufe an den genannten Anschlägen (Growlybass: f und ff zusammen)', () => {
  assert.deepEqual(binRanges([[0, 60], [61, 95], [96, 120], [121, 127]], [61, 96]), [[[0, 60]], [[61, 95]], [[96, 120], [121, 127]]]);
});
