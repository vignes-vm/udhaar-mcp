import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseUtterance, parseWithBedrock, parseWithRules } from "../src/parser.ts";

afterEach(() => {
  delete process.env.UDHAAR_DISABLE_BEDROCK;
});

test("parseWithRules extracts a credit entry with a note", () => {
  const entries = parseWithRules("Ramu took 200 rupees of rice on credit");
  assert.deepEqual(entries, [{ customer: "Ramu", type: "credit", amount: 200, note: "rice" }]);
});

test("parseWithRules extracts a payment entry", () => {
  const entries = parseWithRules("Kumar paid 500");
  assert.deepEqual(entries, [{ customer: "Kumar", type: "payment", amount: 500 }]);
});

test("parseWithRules handles udhaar/baaki/kadan and multiple entries in one sentence", () => {
  const entries = parseWithRules(
    "Ramu took 200 rupees of rice on udhaar and Sita took 1.5k of oil on baaki, Kumar paid 500",
  );
  assert.equal(entries.length, 3);
  assert.equal(entries[0].customer, "Ramu");
  assert.equal(entries[0].type, "credit");
  assert.equal(entries[1].customer, "Sita");
  assert.equal(entries[1].amount, 1500);
  assert.equal(entries[2].type, "payment");
});

test("parseWithRules returns [] for an unrelated sentence", () => {
  assert.deepEqual(parseWithRules("what a nice day today"), []);
});

test("parseWithBedrock sanitizes malformed items and keeps valid ones", async () => {
  const mockClient = {
    send: async () => ({
      output: {
        message: {
          content: [
            {
              text:
                'Here you go:\n```json\n[' +
                '{"customer":"Ramu","type":"credit","amount":200,"note":"rice"},' +
                '{"customer":"","type":"credit","amount":100},' +
                '{"customer":"Bad","type":"nonsense","amount":100},' +
                '{"customer":"Negative","type":"credit","amount":-50},' +
                '{"customer":"NoAmount","type":"credit"},' +
                '{"customer":"Kumar","type":"payment","amount":500}' +
                ']\n```',
            },
          ],
        },
      },
    }),
  };

  const entries = await parseWithBedrock("irrelevant", mockClient);
  assert.deepEqual(entries, [
    { customer: "Ramu", type: "credit", amount: 200, note: "rice" },
    { customer: "Kumar", type: "payment", amount: 500, note: undefined },
  ]);
});

test("parseWithBedrock returns [] when the model reports no entries", async () => {
  const mockClient = {
    send: async () => ({ output: { message: { content: [{ text: "[]" }] } } }),
  };
  assert.deepEqual(await parseWithBedrock("hello", mockClient), []);
});

test("parseUtterance uses the rules engine when Bedrock is disabled", async () => {
  process.env.UDHAAR_DISABLE_BEDROCK = "1";
  const result = await parseUtterance("Kumar paid 500");
  assert.equal(result.engine, "rules");
  assert.deepEqual(result.entries, [{ customer: "Kumar", type: "payment", amount: 500 }]);
});
