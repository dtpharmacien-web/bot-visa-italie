import { Bot, InlineKeyboard } from "grammy";
import { logger } from "../lib/logger.js";
import { CENTRES, findCentre, getCentreById } from "./centres.js";
import {
  addSubscription,
  removeSubscription,
  getUserSubscriptions,
  getStats,
  toggleDailyReminder,
} from "./storage.js";
import { checkCentreAvailability } from "./scraper.js";
import { startScheduler } from "./scheduler.js";
import {
  centreSelectionKeyboard,
  mainMenuKeyboard,
  subscriptionKeyboard,
  backToMenuKeyboard,
} from "./keyboards.js";
import {
  getPredictionsForCentre,
  formatPredictionMessage,
  formatAllCentresPrediction,
} from "./predictions.js";

// ─── Messages ──────────────────────────────────────────────────────────────

function welcomeMessage(firstName?: string): string {
  const name = firstName ? ` ${firstName}` : "";
  return (
    `🇮🇹 <b>Bot Alertes Visa Italie — VFS Global Algérie</b>\n\n` +
    `Bonjour${name} ! Je surveille les créneaux de rendez-vous visa Italie sur VFS Global et je vous alerte dès qu'une place est disponible.\n\n` +
    `<b>Que voulez-vous faire ?</b>`
  );
}

function centresMessage(): string {
  const emojis: Record<string, string> = {
    alger: "🏙️", constantine: "🏛️", oran: "🌊", annaba: "🌲", tlemcen: "🕌",
  };
  return (
    `📍 <b>Centres VFS Global disponibles en Algérie :</b>\n\n` +
    CENTRES.map((c) => `${emojis[c.id] ?? "📍"} <b>${c.name}</b>`).join("\n") +
    `\n\n<i>Sélectionnez un centre ci-dessous :</i>`
  );
}

function statsMessage(): string {
  const s = getStats();
  const lines = Object.entries(s.byCentre)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `  • ${name} : <b>${count}</b> abonné(s)`)
    .join("\n");

  return (
    `📊 <b>Statistiques du bot</b>\n\n` +
    `👥 Utilisateurs actifs : <b>${s.uniqueUsers}</b>\n` +
    `📋 Abonnements totaux : <b>${s.totalSubscriptions}</b>\n` +
    `🚨 Alertes envoyées : <b>${s.totalAlertsSent}</b>\n` +
    `🔍 Vérifications effectuées : <b>${s.totalChecks}</b>\n` +
    `📈 Créneaux détectés (historique) : <b>${s.totalDetections}</b>\n\n` +
    (lines ? `<b>Par centre :</b>\n${lines}` : `<i>Aucun abonnement actif pour l'instant.</i>`)
  );
}

async function verifyCentre(bot: Bot, chatId: number, messageId: number, centreId: string) {
  const centre = getCentreById(centreId);
  if (!centre) return;

  await bot.api.editMessageText(
    chatId, messageId,
    `🔍 Vérification en cours pour <b>${centre.name}</b>...\n<i>Connexion à VFS Global...</i>`,
    { parse_mode: "HTML" }
  );

  try {
    const result = await checkCentreAvailability(centre);
    const icon = result.available ? "✅" : "❌";
    const status = result.available ? "DISPONIBLE" : "Indisponible";
    const now = new Date().toLocaleString("fr-FR", {
      timeZone: "Africa/Algiers",
      day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit",
    });

    let msg = `${icon} <b>${centre.name}</b> — ${status}\n\n`;

    if (result.available && result.slots.length > 0) {
      msg += `📅 <b>Créneaux disponibles :</b>\n`;
      for (const slot of result.slots.slice(0, 5)) msg += `  • ${slot}\n`;
      msg += `\n<a href="https://visa.vfsglobal.com/dza/en/ita/book-an-appointment">🔗 Réserver maintenant</a>\n`;
    } else if (result.available) {
      msg += `<a href="https://visa.vfsglobal.com/dza/en/ita/book-an-appointment">🔗 Réserver maintenant</a>\n`;
    } else {
      msg += `<i>${result.rawMessage}</i>\n`;
    }

    msg += `\n<i>Vérifié le ${now}</i>`;

    const kb = new InlineKeyboard()
      .url("🔗 Réserver sur VFS", "https://visa.vfsglobal.com/dza/en/ita/book-an-appointment").row()
      .text("🔄 Revérifier", `verifier:${centreId}`).row()
      .text("◀️ Retour", "menu:verifier");

    await bot.api.editMessageText(chatId, messageId, msg, {
      parse_mode: "HTML",
      reply_markup: kb,
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    logger.error({ err }, "Error checking availability on demand");
    await bot.api.editMessageText(
      chatId, messageId,
      "⚠️ Erreur lors de la vérification. Réessayez dans quelques instants.",
      { reply_markup: backToMenuKeyboard() }
    );
  }
}

// ─── Bot factory ───────────────────────────────────────────────────────────

export function createBot(): Bot {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");

  const bot = new Bot(token);

  // ── Commandes texte ─────────────────────────────────────────────────────

  bot.command(["start", "aide", "help"], async (ctx) => {
    await ctx.reply(welcomeMessage(ctx.from?.first_name), {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.command("centres", async (ctx) => {
    await ctx.reply(centresMessage(), {
      parse_mode: "HTML",
      reply_markup: centreSelectionKeyboard("suivre"),
    });
  });

  bot.command("suivre", async (ctx) => {
    const args = ctx.message?.text.split(" ").slice(1).join(" ").trim();
    if (!args) {
      return ctx.reply("🔔 <b>S'abonner à un centre</b>\n\nChoisissez un centre :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("suivre"),
      });
    }
    const centre = findCentre(args);
    if (!centre) {
      return ctx.reply(
        `❌ Centre "<b>${args}</b>" non trouvé.\n\nChoisissez un centre :`,
        { parse_mode: "HTML", reply_markup: centreSelectionKeyboard("suivre") }
      );
    }
    const added = addSubscription(ctx.chat.id, centre.id, centre.name);
    return ctx.reply(
      added
        ? `✅ <b>Abonné — ${centre.name}</b>\n\nVous recevrez une alerte dès qu'un créneau est disponible.\n<i>Vérification toutes les 3 minutes.</i>`
        : `ℹ️ Vous êtes déjà abonné à <b>${centre.name}</b>.`,
      { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
    );
  });

  bot.command("arreter", async (ctx) => {
    const args = ctx.message?.text.split(" ").slice(1).join(" ").trim();
    if (!args) {
      return ctx.reply("🔕 <b>Arrêter un abonnement</b>\n\nChoisissez un centre :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("arreter"),
      });
    }
    const centre = findCentre(args);
    if (!centre) {
      return ctx.reply(
        `❌ Centre non trouvé. Choisissez parmi :`,
        { parse_mode: "HTML", reply_markup: centreSelectionKeyboard("arreter") }
      );
    }
    const removed = removeSubscription(ctx.chat.id, centre.id);
    return ctx.reply(
      removed
        ? `🔕 <b>Abonnement annulé — ${centre.name}</b>\n\nVous ne recevrez plus d'alertes pour ce centre.`
        : `ℹ️ Vous n'êtes pas abonné à <b>${centre.name}</b>.`,
      { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
    );
  });

  bot.command("mesabonnements", async (ctx) => {
    const subs = getUserSubscriptions(ctx.chat.id);
    const subscribedIds = subs.map((s) => s.centreId);
    if (subs.length === 0) {
      return ctx.reply(
        "📭 <b>Aucun abonnement actif</b>\n\nChoisissez un centre pour commencer :",
        { parse_mode: "HTML", reply_markup: subscriptionKeyboard([]) }
      );
    }
    const list = subs.map((s) => `✅ <b>${s.centreName}</b>`).join("\n");
    return ctx.reply(
      `📋 <b>Vos abonnements actifs :</b>\n\n${list}\n\n<i>Appuyez sur un centre coché pour vous désabonner.</i>`,
      { parse_mode: "HTML", reply_markup: subscriptionKeyboard(subscribedIds) }
    );
  });

  bot.command("verifier", async (ctx) => {
    const args = ctx.message?.text.split(" ").slice(1).join(" ").trim();
    if (!args) {
      return ctx.reply("🔍 <b>Vérifier maintenant</b>\n\nChoisissez un centre :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("verifier"),
      });
    }
    const centre = findCentre(args);
    if (!centre) {
      return ctx.reply("❌ Centre non trouvé. Choisissez parmi :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("verifier"),
      });
    }
    const loadingMsg = await ctx.reply(`🔍 Vérification en cours pour <b>${centre.name}</b>...`, { parse_mode: "HTML" });
    await verifyCentre(bot, ctx.chat.id, loadingMsg.message_id, centre.id);
    return;
  });

  bot.command("prediction", async (ctx) => {
    const args = ctx.message?.text.split(" ").slice(1).join(" ").trim();
    if (!args) {
      return ctx.reply("🔮 <b>Prédictions d'ouverture</b>\n\nChoisissez un centre :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("prediction"),
      });
    }
    const centre = findCentre(args);
    if (!centre) {
      return ctx.reply("❌ Centre non trouvé. Choisissez parmi :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("prediction"),
      });
    }
    const pred = getPredictionsForCentre(centre.id, centre.name);
    await ctx.reply(formatPredictionMessage(pred), {
      parse_mode: "HTML",
      reply_markup: backToMenuKeyboard(),
      link_preview_options: { is_disabled: true },
    });
    return;
  });

  bot.command("stats", async (ctx) => {
    await ctx.reply(statsMessage(), {
      parse_mode: "HTML",
      reply_markup: backToMenuKeyboard(),
    });
  });

  bot.command("rappel", async (ctx) => {
    const chatId = ctx.chat.id;
    const subs = getUserSubscriptions(chatId);
    if (subs.length === 0) {
      return ctx.reply(
        "📭 <b>Aucun abonnement actif</b>\n\nAbonnez-vous à un centre d'abord pour recevoir le rappel matinal.",
        { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
      );
    }
    const isNowEnabled = toggleDailyReminder(chatId);
    if (isNowEnabled) {
      return ctx.reply(
        `☀️ <b>Rappel matinal activé !</b>\n\n` +
        `Chaque matin à <b>8h00</b>, vous recevrez un briefing avec :\n` +
        `  • Les probabilités d'ouverture du jour pour vos centres\n` +
        `  • L'heure conseillée pour surveiller\n` +
        `  • Un conseil personnalisé\n\n` +
        `<i>Tapez /rappel à nouveau pour le désactiver.</i>`,
        { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
      );
    } else {
      return ctx.reply(
        `🔕 <b>Rappel matinal désactivé</b>\n\n` +
        `Vous ne recevrez plus le briefing du matin.\n` +
        `<i>Tapez /rappel à nouveau pour le réactiver.</i>`,
        { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
      );
    }
  });

  bot.command("tout", async (ctx) => {
    const chatId = ctx.chat.id;
    let count = 0;
    const results: string[] = [];
    for (const centre of CENTRES) {
      const added = addSubscription(chatId, centre.id, centre.name);
      if (added) { count++; results.push(`✅ ${centre.name}`); }
      else results.push(`ℹ️ ${centre.name} (déjà abonné)`);
    }
    await ctx.reply(
      `🔔 <b>Abonnement à tous les centres</b>\n\n${results.join("\n")}\n\n` +
      (count > 0
        ? `<b>${count} nouveau(x) abonnement(s) activé(s) !</b>\n<i>Vous serez alerté dès qu'un créneau s'ouvre dans n'importe quel centre.</i>`
        : `<i>Vous étiez déjà abonné à tous les centres.</i>`),
      { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
    );
  });

  // ── Callbacks boutons inline ─────────────────────────────────────────────

  bot.callbackQuery(/^menu:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];

    if (action === "accueil") {
      await ctx.editMessageText(welcomeMessage(ctx.from?.first_name), {
        parse_mode: "HTML",
        reply_markup: mainMenuKeyboard(),
      });
    } else if (action === "suivre") {
      await ctx.editMessageText("🔔 <b>S'abonner à un centre</b>\n\nChoisissez un centre :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("suivre"),
      });
    } else if (action === "arreter") {
      await ctx.editMessageText("🔕 <b>Arrêter un abonnement</b>\n\nChoisissez un centre :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("arreter"),
      });
    } else if (action === "verifier") {
      await ctx.editMessageText("🔍 <b>Vérifier maintenant</b>\n\nChoisissez un centre :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("verifier"),
      });
    } else if (action === "prediction") {
      await ctx.editMessageText("🔮 <b>Prédictions d'ouverture</b>\n\nChoisissez un centre ou voir tout :", {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("prediction")
          .row()
          .text("🌍 Tous les centres", "prediction:tous"),
      });
    } else if (action === "mesabonnements") {
      const subs = getUserSubscriptions(ctx.from.id);
      const subscribedIds = subs.map((s) => s.centreId);
      if (subs.length === 0) {
        await ctx.editMessageText(
          "📭 <b>Aucun abonnement actif</b>\n\nChoisissez un centre pour commencer :",
          { parse_mode: "HTML", reply_markup: subscriptionKeyboard([]) }
        );
      } else {
        const list = subs.map((s) => `✅ <b>${s.centreName}</b>`).join("\n");
        await ctx.editMessageText(
          `📋 <b>Vos abonnements actifs :</b>\n\n${list}\n\n<i>Appuyez sur un centre coché pour vous désabonner.</i>`,
          { parse_mode: "HTML", reply_markup: subscriptionKeyboard(subscribedIds) }
        );
      }
    } else if (action === "centres") {
      await ctx.editMessageText(centresMessage(), {
        parse_mode: "HTML",
        reply_markup: centreSelectionKeyboard("suivre"),
      });
    } else if (action === "stats") {
      await ctx.editMessageText(statsMessage(), {
        parse_mode: "HTML",
        reply_markup: backToMenuKeyboard(),
      });
    } else if (action === "rappel") {
      const subs = getUserSubscriptions(ctx.from.id);
      if (subs.length === 0) {
        await ctx.editMessageText(
          "📭 <b>Aucun abonnement actif</b>\n\nAbonnez-vous à un centre d'abord pour recevoir le rappel matinal.",
          { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
        );
        return;
      }
      const isNowEnabled = toggleDailyReminder(ctx.from.id);
      if (isNowEnabled) {
        await ctx.editMessageText(
          `☀️ <b>Rappel matinal activé !</b>\n\n` +
          `Chaque matin à <b>8h00</b>, vous recevrez un briefing avec :\n` +
          `  • Les probabilités d'ouverture du jour pour vos centres\n` +
          `  • L'heure conseillée pour surveiller\n` +
          `  • Un conseil personnalisé\n\n` +
          `<i>Appuyez sur ☀️ Rappel matinal à nouveau pour le désactiver.</i>`,
          { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
        );
      } else {
        await ctx.editMessageText(
          `🔕 <b>Rappel matinal désactivé</b>\n\nVous ne recevrez plus le briefing du matin.\n<i>Appuyez sur ☀️ Rappel matinal à nouveau pour le réactiver.</i>`,
          { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
        );
      }
    }
  });

  bot.callbackQuery(/^suivre:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const centreId = ctx.match[1];

    if (centreId === "tous") {
      const chatId = ctx.from.id;
      let count = 0;
      for (const centre of CENTRES) {
        if (addSubscription(chatId, centre.id, centre.name)) count++;
      }
      await ctx.editMessageText(
        `🔔 <b>Abonné à tous les centres !</b>\n\n` +
        CENTRES.map((c) => `✅ ${c.name}`).join("\n") +
        `\n\n<i>${count > 0 ? `${count} nouveau(x) abonnement(s) activé(s).` : "Vous étiez déjà abonné à tout."}</i>`,
        { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
      );
      return;
    }

    const centre = getCentreById(centreId);
    if (!centre) return;
    const added = addSubscription(ctx.from.id, centre.id, centre.name);
    await ctx.editMessageText(
      added
        ? `✅ <b>Abonné — ${centre.name}</b>\n\nVous recevrez une alerte dès qu'un créneau est disponible.\n<i>Vérification toutes les 3 minutes.</i>`
        : `ℹ️ Vous êtes déjà abonné à <b>${centre.name}</b>.`,
      { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
    );
  });

  bot.callbackQuery(/^arreter:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const centreId = ctx.match[1];
    const centre = getCentreById(centreId);
    if (!centre) return;
    const removed = removeSubscription(ctx.from.id, centreId);
    await ctx.editMessageText(
      removed
        ? `🔕 <b>Abonnement annulé — ${centre.name}</b>\n\nVous ne recevrez plus d'alertes pour ce centre.`
        : `ℹ️ Vous n'étiez pas abonné à <b>${centre.name}</b>.`,
      { parse_mode: "HTML", reply_markup: backToMenuKeyboard() }
    );
  });

  bot.callbackQuery(/^verifier:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("Vérification en cours...");
    const centreId = ctx.match[1];
    const centre = getCentreById(centreId);
    if (!centre) return;
    await ctx.editMessageText(
      `🔍 Vérification en cours pour <b>${centre.name}</b>...\n<i>Connexion à VFS Global...</i>`,
      { parse_mode: "HTML" }
    );
    await verifyCentre(bot, ctx.from.id, ctx.callbackQuery.message!.message_id, centreId);
  });

  bot.callbackQuery(/^prediction:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const centreId = ctx.match[1];

    if (centreId === "tous") {
      await ctx.editMessageText(formatAllCentresPrediction(), {
        parse_mode: "HTML",
        reply_markup: backToMenuKeyboard(),
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    const centre = getCentreById(centreId);
    if (!centre) return;
    const pred = getPredictionsForCentre(centre.id, centre.name);
    await ctx.editMessageText(formatPredictionMessage(pred), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🌍 Tous les centres", "prediction:tous").row()
        .text("◀️ Menu principal", "menu:accueil"),
      link_preview_options: { is_disabled: true },
    });
  });

  // ── Catch-all texte ──────────────────────────────────────────────────────

  bot.on("message:text", (ctx) =>
    ctx.reply(
      "Utilisez le menu ci-dessous ou tapez /aide pour voir toutes les commandes.",
      { reply_markup: mainMenuKeyboard() }
    )
  );

  bot.catch((err) => {
    logger.error({ err }, "Bot error");
  });

  return bot;
}

async function registerCommands(bot: Bot) {
  await bot.api.setMyCommands([
    { command: "start",          description: "🏠 Menu principal" },
    { command: "suivre",         description: "🔔 S'abonner aux alertes d'un centre" },
    { command: "arreter",        description: "🔕 Arrêter les alertes d'un centre" },
    { command: "tout",           description: "🌍 S'abonner à TOUS les centres" },
    { command: "mesabonnements", description: "📋 Voir mes abonnements actifs" },
    { command: "verifier",       description: "🔍 Vérifier la disponibilité maintenant" },
    { command: "prediction",     description: "🔮 Prédictions d'ouverture des créneaux" },
    { command: "rappel",         description: "☀️ Activer/désactiver le briefing matinal" },
    { command: "centres",        description: "📍 Liste des centres disponibles" },
    { command: "stats",          description: "📊 Statistiques du bot" },
    { command: "aide",           description: "❓ Aide et informations" },
  ]);
  logger.info("Bot commands registered in Telegram menu");
}

export async function startBot() {
  const bot = createBot();
  await registerCommands(bot).catch((err) =>
    logger.error({ err }, "Failed to register commands")
  );
  startScheduler(bot);

  process.once("SIGINT", () => bot.stop());
  process.once("SIGTERM", () => bot.stop());

  logger.info("Telegram bot starting (long polling)");
  await bot.start();
  logger.info("Telegram bot stopped");
}
