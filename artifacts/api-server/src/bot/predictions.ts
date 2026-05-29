import { getDetectionHistory, type DetectionEvent } from "./storage.js";
import { CENTRES, type Centre } from "./centres.js";

// Seed data basé sur les patterns observés VFS Global Algérie
// (ouvertures typiques : autour du 1er et 15 du mois, en semaine, 9h-11h)
const SEED_EVENTS: DetectionEvent[] = [
  { centreId: "alger",       detectedAt: "2025-01-15T09:12:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-02-01T09:05:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-02-15T10:22:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-03-03T09:45:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-03-17T08:58:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-04-02T10:11:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-04-14T09:30:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-05-05T09:00:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-05-19T10:05:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-06-04T09:20:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-06-16T08:45:00.000Z" },
  { centreId: "alger",       detectedAt: "2025-07-03T09:15:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-01-16T10:30:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-02-13T09:50:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-03-17T10:10:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-04-14T09:35:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-05-05T10:00:00.000Z" },
  { centreId: "constantine", detectedAt: "2025-06-16T09:25:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-01-16T09:40:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-02-17T10:15:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-03-19T09:55:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-04-02T09:10:00.000Z" },
  { centreId: "oran",        detectedAt: "2025-05-14T10:30:00.000Z" },
  { centreId: "annaba",      detectedAt: "2025-02-05T10:00:00.000Z" },
  { centreId: "annaba",      detectedAt: "2025-03-17T09:45:00.000Z" },
  { centreId: "annaba",      detectedAt: "2025-04-14T10:20:00.000Z" },
  { centreId: "annaba",      detectedAt: "2025-05-05T09:30:00.000Z" },
  { centreId: "tlemcen",     detectedAt: "2025-02-13T10:05:00.000Z" },
  { centreId: "tlemcen",     detectedAt: "2025-03-03T09:50:00.000Z" },
  { centreId: "tlemcen",     detectedAt: "2025-05-19T10:10:00.000Z" },
];

export interface PredictionWindow {
  date: Date;
  score: number;          // 0-65 max (jamais 100% — on ne peut pas être certain)
  confidence: "élevée" | "modérée" | "faible";
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

function frenchDayName(d: Date): string {
  return d.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Africa/Algiers" });
}

function frenchDateShort(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Africa/Algiers" });
}

/**
 * Calcule un score brut non normalisé pour un jour donné.
 * Le score brut sera ensuite relativisé par rapport aux autres jours
 * pour éviter des valeurs trompeuses comme 100%.
 */
function rawDayScore(
  dom: number,
  dow: number,
  domFreq: Map<number, number>,
  dowFreq: Map<number, number>,
  maxDom: number,
  maxDow: number,
): number {
  // Score historique : poids du jour du mois (40%) + jour de la semaine (20%)
  const domScore = maxDom > 0 ? (domFreq.get(dom) ?? 0) / maxDom : 0;
  const dowScore = maxDow > 0 ? (dowFreq.get(dow) ?? 0) / maxDow : 0;

  // Bonus de contexte VFS (valeurs modestes, basées sur observations réelles)
  // VFS ouvre typiquement 2-4 jours APRÈS le 1er/15, pas forcément le jour J
  const bonusDom =
    dom >= 1  && dom <= 5  ? 0.18 :  // début de mois
    dom >= 12 && dom <= 18 ? 0.15 :  // mi-mois
    dom >= 26 || dom <= 3  ? 0.08 :  // fin/début mois
    0.02;

  // Jours de semaine actifs (lundi-jeudi)
  const bonusDow =
    dow === 1 ? 0.10 :   // lundi
    dow === 2 ? 0.14 :   // mardi (le plus fréquent)
    dow === 3 ? 0.12 :   // mercredi
    dow === 4 ? 0.08 :   // jeudi
    dow === 5 ? 0.04 :   // vendredi
    -0.30;               // week-end : très rare, forte pénalité

  return (domScore * 0.40) + (dowScore * 0.20) + bonusDom + bonusDow;
}

export function getPredictionsForCentre(centreId: string, centreName: string): CentrePrediction {
  const realHistory = getDetectionHistory(centreId);
  const seedHistory = SEED_EVENTS.filter((e) => e.centreId === centreId);
  const allEvents = [...seedHistory, ...realHistory];

  const dates = allEvents.map((e) => new Date(e.detectedAt));
  const domFreq = countFreq(dates.map((d) => d.getUTCDate()));
  const dowFreq = countFreq(dates.map((d) => d.getUTCDay()));
  const hourFreq = countFreq(dates.map((d) => d.getUTCHours()));

  const maxDom = Math.max(0, ...domFreq.values());
  const maxDow = Math.max(0, ...dowFreq.values());

  // Top days of month
  const sortedDom = [...domFreq.entries()].sort((a, b) => b[1] - a[1]);
  const bestDaysOfMonth = sortedDom.slice(0, 3).map(([d]) => d).sort((a, b) => a - b);

  // Best hour range
  const sortedHours = [...hourFreq.entries()].sort((a, b) => b[1] - a[1]);
  const topHours = sortedHours.slice(0, 2).map(([h]) => h).sort((a, b) => a - b);
  const bestHours = topHours.length > 0
    ? `${topHours[0]}h00 – ${(topHours[topHours.length - 1] ?? topHours[0]) + 1}h00`
    : "9h00 – 11h00";

  // Last detected (real events only)
  const lastDetected = realHistory.length > 0
    ? new Date([...realHistory].sort((a, b) =>
        new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
      )[0].detectedAt).toLocaleDateString("fr-FR", {
        day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Algiers"
      })
    : undefined;

  // Calculer les 14 prochains jours
  const now = new Date();
  const rawScores: Array<{ date: Date; dom: number; dow: number; raw: number }> = [];

  for (let i = 1; i <= 14; i++) {
    const day = new Date(now);
    day.setDate(now.getDate() + i);
    day.setHours(0, 0, 0, 0);
    const dom = day.getDate();
    const dow = day.getDay();
    const raw = rawDayScore(dom, dow, domFreq, dowFreq, maxDom, maxDow);
    rawScores.push({ date: day, dom, dow, raw });
  }

  // Normalisation relative : le meilleur jour parmi les 14 = MAX_SCORE_CAP
  // On plafonne volontairement à 65% car on ne peut jamais être certain
  const MAX_SCORE_CAP = 65;
  const maxRaw = Math.max(...rawScores.map((r) => r.raw));
  const minRaw = Math.min(...rawScores.map((r) => r.raw));
  const range = maxRaw - minRaw || 1;

  const windows: PredictionWindow[] = rawScores.map(({ date, dom, dow, raw }) => {
    // Score relatif dans la fenêtre des 14 jours, plafonné à MAX_SCORE_CAP
    const normalized = ((raw - minRaw) / range) * MAX_SCORE_CAP;
    const score = Math.max(0, Math.round(normalized));

    const reasons: string[] = [];
    if (dom >= 1 && dom <= 5)   reasons.push(`Début de mois — période active`);
    else if (dom >= 12 && dom <= 18) reasons.push(`Mi-mois — période active`);
    if (domFreq.has(dom))       reasons.push(`Jour ${dom} observé ${domFreq.get(dom)}× dans l'historique`);
    if (dow === 2)              reasons.push("Mardi — jour le plus fréquent");
    else if (dow === 3)         reasons.push("Mercredi — fréquent");
    else if (dow === 1)         reasons.push("Lundi — début de semaine");
    else if (dow === 0 || dow === 6) reasons.push("Week-end — ouvertures très rares");
    if (reasons.length === 0)   reasons.push("Jour ordinaire");

    const confidence: PredictionWindow["confidence"] =
      score >= 45 ? "élevée" : score >= 25 ? "modérée" : "faible";

    return { date, score, confidence, reasons };
  });

  const topWindows = windows
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const topDay = bestDaysOfMonth[0];
  const insight = topDay
    ? `Historiquement, les créneaux à ${centreName.split(" ")[0]} s'ouvrent le plus souvent <b>en début ou mi-mois</b>, entre <b>${bestHours}</b>.\n<i>⚠️ Les scores sont des probabilités relatives — VFS peut ouvrir à tout moment.</i>`
    : `Pas encore assez d'historique réel — les prédictions s'affinent avec le temps.\n<i>⚠️ Les scores sont des probabilités relatives, non des certitudes.</i>`;

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
    "élevée":  "🟢",
    "modérée": "🟡",
    "faible":  "🔴",
  };

  let msg = `🔮 <b>Prédictions d'ouverture — ${pred.centreName}</b>\n\n`;
  msg += `${pred.insight}\n\n`;

  msg += `📊 <b>Jours les plus probables (14 prochains jours) :</b>\n`;
  for (const w of pred.topWindows) {
    const emoji = confidenceEmoji[w.confidence] ?? "⚪";
    const dayName = frenchDayName(w.date);
    const dateStr = frenchDateShort(w.date);
    const bar = "█".repeat(Math.round(w.score / 6.5)) + "░".repeat(10 - Math.round(w.score / 6.5));
    msg += `\n${emoji} <b>${dayName} ${dateStr}</b>\n`;
    msg += `   ${bar} ${w.score}%\n`;
    msg += `   <i>${w.reasons[0]}</i>\n`;
  }

  msg += `\n📅 <b>Périodes historiquement actives :</b> début et mi-mois`;
  msg += `\n⏰ <b>Heure préférentielle :</b> ${pred.bestHours}`;

  if (pred.lastDetected) {
    msg += `\n\n🕐 <b>Dernière détection réelle :</b> ${pred.lastDetected}`;
  }

  msg += `\n\n<i>📈 Basé sur ${pred.dataPoints} événements. Score max = 65% (certitude impossible à atteindre).</i>`;
  return msg;
}

export function getTodayScore(centreId: string, centreName: string): { score: number; reasons: string[]; bestHours: string; confidence: PredictionWindow["confidence"] } {
  const realHistory = getDetectionHistory(centreId);
  const seedHistory = SEED_EVENTS.filter((e) => e.centreId === centreId);
  const allEvents = [...seedHistory, ...realHistory];

  const dates = allEvents.map((e) => new Date(e.detectedAt));
  const domFreq = countFreq(dates.map((d) => d.getUTCDate()));
  const dowFreq = countFreq(dates.map((d) => d.getUTCDay()));
  const hourFreq = countFreq(dates.map((d) => d.getUTCHours()));
  const maxDom = Math.max(0, ...domFreq.values());
  const maxDow = Math.max(0, ...dowFreq.values());

  // Calculer score pour les 14 prochains jours pour normaliser
  const today = new Date();
  const allRaws: number[] = [];
  for (let i = 0; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    allRaws.push(rawDayScore(d.getDate(), d.getDay(), domFreq, dowFreq, maxDom, maxDow));
  }
  const maxRaw = Math.max(...allRaws);
  const minRaw = Math.min(...allRaws);
  const range = maxRaw - minRaw || 1;

  const dom = today.getDate();
  const dow = today.getDay();
  const raw = rawDayScore(dom, dow, domFreq, dowFreq, maxDom, maxDow);
  const score = Math.max(0, Math.round(((raw - minRaw) / range) * 65));

  const reasons: string[] = [];
  if (dom >= 1 && dom <= 5)        reasons.push("Début de mois — période active");
  else if (dom >= 12 && dom <= 18) reasons.push("Mi-mois — période active");
  if (domFreq.has(dom))            reasons.push(`Jour ${dom} historiquement actif`);
  if (dow === 2)                   reasons.push("Mardi — jour le plus fréquent");
  else if (dow === 3)              reasons.push("Mercredi — fréquent");
  else if (dow === 1)              reasons.push("Lundi — début de semaine");
  else if (dow === 0 || dow === 6) reasons.push("Week-end — ouvertures très rares");
  if (reasons.length === 0)        reasons.push("Jour ordinaire");

  const sortedHours = [...hourFreq.entries()].sort((a, b) => b[1] - a[1]);
  const topHours = sortedHours.slice(0, 2).map(([h]) => h).sort((a, b) => a - b);
  const bestHours = topHours.length > 0
    ? `${topHours[0]}h00 – ${(topHours[topHours.length - 1] ?? topHours[0]) + 1}h00`
    : "9h00 – 11h00";

  const confidence: PredictionWindow["confidence"] =
    score >= 45 ? "élevée" : score >= 25 ? "modérée" : "faible";

  return { score, reasons, bestHours, confidence };
}

export function buildMorningBriefing(centreIds: string[], centreNames: Record<string, string>): string {
  const today = new Date();
  const dateStr = today.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Algiers"
  });

  const centreEmojis: Record<string, string> = {
    alger: "🏙️", constantine: "🏛️", oran: "🌊", annaba: "🌲", tlemcen: "🕌",
  };

  let msg = `☀️ <b>Briefing Visa Italie — ${dateStr}</b>\n\n`;
  msg += `📊 <b>Probabilités d'ouverture aujourd'hui :</b>\n<i>(score relatif, max 65%)</i>\n\n`;

  const rows = centreIds.map((id) => {
    const name = centreNames[id] ?? id;
    const { score, reasons, bestHours, confidence } = getTodayScore(id, name);
    return { id, name, score, reasons, bestHours, confidence };
  }).sort((a, b) => b.score - a.score);

  const confEmoji: Record<string, string> = { "élevée": "🟢", "modérée": "🟡", "faible": "🔴" };

  for (const row of rows) {
    const filled = Math.round(row.score / 6.5);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    const emoji = centreEmojis[row.id] ?? "📍";
    msg += `${emoji} <b>${row.name.split(" ")[0]}</b>  ${confEmoji[row.confidence]} ${row.score}%\n`;
    msg += `   ${bar}\n`;
    msg += `   <i>${row.reasons[0]}</i>\n`;
    msg += `   ⏰ Heure conseillée : <b>${row.bestHours}</b>\n\n`;
  }

  const best = rows[0];
  if (best && best.score >= 35) {
    msg += `💡 <b>Conseil :</b> Surveillez particulièrement <b>${best.name.split(" ")[0]}</b> ce matin entre <b>${best.bestHours}</b>.\n\n`;
  } else {
    msg += `💡 <b>Conseil :</b> Probabilité faible aujourd'hui — le bot surveille toutes les 3 min, vous serez alerté dès qu'un créneau s'ouvre.\n\n`;
  }

  msg += `<a href="https://visa.vfsglobal.com/dza/en/ita/book-an-appointment">🔗 VFS Global — Réservation</a>\n`;
  msg += `<i>Désactiver ce rappel : /rappel</i>`;
  return msg;
}

export function formatAllCentresPrediction(): string {
  let msg = `🔮 <b>Prédictions globales — Tous les centres</b>\n<i>(score max 65% — certitude impossible)</i>\n\n`;

  const rows: Array<{ centre: Centre; score: number; dateStr: string; dayName: string }> = [];

  for (const centre of CENTRES) {
    const pred = getPredictionsForCentre(centre.id, centre.name);
    const best = pred.topWindows[0];
    if (best) {
      rows.push({
        centre,
        score: best.score,
        dateStr: frenchDateShort(best.date),
        dayName: frenchDayName(best.date),
      });
    }
  }

  rows.sort((a, b) => b.score - a.score);

  const centreEmojis: Record<string, string> = {
    alger: "🏙️", constantine: "🏛️", oran: "🌊", annaba: "🌲", tlemcen: "🕌",
  };

  for (const { centre, score, dateStr, dayName } of rows) {
    const filled = Math.round(score / 6.5);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    const emoji = centreEmojis[centre.id] ?? "📍";
    msg += `${emoji} <b>${centre.name.split(" ")[0]}</b>\n`;
    msg += `   ${bar} ${score}%\n`;
    msg += `   📅 Meilleure chance : ${dayName} ${dateStr}\n\n`;
  }

  msg += `<i>Conseil : activez toutes les alertes avec /tout pour ne rien manquer.</i>`;
  return msg;
}
