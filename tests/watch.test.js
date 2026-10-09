import { test } from "node:test";
import assert from "node:assert/strict";
import { createWatcher, ARM_MS, GRACE_MS } from "../js/watch.js";

// Ayudante: avanza el tiempo en pasos de 100 ms con unas entradas dadas y devuelve los eventos.
function run(w, inputs, fromMs, toMs, step = 100) {
  const events = [];
  let last;
  for (let t = fromMs; t <= toMs; t += step) {
    last = w.update(typeof inputs === "function" ? inputs(t) : inputs, t);
    if (last.leave) events.push({ t, leave: last.leave });
    if (last.back) events.push({ t, back: last.back });
  }
  return { events, last };
}
const armedWatcher = () => {
  const w = createWatcher();
  const { last } = run(w, {}, 0, ARM_MS + 200);
  assert.equal(last.phase, "armed");
  return w;
};
const T0 = ARM_MS + 300; // instante tras armar

test("empieza en buen estado: se arma tras el margen y no genera salidas", () => {
  const w = createWatcher();
  const { events, last } = run(w, {}, 0, 5000);
  assert.deepEqual(events, []);
  assert.equal(last.phase, "armed");
  assert.equal(last.coverReason, null);
});

test("empezar SIN pantalla completa no penaliza: muestra 'prepare' y se arma al colocarlo", () => {
  const w = createWatcher();
  let r = run(w, { needsFullscreen: true }, 0, 6000);
  assert.deepEqual(r.events, []);
  assert.equal(r.last.phase, "preparing");
  assert.equal(r.last.coverReason, "prepare");
  // el alumno pasa a pantalla completa
  r = run(w, {}, 6100, 6100 + ARM_MS + 200);
  assert.deepEqual(r.events, []);
  assert.equal(r.last.phase, "armed");
});

test("empezar con la ventana reducida tampoco penaliza", () => {
  const w = createWatcher();
  const r = run(w, { reduced: true }, 0, 10000);
  assert.deepEqual(r.events, []);
  assert.equal(r.last.coverReason, "prepare");
});

test("el margen para armar se reinicia si el estado bueno se interrumpe", () => {
  const w = createWatcher();
  run(w, {}, 0, ARM_MS - 300);
  run(w, { reduced: true }, ARM_MS - 200, ARM_MS + 100);
  const r = run(w, {}, ARM_MS + 200, ARM_MS + 200 + ARM_MS - 300);
  assert.equal(r.last.phase, "preparing");
});

test("hidden cuenta al instante", () => {
  const w = armedWatcher();
  const r = run(w, { hidden: true }, T0, T0);
  assert.equal(r.events[0].leave.reason, "hidden");
});

test("un parpadeo de foco o de ventana reducida más corto que su margen no cuenta", () => {
  const w = armedWatcher();
  let r = run(w, { blurred: true }, T0, T0 + GRACE_MS.blurred - 200);
  assert.deepEqual(r.events, []);
  r = run(w, {}, T0 + GRACE_MS.blurred, T0 + 3000);
  assert.deepEqual(r.events, []);
  r = run(w, { reduced: true }, T0 + 4000, T0 + 4000 + GRACE_MS.reduced - 200);
  assert.deepEqual(r.events, []);
});

test("una señal que se mantiene cuenta al superar el margen, con el instante en que empezó", () => {
  const w = armedWatcher();
  const r = run(w, { reduced: true }, T0, T0 + 4000);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].leave.reason, "reduced");
  assert.equal(r.events[0].leave.since, T0);
  assert.equal(r.events[0].t - T0, GRACE_MS.reduced);
  assert.equal(r.last.coverReason, "away");
});

test("salir de la pantalla completa: 3 s no cuenta (gesto natural), 6 s sí", () => {
  const w = armedWatcher();
  let r = run(w, { fullscreenLost: true }, T0, T0 + 3000);
  assert.deepEqual(r.events, []);
  r = run(w, {}, T0 + 3100, T0 + 4000);
  assert.deepEqual(r.events, []);
  r = run(w, { fullscreenLost: true }, T0 + 5000, T0 + 11000);
  assert.equal(r.events[0].leave.reason, "fullscreenLost");
});

test("la vuelta se produce cuando no queda ninguna señal, con el tiempo fuera", () => {
  const w = armedWatcher();
  run(w, { reduced: true, blurred: true }, T0, T0 + 4000);
  // se arregla una señal, sigue la otra: continúa fuera
  let r = run(w, { blurred: true }, T0 + 4100, T0 + 5000);
  assert.equal(r.last.phase, "away");
  r = run(w, {}, T0 + 5100, T0 + 5100);
  assert.equal(r.events[0].back.reason, "reduced");
  assert.equal(r.events[0].back.awayMs, 5100);
  assert.equal(r.last.phase, "armed");
});

test("el motivo es la señal de mayor prioridad cuando coinciden", () => {
  const w = armedWatcher();
  const r = run(w, { noFocus: true, blurred: true, reduced: true }, T0, T0 + 3000);
  assert.equal(r.events[0].leave.reason, "reduced");
});

test("tras volver sigue vigilando y una segunda salida cuenta de nuevo", () => {
  const w = armedWatcher();
  let r = run(w, { hidden: true }, T0, T0 + 200);
  r = run(w, {}, T0 + 300, T0 + 300);
  assert.equal(r.events[0].back.awayMs > 0, true);
  r = run(w, { hidden: true }, T0 + 1000, T0 + 1000);
  assert.equal(r.events[0].leave.reason, "hidden");
});

test("mientras está fuera no se generan salidas repetidas", () => {
  const w = armedWatcher();
  const r = run(w, { reduced: true }, T0, T0 + 20000);
  assert.equal(r.events.filter((e) => e.leave).length, 1);
});

test("márgenes personalizados: en ordenadores la pantalla completa perdida cuenta antes", () => {
  const w = createWatcher({ grace: { fullscreenLost: 1500 } });
  run(w, {}, 0, ARM_MS + 200);
  const r = run(w, { fullscreenLost: true }, T0, T0 + 2000);
  assert.equal(r.events[0].leave.reason, "fullscreenLost");
  assert.equal(r.events[0].t - T0, 1500);
});

test("iPad: un instante oculta dentro del margen (gesto del sistema al desplazarse) no cuenta", () => {
  const w = createWatcher({ grace: { hidden: 2000 } });
  run(w, {}, 0, ARM_MS + 200);
  const r = run(w, { hidden: true }, T0, T0 + 600);
  const r2 = run(w, {}, T0 + 700, T0 + 3000);
  assert.deepEqual([...r.events, ...r2.events], []);
});

test("página congelada en segundo plano: al volver se cuenta la salida con su duración real", () => {
  const w = createWatcher({ grace: { hidden: 2000 } });
  run(w, {}, 0, ARM_MS + 200);
  w.update({ hidden: true }, T0); // se oculta y el temporizador deja de correr
  const r = w.update({}, T0 + 30000); // vuelve 30 s después
  assert.deepEqual(r.leave, { reason: "hidden", since: T0 });
  assert.equal(r.back.awayMs, 30000);
  assert.equal(r.phase, "armed");
});

test("congelada y al volver sigue otra señal activa: queda fuera hasta que se resuelva", () => {
  const w = createWatcher({ grace: { hidden: 2000 } });
  run(w, {}, 0, ARM_MS + 200);
  w.update({ hidden: true }, T0);
  let r = w.update({ reduced: true }, T0 + 10000);
  assert.equal(r.leave.reason, "hidden");
  assert.equal(r.phase, "away");
  r = w.update({}, T0 + 12000);
  assert.equal(r.back.awayMs, 12000);
});
