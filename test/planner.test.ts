import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "udhaar-planner-test-"));
  process.env.UDHAAR_DATA_FILE = join(dir, "ledger.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.UDHAAR_DATA_FILE;
  delete process.env.UDHAAR_DISABLE_BEDROCK;
});

test("rankDues scores balance * recency, highest score first", async () => {
  const { addEntry } = await import("../src/ledger.ts");
  const { rankDues } = await import("../src/planner.ts");
  const now = new Date("2026-10-20T00:00:00.000Z");

  addEntry("Stale", "credit", 100, undefined, "2026-08-01T00:00:00.000Z"); // score 300
  addEntry("Big", "credit", 900, undefined, "2026-10-19T00:00:00.000Z"); // score ~930
  addEntry("Tiny", "credit", 10, undefined, "2026-10-19T00:00:00.000Z"); // score ~10.3

  const ranked = rankDues(3, now);
  assert.deepEqual(ranked.map((d) => d.displayName), ["Big", "Stale", "Tiny"]);
});

test("rankDues respects maxCustomers", async () => {
  const { addEntry } = await import("../src/ledger.ts");
  const { rankDues } = await import("../src/planner.ts");
  addEntry("A", "credit", 500);
  addEntry("B", "credit", 400);
  addEntry("C", "credit", 300);

  assert.equal(rankDues(2).length, 2);
});

test("collectionPlan falls back to a polite template when Bedrock is disabled", async () => {
  process.env.UDHAAR_DISABLE_BEDROCK = "1";
  const { addEntry } = await import("../src/ledger.ts");
  const { collectionPlan } = await import("../src/planner.ts");
  addEntry("Ramu", "credit", 900);

  const plan = await collectionPlan(3, "English", "Sri Shop");
  assert.equal(plan.engine, "template");
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].priority, 1);
  assert.equal(plan.items[0].customer, "Ramu");
  assert.match(plan.items[0].message, /Sri Shop/);
  assert.match(plan.items[0].message, /Ramu/);
});

test("collectionPlan returns no items when nobody owes money", async () => {
  process.env.UDHAAR_DISABLE_BEDROCK = "1";
  const { collectionPlan } = await import("../src/planner.ts");
  const plan = await collectionPlan();
  assert.deepEqual(plan.items, []);
});
