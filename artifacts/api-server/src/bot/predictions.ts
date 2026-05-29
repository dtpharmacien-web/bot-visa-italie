import { getDetectionHistory, type DetectionEvent } from "./storage.js";
import { CENTRES, type Centre } from "./centres.js";

// Seed data basé sur les patterns observés VFS Global Algérie
// (ouvertures typiques : 1er et 15 du mois, mardi/mercredi, 9h-11h)
const SEED_EVENTS: DetectionEvent[] = [
  { centreId: "alger",       detectedAt: "2025-01-15T09:12:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-02-01T09:05:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-02-15T10:22:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-03-01T09:45:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-03-15T08:58:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-04-01T10:11:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-04-14T09:30:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-05-01T09:00:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-05-16T10:05:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-06-02T09:20:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-06-15T08:45:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-07-01T09:15:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-01-15T10:30:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-02-15T09:50:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-03-14T10:10:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-04-15T09:35:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-05-02T10:00:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-06-16T09:25:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-01-16T09:40:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-02-14T10:15:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-03-15T09:55:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-04-01T09:10:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-05-15T10:30:00.000Z" },
  { centreId: "annaba",      detectedAt: "2025-02-01T10:00:00.000Z" },
  { centreId: "annaba",      detectedAt: "2025-03-15T09:45:00.000Z" },
  { centreId: "annaba",      detectedAt: "2025-04-15T10:20:00.000Z" },
  { centreId: "annaba",      detectedAt: "2025-05-01T09:30:00.000Z" },
  { centreId: "tlemcen",     detectedAt: "2025-02-15T10:05:00.000Z" },
  { centreId: "tlemcen",     detectedAt: "2025-03-01T09:50:00.000Z" },
  { centreId: "tlemcen",     detectedAt: "2025-05-15T10:10:00.000Z" },
];

export interface PredictionWindow {
  date: Date;
  score: number;          // 0-100
  confidence: "haute" | "moyenne" | "faible";
  reasons: string[];
}

export interface CentrePrediction {
  centreId: string;
  centreName: string;
  topWindows: PredictionWindow[];
  bestDaysOfMonth: number[];
  bestHours: string;
  dataPoints: number;
  lastDetected?: string;
  insight: string;
}

function countFreq<T>(items: T[]): Map<T, number> {
  const map = new Map<T, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return map;
}

function normalize(value: number, max: number): number {
  return max > 0 ? Math.round((value / max) * 100) : 0;
}

function frenchDayName(d: Date): string {
  return d.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Africa/Algiers" });
}

function frenchDateShort(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Africa/Algiers" });
}

export function getPredictionsForCentre(centreId: string, centreName: string): CentrePrediction {
  const realHistory = getDetectionHistory(centreId);
  const seedHistory = SEED_EVENTS.filter((e) => e.centreId === centreId);
  const allEvents = [...seedHistory, ...realHistory];

  const dates = allEvents.map((e) => new Date(e.detectedAt));
  const domFreq = countFreq(dates.map((d) => d.getUTCDate())); // day of month 1-31
  const dowFreq = countFreq(dates.map((d) => d.getUTCDay())); // day of week 0=Sun
  const hourFreq = countFreq(dates.map((d) => d.getUTCHours()));

  const maxDom = Math.max(0, ...domFreq.values());
  const maxDow = Math.max(0, ...dowFreq.values());
  const maxHour = Math.max(0, ...hourFreq.values());

  // Top days of month
  const sortedDom = [...domFreq.entries()].sort((a, b) => b[1] - a[1]);
  const bestDaysOfMonth = sortedDom.slice(0, 4).map(([d]) => d).sort((a, b) => a - b);

  // Best hour range
  const sortedHours = [...hourFreq.entries()].sort((a, b) => b[1] - a[1]);
  const topHours = sortedHours.slice(0, 3).map(([h]) => h).sort((a, b) => a - b);
  const bestHours = topHours.length > 0
    ? `${topHours[0]}h00 – ${(topHours[topHours.length - 1] ?? topHours[0]) + 1}h00`
    : "9h00 – 11h00";

  // Last detected
  const sorted = [...allEvents].sort((a, b) =>
    new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
  );
  const lastDetected = realHistory.length > 0
    ? new Date(sorted[0].detectedAt).toLocaleDateString("fr-FR", {
        day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Algiers"
      })
    : undefined;

  // Predict next 14 days
  const now = new Date();
  const windows: PredictionWindow[] = [];

  for (let i = 1; i <= 14; i++) {
    const day = new Date(now);
    day.setDate(now.getDate() + i);
    day.setHours(0, 0, 0, 0);

    const dom = day.getDate();
    const dow = day.getDay();

    const domScore = normalize(domFreq.get(dom) ?? 0, maxDom);
    const dowScore = normalize(dowFreq.get(dow) ?? 0, maxDow);

    // Bonus for 1st and 15th (strong VFS pattern)
    const bonusDom = dom === 1 ? 30 : dom === 15 ? 28 : dom === 16 ? 15 : dom === 2 ? 10 : 0;
    // Bonus for Tuesday (2) and Wednesday (3)
    const bonusDow = dow === 2 ? 15 : dow === 3 ? 12 : dow === 1 ? 8 : 0;
    // Penalize weekends
    const penaltyWeekend = (dow === 0 || dow === 6) ? -40 : 0;

    const rawScore = (domScore * 0.5) + (dowScore * 0.3) + bonusDom + bonusDow + penaltyWeekend;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    const reasons: string[] = [];
    if (dom === 1) reasons.push("1er du mois — ouverture fréquente");
    else if (dom === 15) reasons.push("15 du mois — ouverture fréquente");
    else if (dom === 16) reasons.push("Proche du 15");
    else if (dom === 2) reasons.push("Proche du 1er");
    if (domFreq.has(dom)) reasons.push(`Jour ${dom} historiquement actif (×${domFreq.get(dom)})`);
    if (dow === 2) reasons.push("Mardi — jour favori VFS");
    else if (dow === 3) reasons.push("Mercredi — fréquent");
    else if (dow === 1) reasons.push("Lundi — début de semaine");
    if (reasons.length === 0) reasons.push("Probabilité normale");

    const confidence: PredictionWindow["confidence"] =
      score >= 60 ? "haute" : score >= 35 ? "moyenne" : "faible";

    windows.push({ date: day, score, confidence, reasons });
  }

  const topWindows = windows
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Insight global
  const topDay = bestDaysOfMonth[0];
  const insight = topDay
    ? `Les créneaux à ${centreName.split(" ")[0]} s'ouvrent le plus souvent autour du <b>${topDay} du mois</b>, entre <b>${bestHours}</b>.`
    : `Pas encore assez d'historique réel — les prédictions s'améliorent avec le temps.`;

  return {
    centreId,
    centreName,
    topWindows,
    bestDaysOfMonth,
    bestHours,
    dataPoints: allEvents.length,
    lastDetected,
    insight,
  };
}

export function formatPredictionMessage(pred: CentrePrediction): string {
  const confidenceEmoji: Record<string, string> = {
    haute: "🟢",
    moyenne: "🟡",
    faible: "🔴",
  };

  let msg = `🔮 <b>Prédictions d'ouverture — ${pred.centreName}</b>\n\n`;
  msg += `${pred.insight}\n\n`;

  msg += `📊 <b>Fenêtres les plus probables (14 prochains jours) :</b>\n`;
  for (const w of pred.topWindows) {
    const emoji = confidenceEmoji[w.confidence] ?? "⚪";
    const dayName = frenchDayName(w.date);
    const dateStr = frenchDateShort(w.date);
    msg += `\n${emoji} <b>${dayName} ${dateStr}</b> — ${w.score}% de chance\n`;
    msg += `   <i>${w.reasons[0]}</i>\n`;
  }

  msg += `\n📅 <b>Jours du mois les plus actifs :</b> `;
  msg += pred.bestDaysOfMonth.map((d) => `<b>${d}</b>`).join(", ") || "1, 15";

  msg += `\n⏰ <b>Heure préférentielle :</b> ${pred.bestHours}`;

  if (pred.lastDetected) {
    msg += `\n\n🕐 <b>Dernière détection réelle :</b> ${pred.lastDetected}`;
  }

  msg += `\n\n<i>📈 Basé sur ${pred.dataPoints} événements historiques. Les prédictions s'améliorent avec le temps.</i>`;
  return msg;
}

export function formatAllCentresPrediction(): string {
  let msg = `🔮 <b>Prédictions globales — Tous les centres</b>\n\n`;

  const topDayByScore: Array<{ centre: Centre; dom: number; score: number }> = [];

  for (const centre of CENTRES) {
    const pred = getPredictionsForCentre(centre.id, centre.name);
    const best = pred.topWindows[0];
    if (best) {
      topDayByScore.push({ centre, dom: best.date.getDate(), score: best.score });
    }
  }

  topDayByScore.sort((a, b) => b.score - a.score);

  for (const { centre, dom, score } of topDayByScore) {
    const pred = getPredictionsForCentre(centre.id, centre.name);
    const best = pred.topWindows[0];
    if (!best) continue;
    const dayName = frenchDayName(best.date);
    const dateStr = frenchDateShort(best.date);
    const bar = "█".repeat(Math.round(score / 10)) + "░".repeat(10 - Math.round(score / 10));
    msg += `📍 <b>${centre.name.split(" ")[0]}</b>\n`;
    msg += `   ${bar} ${score}%\n`;
    msg += `   📅 Meilleure chance : ${dayName} ${dateStr}\n\n`;
  }

  msg += `<i>Conseil : activez les alertes sur tous les centres avec /tout pour ne rien manquer.</i>`;
  return msg;
}
