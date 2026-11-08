// Einklappbare Gruppen der Seitenleisten (<details data-group>): Offen-Zustand aus dem gemerkten Layout setzen und Änderungen melden.
// Darf für mehrere Wurzeln aufgerufen werden (die Klang-Gruppen entstehen erst zur Laufzeit).
export function initGroups(root, { get, set }) {
  for (const el of root.querySelectorAll('details[data-group]')) {
    const id = el.dataset.group;
    el.open = get(id) === true;
    // toggle feuert auch, wenn open per Code gesetzt wird: nur echte Änderungen weitermelden
    el.addEventListener('toggle', () => { if (el.open !== (get(id) === true)) set(id, el.open); });
  }
}
