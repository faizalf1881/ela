import "server-only";
import ExcelJS from "exceljs";

/**
 * Reads an uploaded customer list (spec #4): Excel .xlsx or .csv, first sheet,
 * first non-empty row as the header (or "Column A, B…" when the first row is
 * already data). Guesses which column holds the phone numbers and the names.
 */

export class SheetError extends Error {}

export type Sheet = { columns: string[]; rows: Record<string, string>[]; phoneColumn: string | null; nameColumn: string | null; truncated: boolean };

const MAX_ROWS = 5000;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Excel keeps long numbers as numbers; print them in full, never 9.19E+11.
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
    if (o.text !== undefined) return cellText(o.text);
    if (o.result !== undefined) return cellText(o.result);
  }
  return String(v).trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

const looksLikePhone = (v: string) => /^\+?[\d\s().-]{8,20}$/.test(v) && v.replace(/\D/g, "").length >= 10;
const PHONE_HEADER = /phone|mobile|whats\s?app|number|contact|cell|^ph\.?$|tel/i;

export async function parseSheet(file: File): Promise<Sheet> {
  const lower = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  let table: string[][];
  if (lower.endsWith(".csv") || file.type === "text/csv") {
    table = parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  } else if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new SheetError("That file couldn't be read as an Excel workbook. Save it as .xlsx (or .csv) and try again.");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new SheetError("The workbook has no sheets.");
    const raw: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => raw.push((row.values as unknown[]).slice(1)));
    const width = Math.max(0, ...raw.map((r) => r.length));
    table = raw.map((r) => Array.from({ length: width }, (_, i) => cellText(r[i])));
  } else {
    throw new SheetError("Upload an Excel (.xlsx) or CSV file. For an old .xls file, open it in Excel and Save As .xlsx.");
  }

  table = table.filter((r) => r.some((c) => c !== ""));
  if (!table.length) throw new SheetError("The file is empty.");
  const width = Math.max(...table.map((r) => r.length));
  const first = table[0];
  const hasHeader = !first.some(looksLikePhone);
  const columns = hasHeader
    ? Array.from({ length: width }, (_, i) => first[i] || `Column ${String.fromCharCode(65 + (i % 26))}`)
    : Array.from({ length: width }, (_, i) => `Column ${String.fromCharCode(65 + (i % 26))}`);
  // Two columns with the same title would overwrite each other.
  const unique = columns.map((c, i) => (columns.indexOf(c) === i ? c : `${c} (${i + 1})`));
  const body = (hasHeader ? table.slice(1) : table).slice(0, MAX_ROWS);
  const rows = body.map((r) => Object.fromEntries(unique.map((c, i) => [c, r[i] ?? ""])));

  const phoneScore = (c: string) => rows.filter((r) => looksLikePhone(r[c])).length;
  const phoneColumn = unique.find((c) => PHONE_HEADER.test(c)) ?? [...unique].sort((a, b) => phoneScore(b) - phoneScore(a)).find((c) => phoneScore(c) > 0) ?? null;
  const nameColumn = unique.find((c) => c !== phoneColumn && /name|customer/i.test(c)) ?? null;
  return { columns: unique, rows, phoneColumn, nameColumn, truncated: (hasHeader ? table.length - 1 : table.length) > MAX_ROWS };
}
