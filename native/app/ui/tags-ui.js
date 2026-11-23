// Schlagworte nach Kategorien: je Kategorie eine Gruppe mit Umschalt-Knöpfen, mehrere pro Kategorie wählbar. Jedes Wort trägt hinter dem
// Namen Kennbuchstaben für seine Art (Spiel, Klang, Form; über CSS aus data-marks, also nicht Teil des Textes), ist blass, solange es im
// jetzigen Zustand nichts bewirkt, und die Anzeige über der Liste (#tag-fx) sagt für das überfahrene oder fokussierte Wort, was es wann bewegt.
import { TAG_CATEGORIES, t } from '../index.js';
import { pressed, setAttr, setText } from './state.js';
import { tagEffect } from './tag-effects.js';

// Auswahl als { kategorie: [tags] } in der Reihenfolge von TAG_CATEGORIES, leere Kategorien entfallen
export function toggleTag(tags, category, tag) {
  const out = {};
  for (const c of TAG_CATEGORIES) {
    const list = c.tags.filter((x) => (tags[c.id] ?? []).includes(x) !== (c.id === category && x === tag));
    if (list.length) out[c.id] = list;
  }
  return out;
}

let shown = null; // { category, tag } des Worts, das die Anzeige gerade erklärt

// Texte setzt render() über data-i18n
export function buildTags(container, onToggle) {
  for (const { id, tags } of TAG_CATEGORIES) {
    const group = document.createElement('div');
    group.className = 'tag-group';
    const name = Object.assign(document.createElement('p'), { className: 'tag-label', id: `tags-${id}` });
    name.dataset.i18n = `category.${id}`;
    const chips = Object.assign(document.createElement('div'), { className: 'chips' });
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-labelledby', name.id);
    for (const tag of tags) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
      Object.assign(b.dataset, { category: id, tag, i18n: `tag.${id}.${tag}` });
      b.setAttribute('aria-describedby', 'tag-fx'); // die Anzeige erklärt das fokussierte Wort
      b.addEventListener('click', () => onToggle(id, tag));
      chips.append(b);
    }
    group.append(name, chips);
    container.append(group);
  }
  // die Anzeige folgt Maus und Fokus; verlässt die Maus die Liste, bleibt das zuletzt gezeigte Wort stehen
  const show = (e) => {
    const b = e.target.closest?.('button[data-tag]');
    if (!b || (shown?.tag === b.dataset.tag && shown.category === b.dataset.category)) return;
    shown = { category: b.dataset.category, tag: b.dataset.tag };
    container.dispatchEvent(new CustomEvent('tagshown')); // tuning.js zeichnet neu
  };
  container.addEventListener('pointerover', show);
  container.addEventListener('focusin', show);
}

const percent = (x) => `${x > 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)} %`;
const partName = (type) => t(`form.part.${type}`);

/** Klartext für die Anzeige: Name, dann je Art eine Zeile mit dem, was das Wort bewegt, und wann. */
export function effectText(category, tag, fx) {
  const lines = [t(`tag.${category}.${tag}`)];
  if (fx.play.length) {
    lines.push(t('tagfx.play', { list: fx.play.map(({ param, value }) => (typeof value === 'number' ? `${t(`param.${param}`)} ${percent(value)}` : t(param === 'buildUp' ? `param.buildUp.${value}` : `param.${param}`))).join(', ') }));
  }
  // Klangfelder nach Instrument, getrennt in: kommt an / die gewählte Stimme benutzt den Regler nicht / der Knopf ist von Hand gestellt
  const sound = (blocked) => {
    const byGroup = {};
    for (const s of fx.sound.filter((x) => x.blocked === blocked)) {
      const group = s.path.split('.')[0];
      (byGroup[group] ??= []).push(`${t(`timbre.${s.path}`)} ${percent(s.delta)}`);
    }
    return Object.entries(byGroup).map(([group, items]) => `${t(group === 'master' ? 'group.master' : `layer.${group}`)}: ${items.join(', ')}`).join('; ');
  };
  for (const [blocked, key] of [[null, 'tagfx.sound'], ['voice', 'tagfx.voice'], ['knob', 'tagfx.knob']]) {
    const list = sound(blocked);
    if (list) lines.push(t(key, { list }));
  }
  if (fx.form.length) lines.push(t('tagfx.form', { list: fx.form.map(({ type, factor }) => t(factor > 1 ? 'tagfx.more' : 'tagfx.less', { part: partName(type) })).join(', ') }));
  if (lines.length === 1) lines.push(t('tagfx.none'));
  return lines.join('\n');
}

/** Auswahl, Kennbuchstaben und Abschwächung der Wörter nach dem Zustand des Tracks; die Anzeige zeigt das zuletzt berührte Wort. */
export function renderTags(container, track, display) {
  for (const b of container.querySelectorAll('button[data-tag]')) {
    const { category, tag } = b.dataset;
    pressed(b, (track.tags[category] ?? []).includes(tag));
    const fx = tagEffect(tag, track);
    setAttr(b, 'data-marks', fx.kinds.map((kind) => t(`tagfx.mark.${kind}`)).join(' '));
    b.classList.toggle('inert', !fx.effective);
  }
  if (display) setText(display, shown ? effectText(shown.category, shown.tag, tagEffect(shown.tag, track)) : t('tagfx.idle'));
}
