// Auswahl als LCD: das Select bleibt ein echtes Select, davor und dahinter je eine Taste zum vorigen/nächsten Eintrag.
const syncs = new Set();

// Index des nächsten nicht deaktivierten Eintrags in Richtung dir, -1 am Listenende (kein Umlauf)
const neighbour = (select, dir) => {
  for (let i = select.selectedIndex + dir; i >= 0 && i < select.options.length; i += dir) if (!select.options[i].disabled) return i;
  return -1;
};

export function createLcdSelect(select, { prevKey, nextKey }) {
  const wrap = document.createElement('span');
  wrap.className = 'lcd-select';
  const button = (text, key, dir) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'lcd-btn', textContent: text, tabIndex: -1 }); // die Pfeiltasten am Select schalten ohnehin weiter
    b.dataset.i18nLabel = key; // render() setzt den zugänglichen Namen
    b.addEventListener('click', () => {
      const i = neighbour(select, dir);
      if (i < 0) return;
      select.selectedIndex = i;
      select.dispatchEvent(new Event('change', { bubbles: true })); // die change-Weiche ruft sync()
    });
    return b;
  };
  const prev = button('‹', prevKey, -1);
  const next = button('›', nextKey, 1);
  select.before(wrap);
  wrap.append(prev, select, next);

  const sync = () => {
    for (const [b, dir] of [[prev, -1], [next, 1]]) {
      const off = select.disabled || neighbour(select, dir) < 0;
      if (b.disabled === off) continue;
      if (off && document.activeElement === b) select.focus(); // sonst verliert die Tastatur den Fokus
      b.disabled = off;
    }
  };
  select.addEventListener('change', sync);
  syncs.add({ wrap, sync });
  sync();
}

/** Tasten aller LCD-Auswahlen neu bewerten (Einträge oder Auswahl können sich von außen geändert haben). */
export function syncLcdSelects() {
  for (const s of syncs) {
    if (s.wrap.isConnected) s.sync();
    else syncs.delete(s); // entfernt: aus der Liste nehmen
  }
}
