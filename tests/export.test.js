import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsv, csvCell } from "../js/correction.js";

test("csvCell: comillas, separadores y fórmulas neutralizadas", () => {
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('di "hola"'), '"di ""hola"""');
  assert.equal(csvCell("=SUMA(A1)"), "'=SUMA(A1)");
  assert.equal(csvCell("-3,5"), "-3,5");
  assert.equal(csvCell(null), "");
});

test("buildCsv: separador «;», coma decimal, BOM y columna de pendientes solo con abiertas", () => {
  const rows = [{ apellidos: "López", nombre: "Ana", grupo: "2A", nota: 7.5, pendientes: 1, aciertos: 3, errores: 1, blancos: 0, salidas: 0, segundos_fuera: 12.5, cambios_escritorio: 2, segundos_escritorio: 4.5, ventanas_encima: 1, segundos_ventana_encima: 3, desconexiones: 1, segundos_sin_conexion: 8.5, pegados: 2 }];
  const withOpen = buildCsv(rows, true).split("\r\n");
  assert.ok(withOpen[0].startsWith("﻿Apellidos;Nombre;Grupo;Nota;Preguntas sin corregir;"));
  assert.equal(withOpen[1], "López;Ana;2A;7,5;1;3;1;0;0;12,5;2;4,5;1;3;1;8,5;2");
  assert.ok(!buildCsv(rows, false).includes("sin corregir"));
});
