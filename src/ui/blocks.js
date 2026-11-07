// Schalter der Ansichten. Die Registry VIEWS steht in views.js (rein, auch für layout-state.js); ein neuer
// hideable-Eintrag dort bekommt Schalter und Ausblenden hier ohne weiteren Code. Kein Browser-Objekt beim Import:
// das DOM wird erst in initViews angefasst.
import { t } from '../index.js';
import { VIEWS } from './views.js';

export { VIEWS };

// initViews(container, { isVisible(id), setVisible(id, on) }) -> { render() }; render() schreibt nur bei Änderung
export function initViews(container, { isVisible, setVisible }) {
  const rows = VIEWS.filter((v) => v.hideable).map(({ id }) => {
    const label = document.createElement('label');
    label.className = 'view-switch';
    const input = Object.assign(document.createElement('input'), { type: 'checkbox' });
    input.addEventListener('change', () => setVisible(id, input.checked));
    const text = document.createElement('span');
    label.append(input, text);
    container.append(label);
    return { id, input, text, block: document.querySelector(`section[data-view="${id}"]`) };
  });

  return {
    render() {
      for (const { id, input, text, block } of rows) {
        const on = isVisible(id);
        if (input.checked !== on) input.checked = on;
        if (block && block.hidden === on) block.hidden = !on;
        const name = t(`view.${id}`);
        if (text.textContent !== name) text.textContent = name;
      }
    },
  };
}
