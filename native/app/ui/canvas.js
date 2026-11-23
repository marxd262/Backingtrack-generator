// Canvas scharf für devicePixelRatio: Pufferpixel = CSS-Pixel * dpr, gezeichnet wird in CSS-Pixeln.
export function fitCanvas(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null; // versteckt: nichts zu zeichnen
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

// Farben und Schrift kommen aus den CSS-Variablen, damit die Optik nur in app.css steht
export function cssColors(canvas) {
  const css = getComputedStyle(canvas);
  const v = (name) => css.getPropertyValue(name).trim();
  return { ink: v('--ink'), inkSoft: v('--ink-soft'), paper: v('--paper'), accent: v('--accent'), accent2: v('--accent2'), diatonic: v('--wheel-grey'), mono: v('--mono'), lcd: v('--lcd'), lcdInk: v('--lcd-ink'), lcdInk2: v('--lcd-ink-2'), onAccent: v('--on-accent'), staff: v('--staff'), font: css.fontFamily };
}
