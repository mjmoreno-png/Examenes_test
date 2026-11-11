// Pantalla de corrección de preguntas abiertas y de respuesta corta, y exportación de las notas (panel del profesor).
import { apiPost, NetworkError } from "./api.js";
import { h } from "./dom.js";
import { richNodes } from "./rich.js";
import { formatNumber } from "./util.js";
import { toGift } from "./gift.js";

/* ------------------------------ exportación ------------------------------ */

const num = (v) => (v === "" || v === null || v === undefined ? "" : String(v).replace(".", ","));

// Una celda de CSV: comillas dobles si hace falta y sin fórmulas (= + - @ al principio se neutralizan).
export function csvCell(value) {
  let t = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) t = `'${t}`;
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Tabla de notas lista para Excel en español: separador «;», decimales con coma, orden por apellidos. */
export function buildCsv(rows, hasOpen, hasPart = false) {
  const head = ["Apellidos", "Nombre", "Grupo", "Nota", ...(hasOpen ? ["Preguntas sin corregir"] : []), ...(hasPart ? ["Convalidada"] : []), "Aciertos", "Errores", "En blanco", "Salidas", "Segundos fuera", "Cambios de escritorio", "Segundos en otro escritorio", "Ventanas encima", "Segundos con ventana encima", "Desconexiones", "Segundos sin conexión", "Intentos de pegar"];
  const lines = [head, ...rows.map((r) => [r.apellidos, r.nombre, r.grupo, num(r.nota), ...(hasOpen ? [r.pendientes] : []), ...(hasPart ? [r.convalidada ? "sí" : ""] : []), r.aciertos, r.errores, r.blancos, r.salidas, num(r.segundos_fuera), r.cambios_escritorio ?? 0, num(r.segundos_escritorio ?? 0), r.ventanas_encima ?? 0, num(r.segundos_ventana_encima ?? 0), r.desconexiones ?? 0, num(r.segundos_sin_conexion ?? 0), r.pegados])];
  return "﻿" + lines.map((l) => l.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

function download(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "examen";

async function fetchResults(token, examId) {
  const res = await apiPost({ action: "results", token, examId });
  return res;
}

/** Descarga la tabla de notas de un examen (CSV). Devuelve un texto de error o null. */
export async function exportNotes(token, ex) {
  const res = await fetchResults(token, ex.id);
  if (res.error === "bad_request") return "El script de Google no está actualizado: actualiza Code.gs (Nueva versión) para poder exportar.";
  if (!res.ok) return res.message || "No se han podido leer los resultados.";
  if (!res.rows.length) return "Todavía no hay envíos que exportar.";
  const hasOpen = res.exam.preguntas.some((q) => q.tipo === "abierta");
  download(`notas_${safeName(ex.titulo)}.csv`, buildCsv(res.rows, hasOpen, Boolean(res.exam.convalidable)));
  return null;
}

/** Descarga las preguntas de un examen, con sus soluciones, como archivo GIFT. Devuelve un texto de error o null. */
export async function exportGift(token, ex) {
  const res = await apiPost({ action: "exportExam", token, examId: ex.id });
  if (res.error === "bad_request") return "El script de Google no está actualizado: actualiza Code.gs (Nueva versión) para poder exportar el GIFT.";
  if (!res.ok) return res.message || "No se han podido leer las preguntas.";
  const comment = [`${res.titulo}`, "Exportado desde el panel. Lleva las soluciones: no lo subas al repositorio."];
  // Las instrucciones no forman parte del GIFT: van como comentario para no perderlas.
  if (res.instrucciones) comment.push("", "Instrucciones para el alumno:", ...String(res.instrucciones).split("\n"));
  // El GIFT original tal como se publicó; los exámenes anteriores no lo guardaron y se genera de las preguntas.
  const text = res.gift
    ? `${comment.map((l) => (l ? `// ${l}` : "//")).join("\n")}\n\n${String(res.gift).replace(/^\n+/, "")}`
    : toGift(res.preguntas, comment.join("\n"));
  download(`${safeName(res.titulo)}.gift`, text, "text/plain");
  return null;
}

/* ------------------------------- corrección ------------------------------ */

const fmt = (n) => formatNumber(n);

export async function showCorrection(app, { token, ex, onBack, onUnauthorized }) {
  app.replaceChildren(h("div", { class: "card" }, h("p", { class: "muted" }, "Cargando respuestas…")));
  let res;
  try {
    res = await fetchResults(token, ex.id);
  } catch (e) {
    app.replaceChildren(h("div", { class: "card" }, h("div", { class: "notice error" }, h("p", {}, e instanceof NetworkError ? "No hay conexión con el servidor." : "Ha ocurrido un error inesperado.")), h("button", { class: "btn secondary", type: "button", onclick: onBack }, "Volver")));
    return;
  }
  if (res.error === "unauthorized") return onUnauthorized();
  if (!res.ok) {
    const msg = res.error === "bad_request" ? "El script de Google no está actualizado: actualiza Code.gs (Nueva versión) para poder corregir aquí." : res.message;
    app.replaceChildren(h("div", { class: "card" }, h("div", { class: "notice error" }, h("p", {}, msg)), h("button", { class: "btn secondary", type: "button", onclick: onBack }, "Volver")));
    return;
  }

  // Primero las abiertas (hay que corregirlas) y después las de respuesta corta (ya corregidas solas; se pueden cambiar).
  // Con parte convalidable, al final una pestaña para comprobar quién la ha marcado y dársela o quitársela.
  const part = res.exam.convalidable ?? null;
  const CONV = { id: "", tipo: "convalidaciones" };
  const opens = [...res.exam.preguntas.filter((q) => q.tipo === "abierta"), ...res.exam.preguntas.filter((q) => q.tipo === "corta"), ...(part ? [CONV] : [])];
  const rows = res.rows;
  for (const r of rows) r.cortas = r.cortas ?? {};
  let current = opens[0];
  let onlyPending = false;
  const body = h("div");
  const tabs = h("div", { class: "q-tabs", role: "tablist" });
  const progress = h("div", { class: "progress-wrap" });

  const done = (q) => rows.filter((r) => r.abiertas[q.id]?.puntos !== null && r.abiertas[q.id]?.puntos !== undefined).length;
  const isShort = (q) => q.tipo === "corta";
  const isConv = (q) => q === CONV;
  const convCount = () => rows.filter((r) => r.convalidada).length;
  // Respuesta corta: la corrección a mano si la hay; si no, la automática.
  const shortOk = (a) => Boolean(a?.texto?.trim()) && (a.manual ?? a.auto);
  const shortRight = (q) => rows.filter((r) => shortOk(r.cortas[q.id])).length;

  function renderTabs() {
    tabs.replaceChildren(
      ...opens.map((q) => {
        if (isConv(q)) {
          return h(
            "button",
            { type: "button", role: "tab", class: `q-tab${q === current ? " active" : ""}`, onclick: () => { current = q; renderAll(); } },
            h("strong", {}, "Convalidaciones"),
            h("small", {}, `${convCount()}/${rows.length} · ${fmt(part.puntos)} pt`)
          );
        }
        const d = isShort(q) ? rows.length : done(q);
        return h(
          "button",
          { type: "button", role: "tab", class: `q-tab${q === current ? " active" : ""}${d === rows.length && rows.length ? " complete" : ""}`, onclick: () => { current = q; renderAll(); } },
          h("strong", {}, `Pregunta ${q.n}${isShort(q) ? " · corta" : ""}`),
          h("small", {}, isShort(q) ? `${shortRight(q)}/${rows.length} correctas · ${fmt(q.valor)} pt` : `${d}/${rows.length} · ${fmt(q.valor)} pt`)
        );
      })
    );
  }

  function renderProgress() {
    if (isConv(current)) {
      progress.replaceChildren(h("p", { class: "muted small" }, `${convCount()} de ${rows.length} con ${part.nombre ? `la parte de ${part.nombre}` : "la parte convalidable"} convalidada`));
      return;
    }
    if (isShort(current)) {
      const manual = rows.filter((r) => r.cortas[current.id]?.manual !== null && r.cortas[current.id]?.manual !== undefined).length;
      progress.replaceChildren(h("p", { class: "muted small" }, `${shortRight(current)} de ${rows.length} correctas${manual ? ` · ${manual} corregida${manual === 1 ? "" : "s"} a mano` : ""}`));
      return;
    }
    const d = done(current);
    const pct = rows.length ? Math.round((d / rows.length) * 100) : 0;
    progress.replaceChildren(
      h("div", { class: "progress" }, h("div", { class: "progress-bar", style: `width:${pct}%` })),
      h("p", { class: "muted small" }, `${d} de ${rows.length} corregidas en esta pregunta`)
    );
  }

  // Con «Mostrar solo…» marcado, la tarjeta que deja de cumplir el filtro al corregirla se quita de la lista,
  // tras una pausa para que se vea «Guardado ✓». hidden() se vuelve a mirar entonces por si se ha cambiado.
  function dropIfHidden(card, hidden) {
    if (!onlyPending || !hidden()) return;
    setTimeout(() => {
      if (!onlyPending || !hidden() || !card.isConnected) return;
      card.classList.add("leaving");
      setTimeout(() => {
        if (!onlyPending || !hidden() || !card.isConnected) return card.classList.remove("leaving");
        card.remove();
        if (!body.querySelector(".answer-card")) renderBody();
      }, 300);
    }, 1200);
  }

  function renderBody() {
    if (isConv(current)) return renderConvBody();
    if (isShort(current)) return renderShortBody();
    const inputs = [];
    const visible = rows.filter((r) => !onlyPending || r.abiertas[current.id].puntos === null);
    const only = h("label", { class: "check" }, h("input", { type: "checkbox", checked: onlyPending, onchange: (e) => { onlyPending = e.target.checked; renderBody(); } }), "Mostrar solo las sin corregir");
    body.replaceChildren(
      h("div", { class: "card q-head" }, h("div", { class: "q-text" }, h("strong", {}, `${current.n}. `), ...richNodes(current.text, res.exam.imagenes ?? {})), h("p", { class: "muted small" }, `Vale ${fmt(current.valor)} ${current.valor === 1 ? "punto" : "puntos"}.`), progress, only),
      visible.length ? h("span") : h("div", { class: "notice ok" }, h("p", {}, rows.length ? "No queda ninguna sin corregir en esta pregunta. 🎉" : "Todavía no hay envíos.")),
      ...visible.map((r, idx) => answerCard(r, idx, inputs))
    );
  }

  // Parte convalidable: la marca el alumno al empezar; aquí se comprueba y se da o se quita.
  function renderConvBody() {
    const visible = rows.filter((r) => !onlyPending || r.convalidada);
    const only = h("label", { class: "check" }, h("input", { type: "checkbox", checked: onlyPending, onchange: (e) => { onlyPending = e.target.checked; renderBody(); } }), "Mostrar solo los que la tienen convalidada");
    body.replaceChildren(
      h(
        "div",
        { class: "card q-head" },
        h("p", {}, h("strong", {}, `Parte convalidable${part.nombre ? `: ${part.nombre}` : ""}`), ` · ${part.n} ${part.n === 1 ? "pregunta" : "preguntas"} · ${fmt(part.puntos)} puntos`),
        h("p", { class: "muted small" }, "El alumno la marca al empezar: no ve esas preguntas y recibe sus puntos enteros. Comprueba que de verdad la tiene convalidada. Si se la quitas, esas preguntas le cuentan en blanco (no las vio); si se la das, recibe sus puntos y se ignora lo que contestó en ellas. La nota se recalcula al momento."),
        progress,
        only
      ),
      visible.length ? h("span") : h("div", { class: "notice ok" }, h("p", {}, rows.length ? "Nadie la tiene convalidada." : "Todavía no hay envíos.")),
      ...visible.map((r) => convCard(r))
    );
  }

  function convCard(r) {
    const card = h("div");
    const status = h("span", { class: "save-state small" });
    async function save(value) {
      status.textContent = "Guardando…";
      status.className = "save-state small";
      try {
        const out = await apiPost({ action: "convalidate", token, examId: ex.id, envioId: r.envio_id, convalidada: value });
        if (out.error === "unauthorized") return onUnauthorized();
        if (!out.ok) {
          status.textContent = out.error === "bad_request" ? "El script de Google no está actualizado: actualiza Code.gs (Nueva versión)." : out.message || "No se ha podido guardar.";
          status.className = "save-state small bad";
          return;
        }
        r.convalidada = out.convalidada;
        r.aciertos = out.aciertos;
        r.errores = out.errores;
        r.blancos = out.blancos;
        if (out.nota !== "") r.nota = out.nota;
        paint(`Guardado ✓ · nota del alumno: ${fmt(r.nota)}`);
        renderTabs();
        renderProgress();
        dropIfHidden(card, () => !r.convalidada);
      } catch {
        status.textContent = "Sin conexión: no se ha guardado.";
        status.className = "save-state small bad";
      }
    }
    function paint(message = "") {
      card.className = `answer-card${r.convalidada ? " graded" : ""}`;
      status.textContent = message;
      status.className = "save-state small ok";
      card.replaceChildren(
        h("div", { class: "answer-head" }, h("strong", {}, `${r.apellidos}, ${r.nombre}`), h("span", { class: "badge off-soft" }, r.grupo), h("span", { class: `review-status ${r.convalidada ? "ok" : "blank"}` }, r.convalidada ? "Convalidada" : "No convalidada"), h("span", { class: "muted small" }, `Nota: ${fmt(r.nota)}`)),
        h("div", { class: "grade-row" }, r.convalidada ? h("button", { type: "button", class: "btn secondary small", onclick: () => save(false) }, "Quitar convalidación") : h("button", { type: "button", class: "btn secondary small", onclick: () => save(true) }, "Dar por convalidada"), status)
      );
    }
    paint();
    return card;
  }

  // Respuesta corta: ya corregida sola; el profesor puede marcarla como correcta o incorrecta.
  function renderShortBody() {
    const visible = rows.filter((r) => !onlyPending || (r.cortas[current.id]?.texto?.trim() && !shortOk(r.cortas[current.id])));
    const only = h("label", { class: "check" }, h("input", { type: "checkbox", checked: onlyPending, onchange: (e) => { onlyPending = e.target.checked; renderBody(); } }), "Mostrar solo las incorrectas");
    const accepted = current.respuestas ?? [];
    body.replaceChildren(
      h(
        "div",
        { class: "card q-head" },
        h("div", { class: "q-text" }, h("strong", {}, `${current.n}. `), ...richNodes(current.text, res.exam.imagenes ?? {})),
        Array.isArray(current.huecos)
          ? current.huecos.map((list, k) => h("p", { class: "small" }, `${current.etiquetas?.[k] ?? `Cuadro ${k + 1}`}: `, h("strong", {}, list.join(" · "))))
          : h("p", { class: "small" }, `${accepted.length === 1 ? "Respuesta aceptada" : "Respuestas aceptadas"}: `, h("strong", {}, accepted.join(" · "))),
        Array.isArray(current.huecos) ? h("p", { class: "muted small" }, "Todo o nada: la pregunta está bien solo si todos sus cuadros lo están.") : null,
        h("p", { class: "muted small" }, `Vale ${fmt(current.valor)} ${current.valor === 1 ? "punto" : "puntos"}. Ya están corregidas solas; si una respuesta está bien (o mal) aunque la corrección automática diga lo contrario, cámbiala con los botones y la nota del alumno se recalcula.`),
        progress,
        only
      ),
      visible.length ? h("span") : h("div", { class: "notice ok" }, h("p", {}, rows.length ? "No hay respuestas incorrectas en esta pregunta. 🎉" : "Todavía no hay envíos.")),
      ...visible.map((r) => shortCard(r))
    );
  }

  function shortCard(r) {
    const a = (r.cortas[current.id] = r.cortas[current.id] ?? { texto: "", auto: false, manual: null });
    const card = h("div");
    const status = h("span", { class: "save-state small" });

    async function save(value) {
      // Si coincide con la automática no se guarda corrección a mano: vuelve a la automática.
      const correcta = value === a.auto ? null : value;
      status.textContent = "Guardando…";
      status.className = "save-state small";
      try {
        const out = await apiPost({ action: "grade", token, examId: ex.id, envioId: r.envio_id, qid: current.id, correcta });
        if (out.error === "unauthorized") return onUnauthorized();
        if (!out.ok) {
          status.textContent = out.error === "invalid_grade" && /abierta/.test(out.message ?? "") ? "El script de Google no está actualizado: actualiza Code.gs (Nueva versión)." : out.message || "No se ha podido guardar.";
          status.className = "save-state small bad";
          return;
        }
        a.manual = out.correcta;
        r.aciertos = out.aciertos;
        r.errores = out.errores;
        if (out.nota !== "") r.nota = out.nota;
        paint(`Guardado ✓ · nota del alumno: ${fmt(r.nota)}`);
        renderTabs();
        renderProgress();
        dropIfHidden(card, () => shortOk(a));
      } catch {
        status.textContent = "Sin conexión: no se ha guardado.";
        status.className = "save-state small bad";
      }
    }

    function paint(message = "") {
      if (r.convalidada && current.convalidable !== undefined) {
        card.className = "answer-card graded";
        card.replaceChildren(h("div", { class: "answer-head" }, h("strong", {}, `${r.apellidos}, ${r.nombre}`), h("span", { class: "badge off-soft" }, r.grupo), h("span", { class: "review-status ok" }, "Convalidada")), h("p", { class: "muted small" }, "No vio esta pregunta: tiene sus puntos por la parte convalidada (puedes quitársela en la pestaña «Convalidaciones»)."));
        return;
      }
      const blank = !a.texto.trim();
      const ok = shortOk(a);
      const state = blank ? "blank" : ok ? "ok" : "bad";
      const label = blank ? "En blanco" : `${ok ? "Correcta" : "Incorrecta"} · ${a.manual === null || a.manual === undefined ? "automática" : "corregida a mano"}`;
      card.className = `answer-card${blank ? "" : ok ? " graded" : " wrong"}`;
      status.textContent = message;
      status.className = "save-state small ok";
      const pick = (value, text) => h("button", { type: "button", class: `btn small${ok === value ? "" : " secondary"}`, "aria-pressed": String(ok === value), onclick: () => (ok === value ? null : save(value)) }, text);
      card.replaceChildren(
        h("div", { class: "answer-head" }, h("strong", {}, `${r.apellidos}, ${r.nombre}`), h("span", { class: "badge off-soft" }, r.grupo), h("span", { class: `review-status ${state}` }, label)),
        blank ? h("div", { class: "answer-text empty" }, "(En blanco)") : h("div", { class: "answer-text" }, a.texto),
        blank ? null : h("div", { class: "grade-row" }, pick(true, "✓ Correcta"), pick(false, "✗ Incorrecta"), status)
      );
    }
    paint();
    return card;
  }

  function answerCard(r, idx, inputs) {
    const a = r.abiertas[current.id];
    const max = current.valor;
    const status = h("span", { class: "save-state small" });
    const input = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": `Puntos de ${r.nombre} ${r.apellidos}`, value: a.puntos === null ? "" : String(a.puntos).replace(".", ",") });
    inputs.push(input);
    const card = h("div", { class: `answer-card${a.puntos === null ? " pending" : " graded"}` });

    let sent; // último valor enviado: evita guardar dos veces (Enter + change)
    async function save(value) {
      sent = value;
      status.textContent = "Guardando…";
      status.className = "save-state small";
      try {
        const out = await apiPost({ action: "grade", token, examId: ex.id, envioId: r.envio_id, qid: current.id, puntos: value });
        if (out.error === "unauthorized") return onUnauthorized();
        if (!out.ok) {
          status.textContent = out.message || "No se ha podido guardar.";
          status.className = "save-state small bad";
          return;
        }
        a.puntos = out.puntos;
        r.pendientes = out.pendientes;
        r.nota = out.nota;
        input.value = out.puntos === null ? "" : String(out.puntos).replace(".", ",");
        card.className = `answer-card${out.puntos === null ? " pending" : " graded"}`;
        status.textContent = out.puntos === null ? "Sin corregir" : `Guardado ✓ · nota del alumno: ${fmt(out.nota)}`;
        status.className = "save-state small ok";
        renderTabs();
        renderProgress();
        dropIfHidden(card, () => a.puntos !== null);
      } catch {
        status.textContent = "Sin conexión: no se ha guardado.";
        status.className = "save-state small bad";
      }
    }
    const commit = () => {
      const t = String(input.value).trim().replace(",", ".");
      const last = sent === undefined ? a.puntos : sent;
      if (t === "") return last === null ? undefined : save(null);
      const v = Number(t);
      if (!Number.isFinite(v) || v < 0 || v > max) {
        status.textContent = `Pon un número entre 0 y ${fmt(max)}.`;
        status.className = "save-state small bad";
        return;
      }
      if (v !== last) save(v);
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commit();
      // La siguiente que siga en la lista (con el filtro activo, las ya corregidas se han quitado).
      const next = inputs.slice(idx + 1).find((i) => i.isConnected);
      next?.focus();
      next?.select();
    });
    const quick = (label, value) => h("button", { type: "button", class: "btn secondary small", onclick: () => { input.value = value; commit(); } }, label);

    card.append(
      h("div", { class: "answer-head" }, h("strong", {}, `${r.apellidos}, ${r.nombre}`), h("span", { class: "badge off-soft" }, r.grupo), r.pegados ? h("span", { class: "badge warn-badge", title: "Intentos de pegar texto en la respuesta" }, `${r.pegados} intento${r.pegados === 1 ? "" : "s"} de pegar`) : null),
      a.texto.trim() ? h("div", { class: "answer-text" }, a.texto) : h("div", { class: "answer-text empty" }, "(En blanco)"),
      h("div", { class: "grade-row" }, h("label", {}, h("span", { class: "small muted" }, "Puntos"), input, h("span", { class: "muted" }, ` / ${fmt(max)}`)), quick("0", 0), quick("½", Math.round((max / 2) * 10000) / 10000), quick("Máximo", max), status)
    );
    return card;
  }

  function renderAll() {
    renderTabs();
    renderProgress();
    renderBody();
  }

  const exportBtn = h("button", { class: "btn secondary small", type: "button" }, "Exportar notas (CSV)");
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    const err = await exportNotes(token, ex).catch(() => "No se ha podido exportar.");
    exportBtn.disabled = false;
    if (err) alert(err);
  });

  app.replaceChildren(
    h("div", { class: "top-bar" }, h("div", {}, h("p", { class: "muted small", style: "margin:0" }, "Corregir respuestas"), h("h1", {}, ex.titulo)), h("div", { class: "actions" }, exportBtn, h("button", { class: "btn secondary small", type: "button", onclick: onBack }, "← Volver al panel"))),
    opens.length ? tabs : h("div", { class: "notice info" }, h("p", {}, "Este examen no tiene preguntas abiertas ni de respuesta corta.")),
    body
  );
  if (opens.length) renderAll();
}
