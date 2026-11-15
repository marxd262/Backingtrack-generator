// SFZ-Import (scripts/import-sfz.mjs) ohne Audio: Lesen (#include, #define, Vererbung), Standardzustand (Controller, Keyswitches, Trigger),
// Anschlagkurve, Auswahl der Stufen und Round-Robins, Choke-Gruppen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expandSfz, parseSfz, defaultRegions, velAmp, binRanges, selectZones, chokeGroups, keyNumber } from '../../scripts/import-sfz.mjs';

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
  assert.deepEqual(regions.map((r) => r.sample), ['oh.wav', 'sw.wav', 'rel.wav']);
  const [oh] = regions;
  assert.equal(oh.lokey, 36); // c2 = 36
  assert.equal(oh.path, resolve('/lib/Samples/oh.wav'));
  assert.ok(Math.abs(oh.gain + 1) < 1e-9, 'Pegel 0,5 · 200 % = 1, umgepolt'); // set_hdcc20 0,5 mal 200 %
  assert.equal(oh.pan, -100); // cc21 = 1 linear mal -100, cc10 Mitte bipolar 0
  assert.equal(regions[2].trigger, 'release');
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

test('chokeGroups: Mikrofone mit eigenen Gruppennummern ergeben eine gemeinsame Gruppe je Schlag', () => {
  const hat = [{ group: '179' }, { group: '94' }], open = [{ group: '180', off_by: '179', off_time: '0.21' }, { group: '95', off_by: '94' }];
  assert.deepEqual(chokeGroups({ kick: [{}], hat, openHat: open }), { kick: {}, hat: { group: 2 }, openHat: { offBy: 2, offTime: 0.21 } });
});
