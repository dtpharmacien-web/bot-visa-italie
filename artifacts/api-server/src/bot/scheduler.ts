import cron from "node-cron";
import { Bot } from "grammy";
import { checkCentreAvailability } from "./scraper.js";
import {
  getAllSubscribedCentres,
  getSubscribersByCentre,
  getLastAvailability,
  setLastAvailability,
  recordDetection,
  incrementAlertsSent,
  incrementChecks,
} from "./storage.js";
import { getCentreById, CENTRES } from "./centres.js";
import { logger } from "../lib/logger.js";

function buildAlertMessage(centreName: string, slots: string[]): string {
  const now = new Date().toLocaleString("fr-FR", {
    timeZone: "Africa/Algiers",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  let msg = `🚨🇮🇹 <b>CRÉNEAUX DISPONIBLES — ${centreName.toUpperCase()}</b> 🚨\n\n`;
  msg += `✅ Des rendez-vous visa Italie sont <b>DISPONIBLES MAINTENANT</b> !\n\n`;

  if (slots.length > 0) {
    msg += `📅 <b>Dates disponibles :</b>\n`;
    for (const slot of slots.slice(0, 5)) {
      msg += `  • ${slot}\n`;
    }
    if (slots.length > 5) {
      msg += `  <i>...et ${slots.length - 5} autre(s)</i>\n`;
    }
    msg += "\n";
  }

  msg += `<a href="https://visa.vfsglobal.com/dza/en/ita/book-an-appointment">🔗 Réserver maintenant sur VFS Global</a>\n\n`;
  msg += `⚡ <b>Agissez vite — les créneaux partent en quelques minutes !</b>\n`;
  msg += `<i>Détecté le ${now}</i>`;
  return msg;
}

function buildRecoveryMessage(centreName: string): string {
  return (
    `ℹ️ <b>Visa Italie — ${centreName}</b>\n\n` +
    `❌ Les créneaux ne sont plus disponibles pour le moment.\n\n` +
    `<i>Vous serez notifié automatiquement dès qu'un nouveau créneau apparaît.\n` +
    `Vérification toutes les 3 minutes.</i>`
  );
}

export function startScheduler(bot: Bot) {
  logger.info("Starting VFS appointment scheduler (every 3 minutes)");

  cron.schedule("*/3 * * * *", async () => {
    logger.info("Scheduler tick — checking subscribed centres");
    incrementChecks();

    const subscribedCentreIds = getAllSubscribedCentres();
    if (subscribedCentreIds.length === 0) {
      logger.info("No subscribed centres, skipping check");
      return;
    }

    for (const centreId of subscribedCentreIds) {
      const centre = getCentreById(centreId) ?? CENTRES.find((c) => c.id === centreId);
      if (!centre) continue;

      try {
        const result = await checkCentreAvailability(centre);
        const wasAvailable = getLastAvailability(centreId);
        const isNowAvailable = result.available;

        if (isNowAvailable && wasAvailable !== true) {
          logger.info({ centreId, slots: result.slots }, "Appointments AVAILABLE — notifying subscribers");

          // Enregistre dans l'historique pour les prédictions futures
          recordDetection(centreId, result.slots);

          const subscribers = getSubscribersByCentre(centreId);
          const message = buildAlertMessage(result.centreName, result.slots);
          let sent = 0;
          for (const chatId of subscribers) {
            try {
              await bot.api.sendMessage(chatId, message, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
              sent++;
            } catch (err) {
              logger.error({ err, chatId }, "Failed to send alert to subscriber");
            }
          }
          incrementAlertsSent(sent);
          setLastAvailability(centreId, true);
        } else if (!isNowAvailable && wasAvailable === true) {
          logger.info({ centreId }, "Appointments no longer available — notifying subscribers");
          const subscribers = getSubscribersByCentre(centreId);
          const message = buildRecoveryMessage(result.centreName);
          for (const chatId of subscribers) {
            try {
              await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
            } catch (err) {
              logger.error({ err, chatId }, "Failed to send recovery notification");
            }
          }
          setLastAvailability(centreId, false);
        } else {
          setLastAvailability(centreId, isNowAvailable);
          logger.info({ centreId, available: isNowAvailable }, "No status change");
        }
      } catch (err) {
        logger.error({ err, centreId }, "Error checking centre");
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  });
}
