import { test } from "node:test";
import assert from "node:assert/strict";
import { isReducedWindow, mouseExitZone, trackLargest } from "../js/presence.js";

// iPad Air 11" en horizontal: pantalla 1180x820. Safari a pantalla completa deja ~ 1180x700.
const ipad = { screenWidth: 1180, screenHeight: 820, coarse: true };

test("iPad a pantalla completa no se considera reducido", () => {
  assert.equal(isReducedWindow({ ...ipad, innerWidth: 1180, innerHeight: 700 }), false);
  assert.equal(isReducedWindow({ ...ipad, innerWidth: 1180, innerHeight: 640 }), false); // con barra de pestañas y marcadores
});

test("pantalla dividida a la mitad, a un tercio y a dos tercios sí", () => {
  assert.equal(isReducedWindow({ ...ipad, innerWidth: 590, innerHeight: 700 }), true);
  assert.equal(isReducedWindow({ ...ipad, innerWidth: 390, innerHeight: 700 }), true);
  assert.equal(isReducedWindow({ ...ipad, innerWidth: 790, innerHeight: 700 }), true);
});

test("girar el iPad no cuenta como reducido", () => {
  assert.equal(isReducedWindow({ screenWidth: 820, screenHeight: 1180, coarse: true, innerWidth: 820, innerHeight: 1060 }), false);
});

test("no se aplica en ordenadores ni en móviles", () => {
  assert.equal(isReducedWindow({ screenWidth: 1920, screenHeight: 1080, coarse: false, innerWidth: 800, innerHeight: 600 }), false);
  assert.equal(isReducedWindow({ screenWidth: 390, screenHeight: 844, coarse: true, innerWidth: 390, innerHeight: 600 }), false);
});

test("valores raros no provocan falsos positivos", () => {
  assert.equal(isReducedWindow({ ...ipad, innerWidth: 0, innerHeight: 0 }), false);
  assert.equal(isReducedWindow({ screenWidth: NaN, screenHeight: NaN, coarse: true, innerWidth: 500, innerHeight: 500 }), false);
});

test("histéresis: una vez reducida, hace falta recuperar más para considerarla restaurada", () => {
  // proporción 0,78: por encima de 0,75 (no se reduce), por debajo de 0,82 (no se restaura)
  const w = { ...ipad, innerWidth: 1180, innerHeight: Math.round(0.78 * 820) };
  assert.equal(isReducedWindow({ ...w, wasReduced: false }), false);
  assert.equal(isReducedWindow({ ...w, wasReduced: true }), true);
});

test("el teclado en pantalla al escribir no cuenta como ventana reducida", () => {
  const keyboard = { ...ipad, innerWidth: 1180, innerHeight: 380 };
  assert.equal(isReducedWindow({ ...keyboard, typing: true }), false);
  assert.equal(isReducedWindow({ ...keyboard, typing: true, wasReduced: true }), false);
  assert.equal(isReducedWindow({ ...ipad, innerWidth: 590, innerHeight: 700, typing: false }), true);
});

test("salida del ratón: por un borde o por el centro de la página", () => {
  const page = { width: 1408, height: 881 };
  assert.equal(mouseExitZone({ ...page, x: 700, y: 400 }), "center");
  assert.equal(mouseExitZone({ ...page, x: 700, y: 0 }), "edge"); // barra de menús
  assert.equal(mouseExitZone({ ...page, x: 700, y: 879 }), "edge"); // Dock
  assert.equal(mouseExitZone({ ...page, x: 1405, y: 400 }), "edge");
  assert.equal(mouseExitZone({ ...page, x: 3, y: 400 }), "edge");
  assert.equal(mouseExitZone({ ...page, x: -20, y: 400 }), "edge"); // ya fuera de la página
  assert.equal(mouseExitZone({ ...page, x: NaN, y: 400 }), "edge"); // sin posición: no se supone nada raro
});

test("iPad que da el tamaño de la ventana como tamaño de pantalla: se compara con la ventana más grande vista", () => {
  // Registro real: a media pantalla, screen también decía 585x688 (proporción 1.00).
  let largest = null;
  largest = trackLargest(largest, 1180, 688); // empieza a pantalla completa
  largest = trackLargest(largest, 1180, 376); // teclado: no reduce la referencia
  assert.deepEqual(largest, { width: 1180, height: 688 });
  const tab = { coarse: true };
  assert.equal(isReducedWindow({ ...tab, innerWidth: 585, innerHeight: 688, screenWidth: 585, screenHeight: 688 }), false, "sin referencia no se ve");
  assert.equal(isReducedWindow({ ...tab, innerWidth: 585, innerHeight: 688, screenWidth: 585, screenHeight: 688, largest }), true, "media pantalla");
  assert.equal(isReducedWindow({ ...tab, innerWidth: 767, innerHeight: 688, screenWidth: 767, screenHeight: 688, largest }), true, "dos tercios");
  assert.equal(isReducedWindow({ ...tab, innerWidth: 1180, innerHeight: 688, screenWidth: 1180, screenHeight: 688, largest }), false, "completa");
  assert.equal(isReducedWindow({ ...tab, innerWidth: 820, innerHeight: 1050, screenWidth: 820, screenHeight: 1050, largest }), false, "girado a vertical, completa");
  assert.equal(isReducedWindow({ ...tab, innerWidth: 585, innerHeight: 688, screenWidth: 1180, screenHeight: 820, largest }), true, "iPad que da bien la pantalla: igual que antes");
  assert.equal(trackLargest(largest, 0, 0), largest);
});
