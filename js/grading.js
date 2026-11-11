// Corrección con penalización por error. Función pura.
import { shortBlanks, shortIsBlank, shortAllCorrect } from "./short.js";
// La misma lógica está replicada en apps-script/Code.gs: si cambia una, cambia la otra.

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

/**
 * Penalización por error como fracción de punto. Acepta "1/3", " 1 / 4 ", "0" o "1".
 * Devuelve {num, den} reducida, o null si no se indica (penalización automática: 1/(opciones-1)).
 * Lanza un error si no es una fracción válida entre 0 y 1.
 */
export function parsePenalty(input) {
  if (input === undefined || input === null) return null;
  const text = String(input).trim();
  if (text === "") return null;
  const m = /^(\d{1,3})\s*(?:\/\s*(\d{1,3}))?$/.exec(text);
  if (!m) throw new Error("La penalización debe ser una fracción, por ejemplo 1/3.");
  const num = Number(m[1]);
  const den = m[2] === undefined ? 1 : Number(m[2]);
  if (den < 1) throw new Error("El denominador de la penalización debe ser al menos 1.");
  if (num > den) throw new Error("La penalización no puede ser mayor que 1 punto (el numerador no puede superar al denominador).");
  const g = gcd(num, den) || 1;
  return { num: num / g, den: den / g };
}

/** {num:1, den:3} -> "1/3"; {num:0, den:1} -> "0"; {num:1, den:1} -> "1". */
export function formatPenalty(p) {
  if (!p) return "";
  return p.den === 1 ? String(p.num) : `${p.num}/${p.den}`;
}

/** Lo que vale una pregunta (1 si no se indica). */
export function questionValue(q) {
  const v = Number(q?.valor);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Las preguntas abiertas no se corrigen solas: las evalúa el profesor en la hoja. */
export const isOpenQuestion = (q) => q?.tipo === "abierta";

/** Las de respuesta corta se corrigen solas comparando el texto con las respuestas aceptadas. */
export const isShortQuestion = (q) => q?.tipo === "corta";

/** De la parte convalidable: quien la tiene convalidada recibe sus puntos sin contestarla. */
export const isConvalidableQuestion = (q) => typeof q?.convalidable === "string";

/**
 * Corrige la parte tipo test. Cada pregunta vale `valor` puntos (1 por defecto):
 * acierto +valor, error −valor × penalización, en blanco 0. Las preguntas abiertas no puntúan aquí,
 * pero su valor cuenta en el total, de modo que la nota final queda sobre 10 con todas las preguntas.
 * Las de respuesta corta cuentan como las de test (acierto, error o en blanco), pero sus errores no restan.
 *
 * @param {{id:string, valor?:number, tipo?:string, options:{id:string}[], correct:string, respuestas?:string[]}[]} questions
 * @param {Record<string,string|null|undefined>} answers  id de pregunta -> id de opción, o el texto escrito
 *   en las de respuesta corta (null/ausente/vacío = en blanco)
 * @param {{allowNegative?: boolean, penalty?: {num:number, den:number}|null, shortOverrides?: Record<string,boolean>}} [opts]
 *   penalty: fracción de punto que resta cada error; null/ausente = 1/(opciones-1) en cada pregunta
 *   shortOverrides: respuestas cortas corregidas a mano (id de pregunta -> correcta o no)
 *   convalidada: el alumno tiene convalidada la parte convalidable: esas preguntas suman sus puntos enteros
 *   (no cuentan como aciertos, errores ni en blanco, sino en `convalidadas`) y lo que haya contestado en ellas se ignora
 * @returns {{aciertos:number, errores:number, blancos:number, puntos:number, puntosTest:number,
 *            puntosTestMax:number, puntosTotal:number, abiertas:number, convalidadas:number, nota:number}}
 *   puntos = puntos del test sin recortar; puntosTest = lo mismo redondeado y, salvo nota negativa,
 *   no menor que 0 (es lo que ve el alumno); puntosTotal = suma de los valores de TODAS las preguntas;
 *   nota = puntos / puntosTotal × 10 (provisional si hay preguntas abiertas sin corregir).
 */
export function gradeExam(questions, answers, opts = {}) {
  const { allowNegative = false, penalty = null, shortOverrides = {}, convalidada = false } = opts;
  if (!questions.length) throw new Error("El examen no tiene preguntas.");

  let aciertos = 0;
  let errores = 0;
  let blancos = 0;
  let valorAciertos = 0; // suma de los valores de las acertadas
  let valorErrores = 0; // suma de los valores de las falladas
  let penalizacion = 0; // con la penalización automática: Σ valor / (opciones − 1)
  let puntosTestMax = 0;
  let puntosTotal = 0;
  let abiertas = 0;
  let convalidadas = 0;

  for (const q of questions) {
    const valor = questionValue(q);
    puntosTotal += valor;
    if (isOpenQuestion(q)) {
      abiertas++;
      continue;
    }
    puntosTestMax += valor;
    if (convalidada && isConvalidableQuestion(q)) {
      convalidadas++;
      valorAciertos += valor;
      continue;
    }
    const given = answers?.[q.id];
    if (isShortQuestion(q)) {
      // Un cuadro: un texto. Varios cuadros: una lista de textos (o null), uno por cuadro.
      const multi = shortBlanks(q).length > 1;
      const ok = multi
        ? Array.isArray(given) && given.length <= shortBlanks(q).length && given.every((v) => v === null || typeof v === "string")
        : typeof given === "string";
      if (given !== undefined && given !== null && !ok) {
        throw new Error(`Respuesta no válida en ${q.id}`);
      }
      // Todo o nada: con varios cuadros solo está bien si lo están todos; en blanco, si no rellenó ninguno.
      if (shortIsBlank(q, given)) blancos++;
      else if (typeof shortOverrides[q.id] === "boolean" ? shortOverrides[q.id] : shortAllCorrect(q, given)) {
        aciertos++;
        valorAciertos += valor;
      } else errores++; // sin penalización: es difícil acertar escribiendo al azar
      continue;
    }
    if (given === undefined || given === null || given === "") {
      blancos++;
      continue;
    }
    if (!q.options.some((o) => o.id === given)) {
      throw new Error(`Respuesta no válida en ${q.id}: ${given}`);
    }
    if (given === q.correct) {
      aciertos++;
      valorAciertos += valor;
    } else {
      errores++;
      valorErrores += valor;
      if (!penalty) penalizacion += valor / (q.options.length - 1);
    }
  }

  // Con penalización propia: (Σacierto·den − Σerror·num) / den.
  const puntos = penalty ? (valorAciertos * penalty.den - valorErrores * penalty.num) / penalty.den : valorAciertos - penalizacion;
  const round2 = (x) => {
    const r = Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;
    return r === 0 ? 0 : r; // evita -0
  };
  let nota = (puntos / puntosTotal) * 10;
  if (!allowNegative && nota < 0) nota = 0;
  nota = round2(nota);
  const puntosTest = round2(!allowNegative && puntos < 0 ? 0 : puntos);

  return { aciertos, errores, blancos, puntos, puntosTest, puntosTestMax: round2(puntosTestMax), puntosTotal: round2(puntosTotal), abiertas, convalidadas, nota };
}
