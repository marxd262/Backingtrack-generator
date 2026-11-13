// Streifen der Songform über dem Verlauf (Blöcke je Teil, gleiche Takt-Achse wie die Leinwand) und das Feld "gewählter Teil" daneben.
// Der Streifen ist ein listbox mit option-Kindern (roving tabindex); der gewählte Teil trägt einen Griff an der rechten Kante (Länge ziehen).
// Texte nur per textContent, DOM nur bei Änderung (render läuft je Takt).
// Jede Bearbeitung sperrt den Teil (form-ui.js) und setzt die Länge; bleibt die Gesamtlänge gleich, wirkt sie live (applyLive), sonst Neustart.
import { t } from '../index.js';
import { PART_TYPES, TRANSITIONS, FORM_LIMITS, resolveSection } from '../core/form-types.js';
import { TEMPLATE_IDS } from '../core/form-roll.js';
import { formLength, isValidForm, sectionAt } from '../core/form.js';
import { $, state, setText, setAttr, pressed, rollNewForm, setFormTemplate } from './state.js';
import { createKnob } from './knob.js';
import { createLcdSelect } from './lcd-select.js';
import { stripBlocks, levelLabel, densityLabel, levelValue, densityValue, limits, barsText, editPart, setLocked, addPart, copyPart, deletePart, movePart, barsFromDrag } from './form-ui.js';

const show = (el, on) => { if (el.hidden === on) el.hidden = !on; };
const setDisabled = (el, off) => { if (el.disabled !== off) el.disabled = off; };
const setFlag = (el, name, on) => { if (on) setAttr(el, name, 'true'); else if (el.hasAttribute(name)) el.removeAttribute(name); };
const setStyle = (el, prop, value) => { if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value); };

export function initFormStrip({ render, restartIfPlaying, applyLive }) {
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

  let selected = 0;
  let queued = false;
  let rollNote = false; // "Neu würfeln" fand nur gesperrte Teile: Hinweis im #form-note, bis die nächste Aktion kommt
  const options = []; // { el, name, bars }
  const formNow = () => (isValidForm(state.track.form) ? state.track.form : null);

  // beim Ziehen höchstens eine Neuberechnung des Ereignisstroms je Bild
  const liveSoon = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; applyLive({ patterns: true }); });
  };

  /** Ergebnis einer Bearbeitung übernehmen: Form und Länge setzen, live oder (andere Länge) Neustart an gleicher Stelle. */
  function commit(result, { defer = false } = {}) {
    rollNote = false;
    if (result) {
      const before = state.track.length;
      state.track.form = result.form;
      state.track.length = formLength(result.form);
      selected = result.index;
      if (defer) { /* Ziehen: der Neustart kommt einmal beim Loslassen */ }
      else if (state.track.length === before) liveSoon();
      else restartIfPlaying({ inPlace: true });
    }
    render();
    options[selected]?.el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); // Verschieben, Löschen, Kopieren: der gewählte Teil bleibt sichtbar
  }
  const edit = (patch) => { const f = formNow(); if (f) commit(editPart(f, selected, patch)); };
  const act = (fn) => () => { const f = formNow(); if (f) commit(fn(f)); };

  function choose(i, focus) {
    rollNote = false;
    selected = i;
    render();
    if (focus) options[i]?.el.focus();
  }

  strip.addEventListener('click', (e) => {
    if (e.target.closest('.part-grip')) return; // das Klicken nach dem Ziehen wählt nichts neu
    const i = options.findIndex((o) => o.el === e.target.closest('[role="option"]'));
    if (i >= 0) choose(i, false);
  });

  // Länge ziehen: Zeiger-Capture am Griff; die Breite eines Takts steht beim Anfassen fest, so bleibt das Ziehen stabil, obwohl die Teile mitwandern
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    const f = formNow();
    if (!f || e.button !== 0) return;
    const bars = f.sections[selected].bars;
    const room = FORM_LIMITS.length - (formLength(f) - bars);
    drag = { x: e.clientX, bars, length: state.track.length, px: options[selected].el.getBoundingClientRect().width / bars, max: Math.min(FORM_LIMITS.bars, room) };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault(); // keine Textauswahl beim Ziehen
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const n = barsFromDrag(drag.bars, e.clientX - drag.x, drag.px, { min: 1, max: drag.max });
    const f = formNow();
    if (f && n !== f.sections[selected].bars) commit(editPart(f, selected, { bars: n }), { defer: true });
  });
  const release = () => {
    if (!drag) return;
    const { length } = drag;
    drag = null;
    if (state.track.length !== length) restartIfPlaying({ inPlace: true }); // eine Neuberechnung statt eine je Takt
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

  typeSel.addEventListener('change', () => edit({ type: typeSel.value }));
  transitionSel.addEventListener('change', () => edit({ transition: transitionSel.value }));
  $('part-crash').addEventListener('click', (e) => edit({ crash: e.currentTarget.getAttribute('aria-pressed') !== 'true' }));
  $('part-level').addEventListener('input', (e) => edit({ level: Number(e.target.value) }));
  $('part-density').addEventListener('input', (e) => edit({ density: Number(e.target.value) / 100 }));
  $('part-level-reset').addEventListener('click', () => edit({ level: undefined }));
  $('part-density-reset').addEventListener('click', () => edit({ density: undefined }));
  const bars = () => formNow()?.sections[selected]?.bars ?? 0;
  $('part-shorter').addEventListener('click', () => edit({ bars: bars() - 1 }));
  $('part-longer').addEventListener('click', () => edit({ bars: bars() + 1 }));
  $('part-lock').addEventListener('click', act((f) => setLocked(f, selected, !f.sections[selected].locked)));
  $('part-delete').addEventListener('click', act((f) => deletePart(f, selected)));
  $('part-left').addEventListener('click', act((f) => movePart(f, selected, -1)));
  $('part-right').addEventListener('click', act((f) => movePart(f, selected, 1)));
  $('part-copy').addEventListener('click', act((f) => copyPart(f, selected)));
  $('form-add').addEventListener('click', act(addPart));
  $('form-roll').addEventListener('click', () => {
    const f = formNow();
    if (f?.sections.every((s) => s.locked)) {
      rollNote = true; // nichts zu würfeln: Hinweis statt stillem Nichts
      return render();
    }
    rollNote = false;
    const before = state.track.length;
    if (f) rollNewForm({ reroll: true });
    else {
      // defekte Form: neu anlegen, mit der gewählten Vorlage (Auto, wenn keine erkennbar ist)
      const raw = state.track.form;
      setFormTemplate(TEMPLATE_IDS.includes(raw?.template) && raw?.auto !== true ? raw.template : 'auto');
    }
    if (state.track.length === before) liveSoon();
    else restartIfPlaying({ inPlace: true });
    render();
  });

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
      setText(name, label);
      setText(n, String(b.bars));
      setAttr(el, 'data-type', b.type);
      setStyle(el, '--bars', String(b.bars));
      setStyle(el, 'flex-grow', String(b.bars));
      setStyle(el, 'height', `${(b.height * 100).toFixed(1)}%`);
      const full = `${t('form.partLabel', { name: label, bars: barsText(b.bars), from: b.from, to: b.to })}${b.locked ? `, ${t('form.locked')}` : ''}`;
      setAttr(el, 'aria-label', full);
      setAttr(el, 'title', full); // schmale Blöcke kürzen den Namen: der Tooltip nennt ihn ganz
      setAttr(el, 'aria-selected', String(i === selected));
      setAttr(el, 'tabindex', i === selected ? '0' : '-1');
      setFlag(el, 'aria-current', i === playing);
      el.classList.toggle('locked', b.locked);
    });
    if (grip.parentElement !== options[selected].el) options[selected].el.append(grip);
  }

  function syncInspector(form, block) {
    const s = form.sections[selected];
    const r = resolveSection(s, form.feel);
    const lim = limits(form, selected);
    const set = (el, value) => { if (el.value !== value) el.value = value; };
    // nur das Schild trägt die Farbe des Blocks; Name und Takte stehen im Tooltip
    const chip = $('part-chip');
    setText(chip, t('form.insp.chip', { n: selected + 1 }));
    setAttr(chip, 'data-type', s.type);
    setAttr(chip, 'title', t('form.insp.title', { name: t(`form.part.${s.type}`), from: block.from, to: block.to }));
    for (const o of typeSel.options) setText(o, t(`form.part.${o.value}`));
    for (const o of transitionSel.options) setText(o, t(`form.transition.${o.value}`));
    set(typeSel, s.type);
    set(transitionSel, r.transition);
    pressed($('part-crash'), r.crash);
    setText($('part-len-out'), barsText(s.bars));
    setDisabled($('part-shorter'), !lim.canShorter);
    setDisabled($('part-longer'), !lim.canLonger);
    for (const [id, value, text, unset] of [
      ['level', levelValue(s, form.feel), levelLabel(s, form.feel), s.level == null],
      ['density', densityValue(s, form.feel), densityLabel(s, form.feel), s.density == null],
    ]) {
      set($(`part-${id}`), String(value));
      setText($(`part-${id}-out`), text);
      setAttr($(`part-${id}`), 'aria-valuetext', text);
      setDisabled($(`part-${id}-reset`), unset);
      $(`part-${id}`).classList.toggle('unset', unset);
    }
    pressed($('part-lock'), s.locked === true);
    setDisabled($('part-left'), !lim.canLeft);
    setDisabled($('part-right'), !lim.canRight);
    setDisabled($('part-copy'), !lim.canCopy);
    setDisabled($('part-delete'), !lim.canDelete);
    setDisabled($('form-add'), !lim.canAdd);
    setText($('form-note'), [...(rollNote ? ['form.note.allLocked'] : []), ...lim.reasons].map((k) => t(k)).join(' '));
  }

  // Hatte der Fokus eines unserer Elemente und ist es weg (entfernt, versteckt, eben gesperrt): auf den gewählten Teil, ohne Streifen auf "Neu würfeln"
  function rescueFocus(mine, focused, option) {
    if (!mine || (focused.isConnected && focused.checkVisibility() && !focused.disabled)) return;
    const target = option ?? ($('form-bar').hidden ? $('form-template') : $('form-roll'));
    if (target.checkVisibility()) target.focus();
  }

  return function renderStrip() {
    if (state.page !== 'play') return;
    const raw = state.track.form;
    const form = formNow();
    const focused = document.activeElement;
    const mine = strip.contains(focused) || insp.contains(focused) || $('form-bar').contains(focused);
    const blocks = form ? stripBlocks(form) : [];
    const ok = blocks.length > 0;
    show($('form-bar'), raw != null);
    show($('form-hint'), !ok);
    setText($('form-hint'), ok ? '' : t(raw == null ? 'form.hint.off' : 'form.hint.bad'));
    show(strip, ok);
    show(insp, ok);
    if (!ok) return rescueFocus(mine, focused, null);
    selected = Math.min(Math.max(selected, 0), blocks.length - 1);
    const total = formLength(form);
    const hit = state.playing && state.current && total > 0 ? sectionAt(form, state.current.bar % total) : null;
    syncOptions(blocks, hit ? hit.index : -1);
    syncInspector(form, blocks[selected]);
    rescueFocus(mine, focused, options[selected].el);
  };
}
