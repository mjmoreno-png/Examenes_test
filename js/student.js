// Página del alumno (index.html?e=ID). Todo el contenido del examen se pinta con
// textContent: nunca se inserta HTML procedente del servidor.
import { fetchExam, submitExam, fetchReview, beaconSubmit, NetworkError, ConfigError } from "./api.js";
import { h } from "./dom.js";
import { isReducedWindow, mouseExitZone, trackLargest } from "./presence.js";
import { createWatcher } from "./watch.js";
import { richNodes } from "./rich.js";
import { normalize, seededShuffle, formatClock, penaltyFraction, formatNumber, newSendId } from "./util.js";
import { parsePenalty, questionValue, isOpenQuestion, isShortQuestion } from "./grading.js";
import { MAX_SHORT_CHARS, BLANK, blankLabels } from "./short.js";
import { convalidablePart, isConvalidable } from "./gift.js";

// Cuadros de una pregunta de respuesta corta con varios: tantos como marcas en su enunciado (0 = un solo cuadro,
// el de siempre). El alumno nunca recibe las respuestas aceptadas, solo el enunciado con las marcas.
const blankCount = (q) => (isShortQuestion(q) ? String(q.text ?? "").split(BLANK).length - 1 : 0);

const MAX_OPEN_CHARS = 4000;

const MAX_TEXT = 60;
const RETRY_DELAYS = [2000, 4000, 8000];

const app = document.getElementById("app");
const examId = new URLSearchParams(location.search).get("e");

/* ---------------------------- utilidades DOM ---------------------------- */

const render = (...nodes) => {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------- almacenamiento (con respaldo) ------------------- */

const memory = new Map();
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};

const progressKey = (nombre, apellidos, grupo) => `examen:${examId}:${normalize(apellidos)}|${normalize(nombre)}|${normalize(grupo)}`;
const lastKey = () => `examen:${examId}:ultimo`;
// Envíos hechos desde este dispositivo: su identificador permite ver la revisión cuando el profesor la publique.
const sentKey = () => `examen:${examId}:enviados`;
const MAX_SENT = 20;

function rememberSend(entry) {
  const list = (Array.isArray(loadJson(sentKey())) ? loadJson(sentKey()) : []).filter((e) => e?.envioId !== entry.envioId);
  list.unshift(entry);
  store.set(sentKey(), JSON.stringify(list.slice(0, MAX_SENT)));
}

function loadJson(key) {
  try {
    return JSON.parse(store.get(key));
  } catch {
    return null;
  }
}

/* ------------------------- pantalla completa ---------------------------- */

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const fsSupported = Boolean(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

const fsState = { failed: false }; // true si el navegador ha rechazado la pantalla completa: ya no se exige

// Tableta (o móvil): el puntero principal es el dedo. El iPad también se reconoce cuando Safari se presenta como un
// Mac («sitio web de escritorio», activado por defecto en iPad): un «Mac» con pantalla táctil es un iPad.
// Los portátiles táctiles (puntero principal: ratón o panel) no cuentan como tableta.
const isTablet =
  (window.matchMedia?.("(pointer: coarse)").matches ?? false) ||
  (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1);

// La pantalla completa, si el profesor la exige, solo se pide en ordenadores (Mac, Windows...): en tabletas y
// móviles su comportamiento depende demasiado del navegador, y allí la vigilancia funciona sin ella.
const fullscreenRequired = (flag) => Boolean(flag) && fsSupported && !isTablet;

// Debe llamarse dentro de un gesto del usuario (pulsar o tocar). Si no se puede, se sigue sin ella.
// Un intento automático (auto) que falla no desactiva la exigencia: el siguiente toque lo reintenta.
async function enterFullscreen({ auto = false } = {}) {
  if (!fsSupported || fsElement()) return;
  const el = document.documentElement;
  try {
    await (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    fsState.failed = false;
  } catch {
    if (!auto) fsState.failed = true;
  }
}

/* ------------------------------ pantallas ------------------------------- */

function showMessage(title, text, kind = "info") {
  render(h("div", { class: "card" }, h("h1", {}, title), h("div", { class: `notice ${kind}` }, h("p", {}, text))));
}

// Norma de salidas para el alumno. No menciona cuántas salidas se toleran.
function exitRule(fullscreen) {
  return (
    "No puedes salir de la pantalla del examen: no cambies de pestaña, de ventana ni de aplicación, ni uses otra web al mismo tiempo. " +
    (fullscreen
      ? "El examen se abre a pantalla completa y solo se muestra así: si reduces la ventana, cambias de aplicación o sales de la pantalla completa, el examen se oculta hasta que vuelvas. "
      : "El examen debe ocupar toda la pantalla, sin pantalla dividida: si reduces la ventana o cambias de aplicación, el examen se oculta hasta que vuelvas. ") +
    "Cada salida queda registrada con el tiempo que estés fuera y, si continúas saliendo, el examen se enviará automáticamente tal como esté."
  );
}

// `penalizacion`: fracción elegida por el profesor ("1/4", "0"...) o vacía = automática (1/(opciones-1)).
// `nShorts`: preguntas de respuesta corta según el servidor, para cuando el examen aún no está cargado (código de acceso).
function scoringText(questions, penalizacion, nShorts = 0) {
  let custom = null;
  try {
    custom = parsePenalty(penalizacion);
  } catch {
    custom = null;
  }
  const qs = questions ?? [];
  const tests = qs.filter((q) => !isOpenQuestion(q) && !isShortQuestion(q));
  const shortCount = questions ? qs.filter(isShortQuestion).length : Number(nShorts) || 0;
  const opens = qs.filter(isOpenQuestion);
  const weighted = qs.some((q) => questionValue(q) !== 1); // alguna pregunta no vale 1 punto
  const ks = new Set(tests.map((q) => q.options.length));
  let penalty; // texto de lo que resta cada error, o null si no resta nada
  if (questions && !tests.length) {
    penalty = null; // solo hay preguntas de respuesta corta o abiertas: nada resta
  } else if (custom) {
    penalty = custom.num === 0 ? null : custom.den === 1 ? `${custom.num} punto` : `${custom.num}/${custom.den} de punto`;
  } else {
    penalty =
      ks.size === 1
        ? `${penaltyFraction([...ks][0])} de punto`
        : "una fracción de punto (1/3 si la pregunta tiene 4 opciones)";
  }
  if (weighted && penalty) penalty = penalty.replace(/ de punto$| punto$/, (m) => (m.startsWith(" de") ? " de los puntos de la pregunta" : " vez los puntos de la pregunta"));
  return [
    weighted ? "Cada pregunta indica los puntos que vale. Una respuesta correcta suma todos sus puntos." : "Cada respuesta correcta suma 1 punto.",
    penalty ? `Cada respuesta incorrecta resta ${penalty}.` : "Las respuestas incorrectas no restan.",
    "Las preguntas en blanco ni suman ni restan.",
    ...(penalty ? ["Si no estás seguro, puedes dejarla en blanco."] : []),
    ...(shortCount
      ? [
          `${shortCount === 1 ? "Hay una pregunta" : `Hay ${shortCount} preguntas`} de respuesta corta: escribes una palabra, un número o una fórmula${penalty ? ", y si fallas no resta" : ""}.`,
          { strong: "En las preguntas de respuesta corta no cuentan las tildes ni las mayúsculas, salvo en los símbolos de las fórmulas: Co (cobalto) no es lo mismo que CO. Las demás letras sí cuentan: una palabra mal escrita es incorrecta." },
        ]
      : []),
    ...(opens.length
      ? [`Hay ${opens.length === 1 ? "una pregunta abierta" : `${opens.length} preguntas abiertas`}: escribes tu respuesta en un cuadro de texto (no se puede copiar ni pegar) y la corrige tu profesor.`]
      : []),
  ];
}

// `info` = {titulo, n_preguntas, tiempo_min, requiere_codigo}; `exam` solo si ya está cargado.
function showStart(info, exam) {
  const last = loadJson(lastKey());
  const needsCode = info.requiere_codigo;
  const form = h("form", { novalidate: true });
  const errBox = h("div", { class: "notice error", hidden: true, role: "alert" }, h("p"));
  const nombre = h("input", { name: "nombre", maxlength: MAX_TEXT, autocomplete: "given-name", required: true });
  const apellidos = h("input", { name: "apellidos", maxlength: MAX_TEXT, autocomplete: "family-name", required: true });
  const grupo = h("input", { name: "grupo", maxlength: MAX_TEXT, required: true });
  const code = h("input", { name: "code", autocomplete: "off", autocapitalize: "off" });
  // Parte convalidable (p. ej. formulación): el alumno que la tiene convalidada lo marca y no ve esas preguntas.
  const part = info.convalidable ?? convalidablePart(exam?.questions);
  const convalidada = h("input", { type: "checkbox", name: "convalidada" });
  if (last) {
    nombre.value = last.nombre ?? "";
    apellidos.value = last.apellidos ?? "";
    grupo.value = last.grupo ?? "";
    code.value = last.code ?? "";
    convalidada.checked = Boolean(last.convalidada);
  }
  const button = h("button", { class: "btn block", type: "submit" }, "Empezar el examen");

  const refreshButton = () => {
    const has = nombre.value.trim() && apellidos.value.trim() && grupo.value.trim() && store.get(progressKey(nombre.value, apellidos.value, grupo.value));
    button.textContent = has ? "Continuar el examen" : "Empezar el examen";
  };
  nombre.addEventListener("input", refreshButton);
  apellidos.addEventListener("input", refreshButton);
  grupo.addEventListener("input", refreshButton);

  form.append(
    ...[
    h("label", { class: "field" }, h("span", {}, "Nombre"), nombre),
    h("label", { class: "field" }, h("span", {}, "Apellidos"), apellidos),
    h("label", { class: "field" }, h("span", {}, "Grupo"), grupo, h("small", { class: "hint" }, "Por ejemplo: 2º A")),
    needsCode
      ? h("label", { class: "field" }, h("span", {}, "Código de acceso"), code, h("small", { class: "hint" }, "Te lo da tu profesor."))
      : null,
    part
      ? h(
          "div",
          { class: "notice info" },
          h("label", { class: "check" }, convalidada, h("strong", {}, `Tengo convalidada ${partLabel(part)}`)),
          h(
            "p",
            { class: "small" },
            `Márcalo solo si es tu caso. No verás ${part.n === 1 ? "esa pregunta" : `esas ${part.n} preguntas`} y se te ${part.puntos === 1 ? "dará" : "darán"} ${part.n === 1 ? "su" : "sus"} ${pointsText(part.puntos)} enteros. Tu profesor lo comprobará.`
          )
        )
      : null,
    errBox,
    button
    ].filter(Boolean)
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const n = nombre.value.replace(/\s+/g, " ").trim();
    const a = apellidos.value.replace(/\s+/g, " ").trim();
    const g = grupo.value.replace(/\s+/g, " ").trim();
    const c = code.value.trim();
    const fail = (msg) => {
      errBox.hidden = false;
      errBox.firstChild.textContent = msg;
    };
    errBox.hidden = true;
    if (!n) return fail("Escribe tu nombre.");
    if (!a) return fail("Escribe tus apellidos.");
    if (!g) return fail("Escribe tu grupo.");
    if (n.length > MAX_TEXT || a.length > MAX_TEXT || g.length > MAX_TEXT) return fail(`El nombre, los apellidos y el grupo no pueden superar ${MAX_TEXT} caracteres.`);
    if (needsCode && !c) return fail("Escribe el código de acceso.");

    button.disabled = true;
    if (info.control_salidas && !info.practica && fullscreenRequired(info.pantalla_completa)) enterFullscreen(); // dentro del gesto de pulsar «Empezar»
    try {
      let loaded = exam;
      if (!loaded || needsCode) {
        const res = await fetchExam(examId, c);
        if (!res.ok) return fail(res.message || "No se ha podido abrir el examen.");
        loaded = res.exam;
      }
      startExam(loaded, { nombre: n, apellidos: a, grupo: g, code: c, convalidada: Boolean(part) && convalidada.checked });
    } catch (e) {
      fail(errorText(e));
    } finally {
      button.disabled = false;
    }
  });

  const minutes = Number(info.tiempo_min) || 0;
  render(
    h(
      "div",
      { class: "card" },
      h("h1", {}, info.titulo),
      h(
        "p",
        { class: "muted" },
        `${info.n_preguntas} preguntas · `,
        minutes > 0 ? `${minutes} minutos` : "sin límite de tiempo"
      ),
      h(
        "div",
        { class: "notice info" },
        h("p", {}, h("strong", {}, "Cómo se puntúa")),
        scoringText(exam?.questions, exam?.penalizacion ?? info.penalizacion, info.n_cortas).map((t) => (typeof t === "string" ? h("p", {}, t) : h("p", {}, h("strong", {}, t.strong))))
      ),
      info.practica
        ? h(
            "div",
            { class: "notice ok" },
            h("p", {}, h("strong", {}, "Examen de práctica")),
            h("p", {}, "Sirve para estudiar: no cuenta para la nota. Al enviarlo verás qué tienes bien y mal, con las respuestas correctas, y podrás repetirlo las veces que quieras.")
          )
        : null,
      info.control_salidas && !info.practica
        ? h(
            "div",
            { class: "notice warn" },
            h("p", {}, h("strong", {}, "Examen vigilado")),
            h("p", {}, exitRule(fullscreenRequired(info.pantalla_completa))),
            h("p", {}, "Copiar y pegar está desactivado durante el examen.")
          )
        : null,
      form
    )
  );
  refreshButton();
}

function errorText(e) {
  if (e instanceof ConfigError) return "La aplicación no está configurada todavía. Avisa a tu profesor.";
  if (e instanceof NetworkError) return "No hay conexión con el servidor. Comprueba tu conexión e inténtalo de nuevo.";
  return "Ha ocurrido un error inesperado.";
}

// «la parte de formulación» o, si no tiene nombre, «la parte convalidable».
const partLabel = (part) => (part?.nombre ? `la parte de ${part.nombre}` : "la parte convalidable");
const pointsText = (v) => `${formatNumber(v)} ${v === 1 ? "punto" : "puntos"}`;

/* ------------------------------- examen --------------------------------- */

function startExam(exam, who) {
  const key = progressKey(who.nombre, who.apellidos, who.grupo);
  let progress = loadJson(key);
  if (!progress || typeof progress.answers !== "object" || !progress.startedAt) {
    progress = { nombre: who.nombre, apellidos: who.apellidos, grupo: who.grupo, startedAt: Date.now(), answers: {} };
  }
  // Datos de envío y de vigilancia (también para progresos guardados por versiones anteriores).
  progress.envioId = progress.envioId || newSendId();
  progress.salidas = Number(progress.salidas) || 0;
  progress.segundosFuera = Number(progress.segundosFuera) || 0;
  progress.leftAt = progress.leftAt || null;
  progress.motivos = Array.isArray(progress.motivos) ? progress.motivos : [];
  progress.open = progress.open && typeof progress.open === "object" ? progress.open : {};
  progress.pegados = Number(progress.pegados) || 0;
  progress.desconexiones = Number(progress.desconexiones) || 0;
  progress.segundosSinConexion = Number(progress.segundosSinConexion) || 0;
  progress.offlineSince = progress.offlineSince || null;
  progress.cambiosEscritorio = Number(progress.cambiosEscritorio) || 0;
  progress.segundosEscritorio = Number(progress.segundosEscritorio) || 0;
  progress.ventanasEncima = Number(progress.ventanasEncima) || 0;
  progress.segundosVentanaEncima = Number(progress.segundosVentanaEncima) || 0;
  // Lo que marque al empezar (o al continuar) manda: puede corregirlo si se equivocó.
  progress.convalidada = Boolean(who.convalidada) && exam.questions.some(isConvalidable);
  store.set(key, JSON.stringify(progress));
  store.set(lastKey(), JSON.stringify(who));

  // Orden fijo por alumno: la semilla depende del examen, el nombre, los apellidos y el grupo.
  const seed = `${examId}|${normalize(who.apellidos)}|${normalize(who.nombre)}|${normalize(who.grupo)}`;
  // Con la parte convalidada, sus preguntas no se muestran.
  let questions = exam.questions.filter((q) => !(progress.convalidada && isConvalidable(q))).map((q) => ({ ...q }));
  if (exam.barajar_preguntas) questions = seededShuffle(questions, `${seed}|q`);
  if (exam.barajar_opciones) {
    questions = questions.map((q) => (isOpenQuestion(q) ? q : { ...q, options: seededShuffle(q.options, `${seed}|o|${q.id}`) }));
  }
  // Descarta respuestas guardadas que ya no correspondan a este examen.
  for (const q of questions) {
    const given = progress.answers[q.id];
    const fits = blankCount(q) ? Array.isArray(given) : isShortQuestion(q) ? typeof given === "string" : !isOpenQuestion(q) && q.options.some((o) => o.id === given);
    if (given && !fits) delete progress.answers[q.id];
  }

  renderExam({ exam, questions, who, key, progress });
}

function renderExam(session) {
  const { exam, questions, who, key, progress } = session;
  const total = questions.length;
  const limitSeconds = (Number(exam.tiempo_min) || 0) * 60;
  const watched = Boolean(exam.control_salidas) && !exam.practica; // la práctica nunca se vigila
  const allowed = Number.isFinite(Number(exam.salidas_permitidas)) ? Number(exam.salidas_permitidas) : 3;
  // La pantalla completa solo se exige si el profesor lo ha marcado al publicar el examen, y solo en ordenadores.
  const fsActive = fullscreenRequired(exam.pantalla_completa);
  const overLimit = () => progress.salidas > allowed;
  let timerId = null;
  let sending = false;
  let finished = false;

  const counter = h("span");
  const timer = h("span", { class: "timer", role: "timer" });
  const status = h("div", { class: "status", hidden: true, role: "status" });
  const fieldset = h("fieldset", { class: "question" });
  // Con varios cuadros, contestada solo si están todos rellenos (si no, sale entre las «en blanco» al enviar).
  const isAnswered = (q) =>
    blankCount(q)
      ? Array.from({ length: blankCount(q) }, (_, k) => String(progress.answers[q.id]?.[k] ?? "").trim()).every(Boolean)
      : Boolean(String((isOpenQuestion(q) ? progress.open : progress.answers)[q.id] ?? "").trim());
  const answered = () => questions.filter(isAnswered).length;
  const showPoints = questions.some((q) => questionValue(q) !== 1);
  const updateCounter = () => (counter.textContent = `Contestadas: ${answered()} de ${total}`);
  const save = () => store.set(key, JSON.stringify(progress));

  questions.forEach((q, i) => {
    const group = h("fieldset", { class: "question card question-card", id: `p${i + 1}` });
    // Con varios cuadros, el enunciado son las líneas anteriores a la primera con un cuadro; el resto va con ellos.
    const lines = String(q.text ?? "").split("\n");
    const firstBlank = blankCount(q) ? lines.findIndex((l) => l.includes(BLANK)) : -1;
    // Un solo cuadro con su etiqueta en la última línea («Pb(NO3)2» + «Stock:»): la etiqueta va junto al cuadro.
    const inlineLabel = isShortQuestion(q) && !blankCount(q) && lines.length > 1 && /^[^:]{1,40}:$/.test(lines[lines.length - 1].trim())
      ? lines[lines.length - 1].trim().slice(0, -1)
      : null;
    group.append(
      h(
        "legend",
        {},
        h("span", { class: "qnum" }, `${i + 1}.`),
        ...richNodes(firstBlank !== -1 ? lines.slice(0, firstBlank).join("\n") : inlineLabel ? lines.slice(0, -1).join("\n") : q.text, exam.imagenes),
        showPoints ? h("span", { class: "points-badge" }, `${formatNumber(questionValue(q))} ${questionValue(q) === 1 ? "punto" : "puntos"}`) : null
      )
    );
    if (isOpenQuestion(q) || isShortQuestion(q)) {
      group.append(isOpenQuestion(q) ? openAnswerBox(q) : blankCount(q) ? blanksBox(q, lines.slice(firstBlank)) : shortAnswerBox(q, inlineLabel));
      fieldset.append(group);
      return;
    }
    const name = `q-${q.id}`;
    const radios = q.options.map((o, j) => {
      const input = h("input", { type: "radio", name, value: o.id, checked: progress.answers[q.id] === o.id });
      input.addEventListener("change", () => {
        progress.answers[q.id] = o.id;
        save();
        updateCounter();
        blank.disabled = false;
      });
      group.append(
        h("label", { class: "option" }, input, h("span", {}, h("span", { class: "letter" }, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[j]), o.text))
      );
      return input;
    });
    const blank = h(
      "button",
      {
        type: "button",
        class: "btn secondary small blank-btn",
        disabled: !progress.answers[q.id],
        onclick: () => {
          radios.forEach((r) => (r.checked = false));
          delete progress.answers[q.id];
          save();
          updateCounter();
          blank.disabled = true;
        },
      },
      "Dejar en blanco"
    );
    group.append(blank);
    fieldset.append(group);
  });

  // Respuesta abierta: un cuadro de texto donde no se puede pegar, copiar, cortar ni arrastrar texto.
  function openAnswerBox(q) {
    const area = h("textarea", {
      class: "open-answer",
      rows: 6,
      maxlength: MAX_OPEN_CHARS,
      autocomplete: "off",
      autocapitalize: "sentences",
      spellcheck: "false",
      "aria-label": "Tu respuesta",
      placeholder: "Escribe aquí tu respuesta",
    });
    area.setAttribute("autocorrect", "off");
    area.value = progress.open[q.id] ?? "";
    const left = h("small", { class: "hint" });
    const refresh = () => (left.textContent = `${area.value.length} / ${MAX_OPEN_CHARS} caracteres`);
    noPaste(area);
    area.addEventListener("input", () => {
      progress.open[q.id] = area.value;
      save();
      refresh();
      updateCounter();
    });
    refresh();
    return h("div", { class: "open-box" }, area, left);
  }

  // Respuesta corta: una línea (palabra, número o fórmula) que se corrige sola. Sin mayúsculas ni
  // correcciones automáticas del teclado, que estropearían fórmulas como NaCl.
  function shortAnswerBox(q, label = null) {
    const input = h("input", {
      type: "text",
      class: "open-answer short-answer",
      maxlength: MAX_SHORT_CHARS,
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      "aria-label": label ?? "Tu respuesta",
      placeholder: label ? null : "Escribe aquí tu respuesta",
    });
    input.setAttribute("autocorrect", "off");
    input.value = progress.answers[q.id] ?? "";
    noPaste(input);
    input.addEventListener("input", () => {
      progress.answers[q.id] = input.value;
      save();
      updateCounter();
    });
    // Intro no envía nada: solo cierra el teclado.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
    const hint = h("small", { class: "hint" }, "Las tildes no cuentan; en las fórmulas, sí las mayúsculas de los símbolos.");
    if (label) return h("div", { class: "open-box" }, h("div", { class: "blank-row" }, h("span", { class: "blank-label" }, `${label}:`), input), hint);
    return h("div", { class: "open-box" }, input, hint);
  }

  // Respuesta corta con varios cuadros: cada línea del enunciado con sus cuadros en el sitio de cada marca
  // («Prefijos: [____]»). La respuesta se guarda como una lista, un texto por cuadro.
  function blanksBox(q, lines) {
    const n = blankCount(q);
    const labels = blankLabels(q.text);
    const values = Array.from({ length: n }, (_, k) => String(progress.answers[q.id]?.[k] ?? ""));
    let k = 0;
    const rows = lines.map((line) => {
      const row = h("div", { class: "blank-row" });
      const parts = line.split(BLANK);
      parts.forEach((part, j) => {
        if (part.trim()) row.append(h("span", { class: "blank-label" }, ...richNodes(part.trim(), exam.imagenes)));
        if (j < parts.length - 1) row.append(blankInput(k++));
      });
      return row;
    });
    function blankInput(idx) {
      const input = h("input", {
        type: "text",
        class: "open-answer short-answer",
        maxlength: MAX_SHORT_CHARS,
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        "aria-label": labels[idx],
      });
      input.setAttribute("autocorrect", "off");
      input.value = values[idx];
      noPaste(input);
      input.addEventListener("input", () => {
        values[idx] = input.value;
        progress.answers[q.id] = [...values];
        save();
        updateCounter();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur();
        }
      });
      return input;
    }
    return h("div", { class: "open-box" }, ...rows, h("small", { class: "hint" }, "Las tildes no cuentan; en las fórmulas, sí las mayúsculas de los símbolos. La pregunta solo cuenta como bien si todos sus cuadros lo están."));
  }

  // En los cuadros de respuesta no se puede pegar, copiar, cortar ni arrastrar texto; cada intento de pegar
  // queda registrado para el profesor.
  function noPaste(el) {
    const blocked = () => {
      progress.pegados += 1;
      save();
    };
    for (const type of ["paste", "drop"]) {
      el.addEventListener(type, (e) => {
        e.preventDefault();
        blocked();
      });
    }
    for (const type of ["copy", "cut", "dragstart"]) el.addEventListener(type, (e) => e.preventDefault());
    el.addEventListener("beforeinput", (e) => {
      if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop" || e.inputType === "insertFromYank") {
        e.preventDefault();
        blocked();
      }
    });
  }

  const reviewBtn = h("button", { type: "button", class: "btn block", onclick: () => confirmSend() }, "Revisar y enviar");

  const lock = () => {
    fieldset.disabled = true;
    reviewBtn.disabled = true;
  };

  function confirmSend() {
    const blanks = questions.map((q, i) => (isAnswered(q) ? null : i + 1)).filter(Boolean);
    const dialog = h("dialog");
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.append(
      h("h2", {}, "Antes de enviar"),
      h("p", {}, `Has contestado ${total - blanks.length} de ${total} preguntas.`),
      blanks.length
        ? h(
            "p",
            { class: "blank-list" },
            `En blanco (${blanks.length}): `,
            blanks.flatMap((n, idx) => [
              idx ? ", " : "",
              h("a", { href: `#p${n}`, onclick: () => close() }, String(n)),
            ])
          )
        : null,
      h("p", { class: "muted small" }, "Una vez enviado no podrás cambiar tus respuestas."),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", class: "btn secondary", onclick: close }, "Volver al examen"),
        h(
          "button",
          {
            type: "button",
            class: "btn",
            onclick: () => {
              close();
              send();
            },
          },
          "Enviar definitivamente"
        )
      )
    );
    document.body.append(dialog);
    dialog.addEventListener("cancel", () => dialog.remove());
    dialog.showModal();
  }

  // Tiempo total fuera: salidas ya cerradas + la que esté en curso.
  const awaySeconds = () => progress.segundosFuera + (progress.leftAt ? (Date.now() - progress.leftAt) / 1000 : 0);
  // Tiempo total sin conexión, incluida la desconexión en curso.
  const offlineSeconds = () => progress.segundosSinConexion + (progress.offlineSince ? (Date.now() - progress.offlineSince) / 1000 : 0);

  function buildPayload(motivo) {
    const respuestas = {};
    const abiertas = {};
    for (const q of exam.questions) {
      if (progress.convalidada && isConvalidable(q)) continue;
      if (isOpenQuestion(q)) abiertas[q.id] = (progress.open[q.id] ?? "").slice(0, MAX_OPEN_CHARS);
      else if (blankCount(q)) {
        const list = Array.from({ length: blankCount(q) }, (_, k) => String(progress.answers[q.id]?.[k] ?? "").trim().slice(0, MAX_SHORT_CHARS) || null);
        respuestas[q.id] = list.some(Boolean) ? list : null;
      } else if (isShortQuestion(q)) respuestas[q.id] = String(progress.answers[q.id] ?? "").trim().slice(0, MAX_SHORT_CHARS) || null;
      else respuestas[q.id] = progress.answers[q.id] ?? null;
    }
    return {
      examId,
      nombre: who.nombre,
      apellidos: who.apellidos,
      grupo: who.grupo,
      code: who.code,
      respuestas,
      abiertas,
      convalidada: progress.convalidada,
      pegados: progress.pegados,
      duracion_min: Math.round(((Date.now() - progress.startedAt) / 60000) * 100) / 100,
      salidas: progress.salidas,
      // Incluye el tiempo de una salida que todavía no ha terminado (el alumno envía sin haber vuelto).
      segundos_fuera: Math.round(awaySeconds() * 10) / 10,
      envio: motivo,
      envioId: progress.envioId,
      motivos_salida: progress.motivos.join(","),
      desconexiones: progress.desconexiones,
      segundos_sin_conexion: Math.round(offlineSeconds() * 10) / 10,
      cambios_escritorio: progress.cambiosEscritorio,
      segundos_escritorio: Math.round(desktopSeconds() * 10) / 10,
      ventanas_encima: progress.ventanasEncima,
      segundos_ventana_encima: Math.round(overlaySeconds() * 10) / 10,
    };
  }

  // motivo: "manual" (botón), "tiempo" (se acabó) o "salida" (cambió de pestaña, ventana o app).
  async function send(motivo = "manual") {
    if (sending) return;
    sending = true;
    clearInterval(timerId);
    cover.hidden = true;
    lock();
    const payload = buildPayload(motivo);

    const showStatus = (kind, text, retry) => {
      status.hidden = false;
      status.replaceChildren(
        h("div", { class: `notice ${kind}`, style: "margin:0" }, h("p", {}, text), retry ? h("div", { class: "actions", style: "margin-top:10px" }, retry) : null)
      );
    };
    const retryBtn = () => h("button", { class: "btn", type: "button", onclick: () => { sending = false; send(motivo); } }, "Reintentar el envío");

    showStatus(
      "info",
      motivo === "tiempo"
        ? "Se ha acabado el tiempo. Enviando tus respuestas…"
        : motivo === "salida"
          ? "Has salido de la pantalla del examen: se envía automáticamente con tus respuestas actuales…"
          : "Enviando tus respuestas…"
    );

    let res = null;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await submitExam(payload);
        break;
      } catch (e) {
        if (e instanceof NetworkError && attempt < RETRY_DELAYS.length) {
          showStatus("warn", `Sin conexión. Reintentando… (${attempt + 1}/${RETRY_DELAYS.length})`);
          await sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        showStatus("error", `${errorText(e)} Tus respuestas están guardadas en este dispositivo: no las pierdes.`, retryBtn());
        return;
      }
    }

    if (!res.ok) {
      const closed = res.error === "closed" || res.error === "not_found";
      showStatus(
        "error",
        `${res.message || "No se ha podido enviar el examen."} Tus respuestas siguen guardadas en este dispositivo.`,
        closed ? null : retryBtn()
      );
      return;
    }

    finished = true;
    clearInterval(watchTimer);
    releaseScreen();
    store.remove(key);
    if (res.practica && res.review) {
      // Práctica: no se recuerda el envío (no hay revisión que esperar) y se conserva el nombre para repetir.
      return showReview({ ...res.review, imagenes: exam.imagenes });
    }
    store.remove(lastKey());
    rememberSend({ envioId: progress.envioId, nombre: who.nombre, apellidos: who.apellidos });
    showDone(res, motivo);
  }

  /* --- vigilancia: cada salida se cuenta y se mide; al superar el límite se envía solo --- */

  function warnReturn() {
    const dialog = h("dialog", { class: "warning" });
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.append(
      h("h2", {}, "⚠ AVISO: has salido del examen"),
      h("p", {}, h("strong", {}, "Está prohibido salir de la pantalla del examen.")),
      h("p", {}, "Esta salida ha quedado registrada, junto con el tiempo que has estado fuera, y tu profesor la verá."),
      h("p", {}, h("strong", {}, "Si continúas saliendo, el examen se enviará automáticamente tal como esté.")),
      h("div", { class: "actions" }, h("button", { type: "button", class: "btn danger", onclick: close }, "Entendido, volver al examen"))
    );
    document.body.append(dialog);
    dialog.addEventListener("cancel", () => dialog.remove());
    dialog.showModal();
  }

  // Cubierta: oculta el examen mientras no esté bien colocado (antes de empezar) o el alumno esté fuera.
  const QUIET_MS = 2500; // tras pedir pantalla completa, el navegador cambia de tamaño por sí solo
  let quietUntil = 0;
  const coverTitle = h("h2");
  const coverMain = h("p", {}, h("strong"));
  const coverNote = h("p");
  const fsBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      hidden: true,
      onclick: () => {
        quietUntil = Date.now() + QUIET_MS;
        fsState.failed = false;
        enterFullscreen();
      },
    },
    "Pasar a pantalla completa"
  );
  const cover = h("div", { class: "away-cover", hidden: true, role: "alert" }, coverTitle, coverMain, coverNote, fsBtn);

  function applyCover(reason) {
    if (reason === "prepare") {
      coverTitle.textContent = fsActive ? "Pon el examen a pantalla completa" : "Pon el examen a toda la pantalla";
      coverMain.firstChild.textContent = fsActive
        ? "Toca el botón (o cualquier parte de la pantalla) para empezar."
        : "Cierra la pantalla dividida o amplía la ventana del examen para empezar.";
      coverNote.textContent = "Esto todavía no cuenta como salida.";
    } else if (reason === "away") {
      coverTitle.textContent = "⚠ Examen oculto";
      coverMain.firstChild.textContent = fsActive
        ? "Vuelve a la pantalla completa del examen para continuar."
        : "Vuelve a la ventana completa del examen para continuar.";
      coverNote.textContent = "Mientras estés fuera, el examen no se muestra y el tiempo que pasas fuera queda registrado.";
    }
    cover.hidden = !reason;
    fsBtn.hidden = !(reason && fsActive && !fsElement());
    if (!sending) fieldset.disabled = Boolean(reason);
  }

  function onLeave({ reason, since }) {
    if (!watched || sending || finished || progress.leftAt) return;
    progress.salidas += 1;
    progress.leftAt = since; // desde que empezó la situación, no desde que se confirmó
    progress.motivos.push(reason);
    save();
    // Solo al superar el límite se avisa al servidor. La página puede congelarse al cambiar
    // de app, así que se usa sendBeacon; al volver se reenvía con el mismo envioId.
    if (overLimit()) beaconSubmit(buildPayload("salida"));
  }

  function onReturn({ awayMs }) {
    if (!watched || sending || finished || !progress.leftAt) return;
    progress.segundosFuera += awayMs / 1000;
    progress.leftAt = null;
    save();
    if (overLimit()) send("salida");
    else warnReturn();
  }

  /*
   * ¿Sigue el alumno en la pantalla del examen? La decisión la toma js/watch.js a partir de varias señales
   * (página oculta, foco, ventana reducida, pantalla completa). Aquí solo se recogen las señales.
   */
  // En ordenadores salir de la pantalla completa (Esc) no es un gesto natural: margen más corto que en tabletas.
  // En el iPad, deslizar el dedo para desplazarse empezando cerca del borde activa a veces el gesto del sistema
  // (Dock, multitarea, notificaciones) y la página se oculta un instante: se da un margen antes de contarlo.
  const tablet = isTablet;
  const watcher = createWatcher(
    tablet ? { grace: { hidden: 2000 } } : window.matchMedia?.("(pointer: fine)").matches ? { grace: { fullscreenLost: 1500 } } : {}
  );
  let wasReduced = false;
  let largestWindow = null; // ventana más grande vista: referencia de pantalla completa (ver presence.js)
  let blurred = false;
  let pageHidden = false;
  let focusSeen = false; // hasFocus() solo cuenta si alguna vez ha sido true
  let fullscreenSeen = false; // la pérdida de pantalla completa solo cuenta si estuvo en ella
  let watchTimer = null;
  // Teclado en pantalla: al mostrarlo u ocultarlo (también con la tecla de ocultar teclado del iPad), Safari
  // cambia el foco y el tamaño de la ventana durante la animación. Durante KEYBOARD_MS tras entrar o salir de un
  // cuadro de texto, en tabletas solo cuenta la página oculta (cambiar de app sigue detectándose).
  const KEYBOARD_MS = 3000;
  let keyboardUntil = 0;
  const isEditable = (el) => Boolean(el?.matches?.("textarea, input, [contenteditable]"));

  function collectInputs() {
    const now = Date.now();
    const settling = now < quietUntil;
    const keyboardMoving = tablet && now < keyboardUntil;
    if (document.hasFocus()) focusSeen = true;
    if (fsActive && fsElement()) fullscreenSeen = true;
    // Tamaño de la ventana sin contar el zoom: en el iPad, ampliar con dos dedos encoge innerWidth/innerHeight
    // y se confundía con la pantalla dividida.
    const winW = document.documentElement.clientWidth || window.innerWidth;
    const winH = document.documentElement.clientHeight || window.innerHeight;
    largestWindow = trackLargest(largestWindow, winW, winH);
    wasReduced = isReducedWindow({
      innerWidth: winW,
      innerHeight: winH,
      screenWidth: window.screen?.width,
      screenHeight: window.screen?.height,
      coarse: tablet,
      typing: isEditable(document.activeElement),
      wasReduced,
      largest: largestWindow,
    });
    return {
      hidden: document.hidden || pageHidden,
      blurred: blurred && !keyboardMoving,
      // En tabletas document.hasFocus() puede quedarse en false tras ocultar el teclado aunque el alumno siga
      // en el examen: allí no se usa (otra app se detecta por la página oculta o la ventana reducida).
      noFocus: !tablet && focusSeen && !document.hasFocus(),
      reduced: wasReduced && !settling && !keyboardMoving,
      fullscreenLost: fsActive && fullscreenSeen && !fsElement() && !settling,
      needsFullscreen: fsActive && !fsState.failed && !fsElement(),
    };
  }

  // Mientras el alumno lee o piensa sin tocar la pantalla, el iPad se bloquearía solo (página oculta = salida).
  // Se pide al navegador que mantenga la pantalla encendida; el sistema la suelta al ocultarse la página,
  // así que se vuelve a pedir al volver. Si el navegador no lo permite, se sigue sin ello.
  let wakeLock = null;
  async function keepScreenOn() {
    if (finished || document.hidden || wakeLock || !navigator.wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch {
      wakeLock = null;
    }
  }
  function releaseScreen() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  // Ratón fuera de la página (solo ordenadores): solo se registra para el profesor; al alumno no se le avisa ni le
  // cuenta como salida. En el Mac, el gesto de cambio de escritorio hecho a medias deja ver otra pantalla sin que
  // la página pierda el foco ni se oculte; lo único que avisa es que el ratón deja de estar sobre la página sin
  // haberse movido hasta un borde (comprobado en un Mac: sale y vuelve en el mismo punto).
  // Si el ratón sigue fuera MOUSE_MS:
  //  - lejos de los bordes: cuenta como cambio de escritorio (columnas cambios_escritorio y segundos_escritorio)
  //    y se apunta «mouseOut» en los motivos;
  //  - por un borde (barra de menús, Dock o fuera de la ventana): solo se apunta «mouseEdge» en los motivos.
  // En los motivos, como mucho MOUSE_MAX, para no llenar la columna. Si a la vez la ventana pierde el foco o se
  // oculta, no se apunta: eso ya es una salida.
  const MOUSE_MS = 1500;
  const MOUSE_MAX = 5;
  let mouseOut = null; // { since, zone, logged }
  function checkMouse(now) {
    if (!mouseOut || mouseOut.logged || now - mouseOut.since < MOUSE_MS) return;
    if (!watcher.isArmed() || watcher.isAway() || document.hidden || blurred || !document.hasFocus()) return;
    mouseOut.logged = true;
    if (mouseOut.zone === "center") progress.cambiosEscritorio += 1;
    if (progress.motivos.filter((m) => m.startsWith("mouse")).length < MOUSE_MAX) {
      progress.motivos.push(mouseOut.zone === "center" ? "mouseOut" : "mouseEdge");
    }
    save();
  }
  // Ventana encima del examen (solo tabletas): solo se registra para el profesor, como el cambio de escritorio.
  // En el iPad, una app en una ventana flotante (Slide Over, Stage Manager) tapa el examen sin ocultarlo ni
  // cambiar su tamaño; lo único que avisa es que Safari deja de ser la ventana activa («blur»; comprobado en un
  // iPad: dura lo que la ventana está encima y vuelve el «focus» al quitarla, sin que el teclado lo provoque).
  // Cuenta si dura OVERLAY_MS sin que el alumno toque el examen. Termina con «focus» o al tocar el examen
  // (Safari no siempre avisa de «focus» al volver). Si cerca hubo teclado o la página se oculta, no cuenta.
  const OVERLAY_MS = 2000;
  let overlay = null; // { since, logged }
  function checkOverlay(now) {
    if (!overlay || overlay.logged || now - overlay.since < OVERLAY_MS) return;
    if (keyboardUntil > overlay.since || document.hidden || document.hasFocus()) {
      overlay = null;
      return;
    }
    if (!watcher.isArmed() || watcher.isAway()) return;
    overlay.logged = true;
    progress.ventanasEncima += 1;
    if (progress.motivos.filter((m) => m === "overlay").length < MOUSE_MAX) progress.motivos.push("overlay");
    save();
  }
  const overlayMs = (now = Date.now()) => (overlay?.logged ? now - overlay.since : 0);
  const overlaySeconds = () => progress.segundosVentanaEncima + overlayMs() / 1000;
  function endOverlay() {
    const ms = overlayMs();
    overlay = null;
    if (ms) {
      progress.segundosVentanaEncima += ms / 1000;
      save();
    }
  }

  const desktopOutMs = (now = Date.now()) => (mouseOut?.logged && mouseOut.zone === "center" ? now - mouseOut.since : 0);
  // Tiempo total con otro escritorio a la vista, incluido el cambio en curso.
  const desktopSeconds = () => progress.segundosEscritorio + desktopOutMs() / 1000;

  function evaluateAway() {
    if (!watched || sending || finished) return;
    const now = Date.now();
    const r = watcher.update(collectInputs(), now);
    if (r.leave) onLeave(r.leave);
    if (r.back) onReturn(r.back);
    applyCover(r.coverReason);
    checkMouse(now);
    checkOverlay(now);
  }

  if (watched) {
    document.addEventListener("visibilitychange", evaluateAway);
    window.addEventListener("blur", () => {
      // En tabletas no cuenta como salida: Safari en iPad avisa de «blur» al ocultar el teclado y en otros gestos
      // aunque el alumno siga en el examen, y a veces nunca avisa de «focus» al volver (salidas falsas «blurred»).
      // Irse a otra app se detecta por la página oculta; la pantalla dividida, por el tamaño de la ventana.
      // Sí se usa para registrar una ventana encima del examen (ver checkOverlay).
      if (tablet) {
        if (!overlay && Date.now() >= keyboardUntil) overlay = { since: Date.now(), logged: false };
        return;
      }
      blurred = true;
      evaluateAway();
    });
    window.addEventListener("focus", () => { endOverlay(); blurred = false; evaluateAway(); });
    window.addEventListener("pagehide", () => { pageHidden = true; evaluateAway(); });
    window.addEventListener("pageshow", () => { pageHidden = false; evaluateAway(); });
    window.addEventListener("resize", evaluateAway);
    window.addEventListener("orientationchange", evaluateAway);
    if (!tablet) {
      const root = document.documentElement;
      root.addEventListener("mouseleave", (e) => {
        mouseOut = { since: Date.now(), zone: mouseExitZone({ x: e.clientX, y: e.clientY, width: root.clientWidth, height: root.clientHeight }), logged: false };
      });
      root.addEventListener("mouseenter", () => {
        const ms = desktopOutMs();
        mouseOut = null;
        if (ms) {
          progress.segundosEscritorio += ms / 1000;
          save();
        }
      });
    }
    document.addEventListener("fullscreenchange", evaluateAway);
    document.addEventListener("webkitfullscreenchange", evaluateAway);
    // El teclado en pantalla aparece y desaparece al entrar o salir de un cuadro de texto.
    const keyboardChange = (e) => {
      if (isEditable(e.target)) keyboardUntil = Date.now() + KEYBOARD_MS;
      setTimeout(evaluateAway, 0);
    };
    document.addEventListener("focusin", keyboardChange);
    document.addEventListener("focusout", keyboardChange);
    // Si el alumno está tocando o escribiendo en la página, la ventana es la activa aunque el navegador no haya
    // avisado con «focus» (Safari no siempre lo hace al ocultar el teclado): se quita la marca de ventana sin foco.
    for (const type of ["pointerdown", "touchstart", "keydown", "input"]) {
      document.addEventListener(type, () => {
        endOverlay(); // si toca el examen, ya no está usando la ventana de encima
        if (blurred) {
          blurred = false;
          evaluateAway();
        }
      }, { capture: true, passive: true });
    }
    // Un toque en cualquier parte devuelve la pantalla completa sin que el alumno tenga que buscar nada:
    // así los gestos naturales de la tableta que la quitan no cuestan una salida.
    // Se usa pointerup: en pantallas táctiles el navegador solo permite pedir la pantalla completa al levantar
    // el dedo. Al desplazarse con el dedo no llega pointerup (llega pointercancel), así que no molesta.
    document.addEventListener(
      "pointerup",
      () => {
        if (fsActive && !fsElement() && !fsState.failed && (fullscreenSeen || !watcher.isArmed())) {
          quietUntil = Date.now() + QUIET_MS;
          enterFullscreen({ auto: true });
        }
      },
      true
    );
    keepScreenOn();
    document.addEventListener("visibilitychange", keepScreenOn);
    watchTimer = setInterval(evaluateAway, 500);
    evaluateAway(); // muestra la cubierta de preparación si todavía no está a pantalla completa
  }

  const bar = h("div", { class: "exam-bar" }, counter, limitSeconds ? timer : null);
  const screen = h(
    "div",
    { class: watched ? "exam-screen no-copy" : "exam-screen" },
    h("h1", {}, exam.titulo),
    h("p", { class: "muted" }, `${who.nombre} ${who.apellidos} · ${who.grupo}`),
    watched ? h("p", { class: "muted small" }, "Examen vigilado: no salgas de esta pantalla. Las salidas quedan registradas y, si continúas, el examen se envía automáticamente.") : null,
    bar,
    // Instrucciones del profesor, al principio del examen (texto plano, con sus saltos de línea).
    exam.instrucciones ? h("div", { class: "notice info exam-instructions" }, h("p", {}, h("strong", {}, "Instrucciones")), h("p", {}, exam.instrucciones)) : null,
    progress.convalidada
      ? h("div", { class: "notice info" }, h("p", {}, `Has indicado que tienes convalidada ${partLabel(convalidablePart(exam.questions))}: no ves sus preguntas y tienes sus ${pointsText(convalidablePart(exam.questions).puntos)}. Si no es así, avisa a tu profesor.`))
      : null,
    fieldset,
    reviewBtn,
    h("p", { class: "muted small" }, "Tus respuestas se guardan automáticamente en este dispositivo."),
    status,
    watched ? cover : null
  );
  if (watched) {
    // Frena copiar, cortar, pegar, el menú contextual y seleccionar texto (disuasorio).
    // Los cuadros de respuesta abierta se excluyen: ahí hay que poder escribir y colocar el cursor.
    for (const type of ["copy", "cut", "paste", "contextmenu", "selectstart", "dragstart"]) {
      screen.addEventListener(type, (e) => {
        if (e.target?.closest?.(".open-answer")) return;
        e.preventDefault();
      });
    }
  }
  render(screen);
  updateCounter();
  window.scrollTo(0, 0);

  if (limitSeconds) {
    const tick = () => {
      const remaining = limitSeconds - (Date.now() - progress.startedAt) / 1000;
      timer.textContent = `⏱ ${formatClock(remaining)}`;
      timer.classList.toggle("low", remaining <= 60);
      if (remaining <= 0) send("tiempo");
    };
    tick();
    if (!sending) timerId = setInterval(tick, 1000);
  }

  // Conexión a internet: solo se registra (cuántas veces se pierde y durante cuánto tiempo, y «offline» entre los
  // motivos). No cuenta como salida ni oculta el examen: el wifi del centro puede caerse sin culpa del alumno.
  // navigator.onLine detecta que el dispositivo se queda sin red (wifi apagado, modo avión), no todos los cortes.
  function connectionChanged() {
    if (finished) return;
    if (!navigator.onLine && !progress.offlineSince) {
      progress.desconexiones += 1;
      progress.offlineSince = Date.now();
      progress.motivos.push("offline");
      save();
    } else if (navigator.onLine && progress.offlineSince) {
      progress.segundosSinConexion += (Date.now() - progress.offlineSince) / 1000;
      progress.offlineSince = null;
      save();
    }
  }
  window.addEventListener("online", connectionChanged);
  window.addEventListener("offline", connectionChanged);
  connectionChanged();

  // Si el alumno salió y la página se recargó o se cerró, se suma el tiempo que estuvo fuera.
  // La vigilancia vuelve a empezar desde cero (fase de preparación), así que no se cuenta otra salida.
  if (watched && progress.leftAt) {
    progress.segundosFuera += (Date.now() - progress.leftAt) / 1000;
    progress.leftAt = null;
    save();
    if (!overLimit()) warnReturn();
  }
  if (watched && overLimit() && !sending) send("salida");
}

function showDone(res, motivo = "manual") {
  const hasScore = typeof res.nota === "number";
  render(
    h(
      "div",
      { class: "card" },
      h("h1", {}, "Examen enviado correctamente"),
      h("div", { class: "notice ok" }, h("p", {}, "Ya puedes cerrar esta página.")),
      motivo === "salida"
        ? h("div", { class: "notice warn" }, h("p", {}, "El examen se ha enviado automáticamente porque has salido de la pantalla del examen. Tu profesor lo verá registrado."))
        : null,
      res.abiertas > 0 && typeof res.puntos_test === "number"
        ? [
            h("p", { class: "muted" }, "Parte tipo test"),
            h("div", { class: "big-result" }, `${formatNumber(res.puntos_test)} sobre ${formatNumber(res.puntos_test_max)} puntos`),
            h("p", {}, `Aciertos: ${res.aciertos} · Errores: ${res.errores} · En blanco: ${res.blancos}`),
            h("p", { class: "muted" }, "Las preguntas abiertas las corregirá tu profesor: tu nota final llegará cuando las revise."),
          ]
        : hasScore
        ? [
            h("p", { class: "muted" }, "Tu nota"),
            h("div", { class: "big-result" }, `${formatNumber(res.nota)} / 10`),
            h("p", {}, `Aciertos: ${res.aciertos} · Errores: ${res.errores} · En blanco: ${res.blancos}`),
          ]
        : h("p", { class: "muted" }, "Tu profesor te comunicará la nota."),
      h("p", { class: "muted small" }, "Cuando tu profesor publique la revisión, podrás ver tus fallos abriendo este mismo enlace en este dispositivo.")
    )
  );
}

/* ------------------------------- revisión -------------------------------- */

// Si este dispositivo envió el examen y el profesor ha publicado la revisión, se muestra en lugar del examen.
// Devuelve true si la ha mostrado. Ante cualquier error se sigue con la página normal.
async function tryReview() {
  const sent = loadJson(sentKey());
  if (!Array.isArray(sent) || !sent.length) return false;
  const found = [];
  for (const entry of sent) {
    if (typeof entry?.envioId !== "string") continue;
    let res;
    try {
      res = await fetchReview(examId, entry.envioId);
    } catch {
      return false;
    }
    if (res.ok) found.push(res.review);
    else if (res.error === "review_closed" || res.error === "not_found") return false; // vale para todos los envíos
  }
  if (!found.length) return false;
  if (found.length === 1) showReview(found[0]);
  else showReviewPicker(found);
  return true;
}

// Dispositivo compartido: varios alumnos enviaron desde aquí; cada uno elige el suyo.
function showReviewPicker(reviews) {
  document.title = reviews[0].titulo;
  render(
    h(
      "div",
      { class: "card" },
      h("h1", {}, reviews[0].titulo),
      h("p", {}, "Desde este dispositivo se ha enviado el examen varias veces. Elige el tuyo:"),
      h(
        "div",
        { class: "actions" },
        reviews.map((r) => h("button", { type: "button", class: "btn secondary", onclick: () => showReview(r, () => showReviewPicker(reviews)) }, `${r.nombre} ${r.apellidos}`.trim()))
      )
    )
  );
}

// `r.practica`: resultado de un examen de práctica, recién enviado (no es la revisión publicada por el profesor).
function showReview(r, onBack = null) {
  const retry = () => h("div", { class: "actions" }, h("button", { type: "button", class: "btn", onclick: () => location.reload() }, "Volver a intentarlo"));
  document.title = `${r.practica ? "Resultado" : "Revisión"} · ${r.titulo}`;
  const pts = (v) => `${formatNumber(v)} ${v === 1 ? "punto" : "puntos"}`;
  const cards = r.questions.map((q, i) => {
    // Con varios cuadros, solo el enunciado: cada cuadro se muestra debajo con su etiqueta.
    const lines = String(q.text ?? "").split("\n");
    const firstBlank = Array.isArray(q.cuadros) ? lines.findIndex((l) => l.includes(BLANK)) : -1;
    const legend = h("p", { class: "review-qtext" }, h("span", { class: "qnum" }, `${i + 1}.`), ...richNodes(firstBlank > 0 ? lines.slice(0, firstBlank).join("\n") : q.text, r.imagenes));
    if (q.convalidada) {
      return h("div", { class: "card review-q ok" }, legend, h("span", { class: "review-status ok" }, `Convalidada · ${pts(q.valor)}`));
    }
    if (q.tipo === "abierta") {
      const pending = q.puntos === null || q.puntos === undefined;
      return h(
        "div",
        { class: `card review-q ${pending ? "pending" : ""}` },
        legend,
        h("span", { class: `review-status ${pending ? "pending" : "ok"}` }, pending ? (r.practica ? "No se corrige en la práctica" : "Pendiente de corregir") : `${formatNumber(q.puntos)} de ${pts(q.valor)}`),
        h("p", { class: "muted small" }, "Tu respuesta:"),
        q.respuesta ? h("p", { class: "review-open" }, q.respuesta) : h("p", { class: "muted" }, "(en blanco)")
      );
    }
    const state = q.respuesta === null ? "blank" : (q.tipo === "corta" ? q.acertada : q.respuesta === q.correcta) ? "ok" : "bad";
    const label = { ok: "Correcta", bad: "Incorrecta", blank: "En blanco" }[state];
    if (q.tipo === "corta" && Array.isArray(q.cuadros)) {
      // Varios cuadros: lo que escribió en cada uno y, si la pregunta está mal, las respuestas válidas de los fallados.
      return h(
        "div",
        { class: `card review-q ${state}` },
        legend,
        h("span", { class: `review-status ${state}` }, label),
        q.cuadros.map((c) =>
          h(
            "div",
            { class: "review-blank" },
            h("p", { class: "muted small" }, `${c.etiqueta}:`),
            c.respuesta ? h("p", { class: `review-open${state === "ok" || c.acertada ? "" : " wrong"}` }, c.respuesta) : h("p", { class: "muted" }, "(en blanco)"),
            state === "ok" || c.acertada ? null : h("p", { class: "review-open correct" }, c.correctas.join(" · "))
          )
        )
      );
    }
    if (q.tipo === "corta") {
      const accepted = q.correctas ?? [];
      return h(
        "div",
        { class: `card review-q ${state}` },
        legend,
        h("span", { class: `review-status ${state}` }, label),
        h("p", { class: "muted small" }, "Tu respuesta:"),
        q.respuesta ? h("p", { class: `review-open${state === "ok" ? "" : " wrong"}` }, q.respuesta) : h("p", { class: "muted" }, "(en blanco)"),
        state === "ok" ? null : h("p", { class: "muted small" }, accepted.length === 1 ? "Respuesta correcta:" : "Respuestas válidas:"),
        state === "ok" ? null : h("p", { class: "review-open correct" }, accepted.join(" · "))
      );
    }
    return h(
      "div",
      { class: `card review-q ${state}` },
      legend,
      h("span", { class: `review-status ${state}` }, label),
      q.options.map((o, j) => {
        const isCorrect = o.id === q.correcta;
        const isMine = o.id === q.respuesta;
        const cls = isCorrect ? "correct" : isMine ? "wrong" : "";
        const tag = isCorrect && isMine ? "✓ Tu respuesta" : isCorrect ? "✓ Correcta" : isMine ? "✗ Tu respuesta" : "";
        return h(
          "div",
          { class: `review-opt ${cls}` },
          h("span", { class: "letter" }, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[j]),
          h("span", { class: "opt-text" }, o.text),
          tag ? h("span", { class: "tag" }, tag) : null
        );
      })
    );
  });
  const hasNote = typeof r.nota === "number";
  const pendingOpen = r.questions.some((q) => q.tipo === "abierta" && (q.puntos === null || q.puntos === undefined));
  render(
    h(
      "div",
      {},
      h(
        "div",
        { class: "card" },
        h("h1", {}, `${r.practica ? "Resultado" : "Revisión"}: ${r.titulo}`),
        r.practica ? h("p", { class: "muted small" }, "Examen de práctica: abajo tienes qué has hecho bien y mal, con las respuestas correctas. Puedes repetirlo las veces que quieras.") : null,
        h("p", { class: "muted" }, `${r.nombre} ${r.apellidos}`.trim()),
        hasNote
          ? [
              h("p", { class: "muted" }, pendingOpen ? "Nota provisional" : "Tu nota"),
              h("div", { class: "big-result" }, `${formatNumber(r.nota)} / 10`),
              pendingOpen
                ? h("p", { class: "muted small" }, r.practica ? "Las preguntas abiertas no se corrigen en la práctica: cuentan como 0 en esta nota." : "Faltan preguntas abiertas por corregir: tu nota cambiará cuando tu profesor las corrija.")
                : null,
            ]
          : null,
        h(
          "div",
          { class: "review-summary" },
          h("span", { class: "review-status ok" }, `Aciertos: ${r.aciertos}`),
          h("span", { class: "review-status bad" }, `Errores: ${r.errores}`),
          h("span", { class: "review-status blank" }, `En blanco: ${r.blancos}`),
          r.convalidada ? h("span", { class: "review-status ok" }, `Convalidada ${partLabel(r.convalidada)}`) : null
        ),
        onBack ? h("div", { class: "actions" }, h("button", { type: "button", class: "btn secondary small", onclick: onBack }, "Volver")) : null,
        // Práctica: se vuelve a la pantalla inicial con el examen vacío (el nombre ya está escrito).
        r.practica ? retry() : null
      ),
      cards,
      r.practica ? h("div", { class: "card" }, retry()) : null
    )
  );
}

/* -------------------------------- inicio -------------------------------- */

async function main() {
  if (!examId) {
    return showMessage("Falta el examen", "Este enlace no es correcto. Pide a tu profesor el enlace del examen.", "warn");
  }
  if (await tryReview()) return;
  try {
    const res = await fetchExam(examId);
    if (res.ok) {
      document.title = res.exam.titulo;
      return showStart(
        {
          titulo: res.exam.titulo,
          n_preguntas: res.exam.questions.length,
          tiempo_min: res.exam.tiempo_min,
          requiere_codigo: false,
          control_salidas: res.exam.control_salidas,
          salidas_permitidas: res.exam.salidas_permitidas,
          penalizacion: res.exam.penalizacion,
          pantalla_completa: res.exam.pantalla_completa,
          practica: res.exam.practica,
        },
        res.exam
      );
    }
    if (res.info && (res.error === "code_required" || res.error === "bad_code")) {
      document.title = res.info.titulo;
      return showStart(res.info, null);
    }
    const title = res.error === "closed" ? "Examen cerrado" : "Examen no disponible";
    showMessage(title, res.message || "No se ha podido abrir el examen.", "warn");
  } catch (e) {
    showMessage("No se puede abrir el examen", errorText(e), "error");
  }
}

main();
