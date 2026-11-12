// Streifen der Songform über dem Verlauf (Blöcke je Teil, gleiche Takt-Achse wie die Leinwand) und die Einstellungen des gewählten Teils.
// Der Streifen ist ein listbox mit option-Kindern (roving tabindex). Texte nur per textContent, DOM nur bei Änderung (render läuft je Takt).
// Jede Bearbeitung sperrt den Teil (form-ui.js) und setzt die Länge; bleibt die Gesamtlänge gleich, wirkt sie live (applyLive), sonst Neustart.
import { t } from '../index.js';
import { PART_TYPES, TRANSITIONS, resolveSection } from '../core/form-types.js';
import { formLength, isValidForm, sectionAt } from '../core/form.js';
import { $, state, setText, setAttr, pressed, rollNewForm, setFormTemplate } from './state.js';
import { stripBlocks, levelLabel, densityLabel, levelValue, densityValue, limits, barsText, editPart, setLocked, addPart, copyPart, deletePart, movePart } from './form-ui.js';

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

  let selected = 0;
  let queued = false;
  const options = []; // { el, name, bars }
  const formNow = () => (isValidForm(state.track.form) ? state.track.form : null);

  // beim Ziehen höchstens eine Neuberechnung des Ereignisstroms je Bild
  const liveSoon = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; applyLive({ patterns: true }); });
  };

  /** Ergebnis einer Bearbeitung übernehmen: Form und Länge setzen, live oder (andere Länge) Neustart an gleicher Stelle. */
  function commit(result) {
    if (result) {
      const before = state.track.length;
      state.track.form = result.form;
      state.track.length = formLength(result.form);
      selected = result.index;
      if (state.track.length === before) liveSoon();
      else restartIfPlaying({ inPlace: true });
    }
    render();
  }
  const edit = (patch) => { const f = formNow(); if (f) commit(editPart(f, selected, patch)); };
  const act = (fn) => () => { const f = formNow(); if (f) commit(fn(f)); };

  function choose(i, focus) {
    selected = i;
    render();
    if (focus) options[i]?.el.focus();
  }

  strip.addEventListener('click', (e) => {
    const i = options.findIndex((o) => o.el === e.target.closest('[role="option"]'));
    if (i >= 0) choose(i, false);
  });
  strip.addEventListener('keydown', (e) => {
    const i = options.findIndex((o) => o.el === e.target);
    if (i < 0) return;
    const last = options.length - 1;
    const to = { ArrowRight: Math.min(i + 1, last), ArrowDown: Math.min(i + 1, last), ArrowLeft: Math.max(i - 1, 0), ArrowUp: Math.max(i - 1, 0), Home: 0, End: last, Enter: i, ' ': i }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    choose(to, true);
  });

  typeSel.addEventListener('change', () => edit({ type: typeSel.value }));
  transitionSel.addEventListener('change', () => edit({ transition: transitionSel.value }));
  $('part-crash').addEventListener('change', (e) => edit({ crash: e.target.checked }));
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
    const before = state.track.length;
    if (formNow()) rollNewForm({ reroll: true });
    else setFormTemplate('auto'); // defekte Form: neu anlegen
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
      setAttr(el, 'aria-label', `${t('form.partLabel', { name: label, bars: barsText(b.bars), from: b.from, to: b.to })}${b.locked ? `, ${t('form.locked')}` : ''}`);
      setAttr(el, 'aria-selected', String(i === selected));
      setAttr(el, 'tabindex', i === selected ? '0' : '-1');
      setFlag(el, 'aria-current', i === playing);
      el.classList.toggle('locked', b.locked);
    });
  }

  function syncInspector(form, block) {
    const s = form.sections[selected];
    const r = resolveSection(s, form.feel);
    const lim = limits(form, selected);
    const set = (el, value) => { if (el.value !== value) el.value = value; };
    setText($('form-insp-title'), t('form.insp.title', { name: t(`form.part.${s.type}`), from: block.from, to: block.to }));
    for (const o of typeSel.options) setText(o, t(`form.part.${o.value}`));
    for (const o of transitionSel.options) setText(o, t(`form.transition.${o.value}`));
    set(typeSel, s.type);
    set(transitionSel, r.transition);
    if ($('part-crash').checked !== r.crash) $('part-crash').checked = r.crash;
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
    }
    pressed($('part-lock'), s.locked === true);
    setDisabled($('part-left'), !lim.canLeft);
    setDisabled($('part-right'), !lim.canRight);
    setDisabled($('part-copy'), !lim.canCopy);
    setDisabled($('part-delete'), !lim.canDelete);
    setDisabled($('form-add'), !lim.canAdd);
    setText($('form-note'), lim.reasons.map((k) => t(k)).join(' '));
  }

  return function renderStrip() {
    if (state.page !== 'play') return;
    const raw = state.track.form;
    const form = formNow();
    const blocks = form ? stripBlocks(form) : [];
    const ok = blocks.length > 0;
    show($('form-bar'), raw != null);
    show($('form-hint'), !ok);
    setText($('form-hint'), ok ? '' : t(raw == null ? 'form.hint.off' : 'form.hint.bad'));
    show(strip, ok);
    show(insp, ok);
    if (!ok) return;
    selected = Math.min(Math.max(selected, 0), blocks.length - 1);
    const total = formLength(form);
    const hit = state.playing && state.current && total > 0 ? sectionAt(form, state.current.bar % total) : null;
    const focused = document.activeElement;
    syncOptions(blocks, hit ? hit.index : -1);
    syncInspector(form, blocks[selected]);
    // ein eben gesperrter Knopf (z. B. "Nach rechts" am Ende) hatte den Fokus: auf den gewählten Teil, nicht ins Leere
    if (focused?.disabled && document.activeElement === focused) options[selected].el.focus();
  };
}
