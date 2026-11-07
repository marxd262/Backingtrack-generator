// Einklappbare Seitenleiste: breit steht sie neben den Blöcken, schmal (overlayQuery) liegt sie als Schublade
// darüber. Schmal ist immer nur eine offen; der Zustand liegt beim Aufrufer (isOpen/setOpen), hier nur DOM und Fokus.
import { setAttr } from './state.js';

const sidebars = []; // alle Leisten der Seite, für "nur eine Schublade" und die Blöcke darunter

export function initSidebar({ side, panel, toggle, isOpen, setOpen, overlayQuery = '(max-width: 1099px)' }) {
  const query = typeof matchMedia === 'function' ? matchMedia(overlayQuery) : null;
  const overlay = () => query?.matches === true;
  const heading = panel.querySelector('[tabindex="-1"]');
  const self = { panel, isOpen, setOpen };
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
    // offene Schublade: was sie überdeckt (die Blöcke), ist weder klick- noch fokussierbar; der Kopf bleibt bedienbar
    const covered = overlay() && sidebars.some((s) => s.isOpen());
    for (const el of panel.parentElement.children) {
      if (!sidebars.some((s) => s.panel === el) && el.inert !== covered) el.inert = covered;
    }
  }
  self.render = render;

  toggle.addEventListener('click', () => change(!isOpen()));
  panel.querySelector('.side-close')?.addEventListener('click', () => change(false));
  // Escape schließt nur die sichtbare Schublade (nicht auf der Startseite, nicht breit)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay() && isOpen() && panel.checkVisibility()) change(false);
  });
  query?.addEventListener?.('change', render);
  return { render };
}
