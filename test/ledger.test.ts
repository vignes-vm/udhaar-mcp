import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "udhaar-test-"));
  process.env.UDHAAR_DATA_FILE = join(dir, "ledger.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.UDHAAR_DATA_FILE;
});

test("balance sums credits and payments and normalizes customer names", async () => {
  const { addEntry, balanceOf } = await import("../src/ledger.ts");
  addEntry("Ramu", "credit", 200);
  addEntry("  ramu  ", "payment", 50);
  addEntry("RAMU", "credit", 30);

  const result = balanceOf("ramu");
  assert.ok(result);
  assert.equal(result.balance, 180);
  assert.equal(result.displayName, "Ramu");
  assert.equal(result.entries.length, 3);
});

test("balanceOf returns null for unknown customer", async () => {
  const { balanceOf } = await import("../src/ledger.ts");
  assert.equal(balanceOf("nobody"), null);
});

test("listDues filters by minDaysOverdue and sorts by balance desc", async () => {
  const { addEntry, listDues } = await import("../src/ledger.ts");
  const now = new Date("2026-10-20T00:00:00.000Z");
  addEntry("Kumar", "credit", 900, undefined, "2026-10-01T00:00:00.000Z");
  addEntry("Ramu", "credit", 100, undefined, "2026-10-18T00:00:00.000Z");
  addEntry("Settled", "credit", 50, undefined, "2026-10-01T00:00:00.000Z");
  addEntry("Settled", "payment", 50, undefined, "2026-10-01T00:00:00.000Z");

  const all = listDues(0, now);
  assert.deepEqual(all.map((d) => d.displayName), ["Kumar", "Ramu"]);

  const overdueOnly = listDues(5, now);
  assert.deepEqual(overdueOnly.map((d) => d.displayName), ["Kumar"]);
});

test("addEntry rejects non-positive or non-finite amounts and empty names", async () => {
  const { addEntry } = await import("../src/ledger.ts");
  assert.throws(() => addEntry("Ramu", "credit", 0));
  assert.throws(() => addEntry("Ramu", "credit", -5));
  assert.throws(() => addEntry("Ramu", "credit", NaN));
  assert.throws(() => addEntry("   ", "credit", 10));
});

test("summaryForDay aggregates credit, payments, count and outstanding", async () => {
  const { addEntry, summaryForDay } = await import("../src/ledger.ts");
  addEntry("Ramu", "credit", 200, undefined, "2026-10-18T10:00:00.000Z");
  addEntry("Ramu", "payment", 50, undefined, "2026-10-18T11:00:00.000Z");
  addEntry("Kumar", "credit", 300, undefined, "2026-10-17T10:00:00.000Z");

  const summary = summaryForDay("2026-10-18");
  assert.equal(summary.credit, 200);
  assert.equal(summary.payments, 50);
  assert.equal(summary.count, 2);
  assert.equal(summary.totalOutstanding, 450);
});
