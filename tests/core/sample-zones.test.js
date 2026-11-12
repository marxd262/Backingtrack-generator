// Zonenwahl und Umrechnungen des Samplers (rein): Ränder, Lücken, Überlappungen, Tonhöhe, Pegel, Helligkeit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickZone, playbackRate, dbToGain, zoneGain, brightnessHz, velocityGain, velocityBrightnessHz } from '../../src/audio/voices/sample-zones.js';

const zone = (keyLo, keyHi, velLo = 0, velHi = 127, extra = {}) => ({ keyLo, keyHi, velLo, velHi, rootKey: 60, tuneCents: 0, ...extra });

test('pickZone: Taste und Anschlag genau auf den Grenzen gehören zur Zone', () => {
  const zones = [zone(40, 50, 0, 63, { id: 'lo' }), zone(40, 50, 64, 127, { id: 'hi' })];
  assert.equal(pickZone(zones, 40, 0).id, 'lo');
  assert.equal(pickZone(zones, 50, 63 / 127).id, 'lo');
  assert.equal(pickZone(zones, 50, 64 / 127).id, 'hi');
  assert.equal(pickZone(zones, 45, 1).id, 'hi');
});

test('pickZone: Anschlag 0..1 wird auf 0..127 gerundet und begrenzt', () => {
  const zones = [zone(0, 127, 0, 63, { id: 'lo' }), zone(0, 127, 64, 127, { id: 'hi' })];
  assert.equal(pickZone(zones, 60, -5).id, 'lo');
  assert.equal(pickZone(zones, 60, 99).id, 'hi');
  assert.equal(pickZone(zones, 60, NaN).id, 'hi', 'ungültiger Anschlag zählt als kräftig');
});

test('pickZone: bei mehreren passenden die mit dem engsten Tastenbereich, bei Gleichstand die erste', () => {
  const zones = [zone(0, 127, 0, 127, { id: 'weit' }), zone(55, 65, 0, 127, { id: 'eng' }), zone(55, 65, 0, 127, { id: 'eng2' })];
  assert.equal(pickZone(zones, 60, 0.5).id, 'eng');
  assert.equal(pickZone(zones, 10, 0.5).id, 'weit');
});

test('pickZone: Lücke im Register ergibt die Zone mit der nächsten Taste; leer ergibt null', () => {
  const zones = [zone(20, 30, 0, 127, { id: 'tief' }), zone(60, 70, 0, 127, { id: 'hoch' })];
  assert.equal(pickZone(zones, 40, 0.5).id, 'tief');
  assert.equal(pickZone(zones, 50, 0.5).id, 'hoch');
  assert.equal(pickZone(zones, 5, 0.5).id, 'tief');
  assert.equal(pickZone(zones, 120, 0.5).id, 'hoch');
  assert.equal(pickZone([], 60, 0.5), null);
  assert.equal(pickZone(undefined, 60, 0.5), null);
});

test('pickZone: passt keine Zone zum Anschlag, gilt die Zone mit dem nächsten Anschlagbereich', () => {
  const zones = [zone(0, 127, 0, 40, { id: 'leise' })];
  assert.equal(pickZone(zones, 60, 1).id, 'leise');
});

test('playbackRate: 1 beim Grundton, Verdopplung je Oktave, Feinstimmung wirkt', () => {
  assert.equal(playbackRate(zone(0, 127), 60), 1);
  assert.equal(playbackRate(zone(0, 127), 72), 2);
  assert.equal(playbackRate(zone(0, 127), 48), 0.5);
  assert.ok(Math.abs(playbackRate(zone(0, 127, 0, 127, { tuneCents: 1200 }), 60) - 2) < 1e-12);
  assert.ok(Math.abs(playbackRate(zone(0, 127, 0, 127, { rootKey: 57 }), 60) - 2 ** (3 / 12)) < 1e-12);
});

test('dbToGain: 0 dB ist 1, 6 dB Dämpfung etwa halb, negative Dämpfung verstärkt', () => {
  assert.equal(dbToGain(0), 1);
  assert.ok(Math.abs(dbToGain(6) - 0.501) < 1e-3);
  assert.ok(dbToGain(-6) > 1);
  assert.ok(Number.isFinite(dbToGain(1000)) && dbToGain(1000) >= 0);
});

test('brightnessHz: ab 0,5 durchsichtig (20 kHz), darunter streng fallend bis 400 Hz bei 0', () => {
  assert.equal(brightnessHz(0.5), 20000);
  assert.equal(brightnessHz(1), 20000);
  assert.ok(Math.abs(brightnessHz(0) - 400) < 1e-9);
  let last = Infinity;
  for (const v of [0.5, 0.4, 0.3, 0.2, 0.1, 0]) { const f = brightnessHz(v); assert.ok(f < last || v === 0.5, String(v)); last = f; }
  for (const bad of [NaN, undefined, -3, 9]) assert.ok(Number.isFinite(brightnessHz(bad)) && brightnessHz(bad) >= 400 && brightnessHz(bad) <= 20000);
});

test('velocityGain: Exponent 1 gleich Anschlag, 2 gleich Quadrat, monoton, Grenzen', () => {
  for (const v of [1 / 127, 0.05, 0.3, 0.6, 0.95, 1]) {
    assert.ok(Math.abs(velocityGain(v, 1) - v) < 1e-12, String(v));
    assert.ok(Math.abs(velocityGain(v, 2) - v * v) < 1e-12, String(v));
  }
  let last = 0;
  for (let v = 0.01; v <= 1; v += 0.01) { const g = velocityGain(v, 1.6); assert.ok(g > last, String(v)); last = g; }
  assert.equal(velocityGain(0, 1), 1 / 127, '0 zählt wie der leiseste Anschlag');
  assert.equal(velocityGain(-1, 2), (1 / 127) ** 2);
  assert.equal(velocityGain(5, 1.6), 1);
  assert.equal(velocityGain(NaN, 1.6), 1, 'ungültig zählt wie kräftig');
});

test('velocityBrightnessHz: bei 1 und mit softHz >= 20000 aus (20000), monoton, stetig, bei 0,2 nahe softHz, bei 0,5 nahe der geometrischen Mitte', () => {
  assert.equal(velocityBrightnessHz(1, 3500), 20000);
  assert.equal(velocityBrightnessHz(NaN, 3500), 20000);
  for (const v of [0, 0.2, 0.5, 0.9]) { assert.equal(velocityBrightnessHz(v, 20000), 20000); assert.equal(velocityBrightnessHz(v, 30000), 20000); }
  for (const soft of [800, 3500, 10000]) {
    assert.ok(Math.abs(velocityBrightnessHz(0.2, soft) / soft - 1) < 0.05, `${soft} bei 0,2`);
    assert.ok(Math.abs(velocityBrightnessHz(0.5, soft) / Math.sqrt(soft * 20000) - 1) < 0.1, `${soft} bei 0,5`);
    let last = 0;
    for (let i = 0; i <= 1000; i++) {
      const f = velocityBrightnessHz(i / 1000, soft);
      assert.ok(f >= last, `${soft}: monoton bei ${i / 1000}`);
      assert.ok(i === 0 || f / last < 1.02, `${soft}: stetig bei ${i / 1000}`);
      assert.ok(f >= soft * 0.99 && f <= 20000);
      last = f;
    }
  }
});

test('zoneGain: negative Dämpfung zählt wie 0 dB (nie lauter als 1), positive dämpft wie dbToGain', () => {
  assert.equal(zoneGain(-6), 1);
  assert.equal(zoneGain(0), 1);
  assert.equal(zoneGain(6), dbToGain(6));
});
