// Bedienung der Gruppe "Rhythmus" in der linken Leiste: Taktart, Groove der Taktart und Komplexität. Die Rechnung steht in
// core/grooves.js. Groove und Komplexität wirken live (applyLive), ein Taktartwechsel startet eine laufende Wiedergabe neu.
import { t } from '../index.js';
import { $, state, pressed, setText, setAttr, setMeter } from './state.js';
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

  let grooveMeter = '';
  const slider = $('complexity');
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
      $('groove-chips').replaceChildren(...groovesFor(key).map((id) => {
        const b = chip({ textContent: t(`groove.${id}`) });
        b.dataset.groove = id;
        b.dataset.i18n = `groove.${id}`;
        b.addEventListener('click', () => {
          state.track.groove = id;
          applyLive({ patterns: true });
          render();
        });
        return b;
      }));
    }
    const current = grooveIdFor(state.track);
    for (const b of $('groove-chips').children) pressed(b, b.dataset.groove === current);
    const percent = String(Math.round((state.track.complexity ?? 0.5) * 100));
    if (slider.value !== percent) slider.value = percent;
    const shown = t('ui.percent', { n: percent });
    setText($('complexity-out'), shown);
    setAttr(slider, 'aria-valuetext', shown);
  };
}
