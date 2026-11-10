// Analysewerkzeug (reine Rechnung): Kurzzeit-Fourier, Verlauf der Obertöne, Anschlagszeit, Tonhöhe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stft, harmonicTracks, attackTime, pitchCents } from '../../src/audio/analysis.js';

const SR = 44100;
const make = (seconds, fn) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => fn(i / SR));
const sine = (f, seconds, amp = 1) => make(seconds, (t) => amp * Math.sin(2 * Math.PI * f * t));

test('stft: Sinus bei 440 Hz hat in jedem Fenster sein Maximum bei 440 Hz, 0 dB am größten Wert, Zeiten wachsen', () => {
  const r = stft(sine(440, 1), SR, { size: 2048, hop: 512 });
  assert.ok(r.times.length > 50 && r.db.length === r.times.length);
  assert.equal(r.freqs.length, 1025);
  assert.ok(Math.abs(r.freqs[1] - SR / 2048) < 1e-9);
  for (let i = 1; i < r.times.length; i++) assert.ok(r.times[i] > r.times[i - 1]);
  let top = -Infinity;
  for (const frame of r.db) {
    let best = 0;
    for (let k = 1; k < frame.length; k++) if (frame[k] > frame[best]) best = k;
    assert.ok(Math.abs(r.freqs[best] - 440) <= SR / 2048, `Maximum bei ${r.freqs[best]} Hz`);
    top = Math.max(top, frame[best]);
    assert.ok(frame.every((v) => v >= -90 && v <= 0));
  }
  assert.ok(Math.abs(top) < 1e-6, `größter Wert ${top} dB`);
});

test('harmonicTracks: Obertöne eines abklingenden Signals fallen mit ihrer Zeitkonstante (3. Oberton schneller)', () => {
  const x = make(1.5, (t) => Math.exp(-t / 0.3) * Math.sin(2 * Math.PI * 100 * t) + Math.exp(-t / 0.1) * Math.sin(2 * Math.PI * 300 * t));
  const tracks = harmonicTracks(x, SR, 100, 4, { hop: 512 });
  assert.equal(tracks.length, 4);
  assert.deepEqual(tracks.map((t) => t.harmonic), [1, 2, 3, 4]);
  const at = (track, sec) => track.db[track.times.findIndex((t) => t >= sec)];
  const drop = (track) => at(track, 0.5) - at(track, 0.15); // Soll: -8,686 * 0,35 / tau dB
  assert.ok(Math.abs(drop(tracks[0]) - -10.1) < 3, `1. Oberton ${drop(tracks[0])}`);
  assert.ok(Math.abs(drop(tracks[2]) - -30.4) < 5, `3. Oberton ${drop(tracks[2])}`);
  assert.ok(drop(tracks[2]) < drop(tracks[0]) - 10);
  assert.ok(tracks.every((t) => t.db.every(Number.isFinite) && t.times.length === t.db.length));
});

test('attackTime: lineare Rampe über 20 ms ergibt 16 ms (10 % bis 90 %)', () => {
  const ramp = make(0.2, (t) => Math.min(1, t / 0.02));
  assert.ok(Math.abs(attackTime(ramp, SR) - 0.016) < 0.002, String(attackTime(ramp, SR)));
  assert.equal(attackTime(new Float32Array(1000), SR), 0);
});

test('pitchCents: Sinus bei A4 ergibt 0 Cent, ein Prozent höher etwa 17 Cent', () => {
  assert.ok(Math.abs(pitchCents(sine(440, 0.5), SR, 69)) < 1);
  assert.ok(Math.abs(pitchCents(sine(444.4, 0.5), SR, 69) - 17.2) < 2);
});

test('Stille und sehr kurze Eingaben: alles endlich, nichts wirft', () => {
  for (const x of [new Float32Array(0), new Float32Array(10), new Float32Array(SR)]) {
    const r = stft(x, SR, {});
    assert.ok(r.db.every((f) => f.every(Number.isFinite)));
    assert.ok(harmonicTracks(x, SR, 100, 3, {}).every((t) => t.db.every(Number.isFinite)));
    assert.ok(Number.isFinite(attackTime(x, SR)));
    assert.ok(Number.isFinite(pitchCents(x, SR, 57)));
  }
});
