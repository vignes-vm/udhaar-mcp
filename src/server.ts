import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { addEntry, balanceOf, listDues, summaryForDay } from "./ledger.js";
import { parseUtterance } from "./parser.js";

const app = express();
app.use(express.json());
const port = process.env.PORT ?? 3000;

function inr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "udhaar", version: "0.1.0" });

  server.registerTool(
    "record_credit",
    {
      title: "Record credit",
      description:
        "Use when the shopkeeper says a customer took goods or money on credit/udhaar/baaki/kadan, " +
        'e.g. "Ramu took rice worth two hundred rupees on credit" or "add 500 udhaar for Kumar". ' +
        "Records a credit entry and reports the customer's new balance.",
      inputSchema: {
        customer: z.string().min(1).describe("Customer name"),
        amount: z.number().positive().describe("Amount in INR"),
        note: z.string().optional().describe("What the credit was for"),
      },
    },
    async ({ customer, amount, note }) => {
      addEntry(customer, "credit", amount, note);
      const balance = balanceOf(customer);
      const displayName = balance?.displayName ?? customer;
      const owed = balance?.balance ?? amount;
      return {
        content: [
          {
            type: "text",
            text: `Recorded ${inr(amount)} credit for ${displayName}. They now owe ${inr(owed)}.`,
          },
        ],
        structuredContent: { customer: displayName, balance: owed },
      };
    },
  );

  server.registerTool(
    "record_payment",
    {
      title: "Record payment",
      description:
        'Use when the shopkeeper says a customer paid back money, e.g. "Ramu paid 500" or ' +
        '"Kumar cleared his dues". Records a payment and reports whether the balance is fully settled.',
      inputSchema: {
        customer: z.string().min(1).describe("Customer name"),
        amount: z.number().positive().describe("Amount in INR"),
      },
    },
    async ({ customer, amount }) => {
      addEntry(customer, "payment", amount);
      const balance = balanceOf(customer);
      const displayName = balance?.displayName ?? customer;
      const owed = balance?.balance ?? 0;
      const text =
        owed <= 0
          ? `Recorded ${inr(amount)} payment from ${displayName}. Fully settled.`
          : `Recorded ${inr(amount)} payment from ${displayName}. They still owe ${inr(owed)}.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: { customer: displayName, balance: owed },
      };
    },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Get balance",
      description:
        'Use when the shopkeeper asks what a customer owes, e.g. "how much does Ramu owe" or ' +
        '"what\'s Kumar\'s balance". Reports the current balance and last few movements.',
      inputSchema: {
        customer: z.string().min(1).describe("Customer name"),
      },
    },
    async ({ customer }) => {
      const balance = balanceOf(customer);
      if (!balance) {
        return {
          content: [
            { type: "text", text: `I don't have any records for ${customer} yet.` },
          ],
        };
      }
      const recent = balance.entries.slice(-3).reverse();
      const text = `${balance.displayName} owes ${inr(balance.balance)}.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          customer: balance.displayName,
          balance: balance.balance,
          recent,
        },
      };
    },
  );

  server.registerTool(
    "list_dues",
    {
      title: "List dues",
      description:
        'Use when the shopkeeper asks who owes money, e.g. "who owes me money" or "show overdue customers". ' +
        "Lists customers with outstanding balances, biggest first.",
      inputSchema: {
        minDaysOverdue: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Only include customers inactive for at least this many days"),
        limit: z.number().int().positive().optional().describe("Max customers to list, default 5"),
      },
    },
    async ({ minDaysOverdue, limit }) => {
      const dues = listDues(minDaysOverdue ?? 0).slice(0, limit ?? 5);
      if (dues.length === 0) {
        return {
          content: [{ type: "text", text: "No one owes you money right now." }],
          structuredContent: { dues: [] },
        };
      }
      const total = dues.reduce((sum, d) => sum + d.balance, 0);
      const list = dues.map((d) => `${d.displayName} owes ${inr(d.balance)}`).join(", ");
      return {
        content: [
          { type: "text", text: `${list}. Total outstanding: ${inr(total)}.` },
        ],
        structuredContent: { dues },
      };
    },
  );

  server.registerTool(
    "daily_summary",
    {
      title: "Daily summary",
      description:
        'Use when the shopkeeper asks about today\'s business, e.g. "how was today" or "give me today\'s summary". ' +
        "Reports today's credit, payments, entry count, and total outstanding across all customers.",
      inputSchema: {},
    },
    async () => {
      const summary = summaryForDay();
      const text =
        `Today: ${inr(summary.credit)} in credit and ${inr(summary.payments)} in payments ` +
        `across ${summary.count} entries. Total outstanding: ${inr(summary.totalOutstanding)}.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: { ...summary },
      };
    },
  );

  server.registerTool(
    "payment_reminder",
    {
      title: "Payment reminder",
      description:
        'Use when the shopkeeper wants to remind a customer to pay, e.g. "remind Ramu to pay" or ' +
        '"send Kumar a payment reminder". Drafts a polite reminder message, with a UPI payment link if a UPI ID is given.',
      inputSchema: {
        customer: z.string().min(1).describe("Customer name"),
        shopName: z.string().optional().describe("Shop name to sign the reminder with"),
        upiId: z.string().optional().describe("Shop's UPI ID for a payment deep link"),
      },
    },
    async ({ customer, shopName, upiId }) => {
      const balance = balanceOf(customer);
      if (!balance || balance.balance <= 0) {
        return {
          content: [
            {
              type: "text",
              text: `${balance?.displayName ?? customer} has no outstanding balance. No reminder needed.`,
            },
          ],
        };
      }
      const shop = shopName ?? "the shop";
      let message = `Hi ${balance.displayName}, this is a reminder from ${shop} that you have an outstanding balance of ${inr(balance.balance)}. Please pay at your convenience.`;
      if (upiId) {
        const link = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shop)}&am=${balance.balance.toFixed(2)}&cu=INR`;
        message += ` Pay here: ${link}`;
      }
      return {
        content: [{ type: "text", text: message }],
        structuredContent: { customer: balance.displayName, balance: balance.balance, message },
      };
    },
  );

  server.registerTool(
    "record_from_speech",
    {
      title: "Record from speech",
      description:
        "Use when the shopkeeper describes one or more ledger events in a single free-form spoken sentence, " +
        'possibly mixing English with Tamil/Hindi words like udhaar/baaki/kadan, e.g. "Ramu took two fifty of ' +
        'rice on credit and Kumar paid 500". Parses and records every entry found in the sentence.',
      inputSchema: {
        utterance: z.string().min(1).describe("The shopkeeper's spoken sentence"),
      },
    },
    async ({ utterance }) => {
      const { entries, engine } = await parseUtterance(utterance);
      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text:
                "I couldn't understand any credit or payment in that. Try saying something like " +
                '"Ramu took 200 rupees on credit" or "Kumar paid 500".',
            },
          ],
          isError: true,
        };
      }
      const sentences = entries.map((entry) => {
        addEntry(entry.customer, entry.type, entry.amount, entry.note);
        const balance = balanceOf(entry.customer);
        const displayName = balance?.displayName ?? entry.customer;
        if (entry.type === "credit") {
          return `Recorded ${inr(entry.amount)} credit for ${displayName}.`;
        }
        const owed = balance?.balance ?? 0;
        return owed <= 0
          ? `Recorded ${inr(entry.amount)} payment from ${displayName}. Fully settled.`
          : `Recorded ${inr(entry.amount)} payment from ${displayName}. They still owe ${inr(owed)}.`;
      });
      return {
        content: [{ type: "text", text: sentences.join(" ") }],
        structuredContent: { engine, entries },
      };
    },
  );

  return server;
}

const jsonRpcMethodNotAllowed = {
  jsonrpc: "2.0" as const,
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", (_req, res) => {
  res.status(405).json(jsonRpcMethodNotAllowed);
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json(jsonRpcMethodNotAllowed);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "udhaar" });
});

app.listen(port, () => {
  console.log(`udhaar-mcp listening on ${port}`);
});
