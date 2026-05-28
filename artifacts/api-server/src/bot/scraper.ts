import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../lib/logger.js";
import { type Centre } from "./centres.js";

const BASE_URL = "https://visa.vfsglobal.com/dza/en/ita";
const LIFT_API = "https://lift-api.vfsglobal.com";

const axiosInstance = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/html, */*",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8,ar;q=0.7",
    Referer: "https://visa.vfsglobal.com/",
    Origin: "https://visa.vfsglobal.com",
  },
});

export interface ScrapeResult {
  centreId: string;
  centreName: string;
  available: boolean;
  slots: string[];
  rawMessage: string;
  checkedAt: string;
  error?: string;
}

async function tryCentresApi(): Promise<Record<string, string>> {
  try {
    const url = `${LIFT_API}/appointment/GetCentresByService?ServiceId=1&MissionId=ita&CountryId=dza`;
    const res = await axiosInstance.get(url);
    const data = res.data;
    const map: Record<string, string> = {};
    if (Array.isArray(data)) {
      for (const c of data) {
        if (c.id && c.name) map[String(c.id)] = String(c.name);
      }
    }
    return map;
  } catch {
    return {};
  }
}

async function checkViaLiftApi(centre: Centre): Promise<ScrapeResult | null> {
  try {
    const url =
      `${LIFT_API}/appointment/GetAppointmentSlotDates` +
      `?AppointmentDate=&CenterId=${encodeURIComponent(centre.id)}` +
      `&CountryId=DZA&MissionId=ITA&ServiceId=1&WorkerId=-1`;

    const res = await axiosInstance.get(url);
    const data = res.data;

    const slots: string[] = [];
    if (Array.isArray(data) && data.length > 0) {
      for (const slot of data) {
        if (slot.appointmentDate) slots.push(String(slot.appointmentDate));
      }
    }

    return {
      centreId: centre.id,
      centreName: centre.name,
      available: slots.length > 0,
      slots,
      rawMessage: slots.length > 0 ? `${slots.length} créneau(x) disponible(s)` : "Aucun créneau disponible",
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function checkViaHtmlScraping(centre: Centre): Promise<ScrapeResult> {
  const url = `${BASE_URL}/book-an-appointment`;
  try {
    const res = await axiosInstance.get(url);
    const $ = cheerio.load(res.data as string);

    const pageText = $("body").text().toLowerCase();

    const noSlotsKeywords = [
      "no appointment",
      "not available",
      "no slots",
      "aucun rendez-vous",
      "pas de rendez-vous",
      "indisponible",
    ];
    const availableKeywords = [
      "appointment available",
      "book appointment",
      "select date",
      "available slot",
    ];

    const hasNoSlots = noSlotsKeywords.some((k) => pageText.includes(k));
    const hasAvailable = availableKeywords.some((k) => pageText.includes(k));

    const centreName = centre.name.toLowerCase();
    const centreVisible =
      pageText.includes(centreName) ||
      pageText.includes(centre.id) ||
      pageText.includes("alg");

    let available = false;
    let rawMessage = "Statut inconnu — page JavaScript requise";

    if (hasNoSlots) {
      available = false;
      rawMessage = "Aucun créneau disponible (détecté sur la page)";
    } else if (hasAvailable && centreVisible) {
      available = true;
      rawMessage = "Créneaux potentiellement disponibles !";
    }

    return {
      centreId: centre.id,
      centreName: centre.name,
      available,
      slots: [],
      rawMessage,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      centreId: centre.id,
      centreName: centre.name,
      available: false,
      slots: [],
      rawMessage: "Erreur de vérification",
      checkedAt: new Date().toISOString(),
      error,
    };
  }
}

async function checkViaEmbassyApi(centre: Centre): Promise<ScrapeResult | null> {
  try {
    const endpoints = [
      `${LIFT_API}/appointment/GetCentresByService?ServiceId=1&MissionId=ita&CountryId=dza`,
      `https://visa.vfsglobal.com/api/appointment/GetCentresByService?MissionId=ita&CountryId=dza`,
    ];

    for (const url of endpoints) {
      try {
        const res = await axiosInstance.get(url);
        if (res.status === 200 && Array.isArray(res.data)) {
          const centreEntry = res.data.find(
            (c: { name?: string; id?: string }) =>
              String(c.name ?? "").toLowerCase().includes(centre.id) ||
              String(c.id ?? "").toLowerCase().includes(centre.id)
          );
          if (centreEntry) {
            const hasSlots = centreEntry.availableSlots > 0 || centreEntry.isAvailable === true;
            return {
              centreId: centre.id,
              centreName: centre.name,
              available: hasSlots,
              slots: [],
              rawMessage: hasSlots ? "Créneaux disponibles !" : "Aucun créneau",
              checkedAt: new Date().toISOString(),
            };
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function checkCentreAvailability(centre: Centre): Promise<ScrapeResult> {
  logger.info({ centreId: centre.id }, "Checking VFS appointment availability");

  const liftResult = await checkViaLiftApi(centre);
  if (liftResult) {
    logger.info({ centreId: centre.id, available: liftResult.available }, "LIFT API result");
    return liftResult;
  }

  const embassyResult = await checkViaEmbassyApi(centre);
  if (embassyResult) {
    logger.info({ centreId: centre.id, available: embassyResult.available }, "Embassy API result");
    return embassyResult;
  }

  const htmlResult = await checkViaHtmlScraping(centre);
  logger.info({ centreId: centre.id, available: htmlResult.available }, "HTML scraping result");
  return htmlResult;
}

export async function checkAllCentres(centreIds: string[], allCentres: Centre[]): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];
  for (const id of centreIds) {
    const centre = allCentres.find((c) => c.id === id);
    if (!centre) continue;
    const result = await checkCentreAvailability(centre);
    results.push(result);
    await new Promise((r) => setTimeout(r, 1500));
  }
  return results;
}
