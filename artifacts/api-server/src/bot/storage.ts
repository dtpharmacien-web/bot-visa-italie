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

export interface DetectionEvent {
  centreId: string;
  detectedAt: string;
  slots?: string[];
}

interface StorageData {
  subscriptions: Subscription[];
  lastAvailability: Record<string, boolean>;
  detectionHistory: DetectionEvent[];
  dailyReminderOptOut: number[];
  stats: {
    totalAlertsSent: number;
    totalChecks: number;
    totalRemindersSent: number;
  };
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
    return { subscriptions: [], lastAvailability: {}, detectionHistory: [], dailyReminderOptOut: [], stats: { totalAlertsSent: 0, totalChecks: 0, totalRemindersSent: 0 } };
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StorageData>;
    return {
      subscriptions: parsed.subscriptions ?? [],
      lastAvailability: parsed.lastAvailability ?? {},
      detectionHistory: parsed.detectionHistory ?? [],
      dailyReminderOptOut: parsed.dailyReminderOptOut ?? [],
      stats: { totalAlertsSent: 0, totalChecks: 0, totalRemindersSent: 0, ...parsed.stats },
    };
  } catch {
    return { subscriptions: [], lastAvailability: {}, detectionHistory: [], dailyReminderOptOut: [], stats: { totalAlertsSent: 0, totalChecks: 0, totalRemindersSent: 0 } };
  }
}

function save(data: StorageData) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function toggleDailyReminder(chatId: number): boolean {
  const data = load();
  const idx = data.dailyReminderOptOut.indexOf(chatId);
  if (idx === -1) {
    data.dailyReminderOptOut.push(chatId);
    save(data);
    return false; // now opted OUT
  } else {
    data.dailyReminderOptOut.splice(idx, 1);
    save(data);
    return true; // now opted IN
  }
}

export function hasDailyReminder(chatId: number): boolean {
  const data = load();
  return !data.dailyReminderOptOut.includes(chatId);
}

export function getAllDailyReminderRecipients(): number[] {
  const data = load();
  const allUsers = [...new Set(data.subscriptions.map((s) => s.chatId))];
  return allUsers.filter((id) => !data.dailyReminderOptOut.includes(id));
}

export function incrementRemindersSent(count = 1) {
  const data = load();
  data.stats.totalRemindersSent = (data.stats.totalRemindersSent ?? 0) + count;
  save(data);
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

export function recordDetection(centreId: string, slots: string[] = []) {
  const data = load();
  data.detectionHistory.push({
    centreId,
    detectedAt: new Date().toISOString(),
    slots,
  });
  // Garder max 500 événements pour éviter un fichier trop lourd
  if (data.detectionHistory.length > 500) {
    data.detectionHistory = data.detectionHistory.slice(-500);
  }
  save(data);
}

export function getDetectionHistory(centreId?: string): DetectionEvent[] {
  const data = load();
  if (!centreId) return data.detectionHistory;
  return data.detectionHistory.filter((e) => e.centreId === centreId);
}

export function incrementAlertsSent(count = 1) {
  const data = load();
  data.stats.totalAlertsSent += count;
  save(data);
}

export function incrementChecks() {
  const data = load();
  data.stats.totalChecks += 1;
  save(data);
}

export function getStats() {
  const data = load();
  const uniqueUsers = new Set(data.subscriptions.map((s) => s.chatId)).size;
  const byCentre: Record<string, number> = {};
  for (const sub of data.subscriptions) {
    byCentre[sub.centreName] = (byCentre[sub.centreName] ?? 0) + 1;
  }
  return {
    totalSubscriptions: data.subscriptions.length,
    uniqueUsers,
    byCentre,
    totalAlertsSent: data.stats.totalAlertsSent,
    totalChecks: data.stats.totalChecks,
    totalDetections: data.detectionHistory.length,
  };
}
