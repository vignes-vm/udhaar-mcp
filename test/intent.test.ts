import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { routeIntent, routeWithBedrock, routeWithRules } from "../src/intent.ts";

afterEach(() => {
  delete process.env.UDHAAR_DISABLE_BEDROCK;
});

test("routeWithRules recognizes a statement as record_from_speech", () => {
  const route = routeWithRules("Ramu took 200 rupees of rice on credit");
  assert.deepEqual(route, { tool: "record_from_speech", args: { utterance: "Ramu took 200 rupees of rice on credit" } });
});

test("routeWithRules recognizes a balance question", () => {
  const route = routeWithRules("how much does Ramu owe");
  assert.deepEqual(route, { tool: "get_balance", args: { customer: "ramu" } });
});

test("routeWithRules recognizes a dues question", () => {
  assert.deepEqual(routeWithRules("who owes me money"), { tool: "list_dues", args: {} });
});

test("routeWithRules recognizes a daily summary question", () => {
  assert.deepEqual(routeWithRules("how was today"), { tool: "daily_summary", args: {} });
});

test("routeWithRules recognizes a follow-up question as collection_plan", () => {
  assert.deepEqual(routeWithRules("who should I follow up with today"), { tool: "collection_plan", args: {} });
});

test("routeWithBedrock sanitizes an unknown tool name to record_from_speech", async () => {
  const mockClient = {
    send: async () => ({
      output: { message: { content: [{ text: '{"tool":"delete_everything","args":{}}' }] } },
    }),
  };
  const route = await routeWithBedrock("some sentence", mockClient);
  assert.deepEqual(route, { tool: "record_from_speech", args: { utterance: "some sentence" } });
});

test("routeIntent uses the rules engine when Bedrock is disabled", async () => {
  process.env.UDHAAR_DISABLE_BEDROCK = "1";
  const route = await routeIntent("who owes me money");
  assert.deepEqual(route, { tool: "list_dues", args: {} });
});
