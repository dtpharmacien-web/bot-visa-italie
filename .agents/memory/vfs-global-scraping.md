---
name: VFS Global scraping approach
description: How to scrape VFS Global for Italy visa appointments in Algeria
---

VFS Global (visa.vfsglobal.com) uses:
1. Cloudflare protection that blocks datacenter IPs (Replit, AWS, GCP ranges)
2. Their LIFT API at lift-api.vfsglobal.com returns {"code":"403201"} for unauthorized requests
3. Even headless Chromium returns the JSON 403 error from Replit's IP

**Why:** Cloudflare+VFS backend blocks known cloud/datacenter IP ranges. The response {"code":"403201"} is VFS's own auth error, not a Cloudflare challenge page.

**How to apply:** The Chromium-based scraper (playwright-core + Nix chromium) will work on Railway/Render residential-leaning IPs. CHROMIUM_PATH env var selects the binary. On Alpine Docker: /usr/bin/chromium. On Nix/Replit: auto-detected via findChromiumPath(). Accept that scraper won't work in Replit dev but will work in production.
