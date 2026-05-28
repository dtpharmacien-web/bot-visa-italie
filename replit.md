# Bot Alertes Visa Italie — VFS Global Algérie

Bot Telegram qui surveille les créneaux de rendez-vous visa Italie sur VFS Global en Algérie et envoie des alertes en temps réel aux abonnés.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — lancer le bot + serveur (port 5000)
- `pnpm run typecheck` — vérification TypeScript complète
- `pnpm run build` — typecheck + build de tous les packages
- Required env: `TELEGRAM_BOT_TOKEN` — token du bot Telegram

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Bot: grammy (Telegram Bot Framework, native fetch)
- Scraping: axios + cheerio
- Scheduler: node-cron (toutes les 3 minutes)
- Storage: JSON file (data/subscriptions.json)

## Where things live

- `artifacts/api-server/src/bot/` — tout le code du bot
  - `index.ts` — commandes Telegram et lancement
  - `scheduler.ts` — vérification périodique + notifications
  - `scraper.ts` — scraping VFS Global
  - `centres.ts` — liste des centres Algérie
  - `storage.ts` — abonnements utilisateurs (fichier JSON)
- `artifacts/api-server/data/subscriptions.json` — données persistantes
- `railway.toml` — config déploiement Railway
- `render.yaml` — config déploiement Render
- `Dockerfile` — image Docker

## Commandes du bot

- `/start` ou `/aide` — aide et bienvenue
- `/centres` — liste des centres disponibles (Alger, Constantine, Oran, Annaba, Tlemcen)
- `/suivre <centre>` — s'abonner aux alertes d'un centre
- `/arreter <centre>` — se désabonner
- `/mesabonnements` — voir ses abonnements actifs
- `/verifier <centre>` — vérifier la disponibilité maintenant

## Déploiement 24/7 gratuit

### Railway (recommandé)

1. Créer un compte sur [railway.app](https://railway.app)
2. New Project → Deploy from GitHub Repo (connecter ce repo)
3. Ajouter la variable d'env `TELEGRAM_BOT_TOKEN` dans Railway
4. Le fichier `railway.toml` configure tout automatiquement

### Render (alternative)

1. Créer un compte sur [render.com](https://render.com)
2. New → Background Worker → connecter le repo
3. Build Command: `npm install -g pnpm && pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build`
4. Start Command: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
5. Ajouter `TELEGRAM_BOT_TOKEN` et `PORT=5000` dans Environment

## Architecture decisions

- grammy plutôt que telegraf : compatible Node.js 24+ (utilise le fetch natif, pas node-fetch)
- grammy externalisé dans esbuild : le fichier `platform.node` de grammy ne peut pas être bundlé
- Stockage JSON local : simple, sans base de données, portable pour Railway/Render
- Vérification toutes les 3 min : équilibre entre réactivité et politesse vis-à-vis du serveur VFS

## Product

Bot Telegram permettant aux citoyens algériens de recevoir des alertes immédiates quand des créneaux de rendez-vous visa Italie se libèrent sur VFS Global, par centre (Alger, Constantine, Oran, etc.).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **grammy doit rester external dans build.mjs** — ne pas le retirer de la liste d'externals esbuild
- Le scraper VFS Global peut nécessiter des ajustements si VFS change son API
- Pour Railway : utiliser le type `worker` (pas `web`) pour éviter les sleep après inactivité HTTP
