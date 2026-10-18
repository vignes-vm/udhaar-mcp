import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type EntryType = "credit" | "payment";

export interface Entry {
  id: string;
  customer: string;
  type: EntryType;
  amount: number;
  note?: string;
  at: string;
}

interface Store {
  customers: Record<string, string>;
  entries: Entry[];
}

function dataFile(): string {
  return process.env.UDHAAR_DATA_FILE ?? "./data/ledger.json";
}

function load(): Store {
  const file = dataFile();
  if (!existsSync(file)) {
    return { customers: {}, entries: [] };
  }
  return JSON.parse(readFileSync(file, "utf8")) as Store;
}

function save(store: Store): void {
  const file = dataFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2));
}

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function titleCase(name: string): string {
  return normalize(name)
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function addEntry(
  customer: string,
  type: EntryType,
  amount: number,
  note?: string,
  at?: string,
): Entry {
  const key = normalize(customer);
  if (!key) {
    throw new Error("customer name is required");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number");
  }

  const store = load();
  if (!store.customers[key]) {
    store.customers[key] = titleCase(customer);
  }

  const entry: Entry = {
    id: randomUUID(),
    customer: key,
    type,
    amount: round2(amount),
    note,
    at: at ?? new Date().toISOString(),
  };
  store.entries.push(entry);
  save(store);
  return entry;
}

export function balanceOf(
  customer: string,
): { balance: number; entries: Entry[]; displayName: string } | null {
  const key = normalize(customer);
  const store = load();
  if (!store.customers[key]) {
    return null;
  }
  const entries = store.entries.filter((e) => e.customer === key);
  const balance = round2(
    entries.reduce((sum, e) => sum + (e.type === "credit" ? e.amount : -e.amount), 0),
  );
  return { balance, entries, displayName: store.customers[key] };
}

export interface DueCustomer {
  customer: string;
  displayName: string;
  balance: number;
  lastActivity: string;
  daysSinceActivity: number;
}

export function listDues(minDaysOverdue = 0, now: Date = new Date()): DueCustomer[] {
  const store = load();
  const byCustomer = new Map<string, Entry[]>();
  for (const entry of store.entries) {
    const list = byCustomer.get(entry.customer) ?? [];
    list.push(entry);
    byCustomer.set(entry.customer, list);
  }

  const dues: DueCustomer[] = [];
  for (const [key, entries] of byCustomer) {
    const balance = round2(
      entries.reduce((sum, e) => sum + (e.type === "credit" ? e.amount : -e.amount), 0),
    );
    if (balance <= 0) continue;

    const lastActivity = entries.reduce((latest, e) => (e.at > latest ? e.at : latest), entries[0].at);
    const daysSinceActivity = Math.floor(
      (now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceActivity < minDaysOverdue) continue;

    dues.push({
      customer: key,
      displayName: store.customers[key],
      balance,
      lastActivity,
      daysSinceActivity,
    });
  }

  return dues.sort((a, b) => b.balance - a.balance);
}

export interface DaySummary {
  credit: number;
  payments: number;
  count: number;
  totalOutstanding: number;
}

export function summaryForDay(day?: string): DaySummary {
  const store = load();
  const targetDay = day ?? new Date().toISOString().slice(0, 10);
  const todays = store.entries.filter((e) => e.at.slice(0, 10) === targetDay);

  const credit = round2(todays.filter((e) => e.type === "credit").reduce((s, e) => s + e.amount, 0));
  const payments = round2(todays.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0));

  const byCustomer = new Map<string, Entry[]>();
  for (const entry of store.entries) {
    const list = byCustomer.get(entry.customer) ?? [];
    list.push(entry);
    byCustomer.set(entry.customer, list);
  }
  let totalOutstanding = 0;
  for (const entries of byCustomer.values()) {
    const balance = entries.reduce((sum, e) => sum + (e.type === "credit" ? e.amount : -e.amount), 0);
    if (balance > 0) totalOutstanding += balance;
  }

  return { credit, payments, count: todays.length, totalOutstanding: round2(totalOutstanding) };
}
