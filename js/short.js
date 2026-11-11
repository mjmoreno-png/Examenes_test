// Preguntas de respuesta corta: el alumno escribe una palabra o una fórmula y se corrige sola
// comparándola con las respuestas aceptadas. Función pura.
// La misma lógica está replicada en apps-script/Code.gs: si cambia una, cambia la otra.

export const MAX_SHORT_CHARS = 200; // longitud máxima de la respuesta del alumno
export const MAX_SHORT_ANSWERS = 20; // respuestas aceptadas por pregunta

const NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;
// Respuesta numérica con margen: «12,5 ±2%» (relativo) o «12,5 ±0,3» (absoluto). También «+-» en vez de «±».
const MARGIN = /^([+-]?\d+(?:[.,]\d+)?) ?(?:±|\+-|\+\/-) ?(\d+(?:[.,]\d+)?) ?(%?)$/;
// Lo que escribe el alumno en una de margen: un número, y detrás, si quiere, la unidad («12,5 g/L», «0,5 M»).
const NUMBER_UNIT = /^([+-]?\d+(?:[.,]\d+)?)(?: ?[\p{L}%°].*)?$/u;
const toNumber = (s) => Number(s.replace(",", "."));
const RUNS = /\p{L}+|[^\p{L}]+/gu; // tramos de letras y de lo demás: "hierro(III)" → hierro, (, III, )

const ROMAN = /^[ivxlcdm]+$/i;

// ¿Cuentan las mayúsculas en este tramo de letras? Solo en los símbolos de las fórmulas: sí si lleva alguna
// mayúscula que no sea solo la inicial de un tramo de 3 o más letras (NaCl, Fe, O → sí; óxido, Óxido → no).
// Un número romano entre paréntesis (hierro(III)) no es un símbolo: da igual en mayúsculas o minúsculas.
function runMatters(run, prev = "", next = "") {
  if (run === run.toLowerCase()) return false;
  if (ROMAN.test(run) && prev.endsWith("(") && next.startsWith(")")) return false;
  const rest = run.slice(1);
  return rest !== rest.toLowerCase() || run.length < 3;
}

// Forma comparable: sin tildes, sin espacios de más, sin espacios junto a los paréntesis ni punto final;
// subíndices (H₂O) como dígitos normales.
function shortKey(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)/g, ")")
    .trim()
    .replace(/\.+$/, "")
    .trim();
}

// ¿Cuentan las mayúsculas en el tramo i de una lista de tramos?
const runMattersAt = (runs, i) => runMatters(runs[i], runs[i - 1], runs[i + 1]);

/** ¿Cuentan las mayúsculas en alguna parte de esta respuesta? (NaCl, CO2 → sí; Oxígeno, hierro(III) → no) */
export function caseMatters(answer) {
  const runs = shortKey(answer).match(RUNS) ?? [];
  return runs.some((_, i) => runMattersAt(runs, i));
}

/** Margen de una respuesta numérica («12,5 ±2%») como {valor, margen, relativo}, o null si no lo es. */
export function numericMargin(answer) {
  const m = MARGIN.exec(shortKey(answer));
  return m ? { valor: toNumber(m[1]), margen: toNumber(m[2]), relativo: m[3] === "%" } : null;
}

// ¿Está el número escrito dentro del margen? Se admite la unidad detrás del número.
function withinMargin(margin, given) {
  const m = NUMBER_UNIT.exec(shortKey(given));
  if (!m) return false;
  const tol = margin.relativo ? (Math.abs(margin.valor) * margin.margen) / 100 : margin.margen;
  return Math.abs(toNumber(m[1]) - margin.valor) <= tol + 1e-9 * Math.max(1, Math.abs(margin.valor));
}

/**
 * ¿Coincide lo que ha escrito el alumno con alguna de las respuestas aceptadas? Las tildes no cuentan, y las
 * mayúsculas solo en los símbolos de las fórmulas: «oxido de hierro(iii)» vale por «óxido de hierro(III)», pero
 * «Co» no vale por «CO». Una respuesta con margen («12,5 ±2%») vale
 * cualquier número dentro del margen, con o sin la unidad detrás.
 */
export function shortAnswerMatches(accepted, given) {
  return (accepted || []).some((answer) => {
    const margin = numericMargin(answer);
    if (margin) return withinMargin(margin, given);
    const a = shortKey(answer);
    let b = shortKey(given);
    if (!a) return false;
    if (!a.includes(" ")) b = b.replace(/ /g, ""); // "Na Cl" vale por "NaCl"
    if (NUMBER.test(a) && NUMBER.test(b)) return Number(a.replace(",", ".")) === Number(b.replace(",", "."));
    if (a.toLowerCase() !== b.toLowerCase()) return false;
    const ra = a.match(RUNS);
    const rb = b.match(RUNS);
    return ra.length === rb.length && ra.every((run, i) => !runMattersAt(ra, i) || run === rb[i]);
  });
}

/* ----------------------- varios cuadros por pregunta ----------------------- */

// Una pregunta de respuesta corta puede tener varios cuadros (p. ej. «Prefijos: {…}» y «Stock: {…}»): su enunciado
// lleva esta marca donde va cada cuadro, y sus respuestas aceptadas van en `huecos` (una lista por cuadro).
export const BLANK = "\uE000";
export const MAX_BLANKS = 10;

/** Respuestas aceptadas de cada cuadro: [[…]] si tiene uno solo (`respuestas`), [[…], […]] si tiene varios (`huecos`). */
export const shortBlanks = (q) => (Array.isArray(q?.huecos) ? q.huecos : [q?.respuestas ?? []]);

/** Lo que escribió el alumno en cada cuadro, como lista de textos ("" = vacío). */
export function shortGiven(q, given) {
  const n = shortBlanks(q).length;
  const list = n > 1 ? (Array.isArray(given) ? given : []) : [given];
  return Array.from({ length: n }, (_, i) => (typeof list[i] === "string" ? list[i] : ""));
}

/** ¿Dejó en blanco todos los cuadros? */
export const shortIsBlank = (q, given) => shortGiven(q, given).every((t) => !t.trim());

/** ¿Está bien? Todo o nada: cada cuadro debe coincidir con alguna de sus respuestas aceptadas. */
export function shortAllCorrect(q, given) {
  const vals = shortGiven(q, given);
  return shortBlanks(q).every((accepted, i) => vals[i].trim() !== "" && shortAnswerMatches(accepted, vals[i]));
}

/** Etiqueta de cada cuadro: el texto que lo precede en su línea («Prefijos:» → «Prefijos»), o «Cuadro n». */
export function blankLabels(text) {
  const parts = String(text ?? "").split(BLANK);
  return parts.slice(0, -1).map((p, i) => p.split("\n").pop().replace(/[\s:]+$/, "").trim() || `Cuadro ${i + 1}`);
}
