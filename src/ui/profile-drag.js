// Ziehen im Profil-Baum mit Pointer Events (kein HTML5-Drag-and-drop, das auf Touch nicht geht). Gezogen wird nur am Griff
// .drag-handle in einer Zeile [data-key]. Maus: ab MOVE_TOLERANCE_PX Bewegung. Touch und Stift: erst nach LONG_PRESS_MS Halten ohne
// Bewegung; wer vorher bewegt, scrollt den Baum (der Griff hat touch-action: none, darum scrollt hier das Modul selbst; kann der Baum
// nicht scrollen, das umgebende .pop) und zieht in diesem Druck nie mehr. Während des Ziehens trägt die Zeile unter dem Zeiger data-drop="ok" oder "no", am Rand scrollt der Baum mit.
// Loslassen auf "ok" ruft onDrop; Loslassen anderswo, Escape und pointercancel rufen nur onCancel, ebenso ein verlorenes Loslassen
// (Maus ohne gedrückte Taste, Fenster verliert den Fokus oder wird verborgen). Kennt keine Profile.
import { setAttr } from './state.js';

export const LONG_PRESS_MS = 400;
export const MOVE_TOLERANCE_PX = 8;
export const EDGE_PX = 40; // Randzone oben und unten, in der der Baum mitscrollt
export const EDGE_STEP_PX = 12; // höchstens so viel je Bild

/** Was ein Druck auf den Griff gerade ist: 'wait' (offen), 'drag' (Ziehen beginnt) oder 'scroll' (bewegt, bevor das Halten reichte). */
export function pressState(pointerType, distance, heldMs) {
  const moved = distance > MOVE_TOLERANCE_PX;
  if (pointerType === 'mouse') return moved ? 'drag' : 'wait';
  return moved ? 'scroll' : heldMs >= LONG_PRESS_MS ? 'drag' : 'wait';
}

/** Scroll-Schritt je Bild für den Zeiger auf Höhe y im Baum (top … bottom): nach oben negativ, nach unten positiv, sonst 0. */
export function edgeStep(y, top, bottom) {
  const edge = Math.min(EDGE_PX, (bottom - top) / 3); // niedriger Baum: die Mitte bleibt frei
  const depth = y < top + edge ? top + edge - y : y > bottom - edge ? y - (bottom - edge) : 0;
  const step = Math.ceil(EDGE_STEP_PX * Math.min(1, depth / edge));
  return y < top + edge ? -step : step;
}

export function attachDrag(container, { canDrag, canDrop, onDrop, onCancel }) {
  let press = null; // { id, key, row, type, x, y, at, phase, lastX, lastY, over, timer, frame }
  let disarm = () => {}; // nimmt das Warten auf das Loslassen nach Esc zurück (swallowNextRelease)

  function down(e) {
    const row = e.target.closest?.('.drag-handle')?.closest('[data-key]');
    if (press || !row || !container.contains(row) || !e.isPrimary || e.button > 0 || !canDrag(row.dataset.key)) return;
    press = { id: e.pointerId, key: row.dataset.key, row, type: e.pointerType, x: e.clientX, y: e.clientY, at: performance.now(), phase: 'wait', lastX: e.clientX, lastY: e.clientY, over: null };
    try { e.target.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse haben keinen aktiven Zeiger */ }
    if (press.type !== 'mouse') press.timer = setTimeout(() => press?.phase === 'wait' && start(), LONG_PRESS_MS);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('keydown', key, true);
    addEventListener('blur', lost);
    document.addEventListener('visibilitychange', lost);
  }

  function start() {
    clearTimeout(press.timer);
    press.phase = 'drag';
    press.row.dataset.dragging = 'true';
    if (press.type !== 'mouse') navigator.vibrate?.(30); // das lange Drücken hat gegriffen
    aim();
    const tick = () => {
      const r = container.getBoundingClientRect();
      const step = edgeStep(press.lastY, r.top, r.bottom);
      const was = container.scrollTop;
      if (step) container.scrollTop += step;
      if (container.scrollTop !== was) aim(); // unter dem Zeiger liegt jetzt eine andere Zeile
      press.frame = requestAnimationFrame(tick);
    };
    press.frame = requestAnimationFrame(tick);
  }

  // Zeile unter dem Zeiger markieren (nur Zeilen dieses Baums)
  function aim() {
    const hit = document.elementFromPoint(press.lastX, press.lastY)?.closest('[data-key]');
    const row = hit && container.contains(hit) ? hit : null;
    if (row !== press.over) {
      press.over?.removeAttribute('data-drop');
      press.over = row;
      if (row) setAttr(row, 'data-drop', canDrop(press.key, row.dataset.key) ? 'ok' : 'no');
    }
  }

  function move(e) {
    if (e.pointerId !== press.id) return;
    if (press.type === 'mouse' && e.buttons === 0) { cancel(); return; } // das Loslassen kam nie an
    const dy = e.clientY - press.lastY;
    press.lastX = e.clientX;
    press.lastY = e.clientY;
    if (press.phase === 'wait') {
      const next = pressState(press.type, Math.hypot(e.clientX - press.x, e.clientY - press.y), performance.now() - press.at);
      if (next === 'scroll') { clearTimeout(press.timer); press.phase = 'scroll'; }
      if (next === 'drag') start();
    }
    if (press.phase === 'scroll') scrollBy(dy);
    else if (press.phase === 'drag') { e.preventDefault(); aim(); }
  }

  // der Finger schiebt den Inhalt; scrollt der Baum nicht (zu kurz oder am Ende), dann das Fenster (.pop) darum
  function scrollBy(dy) {
    const was = container.scrollTop;
    container.scrollTop -= dy;
    if (container.scrollTop === was) { const pop = container.closest('.pop'); if (pop) pop.scrollTop -= dy; }
  }

  function up(e) {
    if (e.pointerId !== press.id) return;
    if (press.phase === 'drag' && e.type === 'pointerup') {
      press.lastX = e.clientX;
      press.lastY = e.clientY;
      aim();
    }
    const { phase, key, over } = press;
    const ok = e.type === 'pointerup' && over?.dataset.drop === 'ok'; // vor finish(): das nimmt die Markierung weg
    finish();
    if (phase !== 'drag') return; // Tippen wählt über den Klick die Zeile, Scrollen tut sonst nichts
    swallowClick();
    if (ok) onDrop(key, over.dataset.key);
    else onCancel?.();
  }

  function key(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault(); // schließt sonst das Fenster
    e.stopPropagation();
    const { id, phase } = press;
    cancel();
    if (phase === 'drag') swallowNextRelease(id); // die Taste ist noch unten: ihr Klick käme sonst als Auswahl an
  }

  const lost = (e) => { if (e.type === 'blur' || document.hidden) cancel(); };

  // Abbruch ohne Wirkung; nur ein begonnenes Ziehen meldet onCancel
  function cancel() {
    const dragging = press.phase === 'drag';
    finish();
    if (dragging) onCancel?.();
  }

  // Markierungen weg, Zeitgeber und Zuhörer ab
  function finish() {
    clearTimeout(press.timer);
    cancelAnimationFrame(press.frame);
    press.row.removeAttribute('data-dragging');
    press.over?.removeAttribute('data-drop');
    press = null;
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    removeEventListener('keydown', key, true);
    removeEventListener('blur', lost);
    document.removeEventListener('visibilitychange', lost);
  }

  // der Klick nach dem Loslassen gehört zum Ziehen, nicht zur Zeile darunter
  function swallowClick() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', stop, true));
  }

  // nach Esc mitten im Ziehen: beim späteren Loslassen dieses Zeigers den Klick schlucken; ein neuer Druck verwirft das Warten
  function swallowNextRelease(id) {
    disarm();
    const types = ['pointerup', 'pointercancel', 'pointerdown'];
    const done = (e) => {
      if (e.type !== 'pointerdown' && e.pointerId !== id) return;
      if (e.type === 'pointerup') swallowClick();
      disarm();
    };
    for (const type of types) addEventListener(type, done, true);
    disarm = () => { for (const type of types) removeEventListener(type, done, true); disarm = () => {}; };
  }

  const menu = (e) => { if (e.target.closest?.('.drag-handle')) e.preventDefault(); }; // langes Drücken öffnet sonst das Kontextmenü
  container.addEventListener('pointerdown', down);
  container.addEventListener('contextmenu', menu);
  return () => {
    if (press) finish();
    disarm();
    container.removeEventListener('pointerdown', down);
    container.removeEventListener('contextmenu', menu);
  };
}
