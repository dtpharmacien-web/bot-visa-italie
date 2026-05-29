import { InlineKeyboard } from "grammy";
import { CENTRES } from "./centres.js";

export function centreSelectionKeyboard(action: "suivre" | "verifier" | "arreter" | "prediction"): InlineKeyboard {
  const kb = new InlineKeyboard();
  const emoji: Record<string, string> = {
    alger: "🏙️",
    constantine: "🏛️",
    oran: "🌊",
    annaba: "🌲",
    tlemcen: "🕌",
  };
  CENTRES.forEach((c, i) => {
    kb.text(`${emoji[c.id] ?? "📍"} ${c.name}`, `${action}:${c.id}`);
    if ((i + 1) % 2 === 0) kb.row();
  });
  return kb;
}

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔔 S'abonner à un centre", "menu:suivre").row()
    .text("🌍 Tout suivre d'un coup", "suivre:tous").row()
    .text("🔍 Vérifier maintenant", "menu:verifier").row()
    .text("🔮 Prédictions d'ouverture", "menu:prediction").row()
    .text("☀️ Rappel matinal", "menu:rappel")
    .text("📋 Mes abonnements", "menu:mesabonnements").row()
    .text("📍 Centres", "menu:centres")
    .text("📊 Stats", "menu:stats");
}

export function subscriptionKeyboard(subscribedIds: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  const emoji: Record<string, string> = {
    alger: "🏙️",
    constantine: "🏛️",
    oran: "🌊",
    annaba: "🌲",
    tlemcen: "🕌",
  };
  CENTRES.forEach((c, i) => {
    const isSubscribed = subscribedIds.includes(c.id);
    const label = isSubscribed
      ? `✅ ${c.name}`
      : `${emoji[c.id] ?? "📍"} ${c.name}`;
    const callbackData = isSubscribed ? `arreter:${c.id}` : `suivre:${c.id}`;
    kb.text(label, callbackData);
    if ((i + 1) % 2 === 0) kb.row();
  });
  kb.row().text("🔔 Tout suivre", "suivre:tous");
  return kb;
}

export function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("◀️ Menu principal", "menu:accueil");
}
