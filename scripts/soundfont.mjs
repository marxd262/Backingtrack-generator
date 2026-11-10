// Minimaler SoundFont-Leser (SF2 und SF3) für das Entwicklerskript extract-samples.mjs. Liest die Tabellen (Presets, Instrumente, Zonen,
// Sample-Köpfe) und gibt je Preset die Zonen mit allen Werten zurück, die der Sampler braucht. Nicht Teil der Laufzeit (läuft nur in Node).
import { readFileSync } from 'node:fs';

// Generator-Nummern aus der SF2-Spezifikation (2.04), nur die benutzten
const GEN = {
  startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3, pan: 17, attackVolEnv: 34, holdVolEnv: 35,
  decayVolEnv: 36, sustainVolEnv: 37, releaseVolEnv: 38, instrument: 41, keyRange: 43, velRange: 44, initialAttenuation: 48,
  coarseTune: 51, fineTune: 52, sampleID: 53, sampleModes: 54, scaleTuning: 56, overridingRootKey: 58,
};
const DEFAULT_TC = { attackVolEnv: -12000, holdVolEnv: -12000, decayVolEnv: -12000, releaseVolEnv: -12000 };
const ADDITIVE = ['pan', 'attackVolEnv', 'holdVolEnv', 'decayVolEnv', 'sustainVolEnv', 'releaseVolEnv', 'initialAttenuation', 'coarseTune', 'fineTune'];

const text = (buf, at, len) => buf.toString('latin1', at, at + len).replace(/\0.*$/, '');

function chunks(buf, from, to) {
  const out = {};
  for (let at = from; at + 8 <= to;) {
    const id = buf.toString('latin1', at, at + 4), size = buf.readUInt32LE(at + 4);
    if (id === 'LIST') {
      out[buf.toString('latin1', at + 8, at + 12)] = chunks(buf, at + 12, at + 8 + size);
    } else out[id] = { at: at + 8, size };
    at += 8 + size + (size & 1);
  }
  return out;
}

/** Liest eine .sf2/.sf3: { presets: [...], samples: [...], smplAt, version } */
export function readSoundFont(path) {
  const buf = readFileSync(path);
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'sfbk') throw new Error('Keine SoundFont-Datei');
  const top = chunks(buf, 12, buf.length);
  const pdta = top.pdta, smplAt = top.sdta.smpl.at;
  const table = (id, rec, parse) => Array.from({ length: pdta[id].size / rec }, (_, i) => parse(pdta[id].at + i * rec));
  const phdr = table('phdr', 38, (a) => ({ name: text(buf, a, 20), program: buf.readUInt16LE(a + 20), bank: buf.readUInt16LE(a + 22), bag: buf.readUInt16LE(a + 24) }));
  const pbag = table('pbag', 4, (a) => ({ gen: buf.readUInt16LE(a) }));
  const pgen = table('pgen', 4, (a) => ({ oper: buf.readUInt16LE(a), lo: buf.readUInt8(a + 2), hi: buf.readUInt8(a + 3), amount: buf.readInt16LE(a + 2) }));
  const inst = table('inst', 22, (a) => ({ name: text(buf, a, 20), bag: buf.readUInt16LE(a + 20) }));
  const ibag = table('ibag', 4, (a) => ({ gen: buf.readUInt16LE(a) }));
  const igen = table('igen', 4, (a) => ({ oper: buf.readUInt16LE(a), lo: buf.readUInt8(a + 2), hi: buf.readUInt8(a + 3), amount: buf.readInt16LE(a + 2) }));
  const samples = table('shdr', 46, (a) => ({
    name: text(buf, a, 20), start: buf.readUInt32LE(a + 20), end: buf.readUInt32LE(a + 24), loopStart: buf.readUInt32LE(a + 28), loopEnd: buf.readUInt32LE(a + 32),
    sampleRate: buf.readUInt32LE(a + 36), rootKey: buf.readUInt8(a + 40), correction: buf.readInt8(a + 41), type: buf.readUInt16LE(a + 44),
  }));

  // Zonen eines Bag-Bereichs als Generator-Tabelle { Name: Wert | [lo, hi] }
  const zones = (bags, gens, from, to) => {
    const out = [];
    for (let b = from; b < to; b++) {
      const zone = {};
      for (let g = bags[b].gen; g < bags[b + 1].gen; g++) {
        const { oper, lo, hi, amount } = gens[g];
        const name = Object.keys(GEN).find((k) => GEN[k] === oper);
        if (name) zone[name] = oper === GEN.keyRange || oper === GEN.velRange ? [lo, hi] : amount;
      }
      out.push(zone);
    }
    return out;
  };
  const instrumentZones = inst.map((it, i) => (i + 1 < inst.length ? zones(ibag, igen, it.bag, inst[i + 1].bag) : []));
  const presets = phdr.slice(0, -1).map((p, i) => ({ name: p.name, bank: p.bank, program: p.program, zones: zones(pbag, pgen, p.bag, phdr[i + 1].bag) }));

  // Preset -> Instrument -> Sample: Bereiche schneiden, additive Werte summieren (globale Zonen zuerst)
  const resolve = (preset) => {
    const pGlobal = preset.zones.find((z) => z.instrument === undefined) ?? {};
    const out = [];
    for (const pz of preset.zones.filter((z) => z.instrument !== undefined)) {
      const iz = instrumentZones[pz.instrument];
      const iGlobal = iz.find((z) => z.sampleID === undefined) ?? {};
      for (const z of iz.filter((x) => x.sampleID !== undefined)) {
        const merged = { ...iGlobal, ...z };
        const keys = [pGlobal.keyRange, pz.keyRange, iGlobal.keyRange, z.keyRange].filter(Boolean);
        const vels = [pGlobal.velRange, pz.velRange, iGlobal.velRange, z.velRange].filter(Boolean);
        const key = [Math.max(0, ...keys.map((r) => r[0])), Math.min(127, ...keys.map((r) => r[1]))];
        const vel = [Math.max(0, ...vels.map((r) => r[0])), Math.min(127, ...vels.map((r) => r[1]))];
        if (key[0] > key[1] || vel[0] > vel[1]) continue;
        // Fehlende Hüllkurvenzeiten gelten im Instrument als -12000 Timecents (sofort), alle anderen Werte als 0; Preset-Werte kommen dazu (die lokale Zone überschreibt die globale)
        const sum = Object.fromEntries(ADDITIVE.map((k) => [k, (merged[k] ?? DEFAULT_TC[k] ?? 0) + (pz[k] ?? pGlobal[k] ?? 0)]));
        out.push({ key, vel, sampleID: z.sampleID, rootKey: merged.overridingRootKey, scaleTuning: merged.scaleTuning ?? 100, sampleModes: merged.sampleModes ?? 0, ...sum,
          loopOffsets: [merged.startloopAddrsOffset ?? 0, merged.endloopAddrsOffset ?? 0] });
      }
    }
    return out;
  };
  return { presets, samples, smplAt, buf, resolve, version: top.INFO?.ifil ? buf.readUInt16LE(top.INFO.ifil.at) : 0 };
}
