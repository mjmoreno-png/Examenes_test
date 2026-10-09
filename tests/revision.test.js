// Revisión del examen para el alumno: servidor (Code.gs simulado).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fake-gas.js";
import { parseGift } from "../js/gift.js";

const GIFT = `::T1::[valor=2] Uno{=a~b~c~d}

::T2::Dos{~a=b~c~d}

::T3::Tres{~a~b=c~d}

::A1::[valor=3] Explica la fotosíntesis{}`;
const plain = (x) => JSON.parse(JSON.stringify(x));

function setup() {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Repaso", mostrar_nota: false, preguntas: parseGift(GIFT) });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = r.id;
  const sent = env.post({
    action: "submit", examId: id, nombre: "Ana", apellidos: "López", grupo: "B", envioId: "env-ana",
    respuestas: { q1: "a", q2: "c", q3: null }, abiertas: { q4: "Con luz" },
  });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  return { env, id };
}

test("la revisión está oculta al publicar y la lista lo indica", () => {
  const { env, id } = setup();
  const res = env.post({ action: "review", examId: id, envioId: "env-ana" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "review_closed");
  assert.equal(env.get({ action: "list", token: "secreto" }).exams[0].revision, false);
  assert.ok(env.get({ action: "version" }).funciones.includes("revision"));
});

test("publicar la revisión exige el token", () => {
  const { env, id } = setup();
  assert.equal(env.post({ action: "setReview", token: "mal", id, revision: true }).error, "unauthorized");
  assert.equal(env.post({ action: "review", examId: id, envioId: "env-ana" }).error, "review_closed");
});

test("publicada: el alumno ve sus respuestas, las correctas y su nota, aunque el examen esté cerrado", () => {
  const { env, id } = setup();
  assert.equal(env.post({ action: "setReview", token: "secreto", id, revision: true }).revision, true);
  env.post({ action: "setActive", token: "secreto", id, activo: false });
  assert.equal(env.get({ action: "list", token: "secreto" }).exams[0].revision, true);

  const res = plain(env.post({ action: "review", examId: id, envioId: "env-ana" }));
  assert.equal(res.ok, true, JSON.stringify(res));
  const r = res.review;
  assert.equal(r.titulo, "Repaso");
  assert.deepEqual([r.nombre, r.apellidos], ["Ana", "López"]);
  assert.deepEqual([r.aciertos, r.errores, r.blancos], [1, 1, 1]);
  const [q1, q2, q3, q4] = r.questions;
  assert.deepEqual([q1.respuesta, q1.correcta, q1.valor], ["a", "a", 2]);
  assert.deepEqual([q2.respuesta, q2.correcta], ["c", "b"]);
  assert.deepEqual([q3.respuesta, q3.correcta], [null, "c"]);
  assert.equal(q1.options.length, 4);
  assert.deepEqual([q4.tipo, q4.respuesta, q4.puntos, q4.valor], ["abierta", "Con luz", null, 3]);

  // Al corregir la abierta, la revisión muestra los puntos y la nota final.
  env.post({ action: "grade", token: "secreto", examId: id, envioId: "env-ana", qid: "q4", puntos: 2 });
  const after = plain(env.post({ action: "review", examId: id, envioId: "env-ana" })).review;
  assert.equal(after.questions[3].puntos, 2);
  assert.equal(typeof after.nota, "number");
});

test("solo se ve el propio envío: un identificador desconocido o vacío no devuelve nada", () => {
  const { env, id } = setup();
  env.post({ action: "setReview", token: "secreto", id, revision: true });
  assert.equal(env.post({ action: "review", examId: id, envioId: "otro" }).error, "send_not_found");
  assert.equal(env.post({ action: "review", examId: id, envioId: "" }).error, "bad_request");
  assert.equal(env.post({ action: "review", examId: id }).error, "bad_request");
  assert.equal(env.post({ action: "review", examId: "nada", envioId: "env-ana" }).error, "not_found");
});

test("ocultar de nuevo la revisión la cierra", () => {
  const { env, id } = setup();
  env.post({ action: "setReview", token: "secreto", id, revision: true });
  env.post({ action: "setReview", token: "secreto", id, revision: false });
  assert.equal(env.post({ action: "review", examId: id, envioId: "env-ana" }).error, "review_closed");
});

test("exámenes publicados antes de la columna revision: setup la rellena con FALSO", () => {
  const { env, id } = setup();
  const sh = env.sheets.get("Examenes");
  const col = sh.rows[0].indexOf("revision");
  const row = sh.rows.find((r) => String(r[0]) === String(id));
  row.length = col; // como una fila de una versión anterior, sin la columna
  env.fn("setup")();
  assert.equal(row[col], false);
  assert.equal(env.get({ action: "list", token: "secreto" }).exams[0].revision, false);
});
