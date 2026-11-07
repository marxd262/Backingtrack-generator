// Registry der Ansichten (Blöcke der Spielseite), rein und ohne Imports: blocks.js baut daraus die Schalter,
// layout-state.js leitet Standardwerte und Speichern ab. Ein neuer Eintrag mit hideable: true braucht sein
// section[data-view] im HTML und die i18n-Schlüssel view.<id>; Schalter, Ausblenden und Merken folgen von selbst.
export const VIEWS = [
  { id: 'fretboard', hideable: true },
  { id: 'lanes', hideable: false }, // enthält die Stummschalter je Schicht
  { id: 'wheel', hideable: true },
];
