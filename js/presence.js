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
export function isReducedWindow({ innerWidth, innerHeight, screenWidth, screenHeight, coarse, typing = false, wasReduced = false }) {
  if (!coarse || typing) return false;
  if (!(Math.min(screenWidth, screenHeight) >= 600)) return false;
  if (!(innerWidth > 0 && innerHeight > 0 && screenWidth > 0 && screenHeight > 0)) return false;
  const ratio = (innerWidth * innerHeight) / (screenWidth * screenHeight);
  return ratio < (wasReduced ? RESTORED_RATIO : REDUCED_RATIO);
}
