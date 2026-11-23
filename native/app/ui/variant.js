// Variantennummern 1..9999; vor und zurück springen am Rand auf die andere Seite
export const stepVariant = (seed, dir) => ((seed - 1 + dir + 9999) % 9999) + 1;
