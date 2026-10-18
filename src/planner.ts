import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { listDues, type DueCustomer } from "./ledger.js";

export interface PlanItem {
  priority: number;
  customer: string;
  balance: number;
  daysSinceActivity: number;
  message: string;
}

export interface Plan {
  engine: "bedrock" | "template";
  items: PlanItem[];
}

function inr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function scoreOf(d: DueCustomer): number {
  return d.balance * (1 + Math.min(d.daysSinceActivity, 60) / 30);
}

export function rankDues(maxCustomers = 3, now: Date = new Date()): DueCustomer[] {
  return listDues(0, now)
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .slice(0, maxCustomers);
}

function templateMessage(d: DueCustomer, shopName?: string): string {
  const shop = shopName ?? "the shop";
  return `Hi ${d.displayName}, a friendly reminder from ${shop}: you have an outstanding balance of ${inr(d.balance)}. Please pay whenever convenient. Thank you!`;
}

function bedrockDisabled(): boolean {
  return process.env.UDHAAR_DISABLE_BEDROCK === "1" || process.env.UDHAAR_DISABLE_BEDROCK === "true";
}

let client: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  return client;
}

export async function draftMessages(
  dues: DueCustomer[],
  language: string,
  shopName: string | undefined,
  bedrockClient: Pick<BedrockRuntimeClient, "send"> = getClient(),
): Promise<Record<string, string>> {
  const prompt = dues
    .map((d) => `${d.customer}: owes ${inr(d.balance)}, last activity ${d.daysSinceActivity} days ago`)
    .join("\n");
  const system =
    `You draft warm, respectful, never-threatening payment reminders for a small shop's customers, ` +
    `in ${language}, under 30 words each. Return ONLY a JSON object mapping each customer key to their ` +
    `message string, no prose, no markdown. Shop name: ${shopName ?? "the shop"}.`;

  const command = new ConverseCommand({
    modelId: process.env.BEDROCK_MODEL_ID,
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { temperature: 0.3, maxTokens: 600 },
  });
  const response = await bedrockClient.send(command);
  const content = response.output?.message?.content ?? [];
  const raw = content.find((block) => typeof block.text === "string")?.text ?? "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : {};

  const messages: Record<string, string> = {};
  for (const d of dues) {
    const drafted = (parsed as Record<string, unknown>)[d.customer];
    messages[d.customer] =
      typeof drafted === "string" && drafted.trim() ? drafted.trim() : templateMessage(d, shopName);
  }
  return messages;
}

export async function collectionPlan(
  maxCustomers = 3,
  language = "English",
  shopName?: string,
): Promise<Plan> {
  const dues = rankDues(maxCustomers);
  if (dues.length === 0) {
    return { engine: "template", items: [] };
  }

  const fallback = () => Object.fromEntries(dues.map((d) => [d.customer, templateMessage(d, shopName)]));

  let engine: "bedrock" | "template" = "template";
  let messages: Record<string, string>;
  if (bedrockDisabled()) {
    messages = fallback();
  } else {
    try {
      messages = await draftMessages(dues, language, shopName);
      engine = "bedrock";
    } catch (err) {
      console.error("Bedrock drafting failed, falling back to template:", err);
      messages = fallback();
    }
  }

  const items: PlanItem[] = dues.map((d, index) => ({
    priority: index + 1,
    customer: d.displayName,
    balance: d.balance,
    daysSinceActivity: d.daysSinceActivity,
    message: messages[d.customer],
  }));

  return { engine, items };
}
