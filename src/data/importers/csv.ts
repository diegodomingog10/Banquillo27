/**
 * Parser CSV (RFC 4180) sin dependencias: comillas, comillas escapadas (""),
 * saltos de línea dentro de campos, BOM y detección de separador (, ; o tabulador).
 */

export interface CsvParseResult {
  headers: string[];
  /** Filas como objetos cabecera -> valor (cadena recortada). */
  rows: Record<string, string>[];
  /** Número de línea (1 = cabecera) donde empieza cada fila de `rows`. */
  lineNumbers: number[];
  delimiter: string;
  /** Filas cuyo número de columnas no coincide con la cabecera. */
  malformed: { line: number; expected: number; got: number }[];
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const c of candidates) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === c && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter?: string): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delim = delimiter ?? detectDelimiter(text);
  const records: { fields: string[]; line: number }[] = [];
  let field = '';
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const endRecord = () => {
    fields.push(field);
    field = '';
    // Ignorar líneas totalmente vacías
    if (!(fields.length === 1 && fields[0] === '')) records.push({ fields, line: recordLine });
    fields = [];
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
    } else if (ch === delim) {
      fields.push(field);
      field = '';
    } else if (ch === '\r') {
      // se ignora; \n cierra el registro
    } else if (ch === '\n') {
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== '' || fields.length > 0) endRecord();

  const header = records.shift();
  const headers = (header?.fields ?? []).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  const lineNumbers: number[] = [];
  const malformed: CsvParseResult['malformed'] = [];
  for (const r of records) {
    if (r.fields.length !== headers.length) {
      malformed.push({ line: r.line, expected: headers.length, got: r.fields.length });
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, k) => {
      obj[h] = (r.fields[k] ?? '').trim();
    });
    rows.push(obj);
    lineNumbers.push(r.line);
  }
  return { headers, rows, lineNumbers, delimiter: delim, malformed };
}

/** Serializa filas a CSV (para exportar plantillas o informes). */
export function toCsv(headers: readonly string[], rows: readonly Record<string, unknown>[], delimiter = ','): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(delimiter), ...rows.map((r) => headers.map((h) => esc(r[h])).join(delimiter))].join('\n');
}
