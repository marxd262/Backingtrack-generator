// Zonenwahl und Umrechnungen des Samplers (rein): Ränder, Lücken, Überlappungen, Tonhöhe, Pegel, Helligkeit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickZone, playbackRate, dbToGain, zoneGain, brightnessHz } from '../../src/audio/voices/sample-zones.js';

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

test('zoneGain: negative Dämpfung zählt wie 0 dB (nie lauter als 1), positive dämpft wie dbToGain', () => {
  assert.equal(zoneGain(-6), 1);
  assert.equal(zoneGain(0), 1);
  assert.equal(zoneGain(6), dbToGain(6));
});
