// Máquina de estados de la vigilancia: decide cuándo una situación es una "salida" del examen.
// Función pura (el tiempo se recibe como parámetro): se prueba con líneas de tiempo simuladas.
//
// Fases:
//  - preparing: el examen acaba de abrirse y todavía no está bien colocado (por ejemplo, sin pantalla
//    completa). NO se penaliza nada; se pide al alumno que lo coloque. Pasa a "armed" cuando lleva
//    ARM_MS seguidos en buen estado.
//  - armed: vigilando. Una señal cuenta como salida si se mantiene más de su margen (GRACE_MS), para
//    no penalizar gestos naturales de la tableta (centro de control, barra de apps, giros...).
//  - away: el alumno está fuera. Vuelve cuando ya no hay ninguna señal activa.

/** Tiempo (ms) que debe mantenerse una señal para contar como salida. */
export const GRACE_MS = {
  hidden: 0, // la página no es visible: otra app, pestaña o pantalla bloqueada (en tabletas, ver student.js)
  reduced: 1500, // ventana reducida (pantalla dividida, Stage Manager)
  fullscreenLost: 5000, // salió de la pantalla completa (da tiempo a volver con un toque)
  blurred: 2000, // otra ventana activa
  noFocus: 2000, // document.hasFocus() en false
};

/** Orden de prioridad para decir cuál fue el motivo cuando varias señales coinciden. */
export const PRIORITY = ["hidden", "reduced", "fullscreenLost", "blurred", "noFocus"];

/** Tiempo seguido en buen estado antes de empezar a vigilar. */
export const ARM_MS = 1500;

/** Un hueco entre dos evaluaciones mayor que este indica que la página estuvo congelada (el temporizador va cada 500 ms). */
export const FROZEN_MS = 1000;

/**
 * @param {{grace?: Partial<typeof GRACE_MS>}} [options] márgenes propios (p. ej. más corto para la pantalla
 *   completa en ordenadores, donde salir de ella con Esc no es un gesto natural)
 */
export function createWatcher(options = {}) {
  const grace = { ...GRACE_MS, ...(options.grace ?? {}) };
  let armed = false;
  let okSince = 0;
  let away = null; // { reason, since }
  const since = {}; // señal -> instante en que se activó
  let lastNow = null;

  /**
   * @param {{hidden?:boolean, reduced?:boolean, fullscreenLost?:boolean, blurred?:boolean,
   *          noFocus?:boolean, needsFullscreen?:boolean}} inputs
   * @param {number} now milisegundos
   * @returns {{phase:'preparing'|'armed'|'away', coverReason:null|'prepare'|'away',
   *            leave?:{reason:string, since:number}, back?:{awayMs:number, reason:string}}}
   */
  function update(inputs, now) {
    let missed = null; // señal que superó su margen mientras la página estaba congelada (iPad en segundo plano)
    const frozen = lastNow !== null && now - lastNow >= FROZEN_MS;
    lastNow = now;
    for (const name of PRIORITY) {
      if (inputs[name]) since[name] = since[name] ?? now;
      else {
        if (frozen && armed && !away && !missed && since[name] !== undefined && now - since[name] >= grace[name]) {
          missed = { reason: name, since: since[name] };
        }
        delete since[name];
      }
    }
    const active = PRIORITY.filter((n) => since[n] !== undefined);

    // Al volver de otra app, el iPad reanuda la página sin que el temporizador haya corrido mientras
    // tanto: la salida se cuenta ahora, con su duración real.
    if (missed) {
      if (active.length > 0) {
        away = missed;
        return { phase: "away", coverReason: "away", leave: missed };
      }
      return { phase: "armed", coverReason: null, leave: missed, back: { awayMs: now - missed.since, reason: missed.reason } };
    }

    if (!armed) {
      const ok = active.length === 0 && !inputs.needsFullscreen;
      if (!ok) {
        okSince = 0;
        return { phase: "preparing", coverReason: "prepare" };
      }
      okSince = okSince || now;
      if (now - okSince >= ARM_MS) armed = true;
      return { phase: armed ? "armed" : "preparing", coverReason: armed ? null : null };
    }

    if (away) {
      if (active.length === 0) {
        const back = { awayMs: now - away.since, reason: away.reason };
        away = null;
        return { phase: "armed", coverReason: null, back };
      }
      return { phase: "away", coverReason: "away" };
    }

    const persistent = PRIORITY.find((n) => since[n] !== undefined && now - since[n] >= grace[n]);
    if (persistent) {
      away = { reason: persistent, since: since[persistent] };
      return { phase: "away", coverReason: "away", leave: { reason: persistent, since: since[persistent] } };
    }
    return { phase: "armed", coverReason: null };
  }

  return { update, isArmed: () => armed, isAway: () => away !== null };
}
