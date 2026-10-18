import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

export type IntentTool = "record_from_speech" | "get_balance" | "list_dues" | "daily_summary" | "collection_plan";

export interface Route {
  tool: IntentTool;
  args: Record<string, unknown>;
}

const TOOLS: readonly IntentTool[] = [
  "record_from_speech",
  "get_balance",
  "list_dues",
  "daily_summary",
  "collection_plan",
];

const SYSTEM_PROMPT = `You are an intent router for Udhaar, a voice shop-ledger assistant.
Classify the shopkeeper's sentence into exactly one tool call and extract its arguments.
- record_from_speech {"utterance": string} - statements describing credit/payment events, e.g. "Ramu took 200 rupees on credit".
- get_balance {"customer": string} - asking what one specific named customer owes.
- list_dues {} - asking who owes money in general, or which customers are overdue.
- daily_summary {} - asking about today's business.
- collection_plan {} - asking who to follow up with or collect from today.
Return ONLY JSON: {"tool": "<name>", "args": {...}}. If unsure, use record_from_speech with the full sentence as "utterance".`;

function bedrockDisabled(): boolean {
  return process.env.UDHAAR_DISABLE_BEDROCK === "1" || process.env.UDHAAR_DISABLE_BEDROCK === "true";
}

let client: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  return client;
}

function sanitizeRoute(parsed: unknown, fallbackText: string): Route {
  const fallback: Route = { tool: "record_from_speech", args: { utterance: fallbackText } };
  if (!parsed || typeof parsed !== "object") return fallback;

  const { tool, args } = parsed as Record<string, unknown>;
  if (typeof tool !== "string" || !TOOLS.includes(tool as IntentTool)) return fallback;

  const safeArgs: Record<string, unknown> = args && typeof args === "object" ? { ...(args as object) } : {};
  if (tool === "record_from_speech" && typeof safeArgs.utterance !== "string") {
    safeArgs.utterance = fallbackText;
  }
  return { tool: tool as IntentTool, args: safeArgs };
}

export async function routeWithBedrock(
  text: string,
  bedrockClient: Pick<BedrockRuntimeClient, "send"> = getClient(),
): Promise<Route> {
  const command = new ConverseCommand({
    modelId: process.env.BEDROCK_MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: "user", content: [{ text }] }],
    inferenceConfig: { temperature: 0, maxTokens: 200 },
  });
  const response = await bedrockClient.send(command);
  const content = response.output?.message?.content ?? [];
  const raw = content.find((block) => typeof block.text === "string")?.text ?? "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : {};
  return sanitizeRoute(parsed, text);
}

export function routeWithRules(text: string): Route {
  const t = text.toLowerCase();

  if (/follow up|who should i|collect from/.test(t)) {
    return { tool: "collection_plan", args: {} };
  }
  if (/who owes|overdue|\bdues\b/.test(t)) {
    return { tool: "list_dues", args: {} };
  }
  if (/\btoday\b|\bsummary\b/.test(t)) {
    return { tool: "daily_summary", args: {} };
  }
  if (/\bowe|balance\b/.test(t)) {
    const match = t.match(/(?:does|is|of)\s+([a-z]+)/) ?? t.match(/([a-z]+)\s*'?s?\s*balance/);
    if (match?.[1]) {
      return { tool: "get_balance", args: { customer: match[1] } };
    }
  }
  return { tool: "record_from_speech", args: { utterance: text } };
}

export async function routeIntent(text: string): Promise<Route> {
  if (bedrockDisabled()) {
    return routeWithRules(text);
  }
  try {
    return await routeWithBedrock(text);
  } catch (err) {
    console.error("Bedrock intent routing failed, falling back to rules:", err);
    return routeWithRules(text);
  }
}
