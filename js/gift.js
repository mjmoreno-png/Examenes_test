// Parser de un subconjunto de GIFT: opción múltiple con una única respuesta correcta, respuesta corta
// ({=NaCl =ClNa}: solo respuestas aceptadas, sin ~; con varios {…} en el enunciado, un cuadro por cada uno)
// y abierta ({}). Función pura: no toca el DOM ni la red. Se usa en el panel del profesor.

import { MAX_SHORT_ANSWERS, MAX_SHORT_CHARS, BLANK, MAX_BLANKS } from "./short.js";

const ESCAPABLE = new Set([":", "=", "~", "#", "{", "}", "\\"]);
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export const MAX_VALUE = 100;

// [valor=2] al principio del enunciado: lo que vale la pregunta. También [puntos=2] o [valor: 1/2].
const VALUE_MARK = /^\[\s*(?:valor|puntos)\s*[=:]\s*([^\]]*?)\s*\]\s*/i;
// [convalidable] o [convalidable=formulación]: la pregunta es de una parte que algunos alumnos tienen convalidada.
// Quien la marca al empezar no ve esas preguntas y recibe sus puntos enteros. Va antes o después de [valor=…].
const CONVALIDABLE_MARK = /^\[\s*convalidable\s*(?:[=:]\s*([^\]]*?)\s*)?\]\s*/i;
export const MAX_PART_NAME = 40;

/** "2", "0,5", "0.5" o "1/2" -> número mayor que 0; lanza un error si no es válido. */
export function parseValue(raw, n) {
  const text = String(raw ?? "").trim().replace(",", ".");
  let value = NaN;
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (frac) value = Number(frac[1]) / Number(frac[2]);
  else if (/^\d+(?:\.\d+)?$/.test(text)) value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_VALUE) {
    throw new Error(
      `Pregunta ${n}: el valor «${String(raw).trim()}» no es válido; usa un número mayor que 0 y como mucho ${MAX_VALUE}, por ejemplo [valor=2] o [valor=0,5].`
    );
  }
  return Math.round(value * 10000) / 10000;
}

export class GiftError extends Error {
  constructor(errors) {
    super(errors.join("\n"));
    this.name = "GiftError";
    this.errors = errors;
  }
}

// Quita los escapes: "\:" -> ":", "\n" -> salto de línea.
function unescapeGift(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (ESCAPABLE.has(next)) {
        out += next;
        i++;
        continue;
      }
      if (next === "n") {
        out += "\n";
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

// Índice del primer `ch` sin escapar a partir de `from`, o -1.
function indexOfUnescaped(s, ch, from = 0) {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === ch) return i;
  }
  return -1;
}

// Divide el cuerpo `{...}` en opciones; cada `=` o `~` sin escapar abre una.
function splitOptions(body) {
  const parts = [];
  let current = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      if (current) current.raw += c + (body[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "=" || c === "~") {
      current = { correct: c === "=", raw: "" };
      parts.push(current);
    } else if (current) {
      current.raw += c;
    }
    // Texto antes de la primera opción: se ignora (se detecta luego).
  }
  return parts;
}

function parseOption(part) {
  let raw = part.raw;
  // Feedback (# ...) sin escapar: se descarta.
  const hash = indexOfUnescaped(raw, "#");
  if (hash !== -1) raw = raw.slice(0, hash);
  // Peso %...% al principio: se ignora.
  raw = raw.trim().replace(/^%-?[\d.,]+%/, "");
  return { text: unescapeGift(raw.trim()), correct: part.correct };
}

// Respuestas aceptadas de un cuadro de respuesta corta, sin repetir; `where` dice qué cuadro es en los errores.
function acceptedAnswers(parts, n, where) {
  const respuestas = [...new Set(parts.map((p) => parseOption(p).text))];
  if (respuestas.some((r) => !r)) throw new Error(`Pregunta ${n}${where}: hay una respuesta aceptada vacía.`);
  if (respuestas.length > MAX_SHORT_ANSWERS) {
    throw new Error(`Pregunta ${n}${where}: demasiadas respuestas aceptadas (máximo ${MAX_SHORT_ANSWERS}).`);
  }
  if (respuestas.some((r) => r.length > MAX_SHORT_CHARS)) {
    throw new Error(`Pregunta ${n}${where}: una respuesta aceptada supera los ${MAX_SHORT_CHARS} caracteres.`);
  }
  return respuestas;
}

// Marcas al principio del enunciado, en cualquier orden: [valor=N] y [convalidable=nombre].
// convalidable: nombre de la parte convalidable ("" si no lo tiene) o null si no lo es.
function leadingMarks(text, n) {
  let valor = 1;
  let convalidable = null;
  let rest = text;
  for (let mark; (mark = VALUE_MARK.exec(rest) || CONVALIDABLE_MARK.exec(rest)); ) {
    if (/^\[\s*convalidable/i.test(mark[0])) {
      convalidable = (mark[1] ?? "").replace(/\s+/g, " ").trim();
      if (convalidable.length > MAX_PART_NAME) throw new Error(`Pregunta ${n}: el nombre de la parte convalidable supera los ${MAX_PART_NAME} caracteres.`);
    } else valor = parseValue(mark[1], n);
    rest = rest.slice(mark[0].length);
  }
  return { valor, convalidable, rest };
}

// Respuesta corta con varios cuadros: «Prefijos: {=…} Stock: {=…}». El texto que rodea a los bloques queda en el
// enunciado, con la marca BLANK en el sitio de cada cuadro; sus respuestas aceptadas, en `huecos`.
function parseMultiBlank(rest, blocks, title, n) {
  if (blocks.length > MAX_BLANKS) {
    throw new Error(`Pregunta ${n}: demasiados cuadros de respuesta (máximo ${MAX_BLANKS}).`);
  }
  const segments = blocks.map((b, i) => rest.slice(i ? blocks[i - 1].close + 1 : 0, b.open));
  segments.push(rest.slice(blocks[blocks.length - 1].close + 1));
  const { valor, convalidable, rest: first } = leadingMarks(segments[0].replace(/^\s+/, ""), n);
  segments[0] = first;
  const huecos = blocks.map((b, i) => {
    const parts = splitOptions(rest.slice(b.open + 1, b.close));
    if (!parts.length || !parts.every((p) => p.correct)) {
      throw new Error(
        `Pregunta ${n}: con varios cuadros de respuesta, cada { } debe llevar solo respuestas con = (el cuadro ${i + 1} no las lleva).`
      );
    }
    return acceptedAnswers(parts, n, `, cuadro ${i + 1}`);
  });
  const text = segments.map(unescapeGift).join(BLANK).trim();
  if (!text.split(BLANK).join("").trim()) throw new Error(`Pregunta ${n}: el enunciado está vacío.`);
  return { id: `q${n}`, title, text, options: [], correct: null, huecos, valor, tipo: "corta", ...(convalidable === null ? {} : { convalidable }) };
}

function parseBlock(block, n) {
  let rest = block.trim();
  let title = "";

  if (rest.startsWith("::")) {
    // Buscar el cierre "::" (no escapado).
    let close = -1;
    for (let i = 2; i < rest.length; i++) {
      if (rest[i] === "\\") {
        i++;
        continue;
      }
      if (rest[i] === ":" && rest[i + 1] === ":") {
        close = i;
        break;
      }
    }
    if (close === -1) {
      throw new Error(`Pregunta ${n}: el título ::...:: no está cerrado.`);
    }
    title = unescapeGift(rest.slice(2, close).trim());
    rest = rest.slice(close + 2).trim();
  }

  // Bloques de respuestas { … }: normalmente uno; varios = respuesta corta con un cuadro por bloque.
  const blocks = [];
  for (let from = 0; ; ) {
    const o = indexOfUnescaped(rest, "{", from);
    if (o === -1) break;
    const c = indexOfUnescaped(rest, "}", o + 1);
    if (c === -1) throw new Error(`Pregunta ${n}: falta la llave de cierre }.`);
    blocks.push({ open: o, close: c });
    from = c + 1;
  }
  if (!blocks.length) {
    throw new Error(`Pregunta ${n}: no tiene bloque de respuestas { ... }.`);
  }
  if (blocks.length > 1) return parseMultiBlank(rest, blocks, title, n);
  const { open, close } = blocks[0];

  let before = rest.slice(0, open).trim();
  const after = rest.slice(close + 1).trim();
  const marks = leadingMarks(before, n);
  const { valor, convalidable } = marks;
  before = marks.rest.trim();
  const conv = convalidable === null ? {} : { convalidable };
  const text = unescapeGift([before, after].filter(Boolean).join(" ").trim());
  if (!text) throw new Error(`Pregunta ${n}: el enunciado está vacío.`);

  // Llaves vacías = pregunta abierta (el alumno escribe la respuesta y la corrige el profesor).
  if (rest.slice(open + 1, close).trim() === "") {
    if (convalidable !== null) throw new Error(`Pregunta ${n}: una pregunta abierta no puede ser convalidable (solo las de test y las de respuesta corta).`);
    return { id: `q${n}`, title, text, options: [], correct: null, valor, tipo: "abierta" };
  }

  const parts = splitOptions(rest.slice(open + 1, close));
  // Solo respuestas con = (ninguna ~): respuesta corta, se corrige sola comparando con las aceptadas.
  if (parts.length && parts.every((p) => p.correct)) {
    return { id: `q${n}`, title, text, options: [], correct: null, respuestas: acceptedAnswers(parts, n, ""), valor, tipo: "corta", ...conv };
  }
  if (parts.length < 2) {
    throw new Error(`Pregunta ${n}: necesita al menos 2 opciones (tiene ${parts.length}).`);
  }
  if (parts.length > LETTERS.length) {
    throw new Error(`Pregunta ${n}: demasiadas opciones (máximo ${LETTERS.length}).`);
  }

  const parsed = parts.map(parseOption);
  const blank = parsed.findIndex((o) => !o.text);
  if (blank !== -1) {
    throw new Error(`Pregunta ${n}: la opción ${blank + 1} está vacía.`);
  }
  const correctCount = parsed.filter((o) => o.correct).length;
  if (correctCount !== 1) {
    throw new Error(
      `Pregunta ${n}: debe tener exactamente una opción correcta (=), tiene ${correctCount}.`
    );
  }

  const options = parsed.map((o, i) => ({ id: LETTERS[i], text: o.text }));
  const correct = options[parsed.findIndex((o) => o.correct)].id;
  return { id: `q${n}`, title, text, options, correct, valor, tipo: "test", ...conv };
}

/**
 * Convierte texto GIFT en preguntas.
 * @param {string} input
 * @returns {{id:string,title:string,text:string,options:{id:string,text:string}[],correct:string|null,respuestas?:string[],valor:number,tipo:"test"|"corta"|"abierta"}[]}
 * @throws {GiftError} con `.errors` (una entrada por pregunta defectuosa, con su número).
 */
export function parseGift(input) {
  const text = String(input ?? "")
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n");

  // Fuera los comentarios de línea completa.
  const lines = text.split("\n").filter((l) => !l.trim().startsWith("//"));

  // Bloques separados por líneas en blanco.
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length) blocks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));

  if (blocks.length === 0) throw new GiftError(["No se ha encontrado ninguna pregunta."]);

  const questions = [];
  const errors = [];
  blocks.forEach((block, i) => {
    try {
      questions.push(parseBlock(block, i + 1));
    } catch (e) {
      errors.push(e.message);
    }
  });

  if (errors.length) throw new GiftError(errors);
  const parts = new Set(questions.filter(isConvalidable).map((q) => q.convalidable));
  if (parts.size > 1) {
    throw new GiftError([`Solo puede haber una parte convalidable y hay ${parts.size}: ${[...parts].map((p) => `«${p || "sin nombre"}»`).join(", ")}. Usa el mismo nombre en todas sus preguntas.`]);
  }
  if (parts.size && questions.every(isConvalidable)) {
    throw new GiftError(["Todas las preguntas son convalidables: al menos una tiene que ser para todos."]);
  }
  return questions;
}

/** ¿Es de la parte convalidable? (su nombre puede estar vacío) */
export const isConvalidable = (q) => typeof q?.convalidable === "string";

/** La parte convalidable de un examen: {nombre, n, puntos}, o null si no tiene. */
export function convalidablePart(questions) {
  const qs = (questions ?? []).filter(isConvalidable);
  if (!qs.length) return null;
  const v = (q) => (Number.isFinite(Number(q.valor)) && Number(q.valor) > 0 ? Number(q.valor) : 1);
  return { nombre: qs[0].convalidable, n: qs.length, puntos: Math.round(qs.reduce((s, q) => s + v(q), 0) * 10000) / 10000 };
}

/* ------------------------------ exportación ------------------------------ */

// Escapa un texto para GIFT: la barra invertida, los caracteres especiales y los saltos de línea (como \n,
// para que nunca quede una línea en blanco dentro de una pregunta).
function escapeGift(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/[:=~#{}]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, "\\n");
}

/** Lo que vale una pregunta como marca [valor=N] (coma decimal), o "" si vale 1. */
function valueMark(valor) {
  const v = Number(valor);
  return Number.isFinite(v) && v > 0 && v !== 1 ? `[valor=${String(v).replace(".", ",")}] ` : "";
}

/**
 * Convierte preguntas (las de parseGift o las guardadas en la hoja) en texto GIFT que parseGift vuelve a leer
 * igual: título, valor, enunciado, opciones de test, respuestas cortas aceptadas y abiertas.
 */
export function toGift(questions, comment = "") {
  const blocks = questions.map((q) => {
    const title = q.title ? `::${escapeGift(q.title)}::` : "";
    const text = escapeGift(q.text);
    // Un enunciado sin título que empezara por // se leería como comentario: la marca de valor lo evita.
    const mark = valueMark(q.valor) || (!title && text.startsWith("//") ? "[valor=1] " : "");
    const conv = isConvalidable(q) ? `[convalidable${q.convalidable ? `=${q.convalidable.replace(/[\]\n]/g, " ")}` : ""}] ` : "";
    const head = `${title}${mark}${conv}${text}`;
    if (q.tipo === "abierta") return `${head}{}`;
    const answersBlock = (list) => `{${(list ?? []).map((r) => `=${escapeGift(r)}`).join(" ")}}`;
    if (q.tipo === "corta" && Array.isArray(q.huecos)) {
      // Varios cuadros: cada marca del enunciado vuelve a ser su bloque { … }.
      const parts = String(q.text ?? "").split(BLANK);
      return `${title}${mark}${conv}${parts.map((p, i) => escapeGift(p) + (i < q.huecos.length ? answersBlock(q.huecos[i]) : "")).join("")}`;
    }
    if (q.tipo === "corta") return `${head}${answersBlock(q.respuestas)}`;
    const options = q.options.map((o) => `${o.id === q.correct ? "=" : "~"}${escapeGift(o.text)}`);
    return `${head}{\n${options.join("\n")}\n}`;
  });
  const header = comment ? `${String(comment).split(/\r?\n/).map((l) => (l.trim() ? `// ${l}` : "//")).join("\n")}\n\n` : "";
  return `${header}${blocks.join("\n\n")}\n`;
}
