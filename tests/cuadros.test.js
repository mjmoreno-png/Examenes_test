// Respuesta corta con varios cuadros (p. ej. nombrar por prefijos y por Stock): GIFT, corrección todo o nada y servidor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fake-gas.js";
import { parseGift, toGift } from "../js/gift.js";
import { gradeExam } from "../js/grading.js";
import { BLANK, blankLabels, shortAllCorrect, shortIsBlank } from "../js/short.js";

const plain = (x) => JSON.parse(JSON.stringify(x));

const GIFT = `::F01::Fe2O3
Prefijos: {=trióxido de dihierro}
Stock: {=óxido de hierro(III)}

::F02::Nombra en tradicional el HNO3{=ácido nítrico}

::F03::[valor=2] trióxido de azufre
Fórmula: {=SO3} Stock: {=óxido de azufre(VI)}`;

test("GIFT: varios { } en una pregunta = un cuadro por bloque, con su etiqueta", () => {
  const [f1, f2, f3] = parseGift(GIFT);
  assert.equal(f1.tipo, "corta");
  assert.equal(f1.text, `Fe2O3\nPrefijos: ${BLANK}\nStock: ${BLANK}`);
  assert.deepEqual(f1.huecos, [["trióxido de dihierro"], ["óxido de hierro(III)"]]);
  assert.equal(f1.respuestas, undefined);
  assert.deepEqual(blankLabels(f1.text), ["Prefijos", "Stock"]);
  assert.deepEqual([f2.respuestas, f2.huecos], [["ácido nítrico"], undefined], "un solo bloque: como siempre");
  assert.deepEqual([f3.valor, blankLabels(f3.text)], [2, ["Fórmula", "Stock"]], "dos cuadros en la misma línea");
  assert.deepEqual(parseGift(toGift(parseGift(GIFT))), parseGift(GIFT), "ida y vuelta");
  assert.deepEqual(blankLabels(`${BLANK} y ${BLANK}`), ["Cuadro 1", "y"]);
});

test("GIFT: con varios cuadros, cada uno solo admite respuestas con =", () => {
  assert.throws(() => parseGift("X\nA: {=a}\nB: {}"), /cuadro 2/);
  assert.throws(() => parseGift("X\nA: {=a}\nB: {=b ~c}"), /cuadro 2/);
  assert.throws(() => parseGift("X\nA: {=a}\nB: {=b"), /llave de cierre/);
  assert.throws(() => parseGift(`X ${"{=a} ".repeat(11)}`), /máximo 10/);
});

test("todo o nada: solo es acierto si todos los cuadros están bien; en blanco si no rellena ninguno", () => {
  const [f1] = parseGift(GIFT);
  assert.equal(shortAllCorrect(f1, ["Trióxido de dihierro", "óxido de hierro (III)"]), true);
  assert.equal(shortAllCorrect(f1, ["trióxido de dihierro", "óxido de hierro(II)"]), false);
  assert.equal(shortAllCorrect(f1, ["trióxido de dihierro", ""]), false);
  assert.equal(shortIsBlank(f1, ["", "  "]), true);
  assert.equal(shortIsBlank(f1, null), true);

  const qs = parseGift(GIFT);
  const r = gradeExam(qs, { q1: ["trióxido de dihierro", "óxido de hierro(III)"], q2: "ácido nitroso", q3: ["SO3", null] });
  // F01 bien (1), F02 mal (otro ácido), F03 mal (un cuadro vacío): 1 de 4 puntos
  assert.deepEqual([r.aciertos, r.errores, r.blancos, r.puntos, r.nota], [1, 2, 0, 1, 2.5]);
  assert.equal(gradeExam(qs, { q1: ["", ""], q3: null }).blancos, 3);
  assert.equal(gradeExam(qs, { q3: ["SO3", "x"] }, { shortOverrides: { q3: true } }).puntos, 2, "corrección a mano de la pregunta entera");
  assert.throws(() => gradeExam(qs, { q1: "trióxido de dihierro" }), /no válida/, "con varios cuadros la respuesta es una lista");
  assert.throws(() => gradeExam(qs, { q2: ["ácido nítrico"] }), /no válida/, "con un cuadro, un texto");
  assert.throws(() => gradeExam(qs, { q1: ["a", "b", "c"] }), /no válida/, "más textos que cuadros");
});

function setup() {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Formulación", mostrar_nota: true, preguntas: parseGift(GIFT) });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { env, id: r.id };
}
const submit = (env, id, respuestas, extra = {}) =>
  env.post({ action: "submit", examId: id, nombre: "Ana", apellidos: "López", grupo: "4B", envioId: "e1", respuestas, ...extra });

test("el alumno recibe el enunciado con las marcas, pero nunca las respuestas de los cuadros", () => {
  const { env, id } = setup();
  const got = env.get({ action: "exam", id });
  const f1 = got.exam.questions[0];
  assert.equal(f1.text.split(BLANK).length - 1, 2);
  const json = JSON.stringify(got);
  assert.ok(!json.includes("dihierro") && !json.includes("huecos") && !json.includes("SO3\""), json);
  assert.ok(env.get({ action: "version" }).funciones.includes("cuadros"));
});

test("envío, corrección en el servidor, revisión por cuadro y corrección a mano", () => {
  const { env, id } = setup();
  const sub = plain(submit(env, id, { q1: ["  trióxido   de dihierro ", "óxido de hierro(III)"], q2: "ácido nítrico", q3: ["SO3", "óxido de azufre(IV)"] }));
  assert.deepEqual([sub.aciertos, sub.errores, sub.nota], [2, 1, 5]);
  const rows = env.results(id).rows;
  assert.deepEqual(JSON.parse(rows[1][rows[0].indexOf("respuestas_json")]).q1, ["trióxido de dihierro", "óxido de hierro(III)"], "se guarda limpio");

  const res = plain(env.post({ action: "results", token: "secreto", examId: id }));
  assert.deepEqual(res.exam.preguntas[2].huecos, [["SO3"], ["óxido de azufre(VI)"]]);
  assert.deepEqual(res.exam.preguntas[2].etiquetas, ["Fórmula", "Stock"]);
  assert.deepEqual(res.rows[0].cortas.q3, { texto: "Fórmula: SO3\nStock: óxido de azufre(IV)", auto: false, manual: null });

  env.post({ action: "setReview", token: "secreto", id, revision: true });
  const rev = plain(env.post({ action: "review", examId: id, envioId: "e1" })).review.questions[2];
  assert.equal(rev.acertada, false);
  assert.deepEqual(rev.cuadros.map((c) => [c.etiqueta, c.respuesta, c.acertada]), [["Fórmula", "SO3", true], ["Stock", "óxido de azufre(IV)", false]]);
  assert.deepEqual(rev.cuadros[1].correctas, ["óxido de azufre(VI)"]);

  const g = plain(env.post({ action: "grade", token: "secreto", examId: id, envioId: "e1", qid: "q3", correcta: true }));
  assert.deepEqual([g.ok, g.acertada, g.aciertos, g.nota], [true, true, 3, 10]);
});

test("validación: forma de la respuesta y de las preguntas", () => {
  const { env, id } = setup();
  assert.equal(submit(env, id, { q1: "trióxido de dihierro" }).error, "invalid_answers", "un texto donde van varios");
  assert.equal(submit(env, id, { q1: ["a", "b", "c"] }).error, "invalid_answers", "más textos que cuadros");
  assert.equal(submit(env, id, { q1: [5, "b"] }).error, "invalid_answers");
  assert.equal(submit(env, id, { q1: ["x".repeat(201), "b"] }).error, "invalid_answers");
  assert.equal(submit(env, id, { q2: ["ácido nítrico"] }).error, "invalid_answers", "una lista donde va un texto");
  assert.equal(submit(env, id, { q1: ["trióxido de dihierro", null] }).ok, true);

  const create = (q) => env.post({ action: "createExam", token: "secreto", titulo: "X", preguntas: [{ id: "q1", tipo: "corta", ...q }] });
  assert.equal(create({ text: `A ${BLANK} B ${BLANK}`, huecos: [["a"]] }).error, "invalid_exam", "marcas y cuadros no coinciden");
  assert.equal(create({ text: `A ${BLANK}`, huecos: [["a"]] }).error, "invalid_exam", "al menos 2 cuadros");
  assert.equal(create({ text: `A ${BLANK} B ${BLANK}`, huecos: [["a"], []] }).error, "invalid_exam");
  assert.equal(create({ text: `A ${BLANK}`, respuestas: ["a"] }).error, "invalid_exam", "una marca sin huecos");
  assert.equal(env.post({ action: "createExam", token: "secreto", titulo: "X", preguntas: [{ id: "q1", text: `A ${BLANK}`, options: [{ id: "a", text: "x" }, { id: "b", text: "y" }], correct: "a" }] }).error, "invalid_exam");
  assert.equal(create({ text: `A ${BLANK} B ${BLANK}`, huecos: [["a"], ["b"]] }).ok, true);
});
