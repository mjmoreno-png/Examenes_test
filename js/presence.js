// Señales para saber si el alumno sigue en la pantalla del examen. Funciones puras (sin DOM).

/** Una ventana es "reducida" si ocupa mucho menos que la pantalla: pantalla dividida, Slide Over, Stage Manager. */
export const REDUCED_RATIO = 0.75;
/** Una vez reducida, la ventana debe recuperar este valor para considerarse restaurada (evita rebotes). */
export const RESTORED_RATIO = 0.82;

/**
 * Solo se aplica en tabletas (puntero táctil y lado corto de pantalla >= 600 px), porque en
 * ordenadores las ventanas no maximizadas son normales y en móviles las barras del navegador
 * recortan mucho la altura.
 * Un iPad a pantalla completa ocupa ~85-95 % de la pantalla; la mitad o dos tercios, ~45-62 %.
 * Mientras el alumno escribe (typing), el teclado en pantalla encoge la ventana: no cuenta. Si en ese
 * momento cambia de app o toca otra ventana, lo detectan las señales de foco y de página oculta.
 */
export function isReducedWindow({ innerWidth, innerHeight, screenWidth, screenHeight, coarse, typing = false, wasReduced = false, largest = null }) {
  if (!coarse || typing) return false;
  // Algunos iPad (iPadOS con ventanas) dan como tamaño de pantalla el de la ventana: en pantalla dividida la
  // ventana parecería ocupar toda la pantalla. Se compara también con la ventana más grande vista en el examen.
  if (largest && largest.width * largest.height > screenWidth * screenHeight) {
    screenWidth = largest.width;
    screenHeight = largest.height;
  }
  if (!(Math.min(screenWidth, screenHeight) >= 600)) return false;
  if (!(innerWidth > 0 && innerHeight > 0 && screenWidth > 0 && screenHeight > 0)) return false;
  const ratio = (innerWidth * innerHeight) / (screenWidth * screenHeight);
  return ratio < (wasReduced ? RESTORED_RATIO : REDUCED_RATIO);
}

/** Distancia (px) al borde de la página por debajo de la cual una salida del ratón se considera por el borde. */
export const MOUSE_EDGE_PX = 8;

/**
 * ¿Por dónde ha salido el ratón de la página? "edge" si estaba junto a un borde (movimiento normal del ratón,
 * o la barra de menús y el Dock en la pantalla completa del Mac); "center" si estaba lejos de todos: el ratón
 * no se ha movido, es la ventana la que se ha ido de debajo (p. ej. gesto de cambio de escritorio a medias).
 */
export function mouseExitZone({ x, y, width, height }) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return "edge";
  const d = Math.min(x, y, width - x, height - y);
  return d <= MOUSE_EDGE_PX ? "edge" : "center";
}

/** Guarda la ventana más grande vista (por área) para usarla como referencia de pantalla completa. */
export function trackLargest(largest, width, height) {
  if (!(width > 0 && height > 0)) return largest;
  return !largest || width * height > largest.width * largest.height ? { width, height } : largest;
}
