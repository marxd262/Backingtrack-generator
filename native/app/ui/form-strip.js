// Streifen der Songform über dem Verlauf (Blöcke je Teil, gleiche Takt-Achse wie die Leinwand) und das Feld "gewählter Teil" daneben.
// Der Streifen ist ein listbox mit option-Kindern (roving tabindex); der gewählte Teil trägt einen Griff an der rechten Kante (Länge ziehen).
// Texte nur per textContent, DOM nur bei Änderung (render läuft je Takt).
// Blöcke, Beschriftungen und Grenzen gibt derived().form, den gewählten Teil state().selectedPart; jede Bearbeitung ist eine Aktion der Sitzung
// (selectPart, editPart, toggleLock, deletePart, movePart, copyPart, addPart, rerollForm), die den Teil sperrt, wo die Web-App es tut.
import { t } from './i18n/index.js';
import { session, send, holds } from './session.js';
import { $, setText, setAttr, pressed } from './dom.js';
import { createKnob } from './knob.js';
import { createLcdSelect } from './lcd-select.js';
import { barsText, barsFromDrag, labelText } from './form-ui.js';

const show = (el, on) => { if (el.hidden === on) el.hidden = !on; };
const setDisabled = (el, off) => { if (el.disabled !== off) el.disabled = off; };
const setFlag = (el, name, on) => { if (on) setAttr(el, name, 'true'); else if (el.hasAttribute(name)) el.removeAttribute(name); };
const setStyle = (el, prop, value) => { if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value); };

// current(): die Wiedergabe hat einen Takt erreicht (der Teil, der spielt, trägt dann aria-current)
export function initFormStrip({ page, current }) {
  const { PART_TYPES, TRANSITIONS } = session.tables;
  const strip = $('form-strip');
  const insp = $('form-insp');
  const typeSel = $('part-type');
  const transitionSel = $('part-transition');
  for (const type of PART_TYPES) typeSel.append(new Option('', type));
  for (const tr of TRANSITIONS) transitionSel.append(new Option('', tr));
  for (const sel of [typeSel, transitionSel]) createLcdSelect(sel, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
  // Pegel und Dichte: Doppelklick auf den Knopf drückt die Reset-Taste (data-reset)
  createKnob($('part-level'), { origin: 'center' });
  createKnob($('part-density'), { origin: 'center' });
  // Griff an der rechten Kante des gewählten Teils; wandert mit der Auswahl (nur Zeiger, per Tastatur gibt es −/+)
  const grip = Object.assign(document.createElement('span'), { className: 'part-grip' });
  grip.dataset.edge = 'end';
  grip.setAttribute('aria-hidden', 'true');

  const options = []; // { el, name, bars }
  const selected = () => session.state.selectedPart;
  const form = () => session.derived.form;

  /** Eine Bearbeitung des gewählten Teils schicken; mit der Antwort bleibt der gewählte Teil sichtbar (Verschieben, Löschen, Kopieren). */
  const act = (action, control) => send(action, control).then(() => options[selected()]?.el.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
  const edit = (field, value, control) => act({ action: 'editPart', field, value }, control);

  function choose(i, focus) {
    send({ action: 'selectPart', index: i }).then(() => { if (focus) options[i]?.el.focus(); });
  }

  strip.addEventListener('click', (e) => {
    if (e.target.closest('.part-grip')) return; // das Klicken nach dem Ziehen wählt nichts neu
    const i = options.findIndex((o) => o.el === e.target.closest('[role="option"]'));
    if (i >= 0) choose(i, false);
  });

  // Länge ziehen: Zeiger-Capture am Griff; die Breite eines Takts steht beim Anfassen fest. Der Block folgt der Hand, die Länge geht beim
  // Loslassen an die Sitzung (ein Neustart statt einer je Takt); bis zur Antwort zeigt er die gezogene Länge
  let drag = null; // { x, bars, px, max, shown }
  let held = 0; // die Länge, bei der die Hand losließ, bis ihre Aktion beantwortet ist
  grip.addEventListener('pointerdown', (e) => {
    const f = form();
    if (!f || e.button !== 0) return;
    const { bars } = f.blocks[selected()];
    drag = { x: e.clientX, bars, px: options[selected()].el.getBoundingClientRect().width / bars, max: f.parts[selected()].maxBars, shown: bars };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault(); // keine Textauswahl beim Ziehen
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const n = barsFromDrag(drag.bars, e.clientX - drag.x, drag.px, { min: 1, max: drag.max });
    if (n === drag.shown) return;
    drag.shown = n;
    renderStrip();
  });
  const release = () => {
    if (!drag) return;
    const { bars, shown } = drag;
    drag = null;
    if (shown !== bars) {
      held = shown;
      send({ action: 'editPart', field: 'bars', value: shown }, grip);
    }
    renderStrip();
  };
  grip.addEventListener('pointerup', release);
  grip.addEventListener('pointercancel', release);
  strip.addEventListener('keydown', (e) => {
    const i = options.findIndex((o) => o.el === e.target);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return; // Alt+Pfeil (Zurück im Browser) und Co. bleiben dem Browser
    const last = options.length - 1;
    const to = { ArrowRight: Math.min(i + 1, last), ArrowDown: Math.min(i + 1, last), ArrowLeft: Math.max(i - 1, 0), ArrowUp: Math.max(i - 1, 0), Home: 0, End: last, Enter: i, ' ': i }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    choose(to, true);
  });

  typeSel.addEventListener('change', () => edit('type', typeSel.value, typeSel));
  transitionSel.addEventListener('change', () => edit('transition', transitionSel.value, transitionSel));
  $('part-crash').addEventListener('click', (e) => edit('crash', e.currentTarget.getAttribute('aria-pressed') !== 'true'));
  $('part-level').addEventListener('input', (e) => edit('level', Number(e.target.value), e.target));
  $('part-density').addEventListener('input', (e) => edit('density', Number(e.target.value), e.target));
  $('part-level-reset').addEventListener('click', () => edit('level', null));
  $('part-density-reset').addEventListener('click', () => edit('density', null));
  const bars = () => form()?.blocks[selected()]?.bars ?? 0;
  $('part-shorter').addEventListener('click', () => edit('bars', bars() - 1));
  $('part-longer').addEventListener('click', () => edit('bars', bars() + 1));
  $('part-lock').addEventListener('click', () => act({ action: 'toggleLock' }));
  $('part-delete').addEventListener('click', () => act({ action: 'deletePart' }));
  $('part-left').addEventListener('click', () => act({ action: 'movePart', dir: -1 }));
  $('part-right').addEventListener('click', () => act({ action: 'movePart', dir: 1 }));
  $('part-copy').addEventListener('click', () => act({ action: 'copyPart' }));
  $('form-add').addEventListener('click', () => act({ action: 'addPart' }));
  // nichts zu würfeln (alle Teile gesperrt): die Sitzung setzt den Hinweis state().rollNote
  $('form-roll').addEventListener('click', () => send({ action: 'rerollForm' }));

  // die Länge eines Blocks: beim Ziehen und bis zur Antwort die der Hand
  const barsOf = (b, i) => (i !== selected() ? b.bars : drag ? drag.shown : holds(grip) ? held : b.bars);
  // was die Sitzung für einen gesetzten Wert schreiben wird (form-ui.js der Web-App), solange ein Knopf die Hand zeigt: echtes Minuszeichen
  const minus = (v) => String(v).replace('-', '−');

  function syncOptions(blocks, playing) {
    while (options.length < blocks.length) {
      const el = document.createElement('div');
      el.setAttribute('role', 'option');
      el.className = 'form-part';
      const name = document.createElement('span');
      name.className = 'form-part-name';
      const n = document.createElement('span');
      n.className = 'form-part-bars';
      el.append(name, n);
      strip.append(el);
      options.push({ el, name, bars: n });
    }
    while (options.length > blocks.length) options.pop().el.remove();
    blocks.forEach((b, i) => {
      const { el, name, bars: n } = options[i];
      const label = t(`form.part.${b.type}`);
      const count = barsOf(b, i);
      setText(name, label);
      setText(n, String(count));
      setAttr(el, 'data-type', b.type);
      setStyle(el, '--bars', String(count));
      setStyle(el, 'flex-grow', String(count));
      setStyle(el, 'height', `${(b.height * 100).toFixed(1)}%`);
      const full = `${t('form.partLabel', { name: label, bars: barsText(b.bars), from: b.from, to: b.to })}${b.locked ? `, ${t('form.locked')}` : ''}`;
      setAttr(el, 'aria-label', full);
      setAttr(el, 'title', full); // schmale Blöcke kürzen den Namen: der Tooltip nennt ihn ganz
      setAttr(el, 'aria-selected', String(i === selected()));
      setAttr(el, 'tabindex', i === selected() ? '0' : '-1');
      setFlag(el, 'aria-current', i === playing);
      el.classList.toggle('locked', b.locked);
    });
    if (grip.parentElement !== options[selected()].el) options[selected()].el.append(grip);
  }

  function syncInspector(f, i) {
    const block = f.blocks[i];
    const part = f.parts[i];
    const s = session.state.track.form.sections[i]; // ob Pegel und Dichte eigene Werte haben, ob der Teil gesperrt ist
    const lim = part.limits;
    const set = (el, value) => { if (!holds(el) && el.value !== value) el.value = value; };
    // nur das Schild trägt die Farbe des Blocks; Name und Takte stehen im Tooltip
    const chip = $('part-chip');
    setText(chip, t('form.insp.chip', { n: i + 1 }));
    setAttr(chip, 'data-type', block.type);
    setAttr(chip, 'title', t('form.insp.title', { name: t(`form.part.${block.type}`), from: block.from, to: block.to }));
    for (const o of typeSel.options) setText(o, t(`form.part.${o.value}`));
    for (const o of transitionSel.options) setText(o, t(`form.transition.${o.value}`));
    set(typeSel, block.type);
    set(transitionSel, part.transition);
    pressed($('part-crash'), part.crash);
    setText($('part-len-out'), barsText(barsOf(block, i)));
    setDisabled($('part-shorter'), !lim.canShorter);
    setDisabled($('part-longer'), !lim.canLonger);
    for (const [id, value, label, unset, hand] of [
      ['level', part.levelValue, part.levelLabel, s.level == null, (v) => `${minus(v)} dB`],
      ['density', part.densityValue, part.densityLabel, s.density == null, (v) => t('ui.percent', { n: minus(v) })],
    ]) {
      const knob = $(`part-${id}`);
      set(knob, String(value));
      const text = holds(knob) ? hand(knob.value) : labelText(label);
      setText($(`part-${id}-out`), text);
      setAttr(knob, 'aria-valuetext', text);
      setDisabled($(`part-${id}-reset`), unset);
      knob.classList.toggle('unset', unset);
    }
    pressed($('part-lock'), s.locked === true);
    setDisabled($('part-left'), !lim.canLeft);
    setDisabled($('part-right'), !lim.canRight);
    setDisabled($('part-copy'), !lim.canCopy);
    setDisabled($('part-delete'), !lim.canDelete);
    setDisabled($('form-add'), !lim.canAdd);
    setText($('form-note'), [...(session.state.rollNote ? ['form.note.allLocked'] : []), ...lim.reasons].map((k) => t(k)).join(' '));
  }

  // Hatte der Fokus eines unserer Elemente und ist es weg (entfernt, versteckt, eben gesperrt): auf den gewählten Teil, ohne Streifen auf "Neu würfeln"
  function rescueFocus(mine, focused, option) {
    if (!mine || (focused.isConnected && focused.checkVisibility() && !focused.disabled)) return;
    const target = option ?? ($('form-bar').hidden ? $('form-template') : $('form-roll'));
    if (target.checkVisibility()) target.focus();
  }

  function renderStrip() {
    if (page() !== 'play') return;
    const raw = session.state.track.form;
    const f = form();
    const focused = document.activeElement;
    const mine = strip.contains(focused) || insp.contains(focused) || $('form-bar').contains(focused);
    const ok = f !== null;
    show($('form-bar'), raw != null);
    show($('form-hint'), !ok);
    setText($('form-hint'), ok ? '' : t(raw == null ? 'form.hint.off' : 'form.hint.bad'));
    show(strip, ok);
    show(insp, ok);
    if (!ok) return rescueFocus(mine, focused, null);
    const part = current() ? session.position.part : null;
    syncOptions(f.blocks, part ? part.index : -1);
    syncInspector(f, selected());
    rescueFocus(mine, focused, options[selected()].el);
  }
  return renderStrip;
}
