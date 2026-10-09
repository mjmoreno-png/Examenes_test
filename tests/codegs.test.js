// Carga apps-script/Code.gs en un sandbox con una hoja de cálculo simulada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fake-gas.js";
import { gradeExam, parsePenalty } from "../js/grading.js";
import { parseGift } from "../js/gift.js";

// Valor de una celda por el nombre de su columna: los tests no dependen del orden de las columnas.
const cell = (rows, rowIndex, name) => rows[rowIndex][rows[0].indexOf(name)];
const GIFT = `::P1::Uno{=a~b~c~d}\n\n::P2::Dos{~a=b~c~d}\n\n::P3::Tres{~a~b=c~d}`;
const settings = { titulo: "Test", grupo_destino: "2A", tiempo_min: 20, mostrar_nota: true };

function publish(env, extra = {}) {
  const r = env.post({ action: "createExam", token: "secreto", ...settings, preguntas: parseGift(GIFT), ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.id;
}

test("gradeExam_ de Code.gs coincide con js/grading.js en 2000 casos aleatorios", () => {
  const env = makeEnv();
  const gradeServer = env.fn("gradeExam_");
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 2000; t++) {
    const nq = 1 + Math.floor(rnd() * 25);
    const qs = Array.from({ length: nq }, (_, i) => {
      const k = 2 + Math.floor(rnd() * 5);
      const ids = "abcdef".slice(0, k).split("");
      const q = { id: `q${i + 1}`, options: ids.map((id) => ({ id })), correct: ids[Math.floor(rnd() * k)] };
      const r = rnd();
      if (r < 0.2) { q.tipo = "abierta"; q.options = []; q.correct = null; }
      if (r > 0.4) q.valor = Math.round((0.25 + rnd() * 4) * 4) / 4;
      return q;
    });
    const ans = {};
    for (const q of qs) {
      const r = rnd();
      if (r < 0.25 || q.tipo === "abierta") continue;
      ans[q.id] = r < 0.6 ? q.correct : q.options[Math.floor(rnd() * q.options.length)].id;
    }
    const allowNegative = rnd() < 0.5;
    assert.deepEqual(
      JSON.parse(JSON.stringify(gradeServer(qs, ans, { allowNegative }))),
      gradeExam(qs, ans, { allowNegative })
    );
    // con penalización propia (fracción a/b)
    const den = 1 + Math.floor(rnd() * 9);
    const penalty = { num: Math.floor(rnd() * (den + 1)), den };
    assert.deepEqual(
      JSON.parse(JSON.stringify(gradeServer(qs, ans, { allowNegative, penalty }))),
      gradeExam(qs, ans, { allowNegative, penalty })
    );
  }
});

test("flujo completo: crear, consultar sin soluciones, enviar, listar, cerrar", () => {
  const env = makeEnv();
  const id = publish(env);

  const got = env.get({ action: "exam", id });
  assert.equal(got.ok, true);
  assert.equal(got.exam.questions.length, 3);
  assert.ok(!JSON.stringify(got).includes("correct"), "no debe filtrar las soluciones");

  const sub = env.post({
    action: "submit", examId: id, nombre: "  Ana  López ", grupo: "2º A",
    respuestas: { q1: "a", q2: "a", q3: null }, duracion_min: 7.5,
  });
  assert.deepEqual({ ...sub }, { ok: true, nota: 2.22, aciertos: 1, errores: 1, blancos: 1 }); // (1-1/3)/3*10

  const rows1 = env.results(id).rows;
  assert.equal(cell(rows1, 1, "nombre"), "Ana López");
  assert.equal(cell(rows1, 1, "posible_duplicado"), false);

  // mismo alumno con tildes/mayúsculas distintas -> duplicado, pero no se bloquea
  const again = env.post({ action: "submit", examId: id, nombre: "ANA LOPEZ", grupo: "2º  a", respuestas: {} });
  assert.equal(again.ok, true);
  assert.equal(cell(env.results(id).rows, 2, "posible_duplicado"), true);

  const list = env.get({ action: "list", token: "secreto" });
  assert.equal(list.exams[0].envios, 2);
  assert.match(list.exams[0].results_url, /#gid=\d+$/);

  assert.equal(env.post({ action: "setActive", token: "secreto", id, activo: false }).ok, true);
  assert.equal(env.get({ action: "exam", id }).error, "closed");
  assert.equal(env.post({ action: "submit", examId: id, nombre: "B", grupo: "C", respuestas: {} }).error, "closed");
});

test("no devuelve la nota si mostrar_nota es falso", () => {
  const env = makeEnv();
  const id = publish(env, { mostrar_nota: false });
  const r = env.post({ action: "submit", examId: id, nombre: "A", grupo: "B", respuestas: { q1: "a" } });
  assert.deepEqual({ ...r }, { ok: true });
});

test("código de acceso", () => {
  const env = makeEnv();
  const id = publish(env, { codigo_acceso: "Luz42" });
  const noCode = env.get({ action: "exam", id });
  assert.equal(noCode.error, "code_required");
  assert.equal(noCode.info.requiere_codigo, true);
  assert.ok(!("exam" in noCode));
  assert.equal(env.get({ action: "exam", id, code: "mal" }).error, "bad_code");
  assert.equal(env.get({ action: "exam", id, code: " luz42 " }).ok, true);
  assert.equal(env.post({ action: "submit", examId: id, nombre: "A", grupo: "B", respuestas: {} }).error, "code_required");
  assert.equal(env.post({ action: "submit", examId: id, code: "Luz42", nombre: "A", grupo: "B", respuestas: {} }).ok, true);
});

test("validaciones de submit", () => {
  const env = makeEnv();
  const id = publish(env);
  const base = { action: "submit", examId: id, nombre: "A", grupo: "B", respuestas: {} };
  assert.equal(env.post({ ...base, nombre: "" }).error, "invalid_name");
  assert.equal(env.post({ ...base, nombre: "x".repeat(61) }).error, "invalid_name");
  assert.equal(env.post({ ...base, grupo: "x".repeat(61) }).error, "invalid_group");
  assert.equal(env.post({ ...base, respuestas: { q1: "z" } }).error, "invalid_answers");
  assert.equal(env.post({ ...base, respuestas: { q99: "a" } }).error, "invalid_answers");
  assert.equal(env.post({ ...base, respuestas: [] }).error, "invalid_answers");
  assert.equal(env.post({ ...base, examId: "nope" }).error, "not_found");
  assert.equal(env.results(id).rows.length, 1, "no se guarda nada si falla");
});

test("acciones de administrador exigen token", () => {
  const env = makeEnv();
  const body = { action: "createExam", ...settings, preguntas: parseGift(GIFT) };
  assert.equal(env.post({ ...body, token: "otro" }).error, "unauthorized");
  assert.equal(env.post(body).error, "unauthorized");
  assert.equal(env.get({ action: "list" }).error, "unauthorized");
  assert.equal(env.post({ action: "setActive", id: "x", activo: false }).error, "unauthorized");
  assert.equal(makeEnv(null).get({ action: "list", token: "x" }).error, "token_not_configured");
});

test("createExam valida preguntas y tamaño", () => {
  const env = makeEnv();
  const base = { action: "createExam", token: "secreto", ...settings };
  assert.equal(env.post({ ...base, preguntas: [] }).error, "invalid_exam");
  assert.equal(env.post({ ...base, titulo: "", preguntas: parseGift(GIFT) }).error, "invalid_exam");
  const bad = parseGift(GIFT);
  bad[0].correct = "z";
  assert.equal(env.post({ ...base, preguntas: bad }).error, "invalid_exam");
  const big = parseGift(GIFT);
  big[0].text = "x".repeat(50000);
  assert.equal(env.post({ ...base, preguntas: big }).error, "too_large");
  const warn = parseGift(GIFT);
  warn[0].text = "x".repeat(46000);
  assert.match(env.post({ ...base, preguntas: warn }).warning, /límite/);
});

test("permitir_negativa se respeta en el servidor", () => {
  const env = makeEnv();
  const id = publish(env, { permitir_negativa: true });
  const r = env.post({ action: "submit", examId: id, nombre: "A", grupo: "B", respuestas: { q1: "b", q2: "a", q3: "a" } });
  assert.equal(r.nota, -3.33);
});

test("regresión: un id con forma de notación científica no se convierte en número", () => {
  // Los 8 primeros caracteres del uuid serían "545297e4": Sheets lo guardaría como 5452970000.
  const env = makeEnv("secreto", { uuid: () => "545297e4-aaaa-bbbb-cccc-dddddddddddd" });
  const id = publish(env);
  assert.match(id, /^x/);
  const row = env.sheets.get("Examenes").rows[1];
  assert.equal(row[0], id, "el id guardado es el que se devolvió");
  assert.equal(typeof row[0], "string");
  assert.equal(env.get({ action: "exam", id }).ok, true);
  assert.equal(env.post({ action: "submit", examId: id, nombre: "A", grupo: "1-2", respuestas: {} }).ok, true);
  const list = env.get({ action: "list", token: "secreto" }).exams[0];
  assert.equal(list.id, id);
  assert.equal(list.envios, 1, "la hoja R_ de resultados es la misma que la del examen");
  assert.equal(cell(env.results(id).rows, 1, "grupo"), "1-2", "el grupo no se convierte en fecha");
});

test("regresión: un código de acceso con forma numérica se compara bien", () => {
  const env = makeEnv();
  const id = publish(env, { codigo_acceso: "2e4567" });
  assert.equal(env.get({ action: "exam", id, code: "2E4567" }).ok, true);
  assert.equal(env.get({ action: "list", token: "secreto" }) .exams[0].codigo_acceso, "2e4567");
});

/* ------------------------- control de salidas ------------------------- */

// Los arrays creados dentro del sandbox de vm son de otro "realm": se copian antes de comparar.
const plain = (x) => JSON.parse(JSON.stringify(x));

test("control_salidas se guarda, se anuncia al alumno y aparece en la lista", () => {
  const env = makeEnv();
  const on = publish(env, { control_salidas: true });
  const off = publish(env, { control_salidas: false });
  assert.equal(env.get({ action: "exam", id: on }).exam.control_salidas, true);
  assert.equal(env.get({ action: "exam", id: off }).exam.control_salidas, false);
  const byId = Object.fromEntries(env.get({ action: "list", token: "secreto" }).exams.map((e) => [e.id, e]));
  assert.equal(byId[on].control_salidas, true);
  assert.equal(byId[off].control_salidas, false);
});

test("con código de acceso, control_salidas llega en info antes de pedir el código", () => {
  const env = makeEnv();
  const id = publish(env, { control_salidas: true, codigo_acceso: "Luz42" });
  assert.equal(env.get({ action: "exam", id }).info.control_salidas, true);
});

test("un examen anterior (sin la columna) no está vigilado", () => {
  const env = makeEnv();
  const id = publish(env);
  env.sheets.get("Examenes").rows[1].length = 12; // fila de la versión anterior
  assert.equal(env.get({ action: "exam", id }).exam.control_salidas, false);
});

test("el envío registra salidas, segundos fuera y tipo de envío", () => {
  const env = makeEnv();
  const id = publish(env, { control_salidas: true });
  const r = env.post({
    action: "submit", examId: id, nombre: "Ana", grupo: "2A", respuestas: { q1: "a" },
    salidas: 1, segundos_fuera: 12.34, envio: "salida", envioId: "abc-1",
  });
  assert.equal(r.ok, true);
  const rows = env.results(id).rows;
  const get = (name) => cell(rows, 1, name);
  assert.deepEqual([get("salidas"), get("segundos_fuera"), get("tipo_envio"), get("envio_id"), get("motivos_salida")], [1, 12.3, "salida", "abc-1", ""]);
});

test("valores de vigilancia saneados (tipo desconocido, negativos, texto)", () => {
  const env = makeEnv();
  const id = publish(env);
  env.post({ action: "submit", examId: id, nombre: "A", grupo: "B", respuestas: {}, salidas: -5, segundos_fuera: "x", envio: "hack", envioId: 7 });
  const rowsV = env.results(id).rows;
  assert.deepEqual(["salidas", "segundos_fuera", "tipo_envio", "envio_id", "motivos_salida"].map((n) => cell(rowsV, 1, n)), [0, 0, "manual", "", ""]);
});

test("el mismo envioId no crea una segunda fila y completa los segundos fuera", () => {
  const env = makeEnv();
  const id = publish(env, { control_salidas: true });
  const base = { action: "submit", examId: id, nombre: "Ana", grupo: "2A", respuestas: { q1: "a", q2: "b" }, envio: "salida", envioId: "uno" };
  const first = env.post({ ...base, salidas: 1, segundos_fuera: 0 });   // aviso al salir (sendBeacon)
  const second = env.post({ ...base, salidas: 1, segundos_fuera: 45 }); // reenvío al volver
  assert.equal(first.ok && second.ok, true);
  assert.equal(second.nota, first.nota);
  const rows = env.results(id).rows;
  assert.equal(rows.length, 2, "una sola fila de datos");
  assert.deepEqual([cell(rows, 1, "salidas"), cell(rows, 1, "segundos_fuera")], [1, 45]);
  assert.equal(cell(rows, 1, "posible_duplicado"), false, "no se marca como duplicado de sí mismo");
  // otro alumno con otro envioId sí es una fila nueva
  env.post({ ...base, envioId: "dos", nombre: "Luis" });
  assert.equal(env.results(id).rows.length, 3);
});

test("hojas de resultados antiguas reciben las columnas nuevas por nombre", () => {
  const env = makeEnv();
  const id = publish(env);
  const sheet = env.results(id);
  // cabecera de la primera versión: sin apellidos ni columnas de vigilancia
  sheet.rows = [["fecha", "nombre", "grupo", "aciertos", "errores", "blancos", "nota", "duracion_min", "posible_duplicado", "respuestas_json"]];
  assert.equal(env.post({ action: "submit", examId: id, nombre: "Ana", apellidos: "López", grupo: "B", respuestas: {}, envioId: "x1" }).ok, true);
  const h = sheet.rows[0];
  assert.deepEqual(plain(h.slice(10)), ["salidas", "segundos_fuera", "tipo_envio", "envio_id", "motivos_salida", "puntos_test", "puntos_total", "pegados"]);
  assert.ok(!h.includes("apellidos"), "no se inserta una columna en medio de una hoja ya en uso");
  assert.equal(cell(sheet.rows, 1, "nombre"), "López, Ana", "en hojas anteriores el nombre se guarda como Apellidos, Nombre");
});

test("salidas_permitidas: se guarda, se limita a 0..20 y vale 3 por defecto", () => {
  const env = makeEnv();
  const pick = (v) => {
    const id = publish(env, { control_salidas: true, ...(v === undefined ? {} : { salidas_permitidas: v }) });
    return env.get({ action: "exam", id }).exam.salidas_permitidas;
  };
  assert.equal(pick(undefined), 3);
  assert.equal(pick(5), 5);
  assert.equal(pick(0), 0);
  assert.equal(pick(99), 20);
  assert.equal(pick(-4), 0);
  assert.equal(pick("abc"), 3);
});

test("salidas_permitidas llega en info y en la lista; un examen antiguo tiene 3", () => {
  const env = makeEnv();
  const id = publish(env, { control_salidas: true, salidas_permitidas: 2, codigo_acceso: "Luz42" });
  assert.equal(env.get({ action: "exam", id }).info.salidas_permitidas, 2);
  assert.equal(env.get({ action: "list", token: "secreto" }).exams[0].salidas_permitidas, 2);
  env.sheets.get("Examenes").rows[1].length = 12; // fila anterior a las columnas nuevas
  assert.equal(env.get({ action: "exam", id, code: "Luz42" }).exam.salidas_permitidas, 3);
});

test("motivos_salida se guarda saneado y se completa en el reenvío del mismo envío", () => {
  const env = makeEnv();
  const id = publish(env, { control_salidas: true });
  const base = { action: "submit", examId: id, nombre: "Ana", grupo: "2A", respuestas: {}, envioId: "m1", salidas: 2 };
  env.post({ ...base, motivos_salida: "reduced,<b>hidden</b>" });
  assert.equal(cell(env.results(id).rows, 1, "motivos_salida"), "reduced,bhiddenb");
  env.post({ ...base, motivos_salida: "reduced,bhidden,blurred" });
  assert.equal(env.results(id).rows.length, 2, "una sola fila");
  assert.equal(cell(env.results(id).rows, 1, "motivos_salida"), "reduced,bhidden,blurred");
});

/* ------------------------- penalización por examen ------------------------- */

test("penalizacion: se guarda como texto (Sheets la convertiría en fecha), reducida y expuesta", () => {
  const env = makeEnv();
  const id = publish(env, { penalizacion: " 2 / 6 " });
  const row = env.sheets.get("Examenes").rows[1];
  assert.equal(row[14], "1/3", "guardada reducida y como texto, no como fecha");
  assert.equal(env.get({ action: "exam", id }).exam.penalizacion, "1/3");
  assert.equal(env.get({ action: "list", token: "secreto" }).exams[0].penalizacion, "1/3");
});

test("penalizacion: vacía = automática; 0 y 1 válidos; lo no válido se rechaza", () => {
  const env = makeEnv();
  const pen = (v) => env.get({ action: "exam", id: publish(env, v === undefined ? {} : { penalizacion: v }) }).exam.penalizacion;
  assert.equal(pen(undefined), "");
  assert.equal(pen(""), "");
  assert.equal(pen("0"), "0");
  assert.equal(pen("1"), "1");
  assert.equal(pen("1/4"), "1/4");
  const base = { action: "createExam", token: "secreto", ...settings, preguntas: parseGift(GIFT) };
  for (const bad of ["0.25", "1,5", "3/2", "-1/3", "1/0", "abc"]) {
    assert.equal(env.post({ ...base, penalizacion: bad }).error, "invalid_exam", bad);
  }
});

test("penalizacion llega en info antes de pedir el código", () => {
  const env = makeEnv();
  const id = publish(env, { penalizacion: "1/5", codigo_acceso: "Luz42" });
  assert.equal(env.get({ action: "exam", id }).info.penalizacion, "1/5");
});

test("el servidor corrige con la penalización de cada examen", () => {
  // 3 preguntas de 4 opciones: q1 correcta (a), q2 incorrecta, q3 en blanco
  const resp = { q1: "a", q2: "a" };
  const nota = (extra) => {
    const env = makeEnv();
    const id = publish(env, { permitir_negativa: true, ...extra });
    return env.post({ action: "submit", examId: id, nombre: "A", grupo: "B", respuestas: resp }).nota;
  };
  assert.equal(nota({}), 2.22);                       // automática: (1 − 1/3) / 3 · 10
  assert.equal(nota({ penalizacion: "1/3" }), 2.22);
  assert.equal(nota({ penalizacion: "0" }), 3.33);    // (1 − 0) / 3 · 10
  assert.equal(nota({ penalizacion: "1/2" }), 1.67);  // (1 − 1/2) / 3 · 10
  assert.equal(nota({ penalizacion: "1" }), 0);       // (1 − 1) / 3 · 10
});

test("un examen anterior (sin la columna) o con una celda ilegible usa la automática", () => {
  const env = makeEnv();
  const id = publish(env, { penalizacion: "1/2" });
  env.sheets.get("Examenes").rows[1].length = 14;           // fila anterior a la columna
  assert.equal(env.get({ action: "exam", id }).exam.penalizacion, "");
  env.sheets.get("Examenes").rows[1][14] = new Date();      // Sheets la convirtió en fecha
  assert.equal(env.get({ action: "exam", id }).exam.penalizacion, "");
});

test("createExam devuelve la penalización guardada (el panel la usa para detectar un script antiguo)", () => {
  const env = makeEnv();
  const r = env.post({ action: "createExam", token: "secreto", ...settings, preguntas: parseGift(GIFT), penalizacion: "2/6" });
  assert.equal(r.penalizacion, "1/3");
  const auto = env.post({ action: "createExam", token: "secreto", ...settings, preguntas: parseGift(GIFT) });
  assert.equal(auto.penalizacion, "");
});

/* ------------------------- pantalla completa opcional ------------------------- */

test("pantalla_completa: desactivada por defecto, se guarda, se expone y se devuelve al crear", () => {
  const env = makeEnv();
  const flag = (extra) => {
    const r = env.post({ action: "createExam", token: "secreto", ...settings, control_salidas: true, preguntas: parseGift(GIFT), ...extra });
    return { id: r.id, echo: r.pantalla_completa };
  };
  const off = flag({});
  const on = flag({ pantalla_completa: true });
  assert.equal(off.echo, false);
  assert.equal(on.echo, true);
  assert.equal(env.get({ action: "exam", id: off.id }).exam.pantalla_completa, false);
  assert.equal(env.get({ action: "exam", id: on.id }).exam.pantalla_completa, true);
  const byId = Object.fromEntries(env.get({ action: "list", token: "secreto" }).exams.map((e) => [e.id, e]));
  assert.equal(byId[on.id].pantalla_completa, true);
  assert.equal(byId[off.id].pantalla_completa, false);
});

test("pantalla_completa llega en info antes de pedir el código; un examen anterior no la exige", () => {
  const env = makeEnv();
  const id = publish(env, { control_salidas: true, pantalla_completa: true, codigo_acceso: "Luz42" });
  assert.equal(env.get({ action: "exam", id }).info.pantalla_completa, true);
  env.sheets.get("Examenes").rows[1].length = 15; // fila anterior a la columna
  assert.equal(env.get({ action: "exam", id, code: "Luz42" }).exam.pantalla_completa, false);
});

/* ------------------------- nombre y apellidos, orden alfabético ------------------------- */

const submitAs = (env, id, nombre, apellidos, extra = {}) =>
  env.post({ action: "submit", examId: id, nombre, apellidos, grupo: "2A", respuestas: {}, ...extra });
const names = (env, id) => {
  const rows = env.results(id).rows;
  return rows.slice(1).map((_, i) => `${cell(rows, i + 1, "apellidos")}, ${cell(rows, i + 1, "nombre")}`);
};

test("las hojas nuevas separan apellidos y nombre", () => {
  const env = makeEnv();
  const id = publish(env);
  assert.equal(submitAs(env, id, "  Ana ", " López   Pérez ").ok, true);
  const rows = env.results(id).rows;
  assert.deepEqual(plain(rows[0].slice(0, 4)), ["apellidos", "nombre", "grupo", "nota"]);
  assert.equal(cell(rows, 1, "apellidos"), "López Pérez");
  assert.equal(cell(rows, 1, "nombre"), "Ana");
});

test("los apellidos son obligatorios si se envía el campo y se limitan a 60 caracteres", () => {
  const env = makeEnv();
  const id = publish(env);
  assert.equal(submitAs(env, id, "Ana", "").error, "invalid_surname");
  assert.equal(submitAs(env, id, "Ana", "   ").error, "invalid_surname");
  assert.equal(submitAs(env, id, "Ana", "x".repeat(61)).error, "invalid_surname");
  assert.equal(submitAs(env, id, "", "López").error, "invalid_name");
  assert.equal(env.results(id).rows.length, 1, "no se guarda nada si falla");
});

test("una página anterior (sin campo apellidos) sigue pudiendo enviar", () => {
  const env = makeEnv();
  const id = publish(env);
  assert.equal(env.post({ action: "submit", examId: id, nombre: "Ana López", grupo: "2A", respuestas: {} }).ok, true);
  const rows = env.results(id).rows;
  assert.equal(cell(rows, 1, "nombre"), "Ana López");
  assert.equal(cell(rows, 1, "apellidos"), "");
});

test("las filas quedan ordenadas por apellidos y, a igualdad, por nombre (sin distinguir tildes ni mayúsculas)", () => {
  const env = makeEnv();
  const id = publish(env);
  submitAs(env, id, "Marta", "Zapata Ruiz");
  submitAs(env, id, "Pedro", "Álvarez Gil");
  submitAs(env, id, "Luis", "Benítez");
  submitAs(env, id, "Ana", "álvarez gil");
  submitAs(env, id, "Sara", "Alonso");
  submitAs(env, id, "Eva", "Zapata Ruiz");
  assert.deepEqual(names(env, id), [
    "Alonso, Sara",
    "álvarez gil, Ana",
    "Álvarez Gil, Pedro",
    "Benítez, Luis",
    "Zapata Ruiz, Eva",
    "Zapata Ruiz, Marta",
  ]);
});

test("tras ordenar, el reenvío del mismo envío actualiza la fila correcta", () => {
  const env = makeEnv();
  const id = publish(env, { control_salidas: true });
  submitAs(env, id, "Marta", "Zapata", { envioId: "m", salidas: 1, segundos_fuera: 0 });
  submitAs(env, id, "Pedro", "Álvarez", { envioId: "p", salidas: 1, segundos_fuera: 0 });   // pasa por delante de Zapata
  submitAs(env, id, "Marta", "Zapata", { envioId: "m", salidas: 1, segundos_fuera: 30 });   // reenvío de Marta
  const rows = env.results(id).rows;
  assert.equal(rows.length, 3);
  assert.equal(cell(rows, 1, "segundos_fuera"), 0, "Álvarez, Pedro no cambia");
  assert.equal(cell(rows, 2, "segundos_fuera"), 30, "Zapata, Marta sí");
});

test("posible_duplicado compara apellidos y nombre sin tildes, mayúsculas ni espacios", () => {
  const env = makeEnv();
  const id = publish(env);
  submitAs(env, id, "María", "López Pérez");
  submitAs(env, id, "MARIA", "  lopez   perez ");
  submitAs(env, id, "Pedro", "López Pérez");
  const rows = env.results(id).rows;
  const dups = rows.slice(1).map((_, i) => cell(rows, i + 1, "posible_duplicado"));
  assert.equal(dups.filter(Boolean).length, 1, "solo la segunda María es posible duplicado");
});

test("las hojas anteriores (sin apellidos) siguen funcionando y no se reordenan", () => {
  const env = makeEnv();
  const id = publish(env);
  const sheet = env.results(id);
  sheet.rows = [["fecha", "nombre", "grupo", "aciertos", "errores", "blancos", "nota", "duracion_min", "posible_duplicado", "respuestas_json", "salidas", "segundos_fuera", "tipo_envio", "envio_id", "motivos_salida"]];
  submitAs(env, id, "Marta", "Zapata");
  submitAs(env, id, "Pedro", "Álvarez");
  const rows = sheet.rows;
  assert.deepEqual([cell(rows, 1, "nombre"), cell(rows, 2, "nombre")], ["Zapata, Marta", "Álvarez, Pedro"], "orden de llegada");
  assert.equal(rows[0].length, 18, "solo se añaden columnas al final (puntos_test, puntos_total, pegados)");
});

/* ------------------------- imágenes en los enunciados ------------------------- */

// "Imágenes" de mentira: base64 válido y de tamaño controlado (el servidor no las decodifica).
const fakeB64 = (n, ch = "A") => ch.repeat(n);
const GIFT_IMG = "::P1::Observa ![gráfica](grafica1.png) y responde{=a~b~c}\n\n::P2::Sin imagen{=a~b}\n\n::P3::Otra ![circuito](Circuito-2.png){=a~b}";
const imgs = (...names) => names.map((nombre) => ({ nombre, mime: "image/png", data: fakeB64(1000) }));
const publishImg = (env, extra = {}) =>
  env.post({ action: "createExam", token: "secreto", ...settings, preguntas: parseGift(GIFT_IMG), ...extra });

test("version: el panel puede saber qué funciones tiene el script", () => {
  const env = makeEnv();
  assert.deepEqual(plain(env.get({ action: "version" })), { ok: true, funciones: ["imagenes", "abiertas", "correccion", "revision"] });
});

test("imágenes: se guardan troceadas, se devuelven al alumno y las preguntas no filtran la solución", () => {
  const env = makeEnv();
  const big = { nombre: "grafica1.png", mime: "image/png", data: "QUJD".repeat(25000) }; // 100 000 caracteres -> 3 trozos
  const r = publishImg(env, { imagenes: [big, ...imgs("Circuito-2.png")] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.imagenes, 2);
  const rows = env.sheets.get("Imagenes").rows;
  assert.deepEqual(plain(rows[0]), ["examen", "nombre", "orden", "mime", "datos"]);
  assert.equal(rows.filter((x) => x[1] === "grafica1.png").length, 3, "100 000 caracteres = 3 trozos de 40 000");
  assert.ok(rows.slice(1).every((x) => String(x[4]).length <= 40000), "ningún trozo supera el límite de celda");
  const got = env.get({ action: "exam", id: r.id });
  assert.equal(got.ok, true);
  assert.equal(got.exam.imagenes["grafica1.png"], `data:image/png;base64,${big.data}`, "se recompone idéntica");
  assert.equal(got.exam.imagenes["Circuito-2.png"], `data:image/png;base64,${fakeB64(1000)}`);
  assert.ok(!JSON.stringify(got).includes("correct"));
});

test("imágenes: con código de acceso no se envían hasta acertar el código", () => {
  const env = makeEnv();
  const r = publishImg(env, { imagenes: imgs("grafica1.png", "Circuito-2.png"), codigo_acceso: "Luz42" });
  const sin = env.get({ action: "exam", id: r.id });
  assert.equal(sin.error, "code_required");
  assert.ok(!JSON.stringify(sin).includes("base64"));
  assert.ok(env.get({ action: "exam", id: r.id, code: "Luz42" }).exam.imagenes["grafica1.png"]);
});

test("imágenes: un examen sin imágenes no toca la hoja Imagenes", () => {
  const env = makeEnv();
  const id = publish(env);
  assert.deepEqual(plain(env.get({ action: "exam", id }).exam.imagenes), {});
  assert.equal(env.sheets.has("Imagenes"), false);
});

test("imágenes: falta una imagen citada, nombre no válido, tipo, tamaño y número", () => {
  const env = makeEnv();
  const fail = (extra, texto) => {
    const r = publishImg(env, extra);
    assert.equal(r.error, "invalid_exam", texto);
    return r.message;
  };
  assert.match(fail({ imagenes: imgs("grafica1.png") }, "falta Circuito-2"), /Falta la imagen "Circuito-2.png"/);
  assert.match(fail({}, "sin imágenes"), /Falta la imagen/);
  assert.match(fail({ imagenes: [{ nombre: "grafica1.png", mime: "image/svg+xml", data: "AAAA" }, ...imgs("Circuito-2.png")] }, "svg"), /no es PNG/);
  assert.match(fail({ imagenes: [{ nombre: "grafica1.png", mime: "image/png", data: "no es base64!" }, ...imgs("Circuito-2.png")] }, "base64"), /bien codificada/);
  assert.match(fail({ imagenes: [{ nombre: "grafica1.png", mime: "image/png", data: fakeB64(330001) }, ...imgs("Circuito-2.png")] }, "grande"), /demasiado grande/);
  assert.match(fail({ imagenes: [...imgs("grafica1.png", "Circuito-2.png", "GRAFICA1.PNG")] }, "repetida"), /repetida/);
  const many = Array.from({ length: 13 }, (_, i) => imgs(`i${i}.png`)[0]);
  assert.match(fail({ imagenes: many }, "13"), /Demasiadas/);
  const heavy = Array.from({ length: 7 }, (_, i) => ({ nombre: `h${i}.png`, mime: "image/png", data: fakeB64(300000) }));
  assert.match(fail({ imagenes: heavy }, "total"), /pesan demasiado/);
});

test("imágenes: las citas con carpetas o direcciones de internet se rechazan", () => {
  const env = makeEnv();
  for (const cita of ["https://web.com/a.png", "carpeta/a.png", "a b.png"]) {
    const qs = [{ id: "q1", title: "", text: `Mira ![x](${cita})`, options: [{ id: "a", text: "1" }, { id: "b", text: "2" }], correct: "a" }];
    const r = env.post({ action: "createExam", token: "secreto", ...settings, preguntas: qs, imagenes: imgs("a.png") });
    // "a b.png" no forma una cita válida (lleva un espacio): el texto queda como texto y no pide imagen
    if (cita.includes(" ")) assert.equal(r.ok, true); else assert.equal(r.error, "invalid_exam", cita);
  }
});

test("imágenes: se sirven desde la caché la segunda vez y funcionan sin ella", () => {
  const env = makeEnv();
  const r = publishImg(env, { imagenes: imgs("grafica1.png", "Circuito-2.png") });
  const first = env.get({ action: "exam", id: r.id }).exam.imagenes;
  assert.ok(env.cache.has(`imgm:${r.id}`), "tras la primera lectura queda en caché");
  env.sheets.get("Imagenes").rows.length = 1; // si leyera de la hoja, ya no habría imágenes
  assert.deepEqual(plain(env.get({ action: "exam", id: r.id }).exam.imagenes), plain(first), "la segunda vez sale de la caché");
  env.cache.clear();
  assert.deepEqual(plain(env.get({ action: "exam", id: r.id }).exam.imagenes), {}, "sin caché se lee de la hoja");
});

test("imágenes: las imágenes de un examen no se mezclan con las de otro", () => {
  const env = makeEnv();
  const a = publishImg(env, { imagenes: [{ nombre: "grafica1.png", mime: "image/png", data: fakeB64(500, "A") }, ...imgs("Circuito-2.png")] });
  const b = publishImg(env, { imagenes: [{ nombre: "grafica1.png", mime: "image/png", data: fakeB64(500, "B") }, ...imgs("Circuito-2.png")] });
  assert.ok(env.get({ action: "exam", id: a.id }).exam.imagenes["grafica1.png"].endsWith("A".repeat(500)));
  assert.ok(env.get({ action: "exam", id: b.id }).exam.imagenes["grafica1.png"].endsWith("B".repeat(500)));
});
