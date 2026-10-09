/**
 * Backend de Exámenes tipo test (Google Apps Script, Web App).
 *
 * Se copia a mano al editor de Apps Script de la hoja de cálculo
 * (Extensiones → Apps Script). Ver apps-script/INSTRUCCIONES.md.
 *
 * - La corrección se hace AQUÍ, nunca en el navegador del alumno.
 * - El token de administración vive en Propiedades del script (ADMIN_TOKEN).
 * - gradeExam_ replica exactamente js/grading.js (hay un test que lo comprueba).
 */

const SHEET_EXAMS = 'Examenes';
const EXAM_HEADERS = [
  'id', 'titulo', 'grupo_destino', 'activo', 'codigo_acceso', 'tiempo_min',
  'barajar_preguntas', 'barajar_opciones', 'mostrar_nota', 'permitir_negativa',
  'preguntas_json', 'creado', 'control_salidas', 'salidas_permitidas', 'penalizacion',
  'pantalla_completa', 'hoja_id', 'revision'
];
// Hoja de resultados (una por examen). Orden de las columnas de las hojas nuevas; las hojas de versiones
// anteriores se leen por el nombre de la cabecera y reciben al final las columnas extra que les falten.
const RESULT_BASE = [
  'fecha', 'apellidos', 'nombre', 'grupo', 'aciertos', 'errores', 'blancos', 'nota',
  'duracion_min', 'posible_duplicado', 'respuestas_json'
];
const RESULT_EXTRA = ['salidas', 'segundos_fuera', 'tipo_envio', 'envio_id', 'motivos_salida'];
// Columnas que se añaden siempre: puntos del test, total del examen e intentos de pegar.
const RESULT_POINTS = ['puntos_test', 'puntos_total', 'pegados'];
const RESULT_HEADERS = RESULT_BASE.concat(RESULT_EXTRA);
const RESULT_TEXT_COLUMNS = ['apellidos', 'nombre', 'grupo', 'envio_id', 'motivos_salida']; // nunca números ni fechas
const ENVIO_TYPES = ['manual', 'tiempo', 'salida'];
const MAX_TEXT = 60;          // nombre, apellidos y grupo
const WARN_CHARS = 45000;     // aviso: cerca del límite de celda
const MAX_CHARS = 49000;      // límite duro (la celda admite 50 000)
const MAX_QUESTIONS = 200;
const MAX_OPTIONS = 26;
const MAX_VALUE = 100;        // puntos máximos de una pregunta
const MAX_OPEN_CHARS = 4000;  // longitud máxima de una respuesta abierta

// Imágenes de los enunciados: ![descripción](archivo.png). Se guardan troceadas en la hoja "Imagenes".
const SHEET_IMAGES = 'Imagenes';
const IMAGE_HEADERS = ['examen', 'nombre', 'orden', 'mime', 'datos'];
const MAX_IMAGES = 12;                 // por examen
const MAX_IMAGE_CHARS = 330000;        // base64 de una imagen (~240 KB)
const MAX_TOTAL_IMAGE_CHARS = 2000000; // base64 de todas las imágenes de un examen
const IMAGE_CHUNK = 40000;             // una celda admite 50 000 caracteres
const CACHE_PART = 90000;              // una entrada de caché admite 100 KB
const CACHE_SECONDS = 21600;
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const FEATURES = ['imagenes', 'abiertas', 'correccion', 'revision'];         // capacidades de esta versión del script (las lee el panel)
const DEFAULT_ALLOWED_EXITS = 3;   // salidas permitidas antes del envío automático
const MAX_ALLOWED_EXITS = 20;

/* ------------------------------------------------------------------ */
/* Puntos de entrada                                                   */
/* ------------------------------------------------------------------ */

function doGet(e) {
  return respond_(safely_(function () { return handleGet_((e && e.parameter) || {}); }));
}

function doPost(e) {
  return respond_(safely_(function () {
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return fail_('bad_request', 'El cuerpo de la petición no es JSON válido.');
    }
    return handlePost_(body || {});
  }));
}

function handleGet_(params) {
  switch (params.action) {
    case 'exam': return getExam_(params);
    case 'list': return listExams_(params);
    case 'version': return { ok: true, funciones: FEATURES };
    default: return fail_('bad_request', 'Acción no reconocida.');
  }
}

function handlePost_(body) {
  switch (body.action) {
    case 'submit': return submit_(body);
    case 'createExam': return createExam_(body);
    case 'setActive': return setActive_(body);
    case 'setReview': return setReview_(body);
    case 'review': return review_(body);
    case 'results': return results_(body);
    case 'grade': return grade_(body);
    default: return fail_('bad_request', 'Acción no reconocida.');
  }
}

function safely_(fn) {
  try {
    return fn();
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return fail_('server_error', 'Error interno del servidor.');
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  return { ok: false, error: code, message: message };
}

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

function getExam_(params) {
  var exam = findExam_(params.id);
  if (!exam) return fail_('not_found', 'Este examen no existe.');
  if (!exam.activo) return fail_('closed', 'Este examen está cerrado.');

  var questions = JSON.parse(exam.preguntas_json);
  var info = {
    titulo: exam.titulo,
    n_preguntas: questions.length,
    tiempo_min: exam.tiempo_min,
    requiere_codigo: exam.codigo_acceso !== '',
    control_salidas: exam.control_salidas,
    salidas_permitidas: exam.salidas_permitidas,
    penalizacion: exam.penalizacion,
    pantalla_completa: exam.pantalla_completa
  };

  var codeCheck = checkCode_(exam, params.code);
  if (codeCheck) {
    var res = fail_(codeCheck, codeCheck === 'code_required'
      ? 'Este examen necesita un código de acceso.'
      : 'El código de acceso no es correcto.');
    res.info = info;
    return res;
  }

  return {
    ok: true,
    exam: {
      id: exam.id,
      titulo: exam.titulo,
      grupo_destino: exam.grupo_destino,
      tiempo_min: exam.tiempo_min,
      barajar_preguntas: exam.barajar_preguntas,
      barajar_opciones: exam.barajar_opciones,
      mostrar_nota: exam.mostrar_nota,
      control_salidas: exam.control_salidas,
      salidas_permitidas: exam.salidas_permitidas,
      penalizacion: exam.penalizacion,
      pantalla_completa: exam.pantalla_completa,
      imagenes: loadImages_(exam.id, questions),
      questions: questions.map(function (q) {
        return {
          id: q.id,
          title: q.title,
          text: q.text,
          tipo: isOpen_(q) ? 'abierta' : 'test',
          valor: questionValue_(q),
          options: (q.options || []).map(function (o) { return { id: o.id, text: o.text }; })
        };
      })
    }
  };
}

function submit_(p) {
  var nombre = cleanText_(p.nombre);
  var apellidos = cleanText_(p.apellidos);
  var grupo = cleanText_(p.grupo);
  if (!nombre || nombre.length > MAX_TEXT) {
    return fail_('invalid_name', 'El nombre es obligatorio (máximo ' + MAX_TEXT + ' caracteres).');
  }
  // Una página anterior solo enviaba el nombre completo: sin el campo `apellidos` se acepta igualmente.
  var hasSurnameField = p.apellidos !== undefined && p.apellidos !== null;
  if (hasSurnameField && (!apellidos || apellidos.length > MAX_TEXT)) {
    return fail_('invalid_surname', 'Los apellidos son obligatorios (máximo ' + MAX_TEXT + ' caracteres).');
  }
  if (!grupo || grupo.length > MAX_TEXT) {
    return fail_('invalid_group', 'El grupo es obligatorio (máximo ' + MAX_TEXT + ' caracteres).');
  }

  var exam = findExam_(p.examId);
  if (!exam) return fail_('not_found', 'Este examen no existe.');
  if (!exam.activo) return fail_('closed', 'Este examen está cerrado.');
  var codeCheck = checkCode_(exam, p.code);
  if (codeCheck) return fail_(codeCheck, 'El código de acceso no es correcto.');

  var questions = JSON.parse(exam.preguntas_json);
  var answers = p.respuestas;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return fail_('invalid_answers', 'Las respuestas no tienen el formato esperado.');
  }
  var known = {}, openIds = {};
  questions.forEach(function (q) { if (isOpen_(q)) openIds[q.id] = true; else known[q.id] = true; });
  for (var key in answers) {
    if (!Object.prototype.hasOwnProperty.call(answers, key)) continue;
    var v = answers[key];
    if (!known[key] || !(v === null || typeof v === 'string')) {
      return fail_('invalid_answers', 'Las respuestas no corresponden a este examen.');
    }
  }

  // Respuestas abiertas: id de pregunta -> texto (se guardan tal cual en la hoja del profesor).
  var openAnswers = {};
  var given = p.abiertas;
  if (given !== undefined && given !== null) {
    if (typeof given !== 'object' || Array.isArray(given)) {
      return fail_('invalid_answers', 'Las respuestas no tienen el formato esperado.');
    }
    for (var okey in given) {
      if (!Object.prototype.hasOwnProperty.call(given, okey)) continue;
      var ov = given[okey];
      if (!openIds[okey] || !(ov === null || typeof ov === 'string')) {
        return fail_('invalid_answers', 'Las respuestas no corresponden a este examen.');
      }
      var txt = String(ov === null ? '' : ov).replace(/\r\n?/g, '\n').trim();
      if (txt.length > MAX_OPEN_CHARS) {
        return fail_('invalid_answers', 'Una respuesta abierta supera los ' + MAX_OPEN_CHARS + ' caracteres.');
      }
      openAnswers[okey] = txt;
    }
  }
  var pegados = clampNumber_(p.pegados, 9999, 0);

  var result;
  try {
    result = gradeExam_(questions, answers, {
      allowNegative: exam.permitir_negativa,
      penalty: exam.penalizacion ? parsePenalty_(exam.penalizacion) : null
    });
  } catch (err) {
    return fail_('invalid_answers', 'Las respuestas no corresponden a este examen.');
  }

  var dur = Number(p.duracion_min);
  var duracion = isFinite(dur) && dur >= 0 ? Math.round(dur * 100) / 100 : '';
  var salidas = clampNumber_(p.salidas, 999, 0);
  var segundosFuera = clampNumber_(p.segundos_fuera, 86400, 1);
  var tipoEnvio = ENVIO_TYPES.indexOf(p.envio) !== -1 ? p.envio : 'manual';
  var envioId = typeof p.envioId === 'string' ? p.envioId.trim().slice(0, 64) : '';
  // Señales que provocaron cada salida (p. ej. "reduced,hidden"); solo letras y comas.
  var motivos = typeof p.motivos_salida === 'string' ? p.motivos_salida.replace(/[^A-Za-z,]/g, '').slice(0, 120) : '';

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return fail_('busy', 'El servidor está ocupado. Inténtalo de nuevo en unos segundos.');
  }
  try {
    var sheet = getResultsSheet_(exam, questions);
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0].map(String);
    var H = headerMap_(headers); // nombre de columna -> posición (desde 0)
    var hasApellidos = H.apellidos !== undefined;

    // Un mismo envío (mismo envioId) nunca crea dos filas: solo completa los datos de salidas.
    var sameSend = -1;
    if (envioId && H.envio_id !== undefined) {
      for (var k = 1; k < rows.length; k++) {
        if (String(rows[k][H.envio_id]) === envioId) { sameSend = k; break; }
      }
    }
    if (sameSend !== -1) {
      sheet.getRange(sameSend + 1, H.salidas + 1).setValue(Math.max(Number(rows[sameSend][H.salidas]) || 0, salidas));
      sheet.getRange(sameSend + 1, H.segundos_fuera + 1).setValue(Math.max(Number(rows[sameSend][H.segundos_fuera]) || 0, segundosFuera));
      if (motivos.length > String(rows[sameSend][H.motivos_salida] || '').length) {
        sheet.getRange(sameSend + 1, H.motivos_salida + 1).setValue(motivos);
      }
    } else {
      // En hojas anteriores (sin columna de apellidos) el nombre se guarda como "Apellidos, Nombre".
      var fullName = hasApellidos || !apellidos ? nombre : apellidos + ', ' + nombre;
      var who = normalize_(apellidos) + '|' + normalize_(nombre);
      var g = normalize_(grupo);
      var duplicado = false;
      for (var i = 1; i < rows.length; i++) {
        var other = hasApellidos
          ? normalize_(rows[i][H.apellidos]) + '|' + normalize_(rows[i][H.nombre])
          : normalize_(rows[i][H.nombre]);
        if (other === (hasApellidos ? who : normalize_(fullName)) && normalize_(rows[i][H.grupo]) === g) {
          duplicado = true;
          break;
        }
      }
      var values = {
        fecha: new Date(), apellidos: apellidos, nombre: fullName, grupo: grupo,
        aciertos: result.aciertos, errores: result.errores, blancos: result.blancos, nota: result.nota,
        duracion_min: duracion, posible_duplicado: duplicado, respuestas_json: JSON.stringify(answers),
        salidas: salidas, segundos_fuera: segundosFuera, tipo_envio: tipoEnvio, envio_id: envioId,
        motivos_salida: motivos,
        puntos_test: result.puntosTest, puntos_total: result.puntosTotal, pegados: pegados,
        pendientes: result.abiertas // preguntas abiertas sin corregir; la nota es la del test hasta que se corrija
      };
      var openQs = questions.filter(isOpen_);
      openQs.forEach(function (q) { values[openColumns_(q, questions).resp] = openAnswers[q.id] || ''; });
      var textCols = [];
      var row = headers.map(function (name, idx) {
        if (RESULT_TEXT_COLUMNS.indexOf(name) !== -1) textCols.push(idx + 1);
        return values[name] === undefined ? '' : values[name];
      });
      appendRowText_(sheet, row, textCols);
      // Las filas quedan ordenadas por apellidos y, a igualdad, por nombre.
      if (hasApellidos && sheet.getLastRow() > 2) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length)
          .sort([{ column: H.apellidos + 1, ascending: true }, { column: H.nombre + 1, ascending: true }]);
      }
    }
  } finally {
    lock.releaseLock();
  }

  var out = { ok: true };
  if (exam.mostrar_nota) {
    if (result.abiertas > 0) {
      // Con preguntas abiertas la nota no es definitiva: el alumno solo ve la parte del test.
      out.abiertas = result.abiertas;
      out.puntos_test = result.puntosTest;
      out.puntos_test_max = result.puntosTestMax;
    } else {
      out.nota = result.nota;
    }
    out.aciertos = result.aciertos;
    out.errores = result.errores;
    out.blancos = result.blancos;
  }
  return out;
}

function createExam_(p) {
  var auth = checkToken_(p.token);
  if (auth) return auth;

  var titulo = cleanText_(p.titulo);
  if (!titulo || titulo.length > 120) {
    return fail_('invalid_exam', 'El título es obligatorio (máximo 120 caracteres).');
  }
  var questions;
  try {
    questions = validateQuestions_(p.preguntas);
  } catch (err) {
    return fail_('invalid_exam', err.message);
  }
  var json = JSON.stringify(questions);
  if (json.length > MAX_CHARS) {
    return fail_('too_large', 'El examen es demasiado grande para una celda de Google Sheets (' +
      json.length + ' caracteres; máximo ' + MAX_CHARS + '). Divídelo en dos exámenes.');
  }

  var penalizacion = '';
  try {
    penalizacion = formatPenalty_(parsePenalty_(p.penalizacion));
  } catch (err) {
    return fail_('invalid_exam', err.message);
  }

  var images;
  try {
    images = validateImages_(p.imagenes, questions);
  } catch (err) {
    return fail_('invalid_exam', err.message);
  }

  var tiempo = Math.floor(Number(p.tiempo_min));
  if (!isFinite(tiempo) || tiempo < 0) tiempo = 0;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return fail_('busy', 'El servidor está ocupado. Inténtalo de nuevo en unos segundos.');
  }
  var id;
  try {
    id = newExamId_();
    // La hoja de resultados se llama como el examen; se guarda su identificador interno para no depender del nombre.
    var resultsSheet = createResultsSheet_(titulo, questions);
    appendRowText_(getExamsSheet_(), [
      id,
      titulo,
      cleanText_(p.grupo_destino).slice(0, MAX_TEXT),
      true,
      cleanText_(p.codigo_acceso).slice(0, 40),
      tiempo,
      toBool_(p.barajar_preguntas),
      toBool_(p.barajar_opciones),
      toBool_(p.mostrar_nota),
      toBool_(p.permitir_negativa),
      json,
      new Date(),
      toBool_(p.control_salidas),
      allowedExits_(p.salidas_permitidas),
      penalizacion,
      toBool_(p.pantalla_completa),
      resultsSheet.getSheetId(),
      false // revisión: la publica el profesor desde el panel cuando todos han hecho el examen
    ], [1, 3, 5, 15]);
    formatExamsSheet_(getExamsSheet_()); // también embellece la hoja de quien ya la tenía
    storeImages_(id, images);
  } finally {
    lock.releaseLock();
  }

  var out = { ok: true, id: id, imagenes: images.length, abiertas: questions.filter(isOpen_).length, n_preguntas: questions.length, caracteres: json.length, penalizacion: penalizacion,
    pantalla_completa: toBool_(p.pantalla_completa) };
  if (json.length > WARN_CHARS) {
    out.warning = 'El examen ocupa ' + json.length + ' de 50 000 caracteres: está cerca del límite de la celda.';
  }
  return out;
}

function setActive_(p) {
  return setExamFlag_(p, 'activo', p.activo);
}

// Publica u oculta la revisión: con ella, cada alumno ve sus respuestas y las correctas.
function setReview_(p) {
  var res = setExamFlag_(p, 'revision', p.revision);
  if (res.ok) formatExamsSheet_(getExamsSheet_()); // da formato a la columna en hojas de versiones anteriores
  return res;
}

function setExamFlag_(p, name, value) {
  var auth = checkToken_(p.token);
  if (auth) return auth;
  var sheet = getExamsSheet_();
  var rows = sheet.getDataRange().getValues();
  var col = EXAM_HEADERS.indexOf(name);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.id)) {
      sheet.getRange(i + 1, col + 1).setValue(toBool_(value));
      var out = { ok: true, id: String(p.id) };
      out[name] = toBool_(value);
      return out;
    }
  }
  return fail_('not_found', 'Este examen no existe.');
}

// Revisión del alumno: sus respuestas, las correctas y los puntos de las abiertas. Solo si el profesor la ha
// publicado, y solo del envío cuyo identificador (aleatorio, guardado en el dispositivo del alumno) se presenta.
// Funciona aunque el examen esté cerrado.
function review_(p) {
  var exam = findExam_(p.examId);
  if (!exam) return fail_('not_found', 'Este examen no existe.');
  if (!exam.revision) return fail_('review_closed', 'Tu profesor todavía no ha publicado la revisión de este examen.');
  var envioId = typeof p.envioId === 'string' ? p.envioId.trim().slice(0, 64) : '';
  if (!envioId) return fail_('bad_request', 'Falta el identificador del envío.');

  var questions = JSON.parse(exam.preguntas_json);
  var sh = findResultsSheet_(exam);
  var rows = sh ? sh.getDataRange().getValues() : [];
  var H = rows.length ? headerMap_(rows[0].map(String)) : {};
  var row = null;
  if (H.envio_id !== undefined) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][H.envio_id]) === envioId) { row = rows[i]; break; }
    }
  }
  if (!row) return fail_('send_not_found', 'No se encuentra tu examen entre los enviados.');

  var answers = {};
  try { answers = JSON.parse(String(row[H.respuestas_json] || '{}')) || {}; } catch (err) { answers = {}; }
  var openQs = questions.filter(isOpen_);
  var get = function (name) { return H[name] === undefined ? '' : row[H[name]]; };
  return {
    ok: true,
    review: {
      titulo: exam.titulo,
      nombre: String(get('nombre')),
      apellidos: String(get('apellidos')),
      nota: finalGrade_(exam, openQs, questions, row, H),
      aciertos: get('aciertos'), errores: get('errores'), blancos: get('blancos'),
      imagenes: loadImages_(exam.id, questions),
      questions: questions.map(function (q) {
        var base = { id: q.id, text: q.text, valor: questionValue_(q) };
        if (isOpen_(q)) {
          var c = openColumns_(q, questions);
          var pts = H[c.pts] === undefined ? '' : row[H[c.pts]];
          base.tipo = 'abierta';
          base.respuesta = H[c.resp] === undefined ? '' : String(row[H[c.resp]]);
          base.puntos = pts === '' ? null : Number(pts);
          return base;
        }
        var given = answers[q.id];
        base.tipo = 'test';
        base.options = (q.options || []).map(function (o) { return { id: o.id, text: o.text }; });
        base.correcta = q.correct;
        base.respuesta = typeof given === 'string' && given !== '' ? given : null;
        return base;
      })
    }
  };
}

function listExams_(params) {
  var auth = checkToken_(params.token);
  if (auth) return auth;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var exams = readExams_().map(function (ex) {
    var sh = findResultsSheet_(ex);
    return {
      id: ex.id,
      titulo: ex.titulo,
      grupo_destino: ex.grupo_destino,
      activo: ex.activo,
      control_salidas: ex.control_salidas,
      salidas_permitidas: ex.salidas_permitidas,
      penalizacion: ex.penalizacion,
      pantalla_completa: ex.pantalla_completa,
      revision: ex.revision,
      codigo_acceso: ex.codigo_acceso,
      tiempo_min: ex.tiempo_min,
      n_preguntas: JSON.parse(ex.preguntas_json).length,
      n_abiertas: JSON.parse(ex.preguntas_json).filter(isOpen_).length,
      envios: sh ? Math.max(0, sh.getLastRow() - 1) : 0,
      creado: ex.creado,
      results_url: sh ? ss.getUrl() + '#gid=' + sh.getSheetId() : ss.getUrl()
    };
  });
  return { ok: true, exams: exams };
}

// Datos para la pantalla de corrección del panel: una fila por envío, con las respuestas abiertas y sus puntos.
function results_(p) {
  var auth = checkToken_(p.token);
  if (auth) return auth;
  var exam = findExam_(p.examId);
  if (!exam) return fail_('not_found', 'Este examen no existe.');
  var questions = JSON.parse(exam.preguntas_json);
  var sh = findResultsSheet_(exam);
  var rows = sh ? sh.getDataRange().getValues() : [];
  var H = rows.length ? headerMap_(rows[0].map(String)) : {};
  var openQs = questions.filter(isOpen_);
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var get = function (name) { return H[name] === undefined ? '' : r[H[name]]; };
    var abiertas = {};
    openQs.forEach(function (q) {
      var c = openColumns_(q, questions);
      var pts = H[c.pts] === undefined ? '' : r[H[c.pts]];
      abiertas[q.id] = { texto: H[c.resp] === undefined ? '' : String(r[H[c.resp]]), puntos: pts === '' ? null : Number(pts) };
    });
    var fecha = get('fecha');
    out.push({
      envio_id: String(get('envio_id')),
      apellidos: String(get('apellidos')),
      nombre: String(get('nombre')),
      grupo: String(get('grupo')),
      aciertos: get('aciertos'), errores: get('errores'), blancos: get('blancos'),
      salidas: Number(get('salidas')) || 0,
      segundos_fuera: Number(get('segundos_fuera')) || 0,
      pegados: Number(get('pegados')) || 0,
      fecha: fecha instanceof Date ? fecha.toISOString() : String(fecha),
      nota: finalGrade_(exam, openQs, questions, r, H),
      pendientes: openQs.filter(function (q) { return abiertas[q.id].puntos === null; }).length,
      abiertas: abiertas
    });
  }
  return {
    ok: true,
    exam: {
      id: exam.id, titulo: exam.titulo,
      preguntas: questions.map(function (q, i) { return { id: q.id, n: i + 1, title: q.title, text: q.text, tipo: isOpen_(q) ? 'abierta' : 'test', valor: questionValue_(q) }; }),
      imagenes: loadImages_(exam.id, questions)
    },
    rows: out
  };
}

// Nota sobre 10 de una fila: test + puntos puestos en las abiertas (las no corregidas suman 0).
function finalGrade_(exam, openQs, questions, row, H) {
  var base = Number(row[H.nota]);
  if (!openQs.length || H.puntos_test === undefined || H.puntos_total === undefined) return isFinite(base) ? base : '';
  var sum = Number(row[H.puntos_test]) || 0;
  openQs.forEach(function (q) {
    var c = openColumns_(q, questions);
    if (H[c.pts] !== undefined && row[H[c.pts]] !== '') sum += Number(row[H[c.pts]]) || 0;
  });
  var total = Number(row[H.puntos_total]);
  if (!total) return '';
  var nota = sum / total * 10;
  if (!exam.permitir_negativa && nota < 0) nota = 0;
  return Math.round((nota + Number.EPSILON * Math.sign(nota)) * 100) / 100 || 0;
}

// Pone (o borra, con null) los puntos de una pregunta abierta de un envío.
function grade_(p) {
  var auth = checkToken_(p.token);
  if (auth) return auth;
  var exam = findExam_(p.examId);
  if (!exam) return fail_('not_found', 'Este examen no existe.');
  var questions = JSON.parse(exam.preguntas_json);
  var q = questions.filter(function (x) { return x.id === p.qid; })[0];
  if (!q || !isOpen_(q)) return fail_('invalid_grade', 'Esa pregunta no es abierta.');
  var puntos = null;
  if (p.puntos !== null && p.puntos !== undefined && p.puntos !== '') {
    puntos = Number(p.puntos);
    if (!isFinite(puntos) || puntos < 0 || puntos > questionValue_(q)) {
      return fail_('invalid_grade', 'Los puntos deben estar entre 0 y ' + questionValue_(q) + '.');
    }
    puntos = Math.round(puntos * 10000) / 10000;
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return fail_('busy', 'El servidor está ocupado. Inténtalo de nuevo en unos segundos.');
  }
  try {
    var sh = getResultsSheet_(exam, questions);
    var rows = sh.getDataRange().getValues();
    var H = headerMap_(rows[0].map(String));
    var c = openColumns_(q, questions);
    if (H[c.pts] === undefined || H.envio_id === undefined) return fail_('invalid_grade', 'La hoja de este examen no admite corrección.');
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][H.envio_id]) !== String(p.envioId)) continue;
      sh.getRange(i + 1, H[c.pts] + 1).setValue(puntos === null ? '' : puntos);
      rows[i][H[c.pts]] = puntos === null ? '' : puntos;
      var openQs = questions.filter(isOpen_);
      var pend = openQs.filter(function (x) { var v = rows[i][H[openColumns_(x, questions).pts]]; return v === '' || v === undefined; }).length;
      var nota = finalGrade_(exam, openQs, questions, rows[i], H);
      // Se escriben valores (no fórmulas): la nota y las pendientes de la hoja siempre coinciden con el panel.
      if (nota !== '') sh.getRange(i + 1, (H.nota_final !== undefined ? H.nota_final : H.nota) + 1).setValue(nota);
      if (H.pendientes !== undefined) sh.getRange(i + 1, H.pendientes + 1).setValue(pend);
      return { ok: true, puntos: puntos, pendientes: pend, nota: nota };
    }
    return fail_('not_found', 'No se ha encontrado ese envío.');
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Corrección (réplica exacta de js/grading.js)                        */
/* ------------------------------------------------------------------ */

function questionValue_(q) {
  var v = Number(q && q.valor);
  return isFinite(v) && v > 0 ? v : 1;
}

function isOpen_(q) {
  return !!q && q.tipo === 'abierta';
}

function gradeExam_(questions, answers, opts) {
  var allowNegative = !!(opts && opts.allowNegative);
  var penalty = (opts && opts.penalty) || null; // {num, den}: fracción de punto por error; null = 1/(opciones-1)
  if (!questions.length) throw new Error('El examen no tiene preguntas.');

  var aciertos = 0, errores = 0, blancos = 0, penalizacion = 0;
  var valorAciertos = 0, valorErrores = 0, puntosTestMax = 0, puntosTotal = 0, abiertas = 0;

  questions.forEach(function (q) {
    var valor = questionValue_(q);
    puntosTotal += valor;
    if (isOpen_(q)) { abiertas++; return; }
    puntosTestMax += valor;
    var given = answers ? answers[q.id] : undefined;
    if (given === undefined || given === null || given === '') {
      blancos++;
      return;
    }
    if (!q.options.some(function (o) { return o.id === given; })) {
      throw new Error('Respuesta no válida en ' + q.id + ': ' + given);
    }
    if (given === q.correct) {
      aciertos++;
      valorAciertos += valor;
    } else {
      errores++;
      valorErrores += valor;
      if (!penalty) penalizacion += valor / (q.options.length - 1);
    }
  });

  // Con penalización propia se calcula con enteros: (Σacierto·den − Σerror·num) / den.
  var puntos = penalty ? (valorAciertos * penalty.den - valorErrores * penalty.num) / penalty.den : valorAciertos - penalizacion;
  function round2(x) {
    var r = Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;
    return r === 0 ? 0 : r; // evita -0
  }
  var nota = (puntos / puntosTotal) * 10;
  if (!allowNegative && nota < 0) nota = 0;
  nota = round2(nota);
  var puntosTest = round2(!allowNegative && puntos < 0 ? 0 : puntos);

  return { aciertos: aciertos, errores: errores, blancos: blancos, puntos: puntos, puntosTest: puntosTest,
    puntosTestMax: round2(puntosTestMax), puntosTotal: round2(puntosTotal), abiertas: abiertas, nota: nota };
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (!expected) {
    return fail_('token_not_configured', 'Falta la propiedad ADMIN_TOKEN en el script.');
  }
  if (typeof token !== 'string' || token !== expected) {
    return fail_('unauthorized', 'Token de administración incorrecto.');
  }
  return null;
}

// Devuelve null si el código es válido, o el motivo del rechazo.
function checkCode_(exam, code) {
  if (exam.codigo_acceso === '') return null;
  var given = String(code === undefined || code === null ? '' : code).trim();
  if (given === '') return 'code_required';
  return given.toLowerCase() === exam.codigo_acceso.toLowerCase() ? null : 'bad_code';
}

function cleanText_(s) {
  return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
}

function normalize_(s) {
  return String(s === undefined || s === null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Número entero o con `decimals` decimales, entre 0 y max; 0 si no es un número.
function clampNumber_(v, max, decimals) {
  var n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  var f = Math.pow(10, decimals || 0);
  return Math.round(Math.min(n, max) * f) / f;
}

// Penalización por error como fracción de punto ("1/3", "0", "1"). Réplica de parsePenalty de js/grading.js.
// Devuelve {num, den} reducida, o null si no se indica (penalización automática).
function parsePenalty_(input) {
  if (input === undefined || input === null) return null;
  var text = String(input).trim();
  if (text === '') return null;
  var m = /^(\d{1,3})\s*(?:\/\s*(\d{1,3}))?$/.exec(text);
  if (!m) throw new Error('La penalización debe ser una fracción, por ejemplo 1/3.');
  var num = Number(m[1]);
  var den = m[2] === undefined ? 1 : Number(m[2]);
  if (den < 1) throw new Error('El denominador de la penalización debe ser al menos 1.');
  if (num > den) throw new Error('La penalización no puede ser mayor que 1 punto (el numerador no puede superar al denominador).');
  var a = num, b = den;
  while (b !== 0) { var t = a % b; a = b; b = t; }
  var g = a || 1;
  return { num: num / g, den: den / g };
}

function formatPenalty_(p) {
  if (!p) return '';
  return p.den === 1 ? String(p.num) : p.num + '/' + p.den;
}

// Penalización guardada en la hoja: texto válido o '' (automática) si la celda está vacía o ilegible.
function storedPenalty_(v) {
  try {
    return formatPenalty_(parsePenalty_(v));
  } catch (err) {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Imágenes de los enunciados                                          */
/* ------------------------------------------------------------------ */

// Réplica de js/images.js: ![descripción](archivo.png), solo el nombre del archivo.
var IMAGE_TOKEN = /!\[([^\]\n]*)\]\(([^)\s]+)\)/gu;
var IMAGE_NAME_OK = /^[\p{L}\p{N}_.\-]{1,60}$/u;

function imageNames_(text) {
  var out = [];
  String(text === undefined || text === null ? '' : text).replace(IMAGE_TOKEN, function (all, alt, name) {
    if (out.indexOf(name) === -1) out.push(name);
    return all;
  });
  return out;
}

function referencedImages_(questions) {
  var names = [];
  questions.forEach(function (q) {
    imageNames_(q.text).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
  });
  return names;
}

// Comprueba las imágenes recibidas del panel frente a las citadas en las preguntas.
// Devuelve solo las citadas, con el nombre tal como aparece en el enunciado.
function validateImages_(input, questions) {
  var refs = referencedImages_(questions);
  refs.forEach(function (n) {
    if (!IMAGE_NAME_OK.test(n) || /^https?$/i.test(n)) {
      throw new Error('La imagen "' + n + '" no es válida: escribe solo el nombre del archivo, sin carpetas ni direcciones de internet.');
    }
  });
  var given = input === undefined || input === null ? [] : input;
  if (!Array.isArray(given)) throw new Error('Las imágenes no tienen el formato esperado.');
  if (given.length > MAX_IMAGES) throw new Error('Demasiadas imágenes (máximo ' + MAX_IMAGES + ').');

  var byName = {};
  var total = 0;
  given.forEach(function (img) {
    if (!img || typeof img.nombre !== 'string' || !IMAGE_NAME_OK.test(img.nombre)) {
      throw new Error('Una imagen tiene un nombre no válido.');
    }
    if (IMAGE_MIMES.indexOf(img.mime) === -1) {
      throw new Error('La imagen "' + img.nombre + '" no es PNG, JPEG, WebP ni GIF.');
    }
    if (typeof img.data !== 'string' || !/^[A-Za-z0-9+\/]+=*$/.test(img.data)) {
      throw new Error('La imagen "' + img.nombre + '" no está bien codificada.');
    }
    if (img.data.length > MAX_IMAGE_CHARS) {
      throw new Error('La imagen "' + img.nombre + '" es demasiado grande (máximo unos 240 KB tras reducirla).');
    }
    total += img.data.length;
    var key = img.nombre.toLowerCase();
    if (byName[key]) throw new Error('La imagen "' + img.nombre + '" está repetida.');
    byName[key] = img;
  });
  if (total > MAX_TOTAL_IMAGE_CHARS) throw new Error('Las imágenes del examen pesan demasiado en total (máximo unos 1,5 MB).');

  return refs.map(function (name) {
    var img = byName[name.toLowerCase()];
    if (!img) throw new Error('Falta la imagen "' + name + '", citada en una pregunta.');
    return { nombre: name, mime: img.mime, data: img.data };
  });
}

function getImagesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_IMAGES);
  if (!sh) {
    sh = ss.insertSheet(SHEET_IMAGES);
    sh.appendRow(IMAGE_HEADERS);
    sh.setFrozenRows(1);
    setTextColumns_(sh, [1, 2, 3, 4, 5]);
  }
  return sh;
}

// Guarda las imágenes de un examen troceadas (una fila por trozo). Usar con el lock tomado.
function storeImages_(examId, images) {
  if (!images.length) return;
  var rows = [];
  images.forEach(function (img) {
    for (var i = 0, n = 0; i < img.data.length; i += IMAGE_CHUNK, n++) {
      rows.push([examId, img.nombre, String(n), img.mime, img.data.slice(i, i + IMAGE_CHUNK)]);
    }
  });
  var sh = getImagesSheet_();
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, IMAGE_HEADERS.length).setNumberFormat('@');
  sh.getRange(start, 1, rows.length, IMAGE_HEADERS.length).setValues(rows);
}

// Imágenes de un examen como {nombre: "data:image/png;base64,..."}, con caché (6 h) para que 30 alumnos
// abriendo el examen a la vez no lean la hoja 30 veces.
function loadImages_(examId, questions) {
  var names = referencedImages_(questions);
  if (!names.length) return {};
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (err) { cache = null; }

  var metaKey = 'imgm:' + examId;
  if (cache) {
    try {
      var meta = cache.get(metaKey);
      if (meta) {
        var list = JSON.parse(meta);
        var keys = [];
        list.forEach(function (it, k) { for (var j = 0; j < it.n; j++) keys.push('imgp:' + examId + ':' + k + ':' + j); });
        var parts = cache.getAll(keys);
        var ok = keys.every(function (key) { return parts[key] !== undefined && parts[key] !== null; });
        if (ok) {
          var cached = {};
          list.forEach(function (it, k) {
            var data = '';
            for (var j = 0; j < it.n; j++) data += parts['imgp:' + examId + ':' + k + ':' + j];
            cached[it.nombre] = 'data:' + it.mime + ';base64,' + data;
          });
          return cached;
        }
      }
    } catch (err) { /* sin caché: se lee de la hoja */ }
  }

  var rows = getImagesSheet_().getDataRange().getValues();
  var byName = {};
  var order = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(examId)) continue;
    var nombre = String(rows[i][1]);
    if (!byName[nombre]) { byName[nombre] = { mime: String(rows[i][3]), chunks: [] }; order.push(nombre); }
    byName[nombre].chunks[Number(rows[i][2])] = String(rows[i][4]);
  }
  var out = {};
  var forCache = [];
  order.forEach(function (nombre) {
    var data = byName[nombre].chunks.join('');
    out[nombre] = 'data:' + byName[nombre].mime + ';base64,' + data;
    forCache.push({ nombre: nombre, mime: byName[nombre].mime, data: data });
  });

  if (cache && forCache.length) {
    try {
      var put = {};
      var metaList = forCache.map(function (it, k) {
        var n = 0;
        for (var i2 = 0; i2 < it.data.length; i2 += CACHE_PART, n++) put['imgp:' + examId + ':' + k + ':' + n] = it.data.slice(i2, i2 + CACHE_PART);
        return { nombre: it.nombre, mime: it.mime, n: n };
      });
      put[metaKey] = JSON.stringify(metaList);
      cache.putAll(put, CACHE_SECONDS);
    } catch (err) { /* la caché es opcional */ }
  }
  return out;
}

// Salidas permitidas antes del envío automático: entero 0..20; 3 si no se indica.
function allowedExits_(v) {
  if (v === undefined || v === null || v === '') return DEFAULT_ALLOWED_EXITS;
  var n = Math.floor(Number(v));
  if (!isFinite(n)) return DEFAULT_ALLOWED_EXITS;
  return Math.max(0, Math.min(MAX_ALLOWED_EXITS, n));
}

function toBool_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function newExamId_() {
  var existing = {};
  readExams_().forEach(function (e) { existing[e.id] = true; });
  var id;
  for (var tries = 0; tries < 20; tries++) {
    // Empieza por letra: Sheets convertiría "545297e4" en el número 5452970000.
    id = 'x' + Utilities.getUuid().replace(/-/g, '').slice(0, 7);
    if (!existing[id]) return id;
  }
  throw new Error('No se pudo generar un identificador único.');
}

// Valida y limpia las preguntas recibidas del panel (el servidor no se fía del cliente).
function validateQuestions_(qs) {
  if (!Array.isArray(qs) || qs.length === 0) throw new Error('El examen no tiene preguntas.');
  if (qs.length > MAX_QUESTIONS) throw new Error('Demasiadas preguntas (máximo ' + MAX_QUESTIONS + ').');
  var seen = {};
  return qs.map(function (q, i) {
    var n = i + 1;
    if (!q || typeof q.id !== 'string' || !q.id || seen[q.id]) {
      throw new Error('Pregunta ' + n + ': identificador no válido o repetido.');
    }
    seen[q.id] = true;
    var text = typeof q.text === 'string' ? q.text.trim() : '';
    if (!text) throw new Error('Pregunta ' + n + ': enunciado vacío.');
    var valor = q.valor === undefined || q.valor === null ? 1 : Number(q.valor);
    if (!isFinite(valor) || valor <= 0 || valor > MAX_VALUE) {
      throw new Error('Pregunta ' + n + ': el valor debe ser mayor que 0 y como mucho ' + MAX_VALUE + '.');
    }
    valor = Math.round(valor * 10000) / 10000;
    var title = typeof q.title === 'string' ? q.title.trim() : '';
    if (q.tipo === 'abierta') {
      if (Array.isArray(q.options) && q.options.length) {
        throw new Error('Pregunta ' + n + ': una pregunta abierta no lleva opciones.');
      }
      return { id: q.id, title: title, text: text, options: [], correct: null, tipo: 'abierta', valor: valor };
    }
    if (q.tipo !== undefined && q.tipo !== 'test') throw new Error('Pregunta ' + n + ': tipo de pregunta no válido.');
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > MAX_OPTIONS) {
      throw new Error('Pregunta ' + n + ': debe tener entre 2 y ' + MAX_OPTIONS + ' opciones.');
    }
    var ids = {};
    var options = q.options.map(function (o) {
      if (!o || typeof o.id !== 'string' || !o.id || ids[o.id] ||
          typeof o.text !== 'string' || !o.text.trim()) {
        throw new Error('Pregunta ' + n + ': opciones no válidas.');
      }
      ids[o.id] = true;
      return { id: o.id, text: o.text.trim() };
    });
    if (!ids[q.correct]) throw new Error('Pregunta ' + n + ': la respuesta correcta no es una de las opciones.');
    return {
      id: q.id,
      title: title,
      text: text,
      options: options,
      correct: q.correct,
      tipo: 'test',
      valor: valor
    };
  });
}

/* ------------------------------------------------------------------ */
/* Acceso a las hojas                                                  */
/* ------------------------------------------------------------------ */

// Columnas que deben ser texto plano (evita que "1-2" se convierta en fecha, etc.)
function setTextColumns_(sheet, cols) {
  cols.forEach(function (c) {
    sheet.getRange(1, c, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
}

// Añade una fila marcando antes como texto plano las columnas indicadas, para que
// Sheets no convierta ids, códigos o grupos en números o fechas. Usar con el lock tomado.
function appendRowText_(sheet, values, textCols) {
  var row = sheet.getLastRow() + 1;
  textCols.forEach(function (c) {
    sheet.getRange(row, c).setNumberFormat('@');
  });
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
}

// Cabeceras de una hoja -> posición de cada una (desde 0).
function headerMap_(headers) {
  var map = {};
  headers.forEach(function (h, i) { if (map[h] === undefined) map[h] = i; });
  return map;
}

// Si la hoja es de una versión anterior (menos columnas), añade las cabeceras que faltan.
// Devuelve true si ha añadido alguna.
function ensureHeaders_(sheet, headers) {
  var added = false;
  for (var i = sheet.getLastColumn(); i < headers.length; i++) {
    sheet.getRange(1, i + 1).setValue(headers[i]);
    added = true;
  }
  return added;
}

function getExamsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_EXAMS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_EXAMS);
    sh.appendRow(EXAM_HEADERS);
    sh.setFrozenRows(1);
    setTextColumns_(sh, [1, 3, 5]);
    formatExamsSheet_(sh);
  } else if (ensureHeaders_(sh, EXAM_HEADERS)) {
    formatExamsSheet_(sh); // las columnas nuevas (p. ej. revision) con el mismo aspecto que las demás
  }
  return sh;
}

// Orden de las columnas de una hoja nueva: primero lo que el profesor mira (quién, nota final, incidencias)
// y, al final y ocultas, las columnas técnicas (respuestas, puntos de las abiertas, identificadores).
function newResultLayout_(questions) {
  var open = (questions || []).filter(isOpen_);
  var visible = ['apellidos', 'nombre', 'grupo', 'nota'];
  if (open.length) visible.push('pendientes');
  visible = visible.concat(['aciertos', 'errores', 'blancos', 'salidas', 'segundos_fuera', 'pegados', 'duracion_min', 'fecha', 'posible_duplicado']);
  var hidden = ['puntos_test', 'puntos_total'];
  open.forEach(function (q) {
    var c = openColumns_(q, questions);
    hidden.push(c.resp, c.pts);
  });
  hidden = hidden.concat(['tipo_envio', 'envio_id', 'motivos_salida', 'respuestas_json']);
  return { headers: visible.concat(hidden), visible: visible.length };
}

// Solo presentación: si algo falla aquí, la hoja sigue siendo válida.
function formatResultsSheet_(sh, layout) {
  var n = layout.headers.length;
  var vis = layout.visible;
  var rowsMax = sh.getMaxRows();
  try {
    sh.setFrozenColumns(2);
    sh.setColumnWidth(1, 170);
    sh.setColumnWidth(2, 130);
    sh.setColumnWidth(3, 80);
    for (var c = 4; c <= vis; c++) sh.setColumnWidth(c, 95);
    sh.setColumnWidth(vis - 1, 150); // fecha
    if (n > vis) sh.hideColumns(vis + 1, n - vis);
  } catch (err) {
    console.error(err);
  }
  try {
    // Cabecera azul, filas alternas y bordes suaves en la parte visible.
    var head = sh.getRange(1, 1, 1, vis);
    head.setFontWeight('bold').setBackground('#1f5fbf').setFontColor('#ffffff')
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    sh.setRowHeight(1, 38);
    sh.getRange(1, 1, 1, 3).setHorizontalAlignment('left');
    var body = sh.getRange(2, 1, rowsMax - 1, vis);
    body.setVerticalAlignment('middle').setBorder(true, true, true, true, true, true, '#d9dee5', SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(2, 4, rowsMax - 1, vis - 3).setHorizontalAlignment('center');
    sh.getRange(2, 4, rowsMax - 1, 1).setFontWeight('bold').setFontSize(12).setNumberFormat('0.00');
    var rule = function (name, build) {
      var col = layout.headers.indexOf(name) + 1;
      if (!col) return null;
      return build(SpreadsheetApp.newConditionalFormatRule()).setRanges([sh.getRange(2, col, rowsMax - 1, 1)]).build();
    };
    var rules = [
      rule('nota', function (r) { return r.whenNumberLessThan(5).setBackground('#fde2e1').setFontColor('#a4262c'); }),
      rule('nota', function (r) { return r.whenNumberGreaterThanOrEqualTo(5).setBackground('#dff3e4').setFontColor('#176b34'); }),
      rule('pendientes', function (r) { return r.whenNumberGreaterThan(0).setBackground('#fff1c9').setFontColor('#8a5a00').setBold(true); }),
      rule('salidas', function (r) { return r.whenNumberGreaterThan(0).setBackground('#fde2e1').setFontColor('#a4262c').setBold(true); }),
      rule('segundos_fuera', function (r) { return r.whenNumberGreaterThan(0).setBackground('#fde2e1').setFontColor('#a4262c'); }),
      rule('pegados', function (r) { return r.whenNumberGreaterThan(0).setBackground('#fff1c9').setFontColor('#8a5a00').setBold(true); }),
      rule('posible_duplicado', function (r) { return r.whenFormulaSatisfied('=$' + String.fromCharCode(64 + layout.headers.indexOf('posible_duplicado') + 1) + '2=TRUE').setBackground('#fff1c9').setFontColor('#8a5a00'); })
    ].filter(Boolean);
    sh.setConditionalFormatRules(rules);
    sh.getRange(2, 1, rowsMax - 1, vis).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  } catch (err) {
    console.error(err);
  }
}

// Cabeceras de la respuesta y los puntos de una pregunta abierta (Q3 …). Solo dependen de su posición y título.
function openColumns_(q, questions) {
  var n = questions.indexOf(q) + 1;
  var t = (q.title || '').replace(/\s+/g, ' ').slice(0, 30);
  var base = 'Q' + n + (t ? ' ' + t : '');
  return { resp: base + ' respuesta', pts: base + ' puntos (máx ' + questionValue_(q) + ')' };
}

// Cabeceras de las columnas añadidas a una hoja de resultados, según las preguntas del examen.
function resultHeaders_(questions) {
  var cols = RESULT_POINTS.slice();
  var open = (questions || []).filter(isOpen_);
  open.forEach(function (q) {
    var c = openColumns_(q, questions);
    cols.push(c.resp, c.pts);
  });
  if (open.length) cols.push('pendientes');
  return cols;
}

// Solo presentación (se puede repetir sin problema): cabecera de color, filas alternas, «activo» en verde o rojo
// y ocultas las columnas técnicas (las preguntas con sus soluciones y el identificador de la hoja de resultados).
function formatExamsSheet_(sh) {
  var n = EXAM_HEADERS.length;
  var col = function (name) { return EXAM_HEADERS.indexOf(name) + 1; };
  var rowsMax = sh.getMaxRows();
  try {
    // Exámenes publicados antes de existir la columna «revision»: vacía equivale a FALSO; se escribe para que se vea igual.
    var last = sh.getLastRow();
    if (last > 1) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      var rev = sh.getRange(2, col('revision'), last - 1, 1);
      var vals = rev.getValues();
      var changed = false;
      for (var r = 0; r < vals.length; r++) {
        if (ids[r][0] !== '' && vals[r][0] === '') { vals[r][0] = false; changed = true; }
      }
      if (changed) rev.setValues(vals);
    }
  } catch (err) {
    console.error(err);
  }
  try {
    sh.setFrozenRows(1);
    sh.setFrozenColumns(2);
    sh.setColumnWidth(col('id'), 95);
    sh.setColumnWidth(col('titulo'), 280);
    sh.setColumnWidth(col('grupo_destino'), 90);
    sh.setColumnWidth(col('codigo_acceso'), 100);
    sh.setColumnWidth(col('creado'), 140);
    sh.setColumnWidth(col('revision'), 90);
    sh.hideColumns(col('preguntas_json'), 1);
    sh.hideColumns(col('hoja_id'), 1);
  } catch (err) {
    console.error(err);
  }
  try {
    sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#1f5fbf').setFontColor('#ffffff')
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    sh.setRowHeight(1, 38);
    sh.getRange(1, col('titulo'), 1, 1).setHorizontalAlignment('left');
    sh.getRange(2, 1, rowsMax - 1, n).setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true, '#d9dee5', SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(2, col('activo'), rowsMax - 1, n - col('activo') + 1).setHorizontalAlignment('center');
    sh.getRange(2, col('titulo'), rowsMax - 1, 1).setFontWeight('bold');
    sh.getRange(2, col('creado'), rowsMax - 1, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    // «activo» y «revision»: VERDADERO en verde y FALSO en rojo.
    var rules = [];
    ['activo', 'revision'].forEach(function (name) {
      var letter = String.fromCharCode(64 + col(name));
      var rule = function (formula, bg, fg) {
        return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(bg).setFontColor(fg).setBold(true)
          .setRanges([sh.getRange(2, col(name), rowsMax - 1, 1)]).build();
      };
      rules.push(rule('=$' + letter + '2=TRUE', '#dff3e4', '#176b34'), rule('=$' + letter + '2=FALSE', '#fde2e1', '#a4262c'));
    });
    sh.setConditionalFormatRules(rules);
    var old = sh.getBandings();
    for (var i = 0; i < old.length; i++) old[i].remove();
    sh.getRange(2, 1, rowsMax - 1, n).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  } catch (err) {
    console.error(err);
  }
}

// Nombre de pestaña válido a partir del título: sin caracteres prohibidos, máximo 90 y sin repetir otra pestaña.
function sheetNameFor_(title) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var base = String(title || '').replace(/[\[\]*\/\\?:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, 90).trim() || 'Examen';
  var name = base;
  for (var i = 2; ss.getSheetByName(name); i++) name = base + ' (' + i + ')';
  return name;
}

// La hoja de resultados de un examen: por su identificador (sigue valiendo si la renombras) o, en los exámenes
// anteriores, por el nombre R_<id>.
function findResultsSheet_(exam) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (exam.hoja_id !== '' && exam.hoja_id !== undefined) {
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].getSheetId()) === String(exam.hoja_id)) return all[i];
    }
  }
  return ss.getSheetByName('R_' + exam.id);
}

function createResultsSheet_(title, questions) {
  var layout = newResultLayout_(questions);
  var headers = layout.headers;
  var sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet(sheetNameFor_(title));
  sh.appendRow(headers);
  sh.setFrozenRows(1);
  formatResultsSheet_(sh, layout);
  var textNames = RESULT_TEXT_COLUMNS.concat((questions || []).filter(isOpen_).map(function (q) { return openColumns_(q, questions).resp; }));
  setTextColumns_(sh, textNames.map(function (nm) { return headers.indexOf(nm) + 1; }));
  return sh;
}

// Devuelve la hoja del examen; si no existe (p. ej. se borró) la crea y anota su identificador. Usar con el lock tomado.
function getResultsSheet_(exam, questions) {
  var sh = findResultsSheet_(exam);
  if (!sh) {
    sh = createResultsSheet_(exam.titulo, questions);
    var exams = getExamsSheet_();
    var rows = exams.getDataRange().getValues();
    var col = EXAM_HEADERS.indexOf('hoja_id');
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(exam.id)) { exams.getRange(i + 1, col + 1).setValue(sh.getSheetId()); break; }
    }
  } else {
    // Hoja de una versión anterior: se añaden al final las columnas que falten (por nombre).
    var have = headerMap_(sh.getDataRange().getValues()[0].map(String));
    RESULT_EXTRA.concat(resultHeaders_(questions)).forEach(function (nm) {
      if (have[nm] === undefined) sh.getRange(1, sh.getLastColumn() + 1).setValue(nm);
    });
  }
  return sh;
}

function readExams_() {
  var rows = getExamsSheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (r[0] === '' || r[0] === undefined) continue;
    out.push({
      id: String(r[0]),
      titulo: String(r[1]),
      grupo_destino: String(r[2]),
      activo: toBool_(r[3]),
      codigo_acceso: String(r[4]).trim(),
      tiempo_min: Number(r[5]) || 0,
      barajar_preguntas: toBool_(r[6]),
      barajar_opciones: toBool_(r[7]),
      mostrar_nota: toBool_(r[8]),
      permitir_negativa: toBool_(r[9]),
      preguntas_json: String(r[10]),
      creado: r[11],
      control_salidas: toBool_(r[12]),
      salidas_permitidas: allowedExits_(r[13]),
      penalizacion: storedPenalty_(r[14]),
      pantalla_completa: toBool_(r[15]),
      hoja_id: r[16] === '' || r[16] === undefined ? '' : String(r[16]),
      revision: toBool_(r[17])
    });
  }
  return out;
}

function findExam_(id) {
  if (id === undefined || id === null || id === '') return null;
  var all = readExams_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === String(id)) return all[i];
  }
  return null;
}

/**
 * Opcional: ejecútala una vez a mano desde el editor para crear la hoja
 * "Examenes" y comprobar que los permisos están concedidos. También vuelve a dar
 * formato a la hoja "Examenes" (útil tras actualizar el script).
 */
function setup() {
  formatExamsSheet_(getExamsSheet_());
}
