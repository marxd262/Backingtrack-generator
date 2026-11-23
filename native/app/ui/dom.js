// Small DOM helpers of every building block (they were state.js's in the web app).
export const $ = (id) => document.getElementById(id);
// Only on a change: render() runs per beat and per answer, the same value must not mutate the DOM (nor be announced)
export const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
export const setAttr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
export const pressed = (el, on) => setAttr(el, 'aria-pressed', String(on));
