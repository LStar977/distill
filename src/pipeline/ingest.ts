import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { DatasetMeta, Item } from "../lib/types";
import { normalizeText } from "../lib/text";
import { DatasetError } from "./errors";

/** Shape of data/datasets/<id>.json. */
export interface DatasetFile {
  meta: DatasetMeta;
  items: Item[];
}

const itemSchema = z.object({
  id: z.string().min(1),
  source: z.string(),
  text: z.string(),
  rating: z.number().optional(),
  date: z.string().optional(),
  segment: z.string().optional(),
});

const metaSchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  meta: z.string(),
  description: z.string(),
  itemCount: z.number(),
  sources: z.array(z.string()),
  defaultContext: z.object({ product: z.string(), decision: z.string().optional() }),
});

const datasetSchema = z.object({ meta: metaSchema, items: z.array(itemSchema) });

export const DEFAULT_DATA_ROOT = join(process.cwd(), "data");

export function datasetPath(id: string, dataRoot = DEFAULT_DATA_ROOT): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new DatasetError(`Invalid dataset id "${id}"`);
  return join(dataRoot, "datasets", `${id}.json`);
}

export async function loadDataset(id: string, dataRoot = DEFAULT_DATA_ROOT): Promise<DatasetFile> {
  const path = datasetPath(id, dataRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new DatasetError(`Dataset "${id}" not found at ${path}. Run \`pnpm data:generate\` first.`, { cause: err });
  }
  return parseDatasetJson(raw, id);
}

export function parseDatasetJson(raw: string, id = "?"): DatasetFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new DatasetError(`Dataset "${id}" is not valid JSON`, { cause: err });
  }
  const parsed = datasetSchema.safeParse(json);
  if (!parsed.success) {
    throw new DatasetError(`Dataset "${id}" has an unexpected shape: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Column names (header text) for each field. Unset optional fields are auto-detected. */
export interface CsvColumnMap {
  text?: string;
  rating?: string;
  date?: string;
  source?: string;
  id?: string;
}

const AUTO_COLUMNS: Record<keyof CsvColumnMap, string[]> = {
  text: ["text", "review", "review_text", "body", "content", "comment", "feedback", "message"],
  rating: ["rating", "stars", "score", "star_rating"],
  date: ["date", "created", "created_at", "time", "timestamp", "reviewed_at", "submitted"],
  source: ["source", "app", "product", "channel", "app_name"],
  id: ["id", "review_id", "item_id", "uid"],
};

/** RFC 4180-ish CSV reader: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]?.trim() === ""));
}

function resolveColumn(headers: string[], wanted: string | undefined, key: keyof CsvColumnMap): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  if (wanted !== undefined) {
    const idx = norm.indexOf(wanted.trim().toLowerCase());
    if (idx < 0) throw new DatasetError(`CSV has no column "${wanted}" for ${key}. Columns: ${headers.join(", ")}`);
    return idx;
  }
  for (const candidate of AUTO_COLUMNS[key]) {
    const idx = norm.indexOf(candidate);
    if (idx >= 0) return idx;
  }
  return -1;
}

export interface ParseCsvOptions {
  columns?: CsvColumnMap;
  /** Used when no source column exists. Default "upload". */
  defaultSource?: string;
  /** Prefix for generated ids. Default "row". */
  idPrefix?: string;
}

/** Parse a CSV upload into Items. Dates are normalized to ISO, ratings to numbers. */
export function parseCsv(text: string, opts: ParseCsvOptions = {}): Item[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new DatasetError("CSV is empty");
  const headers = rows[0] as string[];
  const map = opts.columns ?? {};
  const textIdx = resolveColumn(headers, map.text, "text");
  if (textIdx < 0) {
    throw new DatasetError(`CSV needs a text column (one of: ${AUTO_COLUMNS.text.join(", ")}) or an explicit mapping`);
  }
  const ratingIdx = resolveColumn(headers, map.rating, "rating");
  const dateIdx = resolveColumn(headers, map.date, "date");
  const sourceIdx = resolveColumn(headers, map.source, "source");
  const idIdx = resolveColumn(headers, map.id, "id");
  const prefix = opts.idPrefix ?? "row";

  const items: Item[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as string[];
    const body = (row[textIdx] ?? "").trim();
    if (!body) continue;
    const item: Item = {
      id: idIdx >= 0 && (row[idIdx] ?? "").trim() ? (row[idIdx] as string).trim() : `${prefix}-${r}`,
      source: sourceIdx >= 0 && (row[sourceIdx] ?? "").trim() ? (row[sourceIdx] as string).trim() : (opts.defaultSource ?? "upload"),
      text: body,
    };
    if (ratingIdx >= 0) {
      const rating = parseRating(row[ratingIdx] ?? "");
      if (rating !== undefined) item.rating = rating;
    }
    if (dateIdx >= 0) {
      const iso = normalizeDate(row[dateIdx] ?? "");
      if (iso) item.date = iso;
    }
    items.push(item);
  }
  return items;
}

export function parseRating(raw: string): number | undefined {
  const m = raw.trim().match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function iso(y: number, m: number, d: number): string | undefined {
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1900 || y > 2200) return undefined;
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

/**
 * Normalize common date spellings to YYYY-MM-DD: ISO (with or without time),
 * "14 Mar 2026", "Mar 14, 2026", "3/14/2026" (month-first), epoch seconds or
 * millis. Returns undefined when nothing sensible can be read.
 */
export function normalizeDate(raw: string | number | undefined | null): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const dt = new Date(ms);
    return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString().slice(0, 10);
  }
  const s = raw.trim();
  if (!s) return undefined;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) return iso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[(m[2] as string).slice(0, 4).toLowerCase()] ?? MONTHS[(m[2] as string).slice(0, 3).toLowerCase()];
    if (mon !== undefined) return iso(Number(m[3]), mon, Number(m[1]));
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[(m[1] as string).slice(0, 4).toLowerCase()] ?? MONTHS[(m[1] as string).slice(0, 3).toLowerCase()];
    if (mon !== undefined) return iso(Number(m[3]), mon, Number(m[2]));
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return iso(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  if (/^\d{10}(\d{3})?$/.test(s)) return normalizeDate(Number(s));
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Normalize / dedupe / cap
// ---------------------------------------------------------------------------

export interface NormalizeResult {
  items: Item[];
  /** Rows dropped for being empty or duplicates. */
  dropped: number;
  duplicates: number;
  empty: number;
  /** Rows kept over the cap were removed from the middle (evenly spaced) so the time range survives. */
  capped: number;
  sources: string[];
  months: number;
  dateRange: { from?: string; to?: string };
}

export function monthsSpanned(items: readonly Item[]): { months: number; from?: string; to?: string } {
  const dates = items.map((i) => i.date).filter((d): d is string => typeof d === "string" && d.length >= 7).sort();
  if (dates.length === 0) return { months: 0 };
  const from = dates[0] as string;
  const to = dates[dates.length - 1] as string;
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  return { months: (ty - fy) * 12 + (tm - fm) + 1, from, to };
}

/**
 * Normalize dates and ratings, drop empty texts and exact-text duplicates,
 * then apply the cap. Items are returned sorted by date (undated last), then id.
 */
export function normalizeItems(input: readonly Item[], opts: { cap?: number } = {}): NormalizeResult {
  const seen = new Set<string>();
  const out: Item[] = [];
  let duplicates = 0;
  let empty = 0;
  for (const raw of input) {
    const text = normalizeText(raw.text ?? "");
    if (!text) {
      empty++;
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    const item: Item = { id: String(raw.id), source: raw.source || "unknown", text };
    const date = normalizeDate(raw.date);
    if (date) item.date = date;
    if (typeof raw.rating === "number" && Number.isFinite(raw.rating)) item.rating = raw.rating;
    if (raw.segment) item.segment = raw.segment;
    out.push(item);
  }
  out.sort((a, b) => {
    const da = a.date ?? "9999";
    const db = b.date ?? "9999";
    return da < db ? -1 : da > db ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let items = out;
  let capped = 0;
  const cap = opts.cap;
  if (cap !== undefined && cap > 0 && out.length > cap) {
    capped = out.length - cap;
    // Evenly spaced over the date-sorted list, always keeping the first and last item.
    items =
      cap === 1
        ? [out[0] as Item]
        : Array.from({ length: cap }, (_, i) => out[Math.round((i * (out.length - 1)) / (cap - 1))] as Item);
  }

  const span = monthsSpanned(items);
  const sources = Array.from(new Set(items.map((i) => i.source))).sort();
  return {
    items,
    dropped: duplicates + empty,
    duplicates,
    empty,
    capped,
    sources,
    months: span.months,
    dateRange: { from: span.from, to: span.to },
  };
}
