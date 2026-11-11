// Modo práctica: el alumno repite cuantas veces quiera y ve al momento sus fallos; nada se guarda en la hoja.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fake-gas.js";
import { parseGift } from "../js/gift.js";

const plain = (x) => JSON.parse(JSON.stringify(x));
const GIFT = `::T1::Uno{=a~b~c~d}

::C1::Fe2O3
Prefijos: {=trióxido de dihierro}
Stock: {=óxido de hierro(III)}

::C2::Nombra el HNO3{=ácido nítrico}

::A1::Explica algo{}`;

function setup(extra = {}) {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Práctica", control_salidas: true, pantalla_completa: true, practica: true, preguntas: parseGift(GIFT), ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { env, id: r.id, created: r };
}
const submit = (env, id, extra = {}) =>
  env.post({ action: "submit", examId: id, nombre: "Ana", apellidos: "López", grupo: "4B", envioId: "e1",
    respuestas: { q1: "b", q2: ["trioxido de dihierro", "oxido de hierro(iii)"], q3: null }, abiertas: { q4: "porque sí" }, ...extra });

test("se publica sin vigilancia ni pantalla completa, y el alumno y la lista lo saben", () => {
  const { env, id, created } = setup();
  assert.deepEqual([created.practica, created.pantalla_completa], [true, false]);
  const got = env.get({ action: "exam", id });
  assert.deepEqual([got.exam.practica, got.exam.control_salidas, got.exam.pantalla_completa], [true, false, false]);
  const ex = env.get({ action: "list", token: "secreto" }).exams[0];
  assert.deepEqual([ex.practica, ex.control_salidas], [true, false]);
  assert.ok(env.get({ action: "version" }).funciones.includes("practica"));
  // con código de acceso, la pantalla inicial ya sabe que es una práctica
  const { env: env2, id: id2 } = setup({ codigo_acceso: "abc" });
  assert.equal(env2.get({ action: "exam", id: id2 }).info.practica, true);
});

test("al enviar: corrección al momento con las soluciones, y nada en la hoja", () => {
  const { env, id } = setup();
  const res = plain(submit(env, id));
  assert.equal(res.ok, true);
  assert.equal(res.practica, true);
  const r = res.review;
  assert.deepEqual([r.titulo, r.nombre, r.apellidos, r.practica], ["Práctica", "Ana", "López", true]);
  assert.deepEqual([r.aciertos, r.errores, r.blancos], [1, 1, 1]);
  assert.equal(r.nota, 1.67); // (1 − 1/3 del test fallado) de 4 puntos; la abierta cuenta 0
  const [t1, c1, c2, a1] = r.questions;
  assert.deepEqual([t1.respuesta, t1.correcta], ["b", "a"]);
  assert.deepEqual([c1.acertada, c1.cuadros.map((c) => c.acertada)], [true, [true, true]]);
  assert.deepEqual([c2.respuesta, c2.correctas], [null, ["ácido nítrico"]]);
  assert.deepEqual([a1.tipo, a1.respuesta, a1.puntos], ["abierta", "porque sí", null]);
  // ninguna fila en la hoja de resultados: los intentos no se guardan
  assert.equal(env.results(id).rows.length, 1);
  assert.equal(env.get({ action: "list", token: "secreto" }).exams[0].envios, 0);
});

test("se puede repetir: cada intento se corrige aparte, aunque traiga el mismo identificador", () => {
  const { env, id } = setup();
  assert.equal(plain(submit(env, id)).review.aciertos, 1);
  const second = plain(submit(env, id, { respuestas: { q1: "a", q2: ["trióxido de dihierro", "óxido de hierro(III)"], q3: "ácido nítrico" } }));
  assert.deepEqual([second.review.aciertos, second.review.nota], [3, 7.5]);
  assert.equal(env.results(id).rows.length, 1);
});

test("la práctica valida las respuestas igual que un examen y respeta que esté cerrado", () => {
  const { env, id } = setup();
  assert.equal(submit(env, id, { respuestas: { q1: "z" } }).error, "invalid_answers");
  env.post({ action: "setActive", token: "secreto", id, activo: false });
  assert.equal(submit(env, id).error, "closed");
});

test("un examen normal sigue igual: guarda la fila y no devuelve las soluciones", () => {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Normal", mostrar_nota: true, preguntas: parseGift(GIFT) });
  const res = plain(submit(env, r.id));
  assert.equal(res.practica, undefined);
  assert.equal(res.review, undefined);
  assert.ok(!JSON.stringify(res).includes("trióxido"));
  assert.equal(env.results(r.id).rows.length, 2);
});

test("convertir en práctica un examen ya hecho, y volver a examen, sin tocar las notas guardadas", () => {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Real", control_salidas: true, preguntas: parseGift(GIFT) });
  const id = r.id;
  assert.equal(submit(env, id).ok, true);
  assert.equal(env.results(id).rows.length, 2, "el examen real guarda su fila");

  assert.equal(env.post({ action: "setPractice", token: "mal", id, practica: true }).error, "unauthorized");
  assert.equal(env.post({ action: "setPractice", token: "secreto", id: "nada", practica: true }).error, "not_found");
  assert.equal(env.post({ action: "setPractice", token: "secreto", id, practica: true }).practica, true);
  assert.equal(env.get({ action: "list", token: "secreto" }).exams[0].practica, true);
  assert.equal(env.get({ action: "exam", id }).exam.practica, true);

  const res = plain(submit(env, id, { envioId: "e2" }));
  assert.equal(res.practica, true);
  assert.equal(res.review.questions[0].correcta, "a", "en práctica, la corrección al momento");
  assert.equal(env.results(id).rows.length, 2, "la práctica no añade filas ni toca la nota guardada");

  assert.equal(env.post({ action: "setPractice", token: "secreto", id, practica: false }).practica, false);
  const ex = env.get({ action: "exam", id }).exam;
  assert.deepEqual([ex.practica, ex.control_salidas], [false, true], "vuelve a ser examen, con su vigilancia");
  assert.equal(plain(submit(env, id, { envioId: "e3", nombre: "Eva" })).review, undefined);
  assert.equal(env.results(id).rows.length, 3);
  assert.ok(env.get({ action: "version" }).funciones.includes("convertir_practica"));
});
