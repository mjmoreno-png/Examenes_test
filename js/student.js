// Página del alumno (index.html?e=ID). Todo el contenido del examen se pinta con
// textContent: nunca se inserta HTML procedente del servidor.
import { fetchExam, submitExam, fetchReview, beaconSubmit, NetworkError, ConfigError } from "./api.js";
import { h } from "./dom.js";
import { isReducedWindow } from "./presence.js";
import { createWatcher } from "./watch.js";
import { richNodes } from "./rich.js";
import { normalize, seededShuffle, formatClock, penaltyFraction, formatNumber, newSendId } from "./util.js";
import { parsePenalty, questionValue, isOpenQuestion } from "./grading.js";

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
function scoringText(questions, penalizacion) {
  let custom = null;
  try {
    custom = parsePenalty(penalizacion);
  } catch {
    custom = null;
  }
  const qs = questions ?? [];
  const tests = qs.filter((q) => !isOpenQuestion(q));
  const opens = qs.filter(isOpenQuestion);
  const weighted = qs.some((q) => questionValue(q) !== 1); // alguna pregunta no vale 1 punto
  const ks = new Set(tests.map((q) => q.options.length));
  let penalty; // texto de lo que resta cada error, o null si no resta nada
  if (custom) {
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
  if (last) {
    nombre.value = last.nombre ?? "";
    apellidos.value = last.apellidos ?? "";
    grupo.value = last.grupo ?? "";
    code.value = last.code ?? "";
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
    if (info.control_salidas && info.pantalla_completa) enterFullscreen(); // dentro del gesto de pulsar «Empezar»
    try {
      let loaded = exam;
      if (!loaded || needsCode) {
        const res = await fetchExam(examId, c);
        if (!res.ok) return fail(res.message || "No se ha podido abrir el examen.");
        loaded = res.exam;
      }
      startExam(loaded, { nombre: n, apellidos: a, grupo: g, code: c });
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
        scoringText(exam?.questions, exam?.penalizacion ?? info.penalizacion).map((t) => h("p", {}, t))
      ),
      info.control_salidas
        ? h(
            "div",
            { class: "notice warn" },
            h("p", {}, h("strong", {}, "Examen vigilado")),
            h("p", {}, exitRule(info.pantalla_completa)),
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
  store.set(key, JSON.stringify(progress));
  store.set(lastKey(), JSON.stringify(who));

  // Orden fijo por alumno: la semilla depende del examen, el nombre, los apellidos y el grupo.
  const seed = `${examId}|${normalize(who.apellidos)}|${normalize(who.nombre)}|${normalize(who.grupo)}`;
  let questions = exam.questions.map((q) => ({ ...q }));
  if (exam.barajar_preguntas) questions = seededShuffle(questions, `${seed}|q`);
  if (exam.barajar_opciones) {
    questions = questions.map((q) => (isOpenQuestion(q) ? q : { ...q, options: seededShuffle(q.options, `${seed}|o|${q.id}`) }));
  }
  // Descarta respuestas guardadas que ya no correspondan a este examen.
  for (const q of questions) {
    const given = progress.answers[q.id];
    if (given && (isOpenQuestion(q) || !q.options.some((o) => o.id === given))) delete progress.answers[q.id];
  }

  renderExam({ exam, questions, who, key, progress });
}

function renderExam(session) {
  const { exam, questions, who, key, progress } = session;
  const total = questions.length;
  const limitSeconds = (Number(exam.tiempo_min) || 0) * 60;
  const watched = Boolean(exam.control_salidas);
  const allowed = Number.isFinite(Number(exam.salidas_permitidas)) ? Number(exam.salidas_permitidas) : 3;
  // La pantalla completa solo se exige si el profesor lo ha marcado al publicar el examen.
  const fsActive = Boolean(exam.pantalla_completa) && fsSupported;
  const overLimit = () => progress.salidas > allowed;
  let timerId = null;
  let sending = false;
  let finished = false;

  const counter = h("span");
  const timer = h("span", { class: "timer", role: "timer" });
  const status = h("div", { class: "status", hidden: true, role: "status" });
  const fieldset = h("fieldset", { class: "question" });
  const isAnswered = (q) => (isOpenQuestion(q) ? Boolean((progress.open[q.id] ?? "").trim()) : Boolean(progress.answers[q.id]));
  const answered = () => questions.filter(isAnswered).length;
  const showPoints = questions.some((q) => questionValue(q) !== 1);
  const updateCounter = () => (counter.textContent = `Contestadas: ${answered()} de ${total}`);
  const save = () => store.set(key, JSON.stringify(progress));

  questions.forEach((q, i) => {
    const group = h("fieldset", { class: "question card question-card", id: `p${i + 1}` });
    group.append(
      h(
        "legend",
        {},
        h("span", { class: "qnum" }, `${i + 1}.`),
        ...richNodes(q.text, exam.imagenes),
        showPoints ? h("span", { class: "points-badge" }, `${formatNumber(questionValue(q))} ${questionValue(q) === 1 ? "punto" : "puntos"}`) : null
      )
    );
    if (isOpenQuestion(q)) {
      group.append(openAnswerBox(q));
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
    const blocked = () => {
      progress.pegados += 1; // queda registrado para el profesor
      save();
    };
    for (const type of ["paste", "drop"]) {
      area.addEventListener(type, (e) => {
        e.preventDefault();
        blocked();
      });
    }
    for (const type of ["copy", "cut", "dragstart"]) area.addEventListener(type, (e) => e.preventDefault());
    area.addEventListener("beforeinput", (e) => {
      if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop" || e.inputType === "insertFromYank") {
        e.preventDefault();
        blocked();
      }
    });
    area.addEventListener("input", () => {
      progress.open[q.id] = area.value;
      save();
      refresh();
      updateCounter();
    });
    refresh();
    return h("div", { class: "open-box" }, area, left);
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

  function buildPayload(motivo) {
    const respuestas = {};
    const abiertas = {};
    for (const q of exam.questions) {
      if (isOpenQuestion(q)) abiertas[q.id] = (progress.open[q.id] ?? "").slice(0, MAX_OPEN_CHARS);
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
      pegados: progress.pegados,
      duracion_min: Math.round(((Date.now() - progress.startedAt) / 60000) * 100) / 100,
      salidas: progress.salidas,
      // Incluye el tiempo de una salida que todavía no ha terminado (el alumno envía sin haber vuelto).
      segundos_fuera: Math.round(awaySeconds() * 10) / 10,
      envio: motivo,
      envioId: progress.envioId,
      motivos_salida: progress.motivos.join(","),
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
  // Tableta: el puntero principal es el dedo. El iPad también se reconoce cuando Safari se presenta como un Mac
  // («sitio web de escritorio», activado por defecto en iPad): un «Mac» con pantalla táctil es un iPad.
  // Los portátiles táctiles (puntero principal: ratón o panel) no cuentan como tableta.
  const tablet =
    (window.matchMedia?.("(pointer: coarse)").matches ?? false) ||
    (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1);
  const watcher = createWatcher(
    tablet ? { grace: { hidden: 2000 } } : window.matchMedia?.("(pointer: fine)").matches ? { grace: { fullscreenLost: 1500 } } : {}
  );
  let wasReduced = false;
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
    wasReduced = isReducedWindow({
      // Tamaño de la ventana sin contar el zoom: en el iPad, ampliar con dos dedos encoge innerWidth/innerHeight
      // y se confundía con la pantalla dividida.
      innerWidth: document.documentElement.clientWidth || window.innerWidth,
      innerHeight: document.documentElement.clientHeight || window.innerHeight,
      screenWidth: window.screen?.width,
      screenHeight: window.screen?.height,
      coarse: tablet,
      typing: isEditable(document.activeElement),
      wasReduced,
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

  function evaluateAway() {
    if (!watched || sending || finished) return;
    const r = watcher.update(collectInputs(), Date.now());
    if (r.leave) onLeave(r.leave);
    if (r.back) onReturn(r.back);
    applyCover(r.coverReason);
  }

  if (watched) {
    document.addEventListener("visibilitychange", evaluateAway);
    window.addEventListener("blur", () => {
      // En tabletas no se usa: Safari en iPad avisa de «blur» al ocultar el teclado y en otros gestos aunque el
      // alumno siga en el examen, y a veces nunca avisa de «focus» al volver (salidas falsas «blurred»).
      // Irse a otra app se detecta por la página oculta; la pantalla dividida, por el tamaño de la ventana.
      if (tablet) return;
      blurred = true;
      evaluateAway();
    });
    window.addEventListener("focus", () => { blurred = false; evaluateAway(); });
    window.addEventListener("pagehide", () => { pageHidden = true; evaluateAway(); });
    window.addEventListener("pageshow", () => { pageHidden = false; evaluateAway(); });
    window.addEventListener("resize", evaluateAway);
    window.addEventListener("orientationchange", evaluateAway);
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
        if (e.target?.closest?.("textarea.open-answer")) return;
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

function showReview(r, onBack = null) {
  document.title = `Revisión · ${r.titulo}`;
  const pts = (v) => `${formatNumber(v)} ${v === 1 ? "punto" : "puntos"}`;
  const cards = r.questions.map((q, i) => {
    const legend = h("p", { class: "review-qtext" }, h("span", { class: "qnum" }, `${i + 1}.`), ...richNodes(q.text, r.imagenes));
    if (q.tipo === "abierta") {
      const pending = q.puntos === null || q.puntos === undefined;
      return h(
        "div",
        { class: `card review-q ${pending ? "pending" : ""}` },
        legend,
        h("span", { class: `review-status ${pending ? "pending" : "ok"}` }, pending ? "Pendiente de corregir" : `${formatNumber(q.puntos)} de ${pts(q.valor)}`),
        h("p", { class: "muted small" }, "Tu respuesta:"),
        q.respuesta ? h("p", { class: "review-open" }, q.respuesta) : h("p", { class: "muted" }, "(en blanco)")
      );
    }
    const state = q.respuesta === null ? "blank" : q.respuesta === q.correcta ? "ok" : "bad";
    const label = { ok: "Correcta", bad: "Incorrecta", blank: "En blanco" }[state];
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
        h("h1", {}, `Revisión: ${r.titulo}`),
        h("p", { class: "muted" }, `${r.nombre} ${r.apellidos}`.trim()),
        hasNote
          ? [
              h("p", { class: "muted" }, pendingOpen ? "Nota provisional" : "Tu nota"),
              h("div", { class: "big-result" }, `${formatNumber(r.nota)} / 10`),
              pendingOpen ? h("p", { class: "muted small" }, "Faltan preguntas abiertas por corregir: tu nota cambiará cuando tu profesor las corrija.") : null,
            ]
          : null,
        h(
          "div",
          { class: "review-summary" },
          h("span", { class: "review-status ok" }, `Aciertos: ${r.aciertos}`),
          h("span", { class: "review-status bad" }, `Errores: ${r.errores}`),
          h("span", { class: "review-status blank" }, `En blanco: ${r.blancos}`)
        ),
        onBack ? h("div", { class: "actions" }, h("button", { type: "button", class: "btn secondary small", onclick: onBack }, "Volver")) : null
      ),
      cards
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
