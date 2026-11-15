// Regeln der Orgel (docs/sound-v2/SPIELREGELN.md, Abschnitt 4.6), Teil der Artikulations-Schicht (articulation.js ruft organRules nach den
// Regelgruppen auf). Sie greifen nur, wenn die Akkord-Schicht die Tonewheel-Orgel spielt (chords/organ); der Strom aller anderen Stimmen bleibt
// unverändert. Die Regeln setzen nur Felder an den Tönen; was daraus wird, entscheidet die Stimme (audio/voices/organ.js, dort abschaltbar).
// leslie: 1 = der rotierende Lautsprecher dreht schnell (Refrain und letzter Takt davor); fehlt das Feld, dreht er langsam. Ohne Songform gibt es
// keinen Refrain: das Leslie bleibt langsam.

/** out: Ereignisse (werden geändert); env: aus articulate (track, ctx = Kontext je Takt). */
export function organRules(out, { track, ctx }) {
  if (track.voices?.chords?.id !== 'organ') return;
  const chorus = (bar) => ctx[bar]?.kind === 'chorus';
  for (const e of out) {
    if (e.layer !== 'chords' || e.type !== 'note') continue;
    if (chorus(e.bar) || chorus(e.bar + 1)) e.leslie = 1;
  }
}
