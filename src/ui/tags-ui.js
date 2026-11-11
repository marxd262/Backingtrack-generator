// Schlagworte nach Kategorien: je Kategorie eine Gruppe mit Umschalt-Knöpfen, mehrere pro Kategorie wählbar.
import { TAG_CATEGORIES } from '../index.js';
import { INERT_TAGS } from '../core/tags.js';
import { pressed } from './state.js';

// Auswahl als { kategorie: [tags] } in der Reihenfolge von TAG_CATEGORIES, leere Kategorien entfallen
export function toggleTag(tags, category, tag) {
  const out = {};
  for (const c of TAG_CATEGORIES) {
    const list = c.tags.filter((x) => (tags[c.id] ?? []).includes(x) !== (c.id === category && x === tag));
    if (list.length) out[c.id] = list;
  }
  return out;
}

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
      // ohne Wirkung: gedämpft, Hinweis als title und aria-description (setzt render über data-i18n-hint)
      if (INERT_TAGS.includes(tag)) {
        b.classList.add('inert');
        b.dataset.i18nHint = 'ui.inertTag';
      }
      b.addEventListener('click', () => onToggle(id, tag));
      chips.append(b);
    }
    group.append(name, chips);
    container.append(group);
  }
}

export function renderTags(container, tags) {
  for (const b of container.querySelectorAll('button')) pressed(b, (tags[b.dataset.category] ?? []).includes(b.dataset.tag));
}
