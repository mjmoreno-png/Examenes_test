// Preguntas de respuesta corta: comparación, GIFT y servidor (Code.gs simulado).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fake-gas.js";
import { parseGift } from "../js/gift.js";
import { gradeExam } from "../js/grading.js";
import { caseMatters, shortAnswerMatches } from "../js/short.js";

const plain = (x) => JSON.parse(JSON.stringify(x));

test("caseMatters: fórmulas y símbolos sí; palabras normales no", () => {
  for (const a of ["NaCl", "CO2", "H2O", "Fe", "C", "pH", "Na Cl"]) assert.equal(caseMatters(a), true, a);
  for (const a of ["oxígeno", "Oxígeno", "Ley de Ohm", "cloruro de sodio", "12,5", ""]) assert.equal(caseMatters(a), false, a);
});

test("shortAnswerMatches: lo que vale y lo que no", () => {
  const nacl = ["NaCl"];
  for (const g of ["NaCl", " NaCl ", "NaCl.", "Na Cl"]) assert.equal(shortAnswerMatches(nacl, g), true, g);
  for (const g of ["nacl", "NACL", "KCl", "", "NaCl2"]) assert.equal(shortAnswerMatches(nacl, g), false, g);
  assert.equal(shortAnswerMatches(["H2O"], "H₂O"), true, "subíndices");
  assert.equal(shortAnswerMatches(["CO"], "Co"), false, "monóxido de carbono no es cobalto");
  const palabra = ["cloruro de sodio", "cloruro sódico"];
  for (const g of ["Cloruro de sodio", "CLORURO  DE SODIO", "Cloruro Sódico."]) assert.equal(shortAnswerMatches(palabra, g), true, g);
  // las tildes no cuentan; las demás letras, sí
  assert.equal(shortAnswerMatches(palabra, "cloruro sodico"), true);
  for (const g of ["clorurodesodio", "cloruro de sodo"]) assert.equal(shortAnswerMatches(palabra, g), false, g);
  assert.equal(shortAnswerMatches(["Oxígeno"], "oxígeno"), true);
  assert.equal(shortAnswerMatches(["Oxígeno"], "oxigeno"), true);
  assert.equal(shortAnswerMatches(["sulfato de sodio"], "sulfito de sodio"), false, "una letra cambia el compuesto");
  assert.equal(shortAnswerMatches(["hidróxido de estaño(IV)"], "hidroxido de estano(iv)"), true, "ni tildes ni eñes");
  assert.equal(shortAnswerMatches(["oxígeno"], "oxi\u0301geno"), true, "tilde compuesta o precompuesta");
  assert.equal(shortAnswerMatches(["0,5"], "0.5"), true);
  assert.equal(shortAnswerMatches(["0,5"], ".5"), false);
  assert.equal(shortAnswerMatches(["12"], "12,0"), true);
});

test("nomenclatura: mayúsculas solo en los símbolos de las fórmulas, sin tildes, y espacios junto a paréntesis", () => {
  const fe = ["óxido de hierro(III)", "trióxido de dihierro"];
  for (const g of ["óxido de hierro(III)", "Óxido de hierro(III)", "óxido de hierro (III)", "ÓXIDO DE HIERRO(III)", "Trióxido de dihierro.", "óxido de hierro( III )",
    "óxido de hierro(iii)", "oxido de hierro(III)", "OXIDO DE HIERRO(iii)", "trioxido de dihierro"]) assert.equal(shortAnswerMatches(fe, g), true, g);
  for (const g of ["óxido de hierro(3)", "óxido de hierro III", "óxido de hierro(II)", "óxido de hierro(ii)"]) assert.equal(shortAnswerMatches(fe, g), false, g);
  // en las fórmulas, un símbolo de una letra entre paréntesis no es un número romano
  assert.equal(shortAnswerMatches(["Ca(OH)2"], "Ca(oh)2"), false);
  for (const g of ["CaCl2", "CaCl₂", "Ca Cl2"]) assert.equal(shortAnswerMatches(["CaCl2"], g), true, g);
  for (const g of ["cacl2", "CACL2", "Cacl2", "CaCl"]) assert.equal(shortAnswerMatches(["CaCl2"], g), false, g);
  assert.equal(caseMatters("óxido de hierro(III)"), false);
  assert.equal(caseMatters("Fe(OH)3"), true);
  assert.equal(caseMatters("dicloruro de calcio"), false);
});

test("Code.gs compara igual que js/short.js", () => {
  const server = makeEnv().fn("shortAnswerMatches_");
  const answers = [["NaCl"], ["óxido de hierro(III)", "trióxido de dihierro"], ["cloruro de sodio"], ["0,5"], ["Oxígeno"], ["H2O"], ["pH"]];
  const given = ["NaCl", "nacl", "Na Cl", "óxido de hierro (III)", "Óxido de hierro(iii)", "TRIÓXIDO DE DIHIERRO", "cloruro de sodio.", "Cloruro de Sodio", "0.5", "oxígeno", "H₂O", "PH", "ph", "", "  "];
  for (const a of answers) for (const g of given) assert.equal(server(a, g), shortAnswerMatches(a, g), `${a} / ${g}`);
});

test("GIFT: solo respuestas con = es respuesta corta; con ~ sigue siendo test", () => {
  const qs = parseGift("::C1::[valor=0,5] Fórmula del cloruro de sodio{=NaCl}\n\n::C2::Nombre de NaCl{=cloruro de sodio =cloruro sódico#bien =cloruro de sodio}\n\nT{=a~b}");
  assert.deepEqual(plain(qs.map((q) => [q.tipo, q.respuestas, q.options.length, q.valor])), [
    ["corta", ["NaCl"], 0, 0.5],
    ["corta", ["cloruro de sodio", "cloruro sódico"], 0, 1],
    ["test", null, 2, 1],
  ]);
  assert.throws(() => parseGift("A{=x =}"), /Pregunta 1.*vacía/);
  assert.throws(() => parseGift(`A{${Array.from({ length: 21 }, (_, i) => `=r${i}`).join(" ")}}`), /Pregunta 1.*demasiadas/);
});

test("gradeExam: acierto suma, error no resta, vacío es en blanco", () => {
  const qs = parseGift("A{=NaCl}\n\nB{=a~b~c~d}\n\nC{=agua}\n\nD{=CO2}");
  const r = gradeExam(qs, { q1: "Na Cl", q2: "a", q3: "fuego", q4: "   " }, { penalty: { num: 1, den: 3 } });
  assert.deepEqual([r.aciertos, r.errores, r.blancos, r.puntos, r.nota], [2, 1, 1, 2, 5]);
  assert.throws(() => gradeExam(qs, { q1: 3 }), /no válida/);
  // corrección a mano: manda sobre la automática; las en blanco siguen en blanco
  const m = gradeExam(qs, { q1: "ClNa", q3: "agua", q4: "" }, { shortOverrides: { q1: true, q3: false, q4: true } });
  assert.deepEqual([m.aciertos, m.errores, m.blancos], [1, 1, 2]);
});

const GIFT = `::T1::Uno{=a~b~c~d}

::C1::[valor=2] Fórmula del cloruro de sodio{=NaCl}

::C2::Nombre del H2O{=agua =monóxido de dihidrógeno}

::A1::Explica algo{}`;

function setup() {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Química", mostrar_nota: true, preguntas: parseGift(GIFT) });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { env, id: r.id };
}

test("el alumno recibe el tipo pero nunca las respuestas aceptadas", () => {
  const { env, id } = setup();
  const got = env.get({ action: "exam", id });
  assert.deepEqual(plain(got.exam.questions.map((q) => q.tipo)), ["test", "corta", "corta", "abierta"]);
  const json = JSON.stringify(got);
  assert.ok(!json.includes("NaCl") && !json.includes("agua") && !json.includes("respuestas"), json);
  assert.ok(env.get({ action: "version" }).funciones.includes("cortas"));
});

test("envío: se corrige solo en el servidor y queda en la hoja", () => {
  const { env, id } = setup();
  const sub = plain(env.post({ action: "submit", examId: id, nombre: "Ana", apellidos: "López", grupo: "B", envioId: "e1", respuestas: { q1: "b", q2: "  Na Cl ", q3: "Agua" }, abiertas: { q4: "x" } }));
  // test: error (−1/3); cortas: 2 + 1 → 3 − 1/3 = 2,67 sobre 4 de la parte corregida sola
  assert.deepEqual([sub.aciertos, sub.errores, sub.blancos, sub.puntos_test, sub.puntos_test_max], [2, 1, 0, 2.67, 4]);
  const rows = env.results(id).rows;
  assert.equal(JSON.parse(rows[1][rows[0].indexOf("respuestas_json")]).q2, "Na Cl");

  // validación: no texto, demasiado largo
  const bad = (respuestas) => env.post({ action: "submit", examId: id, nombre: "Eva", apellidos: "Ruiz", grupo: "B", respuestas });
  assert.equal(bad({ q2: 5 }).error, "invalid_answers");
  assert.equal(bad({ q2: "x".repeat(201) }).error, "invalid_answers");
});

test("revisión: el alumno ve lo que escribió, si acertó y las respuestas aceptadas", () => {
  const { env, id } = setup();
  env.post({ action: "submit", examId: id, nombre: "Ana", apellidos: "López", grupo: "B", envioId: "e1", respuestas: { q1: "a", q2: "nacl", q3: null } });
  env.post({ action: "setReview", token: "secreto", id, revision: true });
  const rev = plain(env.post({ action: "review", examId: id, envioId: "e1" })).review;
  const [, c1, c2] = rev.questions;
  assert.deepEqual([c1.tipo, c1.respuesta, c1.acertada, c1.correctas], ["corta", "nacl", false, ["NaCl"]]);
  assert.deepEqual([c2.respuesta, c2.acertada], [null, false]);
});

test("validación de preguntas de respuesta corta en el servidor", () => {
  const env = makeEnv();
  const create = (q) => env.post({ action: "createExam", token: "secreto", titulo: "X", preguntas: [{ id: "q1", text: "¿?", ...q }] });
  assert.equal(create({ tipo: "corta", respuestas: [] }).error, "invalid_exam");
  assert.equal(create({ tipo: "corta", respuestas: [" "] }).error, "invalid_exam");
  assert.equal(create({ tipo: "corta", respuestas: ["a"], options: [{ id: "a", text: "a" }] }).error, "invalid_exam");
  assert.equal(create({ tipo: "corta", respuestas: ["NaCl"] }).ok, true);
});

test("corrección a mano de una respuesta corta: recalcula la nota; null vuelve a la automática", () => {
  const { env, id } = setup();
  env.post({ action: "submit", examId: id, nombre: "Ana", apellidos: "López", grupo: "B", envioId: "e1", respuestas: { q1: "a", q2: "ClNa", q3: "agua" }, abiertas: { q4: "x" } });
  const rows = () => env.results(id).rows;
  const c = (name) => rows()[1][rows()[0].indexOf(name)];
  assert.deepEqual([c("aciertos"), c("errores"), c("puntos_test")], [2, 1, 2]);

  const res = plain(env.post({ action: "results", token: "secreto", examId: id }));
  assert.deepEqual(res.rows[0].cortas.q2, { texto: "ClNa", auto: false, manual: null });
  assert.deepEqual(res.rows[0].cortas.q3, { texto: "agua", auto: true, manual: null });
  assert.deepEqual(res.exam.preguntas[1].respuestas, ["NaCl"]);
  assert.equal(res.rows[0].pendientes, 1, "las cortas no quedan pendientes");

  const g = plain(env.post({ action: "grade", token: "secreto", examId: id, envioId: "e1", qid: "q2", correcta: true }));
  assert.deepEqual([g.ok, g.correcta, g.acertada, g.aciertos, g.errores], [true, true, true, 3, 0]);
  assert.deepEqual([c("aciertos"), c("errores"), c("puntos_test"), c("cortas_manual")], [3, 0, 4, '{"q2":true}']);
  env.post({ action: "grade", token: "secreto", examId: id, envioId: "e1", qid: "q4", puntos: 1 });
  assert.equal(c("nota"), 10); // 4 del test + 1 de la abierta sobre 5
  assert.equal(plain(env.post({ action: "results", token: "secreto", examId: id })).rows[0].cortas.q2.manual, true);

  // la revisión del alumno respeta la corrección a mano
  env.post({ action: "setReview", token: "secreto", id, revision: true });
  assert.equal(plain(env.post({ action: "review", examId: id, envioId: "e1" })).review.questions[1].acertada, true);

  const back = plain(env.post({ action: "grade", token: "secreto", examId: id, envioId: "e1", qid: "q2", correcta: null }));
  assert.deepEqual([back.acertada, back.aciertos, c("cortas_manual"), c("nota")], [false, 2, "", 6]);

  // marcar mal una respuesta que la máquina dio por buena
  env.post({ action: "grade", token: "secreto", examId: id, envioId: "e1", qid: "q3", correcta: false });
  assert.equal(c("aciertos"), 1);
  assert.equal(env.post({ action: "grade", token: "secreto", examId: id, envioId: "e1", qid: "q3", correcta: "sí" }).error, "invalid_grade");
  assert.equal(env.post({ action: "grade", token: "mal", examId: id, envioId: "e1", qid: "q3", correcta: true }).error, "unauthorized");
  assert.equal(env.get({ action: "list", token: "secreto" }).exams[0].n_cortas, 2);
});

test("instrucciones del examen: se guardan limpias y el alumno las recibe con el examen (tras el código)", () => {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Formulación", codigo_acceso: "abc", instrucciones: "  Números romanos en MAYÚSCULAS.\r\n\r\n\r\n\r\nSin espacio antes del paréntesis.  ", preguntas: parseGift("A{=NaCl}") });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(env.get({ action: "exam", id: r.id }).info.instrucciones, undefined, "no antes del código");
  assert.equal(env.get({ action: "exam", id: r.id, code: "abc" }).exam.instrucciones, "Números romanos en MAYÚSCULAS.\n\nSin espacio antes del paréntesis.");
  const long = env.post({ action: "createExam", token: "secreto", titulo: "X", instrucciones: "x".repeat(3000), preguntas: parseGift("A{=NaCl}") });
  assert.equal(env.get({ action: "exam", id: long.id }).exam.instrucciones.length, 2000);
  const none = env.post({ action: "createExam", token: "secreto", titulo: "Y", preguntas: parseGift("A{=NaCl}") });
  assert.equal(env.get({ action: "exam", id: none.id }).exam.instrucciones, "");
  assert.ok(env.get({ action: "version" }).funciones.includes("instrucciones"));
});

test("exportExam: con el token devuelve las preguntas con soluciones, que se convierten en el mismo GIFT", async () => {
  const { toGift } = await import("../js/gift.js");
  const env = makeEnv();
  const preguntas = parseGift(GIFT);
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Química", instrucciones: "Lee bien", preguntas });
  assert.equal(env.post({ action: "exportExam", token: "mal", examId: r.id }).error, "unauthorized");
  assert.equal(env.post({ action: "exportExam", token: "secreto", examId: "nada" }).error, "not_found");
  const res = plain(env.post({ action: "exportExam", token: "secreto", examId: r.id }));
  assert.deepEqual([res.titulo, res.instrucciones], ["Química", "Lee bien"]);
  assert.deepEqual(parseGift(toGift(res.preguntas)), preguntas);
  assert.ok(env.get({ action: "version" }).funciones.includes("exportar"));
});

test("exportExam: devuelve el GIFT original tal como se publicó; sin él (exámenes anteriores) va vacío", () => {
  const env = makeEnv();
  const original = "// mis comentarios\n" + GIFT;
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Química", gift: original, preguntas: parseGift(original) });
  assert.equal(env.post({ action: "exportExam", token: "secreto", examId: r.id }).gift, original);
  const viejo = env.post({ action: "createExam", token: "secreto", titulo: "Viejo", preguntas: parseGift(GIFT) });
  assert.equal(env.post({ action: "exportExam", token: "secreto", examId: viejo.id }).gift, "");
  const grande = env.post({ action: "createExam", token: "secreto", titulo: "Grande", gift: "x".repeat(60000), preguntas: parseGift(GIFT) });
  assert.equal(env.post({ action: "exportExam", token: "secreto", examId: grande.id }).gift, "");
  const formula = env.post({ action: "createExam", token: "secreto", titulo: "F", gift: "=raro{=a~b}", preguntas: parseGift(GIFT) });
  assert.equal(env.post({ action: "exportExam", token: "secreto", examId: formula.id }).gift, "\n=raro{=a~b}");
});

test("hojas con columnas añadidas al final: se colocan en su sitio del diseño sin perder datos", () => {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", titulo: "Química", preguntas: parseGift(GIFT) });
  const sheet = env.results(r.id);
  const design = [...sheet.rows[0]];
  // como una hoja de una versión anterior: sin las columnas nuevas, que luego se añadieron al final
  const late = ["desconexiones", "segundos_sin_conexion", "cortas_manual"];
  const old = design.filter((h) => !late.includes(h));
  sheet.rows = [[...old, ...late]];
  env.post({ action: "submit", examId: r.id, nombre: "Ana", apellidos: "López", grupo: "B", envioId: "e1", respuestas: { q2: "NaCl" }, desconexiones: 2, segundos_sin_conexion: 9 });
  assert.deepEqual([...sheet.rows[0]], design, "las columnas quedan en el orden del diseño");
  const cellOf = (name) => sheet.rows[1][sheet.rows[0].indexOf(name)];
  assert.deepEqual([cellOf("apellidos"), cellOf("desconexiones"), cellOf("segundos_sin_conexion"), cellOf("aciertos")], ["López", 2, 9, 1]);
  // y siguen funcionando la corrección a mano y la lectura de resultados
  env.post({ action: "grade", token: "secreto", examId: r.id, envioId: "e1", qid: "q3", correcta: true });
  assert.equal(cellOf("cortas_manual"), '{"q3":true}');
  assert.deepEqual([...sheet.rows[0]], design);
  assert.equal(plain(env.post({ action: "results", token: "secreto", examId: r.id })).rows[0].desconexiones, 2);

  // una columna que añada el profesor no se pierde: queda al final
  sheet.rows[0].push("mis notas");
  sheet.rows[1].push("revisar");
  sheet.rows[0] = [...sheet.rows[0].slice(0, 5), "segundos_sin_conexion", ...sheet.rows[0].slice(5).filter((h) => h !== "segundos_sin_conexion")];
  sheet.rows[1] = sheet.rows[0].map((h) => (h === "mis notas" ? "revisar" : h === "segundos_sin_conexion" ? 9 : null));
  env.fn("setup")();
  assert.deepEqual([...sheet.rows[0]], [...design, "mis notas"]);
  assert.equal(sheet.rows[1][sheet.rows[0].indexOf("mis notas")], "revisar");
  assert.equal(sheet.rows[1][sheet.rows[0].indexOf("segundos_sin_conexion")], 9);
});
