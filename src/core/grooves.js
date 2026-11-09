// Taktarten und Raster; das Groove-Register folgt in diesem Modul. Reine Logik ohne Audio und DOM, importiert nichts.

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

// Taktarten: beats = Schläge (Puls) je Takt, sub = Schritte je Schlag. Einfache Taktarten rastern in Sechzehnteln (sub 4), 6/8 und 12/8
// zählen punktierte Viertel als Schlag und rastern in Achteltriolen (sub 3). `bpm` zählt diese Schläge.
export const METERS = deepFreeze({
  '4/4': { beats: 4, sub: 4 },
  '3/4': { beats: 3, sub: 4 },
  '6/8': { beats: 2, sub: 3 },
  '12/8': { beats: 4, sub: 3 },
  '5/4': { beats: 5, sub: 4 },
});

/** `[6, 8]` ergibt '6/8'; alles, was kein Paar aus zwei ganzen Zahlen ist, ergibt ''. */
export const meterKey = (meter) =>
  Array.isArray(meter) && meter.length === 2 && meter.every(Number.isInteger) ? `${meter[0]}/${meter[1]}` : '';

/** Unterstützte Taktart (Schlüssel in METERS). */
export const isMeter = (meter) => Object.hasOwn(METERS, meterKey(meter));

/** Schläge und Schritte je Schlag; für Unbekanntes das Raster von 4/4 (geprüfte Tracks haben immer eine bekannte Taktart). */
export const meterGrid = (meter) => (isMeter(meter) ? METERS[meterKey(meter)] : METERS['4/4']);
