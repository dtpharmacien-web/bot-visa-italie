import { Bot } from "grammy";
import { logger } from "../lib/logger.js";
import { CENTRES, findCentre } from "./centres.js";
import {
  addSubscription,
  removeSubscription,
  getUserSubscriptions,
} from "./storage.js";
import { checkCentreAvailability } from "./scraper.js";
import { startScheduler } from "./scheduler.js";

const WELCOME_MSG =
  `🇮🇹 <b>Bot Alertes Visa Italie — VFS Global Algérie</b>\n\n` +
  `Bonjour ! Je surveille les créneaux de rendez-vous pour le visa Italie sur VFS Global et vous alerte dès qu'une place est disponible.\n\n` +
  `<b>Commandes disponibles :</b>\n` +
  `/centres — Voir tous les centres\n` +
  `/suivre &lt;centre&gt; — S'abonner aux alertes d'un centre\n` +
  `/arreter &lt;centre&gt; — Arrêter les alertes d'un centre\n` +
  `/mesabonnements — Voir mes abonnements actifs\n` +
  `/verifier &lt;centre&gt; — Vérifier maintenant la disponibilité\n` +
  `/aide — Afficher cette aide\n\n` +
  `<b>Exemple :</b>\n` +
  `<code>/suivre Alger</code> — Recevoir les alertes pour Alger\n` +
  `<code>/suivre Constantine</code> — Recevoir les alertes pour Constantine`;

const CENTRES_MSG =
  `📍 <b>Centres VFS Global disponibles en Algérie :</b>\n\n` +
  CENTRES.map((c) => `• <code>${c.name}</code>`).join("\n") +
  `\n\n<i>Utilisez <code>/suivre &lt;nom du centre&gt;</code> pour vous abonner.</i>`;

export function createBot(): Bot {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  const bot = new Bot(token);

  bot.command(["start", "aide", "help"], (ctx) =>
    ctx.reply(WELCOME_MSG, { parse_mode: "HTML" })
  );

  bot.command("centres", (ctx) =>
    ctx.reply(CENTRES_MSG, { parse_mode: "HTML" })
  );

  bot.command("suivre", async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!args) {
      return ctx.reply(
        "❌ Veuillez préciser un centre.\nExemple : <code>/suivre Alger</code>",
        { parse_mode: "HTML" }
      );
    }
    const centre = findCentre(args);
    if (!centre) {
      return ctx.reply(
        `❌ Centre "<b>${args}</b>" non trouvé.\n\nUtilisez /centres pour voir la liste des centres disponibles.`,
        { parse_mode: "HTML" }
      );
    }
    const chatId = ctx.chat.id;
    const added = addSubscription(chatId, centre.id, centre.name);
    if (!added) {
      return ctx.reply(
        `ℹ️ Vous êtes déjà abonné aux alertes pour <b>${centre.name}</b>.`,
        { parse_mode: "HTML" }
      );
    }
    return ctx.reply(
      `✅ <b>Abonnement activé — ${centre.name}</b>\n\n` +
        `Vous recevrez une notification dès qu'un créneau de rendez-vous visa Italie sera disponible à ${centre.name}.\n\n` +
        `<i>Vérification toutes les 3 minutes.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("arreter", async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!args) {
      return ctx.reply(
        "❌ Veuillez préciser un centre.\nExemple : <code>/arreter Alger</code>",
        { parse_mode: "HTML" }
      );
    }
    const centre = findCentre(args);
    if (!centre) {
      return ctx.reply(
        `❌ Centre "<b>${args}</b>" non trouvé.\n\nUtilisez /centres pour voir la liste des centres disponibles.`,
        { parse_mode: "HTML" }
      );
    }
    const chatId = ctx.chat.id;
    const removed = removeSubscription(chatId, centre.id);
    if (!removed) {
      return ctx.reply(
        `ℹ️ Vous n'êtes pas abonné aux alertes pour <b>${centre.name}</b>.`,
        { parse_mode: "HTML" }
      );
    }
    return ctx.reply(
      `🔕 <b>Abonnement annulé — ${centre.name}</b>\n\nVous ne recevrez plus d'alertes pour ce centre.`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("mesabonnements", async (ctx) => {
    const chatId = ctx.chat.id;
    const subs = getUserSubscriptions(chatId);
    if (subs.length === 0) {
      return ctx.reply(
        "📭 Vous n'avez aucun abonnement actif.\n\nUtilisez <code>/suivre &lt;centre&gt;</code> pour vous abonner.",
        { parse_mode: "HTML" }
      );
    }
    const list = subs.map((s) => `• <b>${s.centreName}</b>`).join("\n");
    return ctx.reply(
      `📋 <b>Vos abonnements actifs :</b>\n\n${list}\n\n<i>Utilisez <code>/arreter &lt;centre&gt;</code> pour vous désabonner.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("verifier", async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!args) {
      return ctx.reply(
        "❌ Veuillez préciser un centre.\nExemple : <code>/verifier Alger</code>",
        { parse_mode: "HTML" }
      );
    }
    const centre = findCentre(args);
    if (!centre) {
      return ctx.reply(
        `❌ Centre "<b>${args}</b>" non trouvé.\n\nUtilisez /centres pour voir la liste des centres disponibles.`,
        { parse_mode: "HTML" }
      );
    }

    const loadingMsg = await ctx.reply(
      `🔍 Vérification en cours pour <b>${centre.name}</b>...`,
      { parse_mode: "HTML" }
    );

    try {
      const result = await checkCentreAvailability(centre);
      const statusIcon = result.available ? "✅" : "❌";
      const statusText = result.available ? "DISPONIBLE" : "Indisponible";

      let msg = `${statusIcon} <b>${centre.name}</b> — ${statusText}\n\n`;

      if (result.available && result.slots.length > 0) {
        msg += `📅 <b>Créneaux disponibles :</b>\n`;
        for (const slot of result.slots.slice(0, 5)) {
          msg += `  • ${slot}\n`;
        }
        msg += `\n<a href="https://visa.vfsglobal.com/dza/en/ita/book-an-appointment">🔗 Réserver maintenant</a>\n`;
      } else if (result.available) {
        msg += `<a href="https://visa.vfsglobal.com/dza/en/ita/book-an-appointment">🔗 Réserver maintenant</a>\n`;
      } else {
        msg += `<i>${result.rawMessage}</i>\n`;
        if (result.error) {
          msg += `\n⚠️ Note : ${result.error}\n`;
        }
      }

      const now = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Algiers" });
      msg += `\n<i>Vérifié le ${now}</i>`;

      await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, msg, {
        parse_mode: "HTML",
      });
    } catch (err) {
      logger.error({ err }, "Error checking availability on demand");
      await ctx.api.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        "⚠️ Erreur lors de la vérification. Réessayez dans quelques instants."
      );
    }
  });

  bot.on("message:text", (ctx) =>
    ctx.reply(
      "Je ne comprends pas cette commande. Utilisez /aide pour voir les commandes disponibles."
    )
  );

  bot.catch((err) => {
    logger.error({ err }, "Bot error");
  });

  return bot;
}

export async function startBot() {
  const bot = createBot();
  startScheduler(bot);

  process.once("SIGINT", () => bot.stop());
  process.once("SIGTERM", () => bot.stop());

  logger.info("Telegram bot starting (long polling)");
  await bot.start();
  logger.info("Telegram bot stopped");
}
