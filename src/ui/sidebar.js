// Einklappbare Seitenleiste: breit steht sie neben den Blöcken, schmal (overlayQuery) liegt sie als modale
// Schublade darüber. Schmal ist immer nur eine offen; der Zustand liegt beim Aufrufer (isOpen/setOpen), hier nur DOM und Fokus.
import { setAttr } from './state.js';

const sidebars = []; // alle Leisten der Seite, für "nur eine Schublade" und die Modalität
let inerted = []; // was die offene Schublade zuletzt inert gemacht hat

// Einzige Stelle für inert: bei offener, sichtbarer Schublade alles außerhalb (Geschwister jeder Vorfahrenebene), sonst nichts
function applyModal() {
  const drawer = sidebars.find((s) => s.overlay() && s.isOpen() && !s.panel.hidden && !s.panel.parentElement.closest('[hidden]'));
  const next = [];
  for (let el = drawer?.panel; el && el !== document.body; el = el.parentElement) {
    for (const sibling of el.parentElement.children) if (sibling !== el) next.push(sibling);
  }
  for (const el of inerted) if (!next.includes(el) && el.inert) el.inert = false;
  for (const el of next) if (!el.inert) el.inert = true;
  inerted = next;
}

// Schubladen bis 1199 px; GLEICHE Grenze in app.css (min-width: 75rem bzw. max-width: 74.9375rem)
const OVERLAY_QUERY = '(max-width: 74.9375rem)';

export function initSidebar({ side, panel, toggle, isOpen, setOpen, overlayQuery = OVERLAY_QUERY }) {
  const query = typeof matchMedia === 'function' ? matchMedia(overlayQuery) : null;
  const overlay = () => query?.matches === true;
  const heading = panel.querySelector('[tabindex="-1"]');
  const self = { panel, isOpen, setOpen, overlay };
  sidebars.push(self);
  const others = () => sidebars.filter((s) => s !== self);

  function change(open) {
    if (open && overlay()) for (const s of others()) if (s.isOpen()) s.setOpen(false);
    if (open !== isOpen()) setOpen(open);
    for (const s of sidebars) s.render();
    // Fokus erst nach dem Aufdecken, unabhängig von einer Einblendung
    (open ? heading : toggle).focus();
  }

  function render() {
    // schmal und beide gemerkt offen (z. B. Fenster verkleinert): die linke bleibt, die rechte schließt und wird gemerkt
    if (overlay() && side !== 'left' && isOpen() && others().some((s) => s.isOpen())) {
      const hadFocus = panel.contains(document.activeElement);
      setOpen(false);
      if (hadFocus) toggle.focus();
    }
    const open = isOpen();
    if (panel.hidden === open) panel.hidden = !open;
    setAttr(toggle, 'aria-expanded', String(open));
    applyModal();
  }
  self.render = render;

  toggle.addEventListener('click', () => change(!isOpen()));
  panel.querySelector('.side-close')?.addEventListener('click', () => change(false));
  // Escape schließt nur die sichtbare Schublade; schon behandelte Escapes (z. B. offene Auswahlliste) zählen nicht
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && overlay() && isOpen() && panel.checkVisibility()) change(false);
  });
  query?.addEventListener?.('change', render);
  return { render };
}
