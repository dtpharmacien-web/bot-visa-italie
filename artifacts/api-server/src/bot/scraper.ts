import axios from "axios";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { logger } from "../lib/logger.js";
import { type Centre } from "./centres.js";

const BOOKING_URL = "https://visa.vfsglobal.com/dza/en/ita/book-an-appointment";

// ─── Résultat ─────────────────────────────────────────────────────────────

export interface ScrapeResult {
  centreId: string;
  centreName: string;
  available: boolean;
  slots: string[];
  rawMessage: string;
  checkedAt: string;
  error?: string;
}

// ─── HTTP rapide (axios) ───────────────────────────────────────────────────

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

async function checkWithHTTP(centre: Centre): Promise<ScrapeResult | null> {
  try {
    const resp = await axios.get(BOOKING_URL, {
      timeout: 8000,
      headers: HTTP_HEADERS,
      validateStatus: () => true,
      maxRedirects: 5,
    });

    if (resp.status === 403 || resp.status === 429 || resp.status === 503) {
      logger.info({ centreId: centre.id, status: resp.status }, "HTTP check: VFS blocked this server");
      return {
        centreId: centre.id,
        centreName: centre.name,
        available: false,
        slots: [],
        rawMessage: `VFS Global ne répond pas depuis ce serveur (HTTP ${resp.status}). Le bot continue la surveillance automatique.`,
        checkedAt: new Date().toISOString(),
        error: `HTTP ${resp.status}`,
      };
    }

    if (resp.status !== 200) {
      logger.info({ centreId: centre.id, status: resp.status }, "HTTP check: unexpected status");
      return null; // Try Playwright
    }

    const html: string = typeof resp.data === "string" ? resp.data : String(resp.data ?? "");
    const text = html.toLowerCase();

    // VFS SPA — la page HTML brute ne contient pas les créneaux (JavaScript requis)
    // Mais on peut détecter certains états statiques
    if (text.includes("no appointment slots are currently available") ||
        text.includes("aucun créneau") ||
        text.includes("no slots available")) {
      return {
        centreId: centre.id,
        centreName: centre.name,
        available: false,
        slots: [],
        rawMessage: "Aucun créneau disponible (confirmé via HTTP)",
        checkedAt: new Date().toISOString(),
      };
    }

    if (text.includes("select a date") || text.includes("available dates")) {
      return {
        centreId: centre.id,
        centreName: centre.name,
        available: true,
        slots: [],
        rawMessage: "Créneaux potentiellement disponibles (détectés via HTTP)",
        checkedAt: new Date().toISOString(),
      };
    }

    // Réponse HTML mais pas de signal clair → essayer Playwright
    logger.info({ centreId: centre.id }, "HTTP check: SPA page returned, trying Playwright");
    return null;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.info({ centreId: centre.id, err: msg }, "HTTP check failed");
    return null; // Try Playwright
  }
}

// ─── Playwright (navigateur complet) ──────────────────────────────────────

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
  ];

  // Try dynamic Nix store path
  try {
    const nixStore = execSync(
      "find /nix/store -name 'chromium' -type f 2>/dev/null | head -1",
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    if (nixStore) candidates.push(nixStore);
  } catch { /* ignore */ }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  try {
    const which = execSync(
      "which chromium-browser || which chromium || which google-chrome",
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    if (which) return which.split("\n")[0].trim();
  } catch { /* ignore */ }

  throw new Error("Chromium not found. Set CHROMIUM_PATH env variable.");
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
      "--single-process",
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

async function checkWithPlaywright(centre: Centre): Promise<ScrapeResult> {
  let context: BrowserContext | null = null;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      locale: "fr-FR",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
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
          apiResponded = true;
          if (body.length > 0) {
            apiAvailable = true;
            for (const item of body) {
              const d = item.appointmentDate ?? item.date ?? item.slotDate;
              if (d) capturedSlots.push(String(d));
            }
          } else if (url.toLowerCase().includes("slot") || url.toLowerCase().includes("date")) {
            apiAvailable = false;
          }
        }
      } catch { /* ignore */ }
    });

    const page = await context.newPage();

    // Timeout court : 15s max pour le chargement
    try {
      await page.goto(BOOKING_URL, { waitUntil: "domcontentloaded", timeout: 12000 });
      await page.waitForTimeout(3000);
    } catch {
      // Si timeout, on travaille avec ce qu'on a
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodyText = (await page.evaluate(() => (globalThis as any).document.body?.innerText ?? "").catch(() => "")) as string;
    const text = bodyText.toLowerCase();

    let available: boolean;
    let rawMessage: string;

    if (apiResponded) {
      available = apiAvailable;
      rawMessage = available
        ? `Créneaux disponibles ! (${capturedSlots.length} créneau(x) via API VFS)`
        : "Aucun créneau disponible (API VFS confirmé — liste vide)";
    } else if (text.includes("no appointment slots are currently available") ||
               text.includes("aucun créneau") ||
               text.includes("no slots")) {
      available = false;
      rawMessage = "Aucun créneau disponible (confirmé sur la page VFS)";
    } else if (text.includes("select a date") || text.includes("available dates")) {
      available = true;
      rawMessage = "Créneaux disponibles ! (détectés sur la page VFS)";
    } else if (text.length < 100) {
      available = false;
      rawMessage = "Page VFS non chargée (serveur peut-être bloqué pour ce serveur)";
    } else {
      available = false;
      rawMessage = "Page VFS chargée — aucun créneau visible";
    }

    logger.info({ centreId: centre.id, available, apiResponded, textLen: text.length }, "Playwright check complete");

    return {
      centreId: centre.id,
      centreName: centre.name,
      available,
      slots: capturedSlots.slice(0, 10),
      rawMessage,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// ─── Point d'entrée principal ─────────────────────────────────────────────

export async function checkCentreAvailability(centre: Centre): Promise<ScrapeResult> {
  logger.info({ centreId: centre.id }, "Checking VFS availability");

  // Timeout global strict : 15 secondes maximum
  const GLOBAL_TIMEOUT_MS = 15_000;

  const checkPromise = (async (): Promise<ScrapeResult> => {
    // Étape 1 : vérification HTTP rapide (8s max)
    const httpResult = await checkWithHTTP(centre);
    if (httpResult !== null) return httpResult;

    // Étape 2 : vérification Playwright si HTTP insuffisant (12s internes)
    return checkWithPlaywright(centre);
  })();

  const timeoutPromise = new Promise<ScrapeResult>((resolve) =>
    setTimeout(() => resolve({
      centreId: centre.id,
      centreName: centre.name,
      available: false,
      slots: [],
      rawMessage: "Délai dépassé (15s) — VFS Global est lent ou indisponible. Le bot continue la surveillance automatique.",
      checkedAt: new Date().toISOString(),
      error: "timeout",
    }), GLOBAL_TIMEOUT_MS)
  );

  try {
    return await Promise.race([checkPromise, timeoutPromise]);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, centreId: centre.id }, "Scraper error");
    return {
      centreId: centre.id,
      centreName: centre.name,
      available: false,
      slots: [],
      rawMessage: "Erreur de connexion à VFS Global. Le bot continue la surveillance automatique.",
      checkedAt: new Date().toISOString(),
      error,
    };
  }
}
