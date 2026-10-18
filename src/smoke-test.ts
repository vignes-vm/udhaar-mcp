import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const port = 3999;
const mcpUrl = process.env.MCP_URL ?? `http://localhost:${port}/mcp`;
const apiKey = process.env.UDHAAR_API_KEY;
const ownsServer = !process.env.MCP_URL;

let server: ChildProcess | undefined;
let tempDir: string | undefined;

function waitForHealth(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const attempt = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error("server never became healthy"));
      setTimeout(attempt, 200);
    };
    attempt();
  });
}

async function startServer(): Promise<void> {
  tempDir = mkdtempSync(join(tmpdir(), "udhaar-smoke-"));
  server = spawn("npx", ["tsx", "src/server.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      UDHAAR_DATA_FILE: join(tempDir, "ledger.json"),
      UDHAAR_DISABLE_BEDROCK: "1",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  await waitForHealth(`http://localhost:${port}/health`);
}

function stopServer(): void {
  server?.kill();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}

async function testAuthEnforcement(): Promise<void> {
  const authPort = port + 1;
  const authDir = mkdtempSync(join(tmpdir(), "udhaar-smoke-auth-"));
  const authUrl = `http://localhost:${authPort}`;
  const secret = "test-secret-key";
  const authServer = spawn("npx", ["tsx", "src/server.ts"], {
    env: {
      ...process.env,
      PORT: String(authPort),
      UDHAAR_DATA_FILE: join(authDir, "ledger.json"),
      UDHAAR_DISABLE_BEDROCK: "1",
      UDHAAR_API_KEY: secret,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    await waitForHealth(`${authUrl}/health`);

    const unauthenticated = await fetch(`${authUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(unauthenticated.status, 401);
    console.log("auth: request without bearer token rejected with 401 ok");

    const transport = new StreamableHTTPClientTransport(new URL(`${authUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    });
    const authedClient = new Client({ name: "udhaar-smoke-test-auth", version: "0.1.0" });
    await authedClient.connect(transport);
    await authedClient.listTools();
    await authedClient.close();
    console.log("auth: request with correct bearer token accepted ok");
  } finally {
    authServer.kill();
    rmSync(authDir, { recursive: true, force: true });
  }
}

async function connectClient(): Promise<Client> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers },
  });
  const client = new Client({ name: "udhaar-smoke-test", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  assert.ok(first && first.type === "text", `expected text content from tool, got: ${JSON.stringify(result)}`);
  return first.text;
}

async function run(): Promise<void> {
  if (ownsServer) await startServer();
  const client = await connectClient();

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(
    names,
    [
      "collection_plan",
      "daily_summary",
      "get_balance",
      "list_dues",
      "payment_reminder",
      "record_credit",
      "record_from_speech",
      "record_payment",
    ].sort(),
  );
  console.log("tools/list ok:", names.join(", "));

  const credit = await callTool(client, "record_credit", { customer: "Kumar", amount: 300, note: "rice" });
  assert.match(textOf(credit), /Kumar/);
  assert.match(textOf(credit), /300/);
  console.log("record_credit ok");

  const payment1 = await callTool(client, "record_payment", { customer: "Kumar", amount: 100 });
  assert.match(textOf(payment1), /still owe/);
  const payment2 = await callTool(client, "record_payment", { customer: "Kumar", amount: 200 });
  assert.match(textOf(payment2), /Fully settled/);
  console.log("split payment ok");

  const balance = await callTool(client, "get_balance", { customer: "kumar" });
  assert.equal((balance.structuredContent as { balance: number }).balance, 0);
  console.log("get_balance ok");

  await callTool(client, "record_credit", { customer: "Ramu", amount: 900 });
  const dues = await callTool(client, "list_dues", {});
  const dueNames = (dues.structuredContent as { dues: { customer: string }[] }).dues.map((d) => d.customer);
  assert.deepEqual(dueNames, ["ramu"]);
  console.log("list_dues ok");

  const summary = await callTool(client, "daily_summary", {});
  const s = summary.structuredContent as { credit: number; count: number };
  assert.equal(s.credit, 1200);
  assert.equal(s.count, 4);
  console.log("daily_summary ok");

  const reminder = await callTool(client, "payment_reminder", {
    customer: "Ramu",
    shopName: "Sri Shop",
    upiId: "shop@upi",
  });
  const reminderText = textOf(reminder);
  assert.match(reminderText, /Ramu/);
  assert.match(reminderText, /upi:\/\/pay/);
  console.log("payment_reminder ok");

  const invalid = await callTool(client, "record_credit", { customer: "Ramu", amount: -50 });
  assert.equal(invalid.isError, true);
  console.log("invalid input ok");

  const speech = await callTool(client, "record_from_speech", {
    utterance: "Sita took 150 rupees of oil on credit",
  });
  const speechContent = speech.structuredContent as { engine: string; entries: { customer: string }[] };
  assert.equal(speechContent.engine, "rules");
  assert.deepEqual(speechContent.entries.map((e) => e.customer), ["Sita"]);
  assert.match(textOf(speech), /Sita/);
  console.log("record_from_speech ok");

  const speechInvalid = await callTool(client, "record_from_speech", { utterance: "what a nice day" });
  assert.equal(speechInvalid.isError, true);
  console.log("record_from_speech invalid input ok");

  const plan = await callTool(client, "collection_plan", { maxCustomers: 2, shopName: "Sri Shop" });
  const planContent = plan.structuredContent as { engine: string; items: { customer: string }[] };
  assert.equal(planContent.engine, "template");
  assert.equal(planContent.items.length, 2);
  assert.match(textOf(plan), /Follow up with/);
  console.log("collection_plan ok");

  await client.close();

  if (ownsServer) await testAuthEnforcement();
}

try {
  await run();
  console.log("smoke test passed");
  stopServer();
  process.exit(0);
} catch (err) {
  console.error("smoke test FAILED:", err);
  stopServer();
  process.exit(1);
}
