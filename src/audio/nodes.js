// Kleine Web-Audio-Bausteine, die Schlagzeug (synth.js) und Stimmen (voices/) gemeinsam benutzen. Unverändert aus synth.js.

export const hz = (m) => 440 * 2 ** ((m - 69) / 12);

export function noiseBuffer(ctx, rng, seconds, channels = 1, decay = 0) {
  const length = Math.ceil(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(channels, length, ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < length; i++) d[i] = (rng.next() * 2 - 1) * Math.exp((-decay * i) / ctx.sampleRate);
  }
  return buf;
}

export const adsr = (g, t, a, peak, hold, rel) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
};

export function osc(ctx, type, freq, detune, dest, t, end) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.connect(dest);
  o.start(t);
  o.stop(end);
  return o;
}

export function gain(ctx, value, dest) {
  const g = ctx.createGain();
  g.gain.value = value;
  g.connect(dest);
  return g;
}
