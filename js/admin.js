// Panel del profesor (admin.html). El token se guarda solo en el localStorage de este navegador.
import { apiGet, apiPost, NetworkError, ConfigError } from "./api.js";
import { parseGift, GiftError } from "./gift.js";
import { h } from "./dom.js";
import { studentLink, randomCode, formatNumber } from "./util.js";
import { parsePenalty, questionValue, isOpenQuestion } from "./grading.js";
import { collectImageRefs, matchImage, MAX_IMAGES, MAX_TOTAL_IMAGE_CHARS } from "./images.js";
import { prepareImage } from "./image-encode.js";
import { richNodes } from "./rich.js";
import { showCorrection, exportNotes } from "./correction.js";

const TOKEN_KEY = "admin_token";
const WARN_CHARS = 45000;
const MAX_CHARS = 49000;

const app = document.getElementById("app");
let token = readToken();

/* ------------------------------- token ---------------------------------- */

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
function saveToken(value) {
  token = value;
  try {
    value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sin almacenamiento: el token vive solo hasta cerrar la página */
  }
}

/* ------------------------------ utilidades ------------------------------ */

function errorText(e) {
  if (e instanceof ConfigError) return "Falta configurar APPS_SCRIPT_URL en js/config.js.";
  if (e instanceof NetworkError) return "No hay conexión con el servidor. Inténtalo de nuevo.";
  return "Ha ocurrido un error inesperado.";
}

const notice = (kind, text) => h("div", { class: `notice ${kind}`, role: kind === "error" ? "alert" : null }, h("p", {}, text));

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const old = button.textContent;
  button.textContent = "¡Copiado!";
  setTimeout(() => (button.textContent = old), 1500);
}

function qrImage(url) {
  if (typeof qrcode === "undefined") return null; // la librería no cargó: se omite el QR
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return h("div", { class: "qr" }, h("img", { src: qr.createDataURL(8, 4), alt: "Código QR del enlace del examen" }));
}

/* ------------------------------- inicio --------------------------------- */

function showLogin(message) {
  const input = h("input", { type: "password", name: "token", autocomplete: "current-password", required: true });
  const msg = h("div");
  if (message) msg.append(notice("error", message));
  const button = h("button", { class: "btn block", type: "submit" }, "Entrar");
  const form = h(
    "form",
    {},
    h("label", { class: "field" }, h("span", {}, "Token de administración"), input, h("small", { class: "hint" }, "Es el valor de ADMIN_TOKEN que pusiste en el script. Se guarda solo en este navegador.")),
    msg,
    button
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    button.disabled = true;
    msg.replaceChildren();
    try {
      const res = await apiGet({ action: "list", token: input.value.trim() });
      if (res.ok) {
        saveToken(input.value.trim());
        showPanel(res.exams);
      } else {
        msg.append(notice("error", res.message || "No se ha podido entrar."));
      }
    } catch (e) {
      msg.append(notice("error", errorText(e)));
    } finally {
      button.disabled = false;
    }
  });
  app.replaceChildren(h("div", { class: "card" }, h("h1", {}, "Panel del profesor"), form));
}

async function main() {
  if (!token) return showLogin();
  try {
    const res = await apiGet({ action: "list", token });
    if (res.ok) return showPanel(res.exams);
    if (res.error === "unauthorized") saveToken("");
    showLogin(res.message);
  } catch (e) {
    showLogin(errorText(e));
  }
}

/* -------------------------------- panel --------------------------------- */

function showPanel(initialExams) {
  const listBox = h("div");
  const createBox = h("div");

  const logout = h(
    "button",
    {
      class: "btn secondary small",
      type: "button",
      onclick: () => {
        saveToken("");
        showLogin();
      },
    },
    "Cerrar sesión"
  );

  app.replaceChildren(
    h("div", { class: "top-bar" }, h("h1", {}, "Panel del profesor"), logout),
    createBox,
    h("div", { class: "card" }, h("h2", {}, "Mis exámenes"), listBox)
  );

  const onUnauthorized = () => {
    saveToken("");
    showLogin("El token ya no es válido. Vuelve a escribirlo.");
  };

  async function refreshList() {
    try {
      const res = await apiGet({ action: "list", token });
      if (res.ok) renderList(res.exams);
      else if (res.error === "unauthorized") onUnauthorized();
      else listBox.replaceChildren(notice("error", res.message));
    } catch (e) {
      listBox.replaceChildren(notice("error", errorText(e)));
    }
  }

  function renderList(exams) {
    if (!exams.length) {
      listBox.replaceChildren(h("p", { class: "muted" }, "Todavía no has publicado ningún examen."));
      return;
    }
    const sorted = [...exams].sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    listBox.replaceChildren(
      ...sorted.map((ex) => {
        const link = studentLink(location.href, ex.id);
        const toggle = h("button", { class: "btn secondary small", type: "button" }, ex.activo ? "Cerrar examen" : "Abrir examen");
        toggle.addEventListener("click", async () => {
          toggle.disabled = true;
          try {
            const res = await apiPost({ action: "setActive", token, id: ex.id, activo: !ex.activo });
            if (res.error === "unauthorized") return onUnauthorized();
            if (!res.ok) alert(res.message);
          } catch (e) {
            alert(errorText(e));
          }
          refreshList();
        });
        // Revisión: con ella, cada alumno ve sus fallos y las respuestas correctas al abrir el enlace en su dispositivo.
        // Un Code.gs anterior no devuelve `revision`: entonces no se ofrece.
        const reviewToggle =
          typeof ex.revision === "boolean"
            ? h("button", { class: "btn secondary small", type: "button" }, ex.revision ? "Ocultar revisión" : "Publicar revisión")
            : null;
        reviewToggle?.addEventListener("click", async () => {
          if (
            !ex.revision &&
            ex.activo &&
            !confirm("El examen sigue abierto: quien todavía no lo haya hecho podría ver las soluciones a través de un compañero. ¿Publicar la revisión igualmente?")
          ) {
            return;
          }
          reviewToggle.disabled = true;
          try {
            const res = await apiPost({ action: "setReview", token, id: ex.id, revision: !ex.revision });
            if (res.error === "unauthorized") return onUnauthorized();
            if (!res.ok) alert(res.message);
          } catch (e) {
            alert(errorText(e));
          }
          refreshList();
        });
        const copy = h("button", { class: "btn secondary small", type: "button" }, "Copiar enlace");
        copy.addEventListener("click", () => copyText(link, copy));
        const exportBtn = h("button", { class: "btn secondary small", type: "button" }, "Exportar notas (CSV)");
        exportBtn.addEventListener("click", async () => {
          exportBtn.disabled = true;
          try {
            const err = await exportNotes(token, ex);
            if (err) alert(err);
          } catch (e) {
            alert(errorText(e));
          }
          exportBtn.disabled = false;
        });
        return h(
          "div",
          { class: "exam-item" },
          h("h3", {}, ex.titulo, " ", h("span", { class: `badge ${ex.activo ? "on" : "off"}` }, ex.activo ? "Abierto" : "Cerrado"), ex.control_salidas ? " " : null, ex.control_salidas ? h("span", { class: "badge on" }, `Vigilado · ${ex.salidas_permitidas ?? 3} salidas${ex.pantalla_completa ? " · pantalla completa" : ""}`) : null, ex.revision ? " " : null, ex.revision ? h("span", { class: "badge on" }, "Revisión publicada") : null),
          h(
            "p",
            { class: "muted small meta" },
            [
              ex.grupo_destino ? `Grupo: ${ex.grupo_destino}` : null,
              `${ex.n_preguntas} preguntas`,
              ex.tiempo_min ? `${ex.tiempo_min} min` : "sin límite de tiempo",
              `${ex.envios} envío${ex.envios === 1 ? "" : "s"}`,
              ex.codigo_acceso ? `Código: ${ex.codigo_acceso}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          ),
          h(
            "div",
            { class: "actions" },
            ex.n_abiertas ? h("button", { class: "btn small", type: "button", onclick: () => showCorrection(app, { token, ex, onBack: main, onUnauthorized }) }, "Corregir abiertas") : null,
            exportBtn,
            toggle,
            reviewToggle,
            copy,
            h("a", { class: "btn secondary small", href: ex.results_url, target: "_blank", rel: "noopener" }, "Ver hoja de Google")
          )
        );
      })
    );
  }

  renderCreate(createBox, { onPublished: refreshList, onUnauthorized });
  renderList(initialExams);
}

/* ----------------------------- crear examen ----------------------------- */

function renderCreate(box, { onPublished, onUnauthorized }) {
  let questions = null;

  const file = h("input", { type: "file", accept: ".txt,.gift,text/plain" });
  const gift = h("textarea", { name: "gift", spellcheck: "false", placeholder: "::P01::Pregunta{\n=Correcta\n~Incorrecta\n~Incorrecta\n}" });
  const preview = h("div");
  const imagesBox = h("div");
  const provided = new Map(); // nombre del archivo (en minúsculas) -> imagen ya reducida
  let imageRefs = { names: [], invalid: [] };
  let tooBig = false;

  const titulo = h("input", { name: "titulo", maxlength: 120, required: true });
  const grupo = h("input", { name: "grupo", maxlength: 60 });
  const tiempo = h("input", { name: "tiempo", type: "number", min: 0, step: 1, value: 0, inputmode: "numeric" });
  const codigo = h("input", { name: "codigo", maxlength: 40, autocomplete: "off" });
  const genCode = h("button", { class: "btn secondary small", type: "button", onclick: () => (codigo.value = randomCode()) }, "Generar código");
  const check = (label, checked) => {
    const input = h("input", { type: "checkbox", checked });
    return { input, node: h("label", { class: "check" }, input, label) };
  };
  // Penalización por cada error, siempre como fracción de punto.
  const penaltySelect = h(
    "select",
    { name: "penalizacion" },
    h("option", { value: "auto" }, "Automática: 1/(opciones − 1), es decir, 1/3 con 4 opciones"),
    h("option", { value: "0" }, "Sin penalización (los errores no restan)"),
    h("option", { value: "1/2" }, "1/2 de punto por error"),
    h("option", { value: "1/3" }, "1/3 de punto por error"),
    h("option", { value: "1/4" }, "1/4 de punto por error"),
    h("option", { value: "1/5" }, "1/5 de punto por error"),
    h("option", { value: "otra" }, "Otra fracción…")
  );
  const numInput = h("input", { type: "number", min: 0, max: 99, step: 1, value: 1, inputmode: "numeric", "aria-label": "Numerador" });
  const denInput = h("input", { type: "number", min: 1, max: 99, step: 1, value: 3, inputmode: "numeric", "aria-label": "Denominador" });
  const customRow = h("div", { class: "fraction-row", hidden: true }, numInput, h("span", { class: "fraction-bar" }, "/"), denInput, h("span", { class: "muted" }, "de punto por error"));
  const penaltyExample = h("small", { class: "hint" });
  // Valor elegido: "" = automática, o "a/b" reducida; lanza un error si la fracción no es válida.
  function chosenPenalty() {
    if (penaltySelect.value === "auto") return "";
    const text = penaltySelect.value === "otra" ? `${numInput.value}/${denInput.value}` : penaltySelect.value;
    const p = parsePenalty(text);
    return p.den === 1 ? String(p.num) : `${p.num}/${p.den}`;
  }
  function refreshPenalty() {
    customRow.hidden = penaltySelect.value !== "otra";
    let text;
    try {
      const f = chosenPenalty();
      const p = f === "" ? { num: 1, den: 3 } : parsePenalty(f);
      // Ejemplo: 20 preguntas, 12 aciertos, 5 errores y 3 en blanco (con la automática, supone 4 opciones).
      const nota = ((12 - (5 * p.num) / p.den) / 20) * 10;
      text = `Cada acierto suma 1 punto y cada error resta ${f === "" ? "1/(opciones − 1)" : f === "0" ? "nada" : f} de punto. Ejemplo: 12 aciertos, 5 errores y 3 en blanco de 20 preguntas → ${formatNumber(Math.max(0, nota))}.`;
      penaltyExample.className = "hint";
    } catch (e) {
      text = e.message;
      penaltyExample.className = "err";
    }
    penaltyExample.textContent = text;
  }
  penaltySelect.addEventListener("change", refreshPenalty);
  numInput.addEventListener("input", refreshPenalty);
  denInput.addEventListener("input", refreshPenalty);
  refreshPenalty();
  const barPreg = check("Barajar el orden de las preguntas", true);
  const barOpc = check("Barajar el orden de las opciones", true);
  const mostrar = check("Mostrar la nota al alumno al terminar", true);
  const negativa = check("Permitir nota negativa (si no, la mínima es 0)", false);
  const vigilar = check("Vigilar salidas: registrar cuántas veces y cuánto tiempo sale el alumno (pestaña, ventana o app)", true);
  const salidasInput = h("input", { name: "salidas", type: "number", min: 0, max: 20, step: 1, value: 3, inputmode: "numeric" });
  const salidasField = h(
    "label",
    { class: "field" },
    h("span", {}, "Salidas permitidas"),
    salidasInput,
    h("small", { class: "hint" }, "Al superarlas, el examen se envía solo. Con 3, a la cuarta salida se envía. Con 0, se envía en la primera.")
  );
  const pantallaCompleta = check("Exigir pantalla completa (opcional): pide pantalla completa al empezar y oculta el examen si se sale de ella", false);
  const refreshVigilar = () => {
    salidasInput.disabled = !vigilar.input.checked;
    pantallaCompleta.input.disabled = !vigilar.input.checked;
  };
  vigilar.input.addEventListener("change", refreshVigilar);

  const msg = h("div");
  const publish = h("button", { class: "btn block", type: "submit", disabled: true }, "Publicar examen");

  function update() {
    questions = null;
    preview.replaceChildren();
    imageRefs = { names: [], invalid: [] };
    tooBig = false;
    publish.disabled = true;
    const text = gift.value.trim();
    if (!text) return renderImages();
    try {
      questions = parseGift(text);
    } catch (e) {
      if (!(e instanceof GiftError)) throw e;
      preview.append(
        h("div", { class: "notice error", role: "alert" }, h("p", {}, h("strong", {}, "Hay errores en el archivo; corrígelos para poder publicar:")), e.errors.map((m) => h("p", {}, m)))
      );
      return renderImages();
    }
    imageRefs = collectImageRefs(questions);
    const size = JSON.stringify(questions).length;
    tooBig = size > MAX_CHARS;
    const nOpen = questions.filter(isOpenQuestion).length;
    const pts = (list) => formatNumber(list.reduce((sum, q) => sum + questionValue(q), 0));
    const tests = questions.filter((q) => !isOpenQuestion(q));
    preview.append(
      h("p", {}, h("strong", {}, `${questions.length} preguntas`), ` · ${size.toLocaleString("es-ES")} de 50 000 caracteres`),
      // Reparto de puntos: la nota final siempre es sobre 10 (puntos obtenidos / puntos totales × 10).
      h(
        "div",
        { class: "notice info" },
        h("p", {}, h("strong", {}, "Reparto de puntos")),
        h("p", {}, `Test: ${tests.length} ${tests.length === 1 ? "pregunta" : "preguntas"} · ${pts(tests)} puntos.`),
        nOpen ? h("p", {}, `Abiertas: ${nOpen} ${nOpen === 1 ? "pregunta" : "preguntas"} · ${pts(questions.filter(isOpenQuestion))} puntos (las corriges tú en la hoja de Google).`) : null,
        h("p", {}, `Total: ${pts(questions)} puntos → la nota se calcula sobre 10.`)
      ),
      tooBig ? notice("error", "El examen es demasiado grande para una celda de Google Sheets. Divídelo en dos exámenes.") : size > WARN_CHARS ? notice("warn", "El examen está cerca del límite de tamaño de una celda de Google Sheets.") : null,
      h(
        "div",
        { class: "card" },
        questions.map((q, i) =>
          h(
            "div",
            { class: "q-preview" },
            h("div", { class: "q-text" }, h("strong", {}, `${i + 1}. `, q.title ? `[${q.title}] ` : ""), ...richNodes(q.text, imageMap()), h("span", { class: "points-badge" }, `${formatNumber(questionValue(q))} ${questionValue(q) === 1 ? "punto" : "puntos"}${isOpenQuestion(q) ? " · abierta" : ""}`)),
            isOpenQuestion(q) ? h("p", { class: "muted small" }, "Respuesta abierta: el alumno escribe en un cuadro de texto.") : h("ol", {}, q.options.map((o) => h("li", { class: o.id === q.correct ? "correct" : null }, o.text, o.id === q.correct ? " ✓" : "")))
          )
        )
      )
    );
    renderImages();
  }

  // Imágenes ya subidas, por el nombre con que se citan en las preguntas: {"grafica1.png": "data:..."}
  function imageMap() {
    const map = {};
    for (const name of imageRefs.names) {
      const img = matchImage(name, [...provided.values()]);
      if (img) map[name] = img.url;
    }
    return map;
  }

  const imgInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true });
  const imgStatus = h("div");
  imgInput.addEventListener("change", async () => {
    const files = [...imgInput.files];
    imgInput.value = "";
    imgStatus.replaceChildren(notice("info", "Reduciendo las imágenes…"));
    const errs = [];
    for (const f of files) {
      try {
        const img = await prepareImage(f);
        provided.set(f.name.toLowerCase(), { name: f.name, ...img });
      } catch (e) {
        errs.push(e.message);
      }
    }
    imgStatus.replaceChildren(...errs.map((m) => notice("error", m)));
    update();
  });

  // Panel de imágenes: qué cita el GIFT, cuáles faltan y cuánto pesan. Decide si se puede publicar.
  function renderImages() {
    const { names, invalid } = imageRefs;
    const have = names.filter((n) => matchImage(n, [...provided.values()]));
    const missing = names.filter((n) => !have.includes(n) && !invalid.includes(n));
    const unused = [...provided.values()].filter((f) => !names.some((n) => n.toLowerCase() === f.name.toLowerCase()));
    const chars = have.reduce((sum, n) => sum + matchImage(n, [...provided.values()]).chars, 0);
    const tooMany = names.length > MAX_IMAGES;
    const tooHeavy = chars > MAX_TOTAL_IMAGE_CHARS;

    imagesBox.replaceChildren();
    if (questions && (names.length || provided.size)) {
      imagesBox.append(
        h(
          "div",
          { class: "card" },
          h("h2", {}, "Imágenes de las preguntas"),
          names.length
            ? h("p", { class: "muted small" }, "El examen cita estas imágenes. Selecciónalas todas a la vez (PNG, JPEG, WebP o GIF): se reducen automáticamente y se guardan en tu hoja de Google.")
            : null,
          h("label", { class: "field" }, h("span", {}, "Añadir imágenes"), imgInput),
          imgStatus,
          invalid.map((n) => notice("error", `La cita «${n}» no es válida: escribe solo el nombre del archivo (sin carpetas ni direcciones de internet), por ejemplo ![gráfica](grafica1.png).`)),
          names
            .filter((n) => !invalid.includes(n))
            .map((n) => {
              const img = matchImage(n, [...provided.values()]);
              return h(
                "div",
                { class: "img-row" },
                img ? h("img", { class: "img-thumb", src: img.url, alt: "" }) : h("span", { class: "img-thumb empty" }, "?"),
                h("span", {}, h("strong", {}, n), " ", img ? h("span", { class: "muted small" }, `✓ ${img.width}×${img.height} px · ${Math.round((img.chars * 3) / 4 / 1024)} KB`) : h("span", { class: "badge off" }, "falta"))
              );
            }),
          unused.length ? h("p", { class: "muted small" }, `Sin usar (no se citan en el GIFT): ${unused.map((f) => f.name).join(", ")}`) : null,
          tooMany ? notice("error", `Demasiadas imágenes: el máximo es ${MAX_IMAGES} por examen.`) : null,
          tooHeavy ? notice("error", "Las imágenes pesan demasiado en total (máximo unos 1,5 MB). Quita alguna o usa imágenes más pequeñas.") : null,
          names.length ? h("p", { class: "muted small" }, `${have.length} de ${names.length} imágenes subidas · ${Math.round((chars * 3) / 4 / 1024)} KB en total`) : null
        )
      );
    }
    publish.disabled = !questions || tooBig || missing.length > 0 || invalid.length > 0 || tooMany || tooHeavy;
    return undefined;
  }

  gift.addEventListener("input", update);
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    gift.value = await f.text();
    if (!titulo.value) {
      titulo.value = f.name.replace(/\.(gift|txt)/gi, "").replace(/[_-]+/g, " ").trim();
    }
    update();
  });

  const form = h(
    "form",
    {},
    h("h2", {}, "Crear examen"),
    h("label", { class: "field" }, h("span", {}, "Archivo GIFT"), file, h("small", { class: "hint" }, "El archivo no se guarda en ningún sitio: solo se envían las preguntas a tu hoja de Google.")),
    h("label", { class: "field" }, h("span", {}, "…o pega el texto GIFT"), gift),
    imagesBox,
    preview,
    h("h2", {}, "Ajustes"),
    h("label", { class: "field" }, h("span", {}, "Título"), titulo),
    h("div", { class: "row2" }, h("label", { class: "field" }, h("span", {}, "Grupo (opcional)"), grupo), h("label", { class: "field" }, h("span", {}, "Tiempo en minutos (0 = sin límite)"), tiempo)),
    h("label", { class: "field" }, h("span", {}, "Código de acceso (opcional)"), codigo, h("div", { style: "margin-top:6px" }, genCode)),
    h("label", { class: "field" }, h("span", {}, "Penalización por cada error"), penaltySelect, customRow, penaltyExample),
    barPreg.node,
    barOpc.node,
    mostrar.node,
    negativa.node,
    vigilar.node,
    salidasField,
    pantallaCompleta.node,
    msg,
    publish
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    msg.replaceChildren();
    if (!questions) return msg.append(notice("error", "Primero carga un examen GIFT válido."));
    if (!titulo.value.trim()) return msg.append(notice("error", "Escribe un título."));
    let penalizacion;
    try {
      penalizacion = chosenPenalty();
    } catch (e) {
      return msg.append(notice("error", e.message));
    }
    // Imágenes citadas en las preguntas, con el nombre tal como aparece en el enunciado.
    const imagenes = imageRefs.names.map((n) => {
      const img = matchImage(n, [...provided.values()]);
      return { nombre: n, mime: img.mime, data: img.data };
    });
    publish.disabled = true;
    publish.textContent = "Publicando…";
    try {
      // Un Code.gs anterior ignoraría imágenes, valores o preguntas abiertas y el examen saldría roto: se comprueba antes.
      const needs = [];
      if (imagenes.length) needs.push(["imagenes", "guardar imágenes"]);
      if (questions.some((q) => isOpenQuestion(q) || questionValue(q) !== 1)) needs.push(["abiertas", "usar preguntas abiertas ni puntos por pregunta"]);
      if (needs.length) {
        const v = await apiGet({ action: "version" });
        const missing = needs.find(([f]) => !v.ok || !Array.isArray(v.funciones) || !v.funciones.includes(f));
        if (missing) {
          msg.append(notice("error", `El script de Google no está actualizado y no sabe ${missing[1]}. Actualiza Code.gs en Apps Script (Nueva versión) y vuelve a publicar.`));
          publish.disabled = false;
          return;
        }
      }
      const res = await apiPost({
        action: "createExam",
        token,
        titulo: titulo.value.trim(),
        grupo_destino: grupo.value.trim(),
        tiempo_min: Number(tiempo.value) || 0,
        codigo_acceso: codigo.value.trim(),
        barajar_preguntas: barPreg.input.checked,
        barajar_opciones: barOpc.input.checked,
        mostrar_nota: mostrar.input.checked,
        permitir_negativa: negativa.input.checked,
        penalizacion,
        imagenes,
        control_salidas: vigilar.input.checked,
        pantalla_completa: vigilar.input.checked && pantallaCompleta.input.checked,
        salidas_permitidas: salidasInput.value === "" ? 3 : Math.max(0, Math.min(20, Math.floor(Number(salidasInput.value)) || 0)),
        preguntas: questions,
      });
      if (res.error === "unauthorized") return onUnauthorized();
      if (!res.ok) {
        msg.append(notice("error", res.message || "No se ha podido publicar."));
        publish.disabled = false;
        return;
      }
      // Un Code.gs anterior ignora la penalización elegida y corrige con la automática: se avisa.
      if (pantallaCompleta.input.checked && res.pantalla_completa === undefined) {
        res.warning = [res.warning, "El script de Google no está actualizado y no conoce la opción de pantalla completa: este examen no la exigirá. Actualiza Code.gs en Apps Script (Nueva versión) y vuelve a publicar el examen."].filter(Boolean).join(" ");
      }
      if (penalizacion !== "" && res.penalizacion === undefined) {
        res.warning = [res.warning, "El script de Google no está actualizado y no conoce la penalización elegida: este examen se corregirá con la automática. Actualiza Code.gs en Apps Script (Nueva versión) y vuelve a publicar el examen."].filter(Boolean).join(" ");
      }
      showPublished(box, res, titulo.value.trim(), codigo.value.trim(), () => renderCreate(box, { onPublished, onUnauthorized }));
      onPublished();
    } catch (e) {
      msg.append(notice("error", errorText(e)));
      publish.disabled = false;
    } finally {
      publish.textContent = "Publicar examen";
    }
  });

  box.replaceChildren(h("div", { class: "card" }, form));
}

function showPublished(box, res, title, code, again) {
  const link = studentLink(location.href, res.id);
  const copy = h("button", { class: "btn", type: "button" }, "Copiar enlace");
  copy.addEventListener("click", () => copyText(link, copy));
  box.replaceChildren(
    h(
      "div",
      { class: "card" },
      h("h2", {}, "Examen publicado"),
      notice("ok", `«${title}» (${res.n_preguntas} preguntas) ya está abierto para los alumnos.`),
      res.warning ? notice("warn", res.warning) : null,
      code ? h("p", {}, "Código de acceso: ", h("strong", {}, code)) : null,
      h("div", { class: "link-row" }, h("input", { readonly: true, value: link, "aria-label": "Enlace del examen", onfocus: (e) => e.target.select() }), copy),
      h("p", {}),
      qrImage(link),
      h("p", { class: "muted small" }, "Cuando quieras que nadie más pueda entrar, ciérralo desde «Mis exámenes»."),
      h("div", { class: "actions" }, h("a", { class: "btn secondary", href: link, target: "_blank", rel: "noopener" }, "Abrir como alumno"), h("button", { class: "btn secondary", type: "button", onclick: again }, "Crear otro examen"))
    )
  );
}

main();
