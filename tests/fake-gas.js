// Entorno simulado de Google Apps Script: carga apps-script/Code.gs en un sandbox
// con una hoja de cálculo en memoria. Lo usan los tests y las pruebas de navegador.
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Imita la conversión automática de Sheets: "545297e4" -> 5452970000, "1-2" -> fecha.
const coerce = (v) => {
  if (typeof v !== "string") return v;
  if (/^\d+(\.\d+)?(e\d+)?$/i.test(v)) return Number(v);
  if (/^\d{1,2}[-/]\d{1,2}$/.test(v)) return new Date(2000, 0, 1);
  return v;
};

class FakeSheet {
  constructor(name, id) { this.name = name; this.id = id; this.rows = []; this.textCells = new Set(); }
  appendRow(r) { this.rows.push(r.map(coerce)); }
  getDataRange() { return { getValues: () => this.rows.map((r) => [...r]) }; }
  getRange(row, col, nRows = 1, nCols = 1) {
    return {
      col,
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setHorizontalAlignment() { return this; },
      setFormulaR1C1: (formula) => { this.rows[row - 1][col - 1] = formula; },
      setValue: (v) => { this.rows[row - 1][col - 1] = this.textCells.has(`${row},${col}`) ? v : coerce(v); },
      setValues: (vals) => {
        vals.forEach((r, i) => {
          this.rows[row - 1 + i] = this.rows[row - 1 + i] || [];
          r.forEach((v, j) => {
            const text = this.textCells.has(`${row + i},${col + j}`);
            this.rows[row - 1 + i][col - 1 + j] = text ? v : coerce(v);
          });
        });
      },
      getValues: () => this.rows.slice(row - 1, row - 1 + nRows).map((r) => Array.from({ length: nCols }, (_, j) => r[col - 1 + j] ?? "")),
      // Como Sheets: ordena las filas del rango por las columnas indicadas (texto sin distinguir mayúsculas ni tildes).
      sort: (specs) => {
        const block = this.rows.slice(row - 1, row - 1 + nRows);
        const key = (r, c) => String(r[c - 1] ?? "");
        block.sort((a, b) => {
          for (const { column, ascending = true } of specs) {
            const d = key(a, column - col + 1).localeCompare(key(b, column - col + 1), "es", { sensitivity: "base" });
            if (d) return ascending ? d : -d;
          }
          return 0;
        });
        block.forEach((r, i) => (this.rows[row - 1 + i] = r));
      },
      setNumberFormat: (fmt) => {
        for (let i = 0; i < nRows; i++) for (let j = 0; j < nCols; j++) {
          if (fmt === "@") this.textCells.add(`${row + i},${col + j}`);
        }
      },
    };
  }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return 1000; }
  getSheetId() { return this.id; }
  setFrozenRows() {}
  setFrozenColumns() {}
  setColumnWidth() {}
  hideColumns(c, n) { this.hidden = [c, n]; }
  showColumns() {}
  getBandings() { return []; }
  // Como Sheets: mueve la columna de `range` delante de la posición `dest` (índices desde 1, antes de mover).
  moveColumns(range, dest) {
    const from = range.col - 1;
    const to = dest - 1 > from ? dest - 2 : dest - 1;
    this.rows.forEach((r) => { while (r.length <= from) r.push(""); r.splice(to, 0, r.splice(from, 1)[0]); });
  }
}

export function makeEnv(token = "secreto", { uuid: uuidFn } = {}) {
  const sheets = new Map();
  let n = 0;
  const ss = {
    getSheetByName: (name) => sheets.get(name) ?? null,
    getSheets: () => [...sheets.values()],
    insertSheet: (name) => { if (sheets.has(name)) throw new Error(`Ya existe una hoja llamada ${name}`); const s = new FakeSheet(name, ++n); sheets.set(name, s); return s; },
    getUrl: () => "https://docs.google.com/spreadsheets/d/X/edit",
  };
  const props = token ? { ADMIN_TOKEN: token } : {};
  let uuid = 0;
  const cache = new Map();
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    CacheService: {
      getScriptCache: () => {
        const m = cache;
        return {
          get: (k) => m.get(k) ?? null,
          put: (k, v) => { if (String(v).length > 100000) throw new Error("Argument too large: value"); m.set(k, v); },
          getAll: (ks) => Object.fromEntries(ks.filter((k) => m.has(k)).map((k) => [k, m.get(k)])),
          putAll: (o) => { for (const [k, v] of Object.entries(o)) { if (String(v).length > 100000) throw new Error("Argument too large: value"); m.set(k, v); } },
        };
      },
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: uuidFn ?? (() => `${String(++uuid).padStart(8, "0")}-aaaa-bbbb-cccc-dddddddddddd`) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (s) => ({ s, setMimeType() { return this; } }),
    },
  });
  vm.runInContext(readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8"), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return {
    sheets,
    cache,
    // Hoja de resultados de un examen, buscada como el script: por el hoja_id guardado en «Examenes».
    results: (id) => {
      const ex = sheets.get("Examenes").rows.find((r) => String(r[0]) === String(id));
      return [...sheets.values()].find((s) => s.id === ex[16]) ?? null;
    },
    rename: (from, to) => { const s = sheets.get(from); sheets.delete(from); s.name = to; sheets.set(to, s); },
    get: (params) => run(`handleGet_`)(params),
    post: (body) => run(`handlePost_`)(body),
    fn: (name) => run(name),
  };
}

