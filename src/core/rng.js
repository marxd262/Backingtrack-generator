// Seedbarer Zufall (mulberry32). Kein Math.random im Projekt.

// FNV-1a: faltet seed + label zu einem 32-Bit-Seed
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed) {
  const base = seed >>> 0; // Seeds jenseits 32 Bit werden modulo 2**32 gekürzt, undefined wird 0
  let state = base;
  const rng = {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) {
      return min + Math.floor(rng.next() * (max - min + 1));
    },
    pick(arr) {
      return arr[Math.floor(rng.next() * arr.length)];
    },
    fork(label) {
      return createRng(hash(`${base}:${label}`));
    },
  };
  return rng;
}
