import { test } from "node:test";
import assert from "node:assert/strict";
import { isReducedWindow } from "../js/presence.js";

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
