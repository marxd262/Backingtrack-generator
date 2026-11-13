// Bedienung des Moduls "Rhythmus" im Rack: Tempo (großer Knopf), Taktart (LED-Tasten), Groove der Taktart (LCD-Auswahl) und Komplexität. Die Rechnung steht in
// core/grooves.js. Groove und Komplexität wirken live (applyLive), ein Taktartwechsel startet eine laufende Wiedergabe neu.
import { t } from '../index.js';
import { $, state, pressed, setText, setAttr, setMeter } from './state.js';
import { createKnob } from './knob.js';
import { createLcdSelect } from './lcd-select.js';
import { METERS, groovesFor, meterKey, grooveIdFor } from '../core/grooves.js';

const chip = (props) => Object.assign(document.createElement('button'), { type: 'button', className: 'chip', ...props });

export function initRhythm({ render, restartIfPlaying, applyLive }) {
  for (const key of Object.keys(METERS)) {
    const b = chip({ textContent: key }); // die Taktart ist sprachneutral
    b.dataset.meter = key;
    b.addEventListener('click', () => {
      if (setMeter(key)) restartIfPlaying({ inPlace: true });
      render();
    });
    $('meter-chips').append(b);
  }

  // das Tempo-Input trägt die Eingabe (app.js hört auf 'input'); der Knopf ist sein Bild
  createKnob($('tuning-tempo'), { origin: 'none', size: 'l', kind: 'white', resetValue: 100 });

  let grooveMeter = '';
  const grooveSelect = $('groove-select');
  createLcdSelect(grooveSelect, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
  grooveSelect.addEventListener('change', () => {
    state.track.groove = grooveSelect.value;
    applyLive({ patterns: true });
    render();
  });
  const slider = $('complexity');
  createKnob(slider, { origin: 'center', kind: 'teal' });
  let queued = false;
  slider.addEventListener('input', () => {
    state.track.complexity = Number(slider.value) / 100;
    render();
    // beim Ziehen höchstens eine Neuberechnung des Ereignisstroms je Bild
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => { queued = false; applyLive({ patterns: true }); });
    }
  });

  return function renderRhythm() {
    const key = meterKey(state.track.meter);
    for (const b of $('meter-chips').children) pressed(b, b.dataset.meter === key);
    // Grooves der gewählten Taktart (bei Wechsel neu gebaut)
    if (grooveMeter !== key) {
      grooveMeter = key;
      grooveSelect.replaceChildren(...groovesFor(key).map((id) => {
        const o = Object.assign(document.createElement('option'), { value: id, textContent: t(`groove.${id}`) });
        o.dataset.i18n = `groove.${id}`;
        return o;
      }));
    }
    const current = grooveIdFor(state.track);
    if (grooveSelect.value !== current) grooveSelect.value = current;
    const percent = String(Math.round((state.track.complexity ?? 0.5) * 100));
    if (slider.value !== percent) slider.value = percent;
    const shown = t('ui.percent', { n: percent });
    setText($('complexity-out'), shown);
    setAttr(slider, 'aria-valuetext', shown);
  };
}
