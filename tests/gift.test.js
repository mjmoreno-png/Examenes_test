import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGift, parseValue, GiftError } from "../js/gift.js";

const SAMPLE = `// comentario
::P01::¿Qué nos convierte en científicos?{
=El modo en que buscamos respuestas
~%-33.33333%Trabajar en un laboratorio
~Usar fórmulas matemáticas
~Tener un título universitario
}

// otro comentario
::P02::2 + 2 = ?{
~3
=4
~5
}
`;

test("parsea el ejemplo del enunciado", () => {
  const qs = parseGift(SAMPLE);
  assert.equal(qs.length, 2);
  assert.deepEqual(qs[0], {
    id: "q1",
    title: "P01",
    text: "¿Qué nos convierte en científicos?",
    options: [
      { id: "a", text: "El modo en que buscamos respuestas" },
      { id: "b", text: "Trabajar en un laboratorio" },
      { id: "c", text: "Usar fórmulas matemáticas" },
      { id: "d", text: "Tener un título universitario" },
    ],
    correct: "a",
    valor: 1,
    tipo: "test",
  });
  assert.equal(qs[1].correct, "b");
  assert.equal(qs[1].options.length, 3);
});

test("el título es opcional", () => {
  const [q] = parseGift("Capital de Francia{=París ~Roma}");
  assert.equal(q.title, "");
  assert.equal(q.text, "Capital de Francia");
  assert.equal(q.correct, "a");
});

test("ignora los pesos %...%", () => {
  const [q] = parseGift("P{=%100%Sí ~%-50%No ~%-50%Quizá}");
  assert.deepEqual(q.options.map((o) => o.text), ["Sí", "No", "Quizá"]);
});

test("procesa los escapes", () => {
  const [q] = parseGift("::T\\:1::¿Es \\{x\\} \\= 1\\~2?{=Sí \\# claro ~No\\:}");
  assert.equal(q.title, "T:1");
  assert.equal(q.text, "¿Es {x} = 1~2?");
  assert.equal(q.options[0].text, "Sí # claro");
  assert.equal(q.options[1].text, "No:");
});

test("descarta el feedback #...", () => {
  const [q] = parseGift("P{=Sí#Muy bien ~No#Mal}");
  assert.deepEqual(q.options.map((o) => o.text), ["Sí", "No"]);
});

test("acepta CRLF y BOM", () => {
  const qs = parseGift("﻿::A::Uno{=x~y}\r\n\r\n::B::Dos{~x=y}\r\n");
  assert.equal(qs.length, 2);
  assert.equal(qs[1].correct, "b");
});

test("enunciado multilínea", () => {
  const [q] = parseGift("::A::Línea uno\nlínea dos{\n=x\n~y\n}");
  assert.equal(q.text, "Línea uno\nlínea dos");
});

test("error si no hay respuesta correcta, con número de pregunta", () => {
  const src = "A{=x~y}\n\nB{~x~y}";
  assert.throws(
    () => parseGift(src),
    (e) => e instanceof GiftError && /Pregunta 2.*exactamente una/.test(e.message)
  );
});

test("error si hay más de una correcta", () => {
  assert.throws(() => parseGift("A{=x=y~z}"), /Pregunta 1.*tiene 2/);
});

test("error si hay menos de 2 opciones", () => {
  assert.throws(() => parseGift("A{~x}"), /Pregunta 1.*al menos 2/);
});

test("error si falta el bloque de respuestas o el cierre", () => {
  assert.throws(() => parseGift("Solo texto"), /Pregunta 1.*bloque de respuestas/);
  assert.throws(() => parseGift("A{=x~y"), /Pregunta 1.*cierre/);
});

test("recoge todos los errores a la vez", () => {
  try {
    parseGift("A{~x}\n\nB{=x~y}\n\nC{~x~y}");
    assert.fail("debía fallar");
  } catch (e) {
    assert.equal(e.errors.length, 2);
    assert.match(e.errors[0], /Pregunta 1/);
    assert.match(e.errors[1], /Pregunta 3/);
  }
});

test("error si no hay preguntas", () => {
  assert.throws(() => parseGift("// solo comentarios\n"), GiftError);
  assert.throws(() => parseGift(""), GiftError);
});

/* ---------------- valor de cada pregunta y preguntas abiertas ---------------- */

test("sin marca, cada pregunta vale 1", () => {
  const qs = parseGift("A{=x~y}\n\nB{=x~y}");
  assert.deepEqual(qs.map((q) => q.valor), [1, 1]);
});

test("[valor=N] al principio del enunciado, con título o sin él", () => {
  const qs = parseGift("::P1::[valor=2] ¿Cuánto es 1+1?{=2~3}\n\n[valor=0,5] Sin título{=a~b}\n\n::P3::  [valor = 1/4]   Con espacios{=a~b}");
  assert.deepEqual(qs.map((q) => q.valor), [2, 0.5, 0.25]);
  assert.equal(qs[0].text, "¿Cuánto es 1+1?", "la marca no queda en el enunciado");
  assert.equal(qs[1].text, "Sin título");
  assert.equal(qs[2].text, "Con espacios");
});

test("[puntos=N] y [valor: N] también valen; mayúsculas y decimales con punto", () => {
  const qs = parseGift("[PUNTOS=1.5] A{=x~y}\n\n[Valor: 3] B{=x~y}");
  assert.deepEqual(qs.map((q) => q.valor), [1.5, 3]);
});

test("una marca que no está al principio es texto normal", () => {
  const [q] = parseGift("Explica qué significa [valor=2] en física{=x~y}");
  assert.equal(q.valor, 1);
  assert.equal(q.text, "Explica qué significa [valor=2] en física");
});

test("valores no válidos se rechazan indicando la pregunta", () => {
  for (const bad of ["0", "-1", "abc", "", "1/0", "101", "2,5,5"]) {
    assert.throws(() => parseGift(`[valor=${bad}] A{=x~y}`), /Pregunta 1: el valor/, bad);
  }
});

test("parseValue", () => {
  assert.equal(parseValue("2"), 2);
  assert.equal(parseValue("0,25"), 0.25);
  assert.equal(parseValue("1/3"), 0.3333);
  assert.equal(parseValue(" 10 "), 10);
  assert.throws(() => parseValue("0"));
});

test("llaves vacías = pregunta abierta", () => {
  const [q] = parseGift("::P7::[valor=3] Explica por qué flota un barco.{}");
  assert.deepEqual(q, { id: "q1", title: "P7", text: "Explica por qué flota un barco.", options: [], correct: null, valor: 3, tipo: "abierta" });
  assert.equal(parseGift("Abierta{ }")[0].tipo, "abierta");
  assert.equal(parseGift("Abierta{\n}")[0].tipo, "abierta");
});

test("abierta con imagen y texto después de la llave", () => {
  const [q] = parseGift("Observa ![fig](f.png) y explica{} (máx. 5 líneas)");
  assert.equal(q.tipo, "abierta");
  assert.equal(q.text, "Observa ![fig](f.png) y explica (máx. 5 líneas)");
});

test("preguntas test y abiertas mezcladas; los errores de test siguen indicando su número", () => {
  const qs = parseGift("A{=x~y}\n\n[valor=2] B{}\n\nC{=x~y}");
  assert.deepEqual(qs.map((q) => q.tipo), ["test", "abierta", "test"]);
  assert.throws(() => parseGift("A{=x~y}\n\nB{}\n\nC{~x~y}"), /Pregunta 3.*exactamente una/);
});

test("una pregunta con contenido sin = ni ~ sigue siendo un error (no se toma por abierta)", () => {
  assert.throws(() => parseGift("A{texto suelto}"), /Pregunta 1.*al menos 2 opciones/);
});

test("toGift: parseGift lee lo exportado exactamente igual (test, corta, abierta, valores y caracteres especiales)", async () => {
  const { toGift } = await import("../js/gift.js");
  const src = `${SAMPLE}

::C1::[valor=0,5] Fórmula de la sal{=NaCl =ClNa}

::A1::[valor=2,25] Explica: ¿por qué \\{a\\} \\= b?\\nSegunda línea con \\\\ barra{}

Sin título #1 con ~ y = y ![gráfica](g1.png){=sí ~no ~a\\:b}`;
  const qs = parseGift(src);
  const out = toGift(qs, "Exportado\nsegunda línea");
  assert.ok(out.startsWith("// Exportado\n// segunda línea\n\n"));
  assert.deepEqual(parseGift(out), qs);
});

test("toGift: textos raros de ida y vuelta", async () => {
  const { toGift } = await import("../js/gift.js");
  const weird = ["a:b", "::x::", "{=}", "~#", "\\", "\\n literal", "// parece comentario", "línea\nnueva", "fin\\"];
  const qs = weird.map((t, i) => ({ id: `q${i + 1}`, title: i % 2 ? t : "", text: t, options: [{ id: "a", text: t }, { id: "b", text: "otra" }], correct: "a", valor: 1, tipo: "test" }));
  qs.push({ id: `q${qs.length + 1}`, title: "", text: "// sin título", options: [], correct: null, respuestas: ["a=b", "c#d"], valor: 1, tipo: "corta" });
  assert.deepEqual(parseGift(toGift(qs)), qs);
});
