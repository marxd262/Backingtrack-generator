// Bedienung des Moduls "Rhythmus" im Rack: Tempo (großer Knopf), Komplexität, Lockerheit, Verzierungen, Taktart (LED-Tasten) und Groove der Taktart (LCD-Auswahl).
// Die Regeln stehen in der Sitzung (setMeter, setGroove, setRhythmKnob); das Tempo schickt app.js (setTempo).
import { t } from './i18n/index.js';
import { session, send, holds } from './session.js';
import { $, pressed, setText, setAttr } from './dom.js';
import { createKnob } from './knob.js';
import { createLcdSelect } from './lcd-select.js';

const chip = (props) => Object.assign(document.createElement('button'), { type: 'button', className: 'chip', ...props });

export function initRhythm() {
  const { METERS, groovesFor } = session.tables;
  for (const key of Object.keys(METERS)) {
    const b = chip({ textContent: key }); // die Taktart ist sprachneutral
    b.dataset.meter = key;
    b.addEventListener('click', () => send({ action: 'setMeter', meter: key }));
    $('meter-chips').append(b);
  }

  // das Tempo-Input trägt die Eingabe (app.js hört auf 'input'); der Knopf ist sein Bild
  createKnob($('tuning-tempo'), { origin: 'none', size: 'l', kind: 'white', resetValue: 100 });

  let grooveMeter = '';
  const grooveSelect = $('groove-select');
  createLcdSelect(grooveSelect, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
  grooveSelect.addEventListener('change', () => send({ action: 'setGroove', groove: grooveSelect.value }, grooveSelect));
  // Komplexität, Lockerheit (Mikrotiming) und Verzierungen (Artikulations-Schicht: Slides, Dead Notes, Flams ...; 0 = keine): jeder Schritt eine
  // Aktion; einen Schritt, dem schon der nächste desselben Knopfs folgt, lässt die Hülle aus
  const sliders = ['complexity', 'loose', 'ornaments'].map((knob) => {
    const slider = $(knob);
    createKnob(slider, { origin: 'center', kind: 'teal' });
    slider.addEventListener('input', () => {
      send({ action: 'setRhythmKnob', knob, value: Number(slider.value) }, slider);
      show(knob, slider);
    });
    return [knob, slider];
  });

  function show(field, slider) {
    // shortcut: the 50 % a knob shows while its field is missing is a rule of the web (rhythm.js 66) no text of the session gives, upgrade: when derived() gives the knobs' values
    const percent = holds(slider) ? slider.value : String(Math.round((session.state.track[field] ?? 0.5) * 100));
    if (slider.value !== percent) slider.value = percent;
    const shown = t('ui.percent', { n: percent });
    setText($(`${field}-out`), shown);
    setAttr(slider, 'aria-valuetext', shown);
  }

  return function renderRhythm() {
    const key = session.derived.meter;
    for (const b of $('meter-chips').children) pressed(b, b.dataset.meter === key);
    // Grooves der gewählten Taktart (bei Wechsel neu gebaut)
    if (grooveMeter !== key) {
      grooveMeter = key;
      grooveSelect.replaceChildren(...groovesFor[key].map((id) => {
        const o = Object.assign(document.createElement('option'), { value: id, textContent: t(`groove.${id}`) });
        o.dataset.i18n = `groove.${id}`;
        return o;
      }));
    }
    const current = session.derived.groove;
    if (!holds(grooveSelect) && grooveSelect.value !== current) grooveSelect.value = current;
    for (const [field, slider] of sliders) show(field, slider);
  };
}
