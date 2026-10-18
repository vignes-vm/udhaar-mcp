import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

export type EntryType = "credit" | "payment";

export interface ParsedEntry {
  customer: string;
  type: EntryType;
  amount: number;
  note?: string;
}

export interface ParseResult {
  entries: ParsedEntry[];
  engine: "bedrock" | "rules";
}

const SYSTEM_PROMPT = `You extract shop credit-ledger entries from a shopkeeper's spoken sentence.
The sentence may mix English with Tamil/Hindi words transliterated to English (e.g. udhaar, baaki, kadan all mean "credit/debt").
Return ONLY a JSON array (no prose, no markdown) of objects: {"customer": string, "type": "credit"|"payment", "amount": number, "note": string|null}.
"amount" is in INR as a plain number, converting spoken amounts like "two fifty" to 250 and "1.5k" to 1500.
Return [] if the sentence contains no ledger entry.`;

let client: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  return client;
}

function bedrockDisabled(): boolean {
  return process.env.UDHAAR_DISABLE_BEDROCK === "1" || process.env.UDHAAR_DISABLE_BEDROCK === "true";
}

function sanitize(items: unknown): ParsedEntry[] {
  if (!Array.isArray(items)) return [];
  const entries: ParsedEntry[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const { customer, type, amount, note } = item as Record<string, unknown>;
    if (typeof customer !== "string" || !customer.trim()) continue;
    if (type !== "credit" && type !== "payment") continue;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) continue;
    entries.push({
      customer: customer.trim(),
      type,
      amount,
      note: typeof note === "string" && note.trim() ? note.trim() : undefined,
    });
  }
  return entries;
}

export async function parseWithBedrock(
  text: string,
  bedrockClient: Pick<BedrockRuntimeClient, "send"> = getClient(),
): Promise<ParsedEntry[]> {
  const command = new ConverseCommand({
    modelId: process.env.BEDROCK_MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: "user", content: [{ text }] }],
    inferenceConfig: { temperature: 0, maxTokens: 400 },
  });
  const response = await bedrockClient.send(command);
  const content = response.output?.message?.content ?? [];
  const raw = content.find((block) => typeof block.text === "string")?.text ?? "[]";
  const match = raw.match(/\[[\s\S]*\]/);
  const parsed = match ? JSON.parse(match[0]) : [];
  return sanitize(parsed);
}

const AMOUNT_RE = /₹?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i;
const CREDIT_RE = /\b(?:credit|udhaar|baaki|kadan|took|bought|got)\b/i;
const PAYMENT_RE = /\bpaid\b/i;
const NOTE_RE = /\bof\s+([a-z\s]+?)(?:\s+(?:on|worth|for)\b|$)/i;

function extractAmount(clause: string): number | null {
  const m = clause.match(AMOUNT_RE);
  if (!m) return null;
  const amount = parseFloat(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function extractCustomer(clause: string): string | null {
  const m = clause.trim().match(/^([A-Za-z]+)\b/);
  return m ? m[1] : null;
}

function parseClause(clause: string): ParsedEntry | null {
  const customer = extractCustomer(clause);
  const amount = extractAmount(clause);
  if (!customer || amount === null) return null;

  if (PAYMENT_RE.test(clause)) {
    return { customer, type: "payment", amount };
  }
  if (CREDIT_RE.test(clause)) {
    const note = clause.match(NOTE_RE)?.[1]?.trim();
    return { customer, type: "credit", amount, note };
  }
  return null;
}

export function parseWithRules(text: string): ParsedEntry[] {
  return text
    .split(/\band\b|[,;]/i)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map(parseClause)
    .filter((entry): entry is ParsedEntry => entry !== null);
}

export async function parseUtterance(text: string): Promise<ParseResult> {
  if (bedrockDisabled()) {
    return { entries: parseWithRules(text), engine: "rules" };
  }
  try {
    const entries = await parseWithBedrock(text);
    return { entries, engine: "bedrock" };
  } catch (err) {
    console.error("Bedrock parse failed, falling back to rules:", err);
    return { entries: parseWithRules(text), engine: "rules" };
  }
}
