import { describe, expect, it } from "vitest";
import { DatasetError } from "./errors";
import { monthsSpanned, normalizeDate, normalizeItems, parseCsv, parseCsvRows, parseDatasetJson } from "./ingest";

describe("parseCsvRows", () => {
  it("handles quotes, escaped quotes, commas and newlines inside quotes", () => {
    const rows = parseCsvRows('id,text\n1,"He said ""hi"", then left"\n2,"line one\nline two"\r\n3,plain\n');
    expect(rows).toEqual([
      ["id", "text"],
      ["1", 'He said "hi", then left'],
      ["2", "line one\nline two"],
      ["3", "plain"],
    ]);
  });
  it("strips a BOM and skips blank lines", () => {
    expect(parseCsvRows("﻿a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseCsv", () => {
  it("auto-detects columns and normalizes ratings and dates", () => {
    const items = parseCsv("review_id,App,Stars,Date,Review\nr1,IronLog,4 stars,14 Mar 2026,Great timer\nr2,SetCount,2,2026-06-02T10:00:00Z,Lost sets\n,,,,\n");
    expect(items).toEqual([
      { id: "r1", source: "IronLog", text: "Great timer", rating: 4, date: "2026-03-14" },
      { id: "r2", source: "SetCount", text: "Lost sets", rating: 2, date: "2026-06-02" },
    ]);
  });
  it("uses an explicit column map and generated ids", () => {
    const items = parseCsv("body,when\nhello,3/14/2026\n", { columns: { text: "body", date: "when" }, defaultSource: "upload", idPrefix: "u" });
    expect(items).toEqual([{ id: "u-1", source: "upload", text: "hello", date: "2026-03-14" }]);
  });
  it("throws a DatasetError when the text column is missing", () => {
    expect(() => parseCsv("a,b\n1,2\n")).toThrow(DatasetError);
    expect(() => parseCsv("text,b\n1,2\n", { columns: { rating: "nope" } })).toThrow(/no column "nope"/);
  });
});

describe("normalizeDate", () => {
  it("reads common spellings", () => {
    expect(normalizeDate("2026-03-14")).toBe("2026-03-14");
    expect(normalizeDate("2026-3-4")).toBe("2026-03-04");
    expect(normalizeDate("14 Mar 2026")).toBe("2026-03-14");
    expect(normalizeDate("Sept 5, 2025")).toBe("2025-09-05");
    expect(normalizeDate("3/14/2026")).toBe("2026-03-14");
    expect(normalizeDate(1_773_446_400)).toBe("2026-03-14");
    expect(normalizeDate("garbage")).toBeUndefined();
    expect(normalizeDate("2026-02-30")).toBeUndefined();
  });
});

describe("normalizeItems", () => {
  const items = [
    { id: "c", source: "A", text: "  Same   text ", date: "2 Jun 2026", rating: 3 },
    { id: "a", source: "B", text: "same text", date: "2026-01-01" },
    { id: "b", source: "A", text: "", date: "2026-01-02" },
    { id: "d", source: "A", text: "Other", date: "2025-08-05" },
    { id: "e", source: "C", text: "Undated" },
  ];
  it("dedupes exact text (whitespace/case-insensitive), drops empties, sorts by date", () => {
    const r = normalizeItems(items);
    expect(r.items.map((i) => i.id)).toEqual(["d", "c", "e"]);
    expect(r.duplicates).toBe(1);
    expect(r.empty).toBe(1);
    expect(r.dropped).toBe(2);
    expect(r.items[1]).toEqual({ id: "c", source: "A", text: "Same text", date: "2026-06-02", rating: 3 });
    expect(r.sources).toEqual(["A", "C"]);
    expect(r.months).toBe(11);
  });
  it("applies the cap with evenly spaced picks so the date range survives", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`, source: "A", text: `t${i}`, date: `2026-01-${String(1 + (i % 28)).padStart(2, "0")}` }));
    const r = normalizeItems(many, { cap: 10 });
    expect(r.items).toHaveLength(10);
    expect(r.capped).toBe(90);
    expect(r.items[0]?.date).toBe("2026-01-01");
    expect(r.items[9]?.date).toBe("2026-01-28");
  });
  it("counts months spanned", () => {
    expect(monthsSpanned([{ id: "1", source: "a", text: "x", date: "2025-08-30" }, { id: "2", source: "a", text: "y", date: "2026-09-01" }]).months).toBe(14);
  });
});

describe("parseDatasetJson", () => {
  it("rejects malformed files with a DatasetError", () => {
    expect(() => parseDatasetJson("{", "x")).toThrow(DatasetError);
    expect(() => parseDatasetJson(JSON.stringify({ meta: {}, items: [] }), "x")).toThrow(DatasetError);
  });
});
