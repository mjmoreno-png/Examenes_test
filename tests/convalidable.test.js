// Parte convalidable (p. ej. formulación) y respuestas numéricas con margen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fake-gas.js";
import { parseGift, toGift, convalidablePart } from "../js/gift.js";
import { gradeExam } from "../js/grading.js";
import { shortAnswerMatches, numericMargin } from "../js/short.js";

const plain = (x) => JSON.parse(JSON.stringify(x));

test("margen: relativo, absoluto, con unidad detrás y lo que no vale", () => {
  const rel = ["12,5 ±2%"];
  for (const g of ["12,5", "12.5", "12,3", "12,75", "12.5 g/L", "12,5g/L", "12,4 M", "12,5 %", "12,5."]) assert.equal(shortAnswerMatches(rel, g), true, g);
  for (const g of ["12,2", "12,8", "g/L 12,5", "12,5 3", "", "doce", "-12,5"]) assert.equal(shortAnswerMatches(rel, g), false, g);
  const abs = ["0,25 ±0,01"];
  for (const g of ["0,25", "0,26", "0.24", "0,255 mol/L"]) assert.equal(shortAnswerMatches(abs, g), true, g);
  for (const g of ["0,27", "0,23", ".25"]) assert.equal(shortAnswerMatches(abs, g), false, g);
  assert.equal(shortAnswerMatches(["50+-1%"], "50,5"), true, "+- en vez de ±");
  assert.equal(shortAnswerMatches(["50 +/- 1"], "51"), true, "+/-");
  assert.deepEqual(numericMargin("12,5 ±2%"), { valor: 12.5, margen: 2, relativo: true });
  assert.equal(numericMargin("12,5"), null);
  // sin margen, todo sigue igual: número exacto y sin unidad
  assert.equal(shortAnswerMatches(["12,5"], "12,5 g/L"), false);
  assert.equal(shortAnswerMatches(["12,5"], "12,50"), true);
});

test("margen: Code.gs compara igual que js/short.js", () => {
  const server = makeEnv().fn("shortAnswerMatches_");
  const answers = [["12,5 ±2%"], ["0,25 ±0,01"], ["50+-1%"], ["-3 ±0,5"], ["0 ±0,1"], ["NaCl"]];
  const given = ["12,5", "12.3", "12,8", "12,5 g/L", "0,26", "0.27 M", "50,5", "-3,4", "-2", "0,05", "0", "NaCl", "", "abc", "1e3"];
  for (const a of answers) for (const g of given) assert.equal(server(a, g), shortAnswerMatches(a, g), `${a} / ${g}`);
});

const GIFT = `::P01::[valor=2] Uno{=a~b~c~d}

::D01::[valor=2] Concentración en g/L{=12,5 ±2%}

::F01::[valor=0,5][convalidable=formulación] Fórmula del cloruro de sodio{=NaCl}

::F02::[convalidable=formulación][valor=0,5] Nombre de CaO{~a=b}`;

test("GIFT: [convalidable=nombre] antes o después del valor; una sola parte; nunca en abiertas", () => {
  const qs = parseGift(GIFT);
  assert.deepEqual(plain(qs.map((q) => [q.tipo, q.valor, q.convalidable ?? null, q.text])), [
    ["test", 2, null, "Uno"],
    ["corta", 2, null, "Concentración en g/L"],
    ["corta", 0.5, "formulación", "Fórmula del cloruro de sodio"],
    ["test", 0.5, "formulación", "Nombre de CaO"],
  ]);
  assert.deepEqual(convalidablePart(qs), { nombre: "formulación", n: 2, puntos: 1 });
  assert.deepEqual(parseGift(toGift(qs)), qs, "se exporta y se vuelve a leer igual");
  assert.equal(parseGift("[convalidable] A{=x}\n\nB{=y}")[0].convalidable, "");
  assert.throws(() => parseGift("[convalidable] A{}\n\nB{=y}"), /abierta no puede ser convalidable/);
  assert.throws(() => parseGift("[convalidable=a] A{=x}\n\n[convalidable=b] B{=y}\n\nC{=z}"), /una parte convalidable/);
  assert.throws(() => parseGift("[convalidable] A{=x}"), /Todas las preguntas son convalidables/);
});

test("gradeExam: con la parte convalidada suma sus puntos enteros, ignora lo contestado y no cuenta aciertos", () => {
  const qs = parseGift(GIFT);
  const ans = { q1: "a", q2: "12,4", q3: "nacl", q4: "a" };
  const sin = gradeExam(qs, ans, { penalty: { num: 1, den: 4 } });
  assert.deepEqual([sin.aciertos, sin.errores, sin.blancos, sin.puntos, sin.convalidadas, sin.nota], [2, 2, 0, 3.875, 0, 7.75]);
  const con = gradeExam(qs, ans, { penalty: { num: 1, den: 4 }, convalidada: true });
  assert.deepEqual([con.aciertos, con.errores, con.blancos, con.puntos, con.convalidadas, con.nota], [2, 0, 0, 5, 2, 10]);
});

function setup() {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Química", mostrar_nota: true, penalizacion: "1/4", preguntas: parseGift(GIFT + "\n\n::A01::Explica{}") });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { env, id: r.id };
}

const send = (env, id, envioId, extra) =>
  plain(env.post({ action: "submit", examId: id, nombre: "Ana", apellidos: envioId, grupo: "B", envioId, respuestas: { q1: "a", q2: "12,4 g/L", q3: "NaCl", q4: "a" }, ...extra }));

test("servidor: el alumno ve la parte (sin soluciones), la marca y se le dan sus puntos; queda en la hoja", () => {
  const { env, id } = setup();
  const got = plain(env.get({ action: "exam", id }));
  // antes del código de acceso el alumno ya sabe si hay parte convalidable (para la casilla de la portada)
  const coded = env.post({ action: "createExam", token: "secreto", titulo: "Con código", codigo_acceso: "abc", preguntas: parseGift(GIFT) });
  assert.deepEqual(plain(env.get({ action: "exam", id: coded.id })).info.convalidable, { nombre: "formulación", n: 2, puntos: 1 });
  assert.deepEqual(got.exam.questions.map((q) => q.convalidable ?? null), [null, null, "formulación", "formulación", null]);
  assert.ok(!JSON.stringify(got).includes("NaCl"));
  assert.ok(env.get({ action: "version" }).funciones.includes("convalidable"));

  const con = send(env, id, "e1", { convalidada: true });
  assert.deepEqual([con.aciertos, con.errores, con.blancos, con.puntos_test, con.convalidadas], [2, 0, 0, 5, 2]);
  const sin = send(env, id, "e2", { convalidada: false });
  assert.deepEqual([sin.aciertos, sin.errores, sin.puntos_test, sin.convalidadas], [3, 1, 4.38, undefined]);

  const sheet = env.results(id);
  const head = sheet.rows[0];
  assert.ok(head.indexOf("convalidada") < head.indexOf("aciertos"), "columna visible, junto a la nota");
  const cell = (row, name) => sheet.rows[row][head.indexOf(name)];
  assert.deepEqual([cell(1, "apellidos"), cell(1, "convalidada"), cell(2, "convalidada")], ["e1", "sí", ""]);
  assert.deepEqual(JSON.parse(cell(1, "respuestas_json")), { q1: "a", q2: "12,4 g/L" }, "lo de la parte convalidada se descarta");

  const res = plain(env.post({ action: "results", token: "secreto", examId: id }));
  assert.deepEqual(res.rows.map((r) => r.convalidada), [true, false]);
  assert.deepEqual(res.exam.convalidable, { nombre: "formulación", n: 2, puntos: 1 });
  assert.equal(plain(env.get({ action: "list", token: "secreto" })).exams[0].convalidable.n, 2);
});

test("servidor: convalidar en un examen sin parte convalidable no hace nada", () => {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "X", mostrar_nota: true, preguntas: parseGift("A{=a~b}\n\nB{=NaCl}") });
  const s = plain(env.post({ action: "submit", examId: r.id, nombre: "Ana", apellidos: "L", grupo: "B", respuestas: { q1: "a", q2: "NaCl" }, convalidada: true }));
  assert.equal(s.convalidadas, undefined);
  assert.ok(!env.results(r.id).rows[0].includes("convalidada"));
  assert.equal(env.post({ action: "convalidate", token: "secreto", examId: r.id, envioId: "x", convalidada: true }).error, "invalid_grade");
});

test("el profesor quita o da la convalidación: se recalcula la nota (con abiertas y correcciones a mano)", () => {
  const { env, id } = setup();
  send(env, id, "e1", { convalidada: true });
  const sheet = env.results(id);
  const cell = (name) => sheet.rows[1][sheet.rows[0].indexOf(name)];
  env.post({ action: "grade", token: "secreto", examId: id, envioId: "e1", qid: "q5", puntos: 1 });
  assert.equal(cell("nota"), 10); // 5 del test + 1 de la abierta sobre 6

  const quita = plain(env.post({ action: "convalidate", token: "secreto", examId: id, envioId: "e1", convalidada: false }));
  // sin la parte: test 2 + corta 2 = 4, las convalidables en blanco; + 1 de la abierta = 5 sobre 6
  assert.deepEqual([quita.ok, quita.convalidada, quita.aciertos, quita.errores, quita.blancos, quita.nota], [true, false, 2, 0, 2, 8.33]);
  assert.deepEqual([cell("convalidada"), cell("puntos_test"), cell("nota")], ["", 4, 8.33]);

  // una corrección a mano de una corta se mantiene con la parte convalidada
  env.post({ action: "grade", token: "secreto", examId: id, envioId: "e1", qid: "q2", correcta: false });
  const da = plain(env.post({ action: "convalidate", token: "secreto", examId: id, envioId: "e1", convalidada: true }));
  assert.deepEqual([da.aciertos, da.errores, da.nota], [1, 1, 6.67]); // 2 + 1 convalidada + 1 abierta = 4 sobre 6
  assert.equal(cell("convalidada"), "sí");

  // revisión: las convalidadas salen como tales, sin solución
  env.post({ action: "setReview", token: "secreto", id, revision: true });
  const rev = plain(env.post({ action: "review", examId: id, envioId: "e1" })).review;
  assert.deepEqual(rev.convalidada, { nombre: "formulación", n: 2, puntos: 1 });
  assert.deepEqual(rev.questions[2], { id: "q3", text: "Fórmula del cloruro de sodio", valor: 0.5, tipo: "corta", convalidada: true });

  assert.equal(env.post({ action: "convalidate", token: "mal", examId: id, envioId: "e1", convalidada: true }).error, "unauthorized");
  assert.equal(env.post({ action: "convalidate", token: "secreto", examId: id, envioId: "e1", convalidada: "sí" }).error, "invalid_grade");
  assert.equal(env.post({ action: "convalidate", token: "secreto", examId: id, envioId: "nada", convalidada: true }).error, "not_found");
});

test("validación en el servidor de la parte convalidable", () => {
  const env = makeEnv();
  const create = (preguntas) => env.post({ action: "createExam", token: "secreto", titulo: "X", preguntas });
  const base = { id: "q2", text: "B", tipo: "corta", respuestas: ["y"] };
  assert.equal(create([{ id: "q1", text: "A", tipo: "abierta", convalidable: "f" }, base]).error, "invalid_exam");
  assert.equal(create([{ id: "q1", text: "A", tipo: "corta", respuestas: ["x"], convalidable: "f" }, { ...base, convalidable: "g" }]).error, "invalid_exam");
  assert.equal(create([{ id: "q1", text: "A", tipo: "corta", respuestas: ["x"], convalidable: "f" }, { ...base, convalidable: "f" }]).error, "invalid_exam");
  assert.equal(create([{ id: "q1", text: "A", tipo: "corta", respuestas: ["x"], convalidable: 3 }, base]).error, "invalid_exam");
  assert.equal(create([{ id: "q1", text: "A", tipo: "corta", respuestas: ["x"], convalidable: "x".repeat(41) }, base]).error, "invalid_exam");
  assert.equal(create([{ id: "q1", text: "A", tipo: "corta", respuestas: ["x"], convalidable: " f " }, base]).ok, true);
});

test("CSV de notas: la columna «Convalidada» solo si el examen tiene parte convalidable", async () => {
  const { buildCsv } = await import("../js/correction.js");
  const rows = [{ apellidos: "López", nombre: "Ana", grupo: "B", nota: 7.5, aciertos: 3, errores: 1, blancos: 0, salidas: 0, segundos_fuera: 0, pegados: 0, convalidada: true }];
  const [head, line] = buildCsv(rows, false, true).replace(/^﻿/, "").split("\r\n");
  assert.equal(head.split(";")[4], "Convalidada");
  assert.equal(line.split(";")[4], "sí");
  assert.ok(!buildCsv(rows, false).includes("Convalidada"));
});

test("convalidable con varios cuadros y en modo práctica", () => {
  const gift = "::F01::[valor=0,2][convalidable=formulación] Fe2O3\nPrefijos: {=trióxido de dihierro}\nStock: {=óxido de hierro(III)}\n\nT{=a~b}";
  const qs = parseGift(gift);
  assert.equal(qs[0].convalidable, "formulación");
  assert.equal(qs[0].huecos.length, 2);
  assert.deepEqual(parseGift(toGift(qs)), qs);
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "P", practica: true, preguntas: qs });
  assert.equal(r.ok, true, JSON.stringify(r));
  const out = plain(env.post({ action: "submit", examId: r.id, nombre: "Ana", apellidos: "L", grupo: "B", respuestas: { q2: "a" }, convalidada: true }));
  assert.equal(out.practica, true);
  assert.equal(out.review.nota, 10);
  assert.equal(out.review.questions[0].convalidada, true);
});
