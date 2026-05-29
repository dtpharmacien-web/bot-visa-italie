import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { logger } from "../lib/logger.js";
import { type Centre } from "./centres.js";

const BOOKING_URL = "https://visa.vfsglobal.com/dza/en/ita/book-an-appointment";

function findChromiumPath(): string {
  if (process.env["CHROMIUM_PATH"] && existsSync(process.env["CHROMIUM_PATH"])) {
    return process.env["CHROMIUM_PATH"];
  }

  const candidates = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  try {
    const which = execSync("which chromium-browser || which chromium || which google-chrome", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (which) return which.split("\n")[0].trim();
  } catch {
    // ignore
  }

  throw new Error(
    "Chromium not found. Set CHROMIUM_PATH env variable or install chromium."
  );
}

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  const executablePath = findChromiumPath();
  logger.info({ executablePath }, "Launching Chromium");

  browserInstance = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--mute-audio",
    ],
  });

  browserInstance.on("disconnected", () => {
    logger.info("Browser disconnected");
    browserInstance = null;
  });

  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

export interface ScrapeResult {
  centreId: string;
  centreName: string;
  available: boolean;
  slots: string[];
  rawMessage: string;
  checkedAt: string;
  error?: string;
}

function detectAvailability(bodyText: string, pageContent: string, centre: Centre) {
  const text = bodyText.toLowerCase();
  const content = pageContent.toLowerCase();

  const noSlotsPatterns = [
    "no appointment slots are currently available",
    "no appointments are currently available",
    "aucun créneau",
    "pas de créneau",
    "no slots",
    "not available",
    "currently unavailable",
    "appointments are currently unavailable",
    "there are no available",
  ];

  const availablePatterns = [
    "select a date",
    "choose a date",
    "please select",
    "book appointment",
    "confirm appointment",
    "available dates",
  ];

  const centreNameLower = centre.name.split(" ")[0].toLowerCase();
  const centreOnPage =
    text.includes(centreNameLower) || content.includes(centreNameLower);

  if (noSlotsPatterns.some((p) => text.includes(p))) {
    return { available: false, msg: "Aucun créneau disponible (confirmé sur la page VFS)" };
  }

  if (availablePatterns.some((p) => text.includes(p))) {
    return { available: true, msg: "Créneaux disponibles ! (détecté sur la page VFS)" };
  }

  if (centreOnPage && text.length > 200) {
    return { available: false, msg: "Page chargée — aucun créneau visible pour ce centre" };
  }

  return { available: false, msg: "Statut indéterminé — page VFS vérifiée" };
}

export async function checkCentreAvailability(centre: Centre): Promise<ScrapeResult> {
  logger.info({ centreId: centre.id }, "Checking VFS availability");

  let context: BrowserContext | null = null;

  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      locale: "fr-FR",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
    });

    const capturedSlots: string[] = [];
    let apiAvailable = false;
    let apiResponded = false;

    context.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("vfsglobal.com")) return;

      try {
        const ct = response.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        const body = await response.json();

        if (Array.isArray(body)) {
          if (body.length > 0) {
            apiAvailable = true;
            apiResponded = true;
            for (const item of body) {
              const d = item.appointmentDate ?? item.date ?? item.slotDate;
              if (d) capturedSlots.push(String(d));
            }
          } else if (url.toLowerCase().includes("slot") || url.toLowerCase().includes("date")) {
            apiResponded = true;
            apiAvailable = false;
          }
        }
      } catch {
        // ignore
      }
    });

    const page = await context.newPage();

    try {
      await page.goto(BOOKING_URL, { waitUntil: "networkidle", timeout: 35000 });
    } catch {
      try {
        await page.goto(BOOKING_URL, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(5000);
      } catch (err2) {
        throw err2;
      }
    }

    await page.waitForTimeout(3000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodyText = await page.evaluate(() => (globalThis as any).document.body?.innerText ?? "") as string;
    const pageContent = await page.content();

    let available: boolean;
    let rawMessage: string;
    let slots = capturedSlots;

    if (apiResponded) {
      available = apiAvailable;
      rawMessage = available
        ? `Créneaux disponibles ! (${capturedSlots.length} créneau(x) via API)`
        : "Aucun créneau disponible (API VFS confirmé)";
    } else {
      const detection = detectAvailability(bodyText, pageContent, centre);
      available = detection.available;
      rawMessage = detection.msg;
    }

    logger.info({ centreId: centre.id, available, apiResponded }, "Check complete");

    return {
      centreId: centre.id,
      centreName: centre.name,
      available,
      slots: slots.slice(0, 10),
      rawMessage,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, centreId: centre.id }, "Scraper error");
    return {
      centreId: centre.id,
      centreName: centre.name,
      available: false,
      slots: [],
      rawMessage: "Erreur de vérification — réessai au prochain cycle",
      checkedAt: new Date().toISOString(),
      error,
    };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
