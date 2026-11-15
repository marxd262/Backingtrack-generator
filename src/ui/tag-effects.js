// Was ein Schlagwort im jetzigen Zustand bewirkt, als Daten für das Schlagwort-Fenster (Kennzeichnung, Anzeige, Abschwächung).
// Drei Arten: Spiel (ändert das Muster, sofort), Klang (ändert Klangregler, sofort; nur soweit die gewählte Stimme den Regler benutzt und
// der Nutzer ihn nicht von Hand gestellt hat) und Form (verschiebt Häufigkeiten beim nächsten Würfeln der Songform). Reine Rechnung ohne DOM.
import { TAG_PLAY_EFFECTS } from '../core/tags.js';
import { TIMBRE_EFFECTS } from '../core/timbre-effects.js';
import { DEV_FACTORS } from '../core/form-roll.js';
import { usesTimbreField } from '../core/voices.js';
import { isValidForm } from '../core/form.js';

/**
 * @returns {{ play: {param: string, value: number|boolean|string}[], sound: {path: string, delta: number, blocked: null|'voice'|'knob'}[],
 *   form: {type: string, factor: number}[], kinds: ('play'|'sound'|'form')[], effective: boolean }}
 * play: Musterwerte (mit Songform ohne `buildUp`: die Form bestimmt dann, welche Schichten spielen); sound: je Klangfeld die Verschiebung und
 * ob sie gerade ankommt; form: Faktoren je Teil-Typ, nur mit Songform; effective: irgendetwas davon wirkt jetzt oder beim nächsten Würfeln.
 */
export function tagEffect(tag, track) {
  const hasForm = isValidForm(track?.form);
  const play = Object.entries(TAG_PLAY_EFFECTS[tag] ?? {}).filter(([param]) => !(param === 'buildUp' && hasForm)).map(([param, value]) => ({ param, value }));
  const sound = Object.entries(TIMBRE_EFFECTS[tag] ?? {}).map(([path, delta]) => {
    const [group, field] = path.split('.');
    const blocked = !usesTimbreField(track?.voices, path) ? 'voice' : track?.timbre?.[group]?.[field] !== undefined ? 'knob' : null;
    return { path, delta, blocked };
  });
  const form = hasForm ? Object.entries(DEV_FACTORS[tag] ?? {}).map(([type, factor]) => ({ type, factor })) : [];
  const kinds = [play.length && 'play', sound.length && 'sound', form.length && 'form'].filter(Boolean);
  return { play, sound, form, kinds, effective: play.length > 0 || form.length > 0 || sound.some((s) => !s.blocked) };
}
