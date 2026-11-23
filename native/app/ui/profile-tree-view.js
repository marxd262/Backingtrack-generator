// Flacher ARIA-Baum (WAI-ARIA-Muster "Tree View"): eine Zeile je sichtbarem Eintrag mit aria-level, ein wandernder Tabstopp.
// Kennt keine Profile: Zeilen kommen fertig von außen (Row), Auswahl und Auf-/Zuklappen meldet er über handlers.
// Row = { key, label, depth, kind, expandable, expanded, selected, draggable }. render() läuft je Takt: das DOM ändert sich nur bei neuen Zeilen.
// Ziehbare Zeilen bekommen am Ende den Griff .drag-handle (nur für Zeiger: aria-hidden, kein Tabstopp; das Ziehen macht profile-drag.js).
import { setText, setAttr } from './state.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

export function createTreeView(container, { onSelect, onToggle, onKeyNav }) {
  container.setAttribute('role', 'tree');
  let rows = [];
  let drawn = ''; // die gezeichneten Zeilen als JSON
  let stop = null; // Schlüssel der Zeile mit dem Tabstopp
  const byKey = new Map(); // Schlüssel -> Zeilen-Element (wiederverwendet, solange die Zeile sichtbar bleibt)

  function rowElement(key) {
    let row = byKey.get(key);
    if (!row) {
      row = el('div', { className: 'tree-row' });
      row.setAttribute('role', 'treeitem');
      row.dataset.key = key;
      const twisty = el('span', { className: 'tree-twisty' });
      twisty.setAttribute('aria-hidden', 'true');
      row.append(twisty, el('span', { className: 'tree-label' }));
      byKey.set(key, row);
    }
    return row;
  }

  function focusKey(key) {
    const row = byKey.get(key);
    if (!row) return;
    if (stop !== key) {
      const old = byKey.get(stop);
      if (old) setAttr(old, 'tabindex', '-1');
      stop = key;
      setAttr(row, 'tabindex', '0');
    }
    row.focus();
  }

  function render(next) {
    const json = JSON.stringify(next);
    if (json === drawn) return;
    drawn = json;
    rows = next;
    const hadFocus = container.contains(document.activeElement);
    if (!rows.some((r) => r.key === stop)) stop = (rows.find((r) => r.selected) ?? rows[0])?.key ?? null;
    const els = rows.map((r) => {
      const row = rowElement(r.key);
      setAttr(row, 'aria-level', String(r.depth));
      if (r.expandable) setAttr(row, 'aria-expanded', String(r.expanded));
      else row.removeAttribute('aria-expanded');
      setAttr(row, 'aria-selected', String(r.selected));
      setAttr(row, 'tabindex', r.key === stop ? '0' : '-1');
      setAttr(row, 'data-kind', r.kind);
      setAttr(row, 'style', `--depth: ${r.depth}`);
      setText(row.children[1], r.label); // nur als Text: Namen können beliebige Zeichen enthalten
      if (r.draggable && !row.children[2]) {
        const handle = el('span', { className: 'drag-handle' });
        handle.setAttribute('aria-hidden', 'true'); // Bildschirmleser verschieben über "Verschieben nach …"
        row.append(handle);
      }
      if (!r.draggable) row.children[2]?.remove();
      return row;
    });
    const keep = new Set(rows.map((r) => r.key));
    for (const key of byKey.keys()) if (!keep.has(key)) byKey.delete(key);
    // Reihenfolge nur bei Änderung neu setzen; umgehängte Elemente verlieren den Fokus, der Tabstopp bekommt ihn zurück
    if (els.length !== container.children.length || els.some((row, i) => container.children[i] !== row)) {
      container.replaceChildren(...els);
      if (hadFocus) byKey.get(stop)?.focus();
    }
  }

  container.addEventListener('click', (e) => {
    const row = e.target.closest('[role="treeitem"]');
    const r = row && rows.find((x) => x.key === row.dataset.key);
    if (!r) return;
    focusKey(r.key);
    if (r.expandable && e.target.closest('.tree-twisty')) onToggle(r.key);
    else onSelect(r.key);
  });

  container.addEventListener('keydown', (e) => {
    const row = e.target.closest('[role="treeitem"]');
    const i = row ? rows.findIndex((x) => x.key === row.dataset.key) : -1;
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const r = rows[i];
    let to = null;
    switch (e.key) {
      case 'ArrowDown': to = rows[i + 1]; break;
      case 'ArrowUp': to = rows[i - 1]; break;
      case 'Home': to = rows[0]; break;
      case 'End': to = rows.at(-1); break;
      case 'ArrowRight': // zu: aufklappen; offen: erstes Kind
        if (r.expandable && !r.expanded) onToggle(r.key);
        else if (r.expanded && rows[i + 1]?.depth > r.depth) to = rows[i + 1];
        break;
      case 'ArrowLeft': // offen: zuklappen; sonst: Elternzeile
        if (r.expandable && r.expanded) onToggle(r.key);
        else to = rows.slice(0, i).findLast((x) => x.depth < r.depth);
        break;
      case 'Enter': case ' ': onSelect(r.key); break;
      default: return;
    }
    e.preventDefault();
    if (to) {
      focusKey(to.key);
      onKeyNav?.(to.key);
    }
  });

  return { render, focusKey };
}
