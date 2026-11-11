// Pinta un enunciado con imágenes. Nunca inserta HTML: el texto va como texto y las imágenes como <img>
// con una dirección "data:" que se valida antes.
import { h } from "./dom.js";
import { splitRich, parseDataUrl } from "./images.js";
import { BLANK } from "./short.js";

/**
 * @param {string} text enunciado, con ![descripción](archivo.png)
 * @param {Record<string,string>} images nombre de archivo -> "data:image/png;base64,..."
 * @returns {(string|Node)[]} nodos para pasar a h(...)
 */
export function richNodes(text, images = {}) {
  // Donde va un cuadro de respuesta (preguntas de respuesta corta con varios cuadros) se ve una raya.
  return splitRich(String(text ?? "").split(BLANK).join("____")).map((part) => {
    if (part.type === "text") return part.text;
    const src = images?.[part.name];
    if (!parseDataUrl(src)) {
      return h("span", { class: "img-missing" }, `[imagen no disponible: ${part.alt || part.name}]`);
    }
    return h("img", { class: "q-img", src, alt: part.alt, draggable: "false" });
  });
}
