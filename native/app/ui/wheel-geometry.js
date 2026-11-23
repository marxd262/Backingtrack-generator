// Akkordrad als reine Geometrie: Knotenpositionen und Trefferprüfung, ohne DOM. Welcher Akkord an welchem Knoten liegt, gibt derived().wheel
// (die Knoten in der Reihenfolge dieses Layouts: außen 0..11, dann innen 0..11).

// Anteile von size: Ringradien und Knotenradien, so dass sich keine zwei Knoten berühren
const OUTER = 0.4;
const INNER = 0.25;
const OUTER_NODE = 0.06;
const INNER_NODE = 0.055;

/**
 * Knoten des Rads für ein Quadrat der Kantenlänge size: je Ring zwölf, ab 12 Uhr im Uhrzeigersinn (außen der Quintenzirkel ab C, innen die
 * Moll-Parallelen).
 * @returns {{ size, cx, cy, outerRadius, innerRadius, nodes: { ring: 'outer'|'inner', index, x, y, r }[] }}
 */
export function layoutWheel(size) {
  const c = size / 2;
  const ring = (name, radius, r) => Array.from({ length: 12 }, (_, index) => {
    const a = ((index * 30 - 90) * Math.PI) / 180;
    return { ring: name, index, x: c + radius * Math.cos(a), y: c + radius * Math.sin(a), r: r * size };
  });
  return {
    size, cx: c, cy: c, outerRadius: OUTER * size, innerRadius: INNER * size,
    nodes: [...ring('outer', OUTER * size, OUTER_NODE), ...ring('inner', INNER * size, INNER_NODE)],
  };
}

/** Knoten unter dem Punkt (x, y) oder null. */
export const hitTest = (layout, x, y) => layout.nodes.find((n) => (x - n.x) ** 2 + (y - n.y) ** 2 <= n.r ** 2) ?? null;
