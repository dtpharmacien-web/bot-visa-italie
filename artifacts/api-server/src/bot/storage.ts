import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, "../../data/subscriptions.json");

export interface Subscription {
  chatId: number;
  centreId: string;
  centreName: string;
  subscribedAt: string;
}

interface StorageData {
  subscriptions: Subscription[];
  lastAvailability: Record<string, boolean>;
}

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load(): StorageData {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return { subscriptions: [], lastAvailability: {} };
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw) as StorageData;
  } catch {
    return { subscriptions: [], lastAvailability: {} };
  }
}

function save(data: StorageData) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function addSubscription(chatId: number, centreId: string, centreName: string): boolean {
  const data = load();
  const exists = data.subscriptions.some(
    (s) => s.chatId === chatId && s.centreId === centreId
  );
  if (exists) return false;
  data.subscriptions.push({ chatId, centreId, centreName, subscribedAt: new Date().toISOString() });
  save(data);
  return true;
}

export function removeSubscription(chatId: number, centreId: string): boolean {
  const data = load();
  const before = data.subscriptions.length;
  data.subscriptions = data.subscriptions.filter(
    (s) => !(s.chatId === chatId && s.centreId === centreId)
  );
  if (data.subscriptions.length === before) return false;
  save(data);
  return true;
}

export function getUserSubscriptions(chatId: number): Subscription[] {
  const data = load();
  return data.subscriptions.filter((s) => s.chatId === chatId);
}

export function getSubscribersByCentre(centreId: string): number[] {
  const data = load();
  return data.subscriptions
    .filter((s) => s.centreId === centreId)
    .map((s) => s.chatId);
}

export function getAllSubscribedCentres(): string[] {
  const data = load();
  return [...new Set(data.subscriptions.map((s) => s.centreId))];
}

export function getLastAvailability(centreId: string): boolean | undefined {
  const data = load();
  return data.lastAvailability[centreId];
}

export function setLastAvailability(centreId: string, available: boolean) {
  const data = load();
  data.lastAvailability[centreId] = available;
  save(data);
}
