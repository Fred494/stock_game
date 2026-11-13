# ElvaStocks

A real-time multiplayer stock market game. Up to 6 players trade virtual euros in 21 companies on their phones; the host runs the game from a desktop control centre. News drives a simulated market, profits are taxed, power-ups unlock after round 6, and the highest wealth after 12 rounds wins.

Independent game: no accounts, no GeoGuessr or other dependencies.

## Run it

Requires Node 20+.

```bash
npm install
npm start
```

- Landing/explainer page: http://localhost:3000/
- Host: http://localhost:3000/host.html (tick *Quick demo timing* for a ~6-minute game instead of 60 minutes)
- Players: scan the QR code on the host screen or open `/play.html` and enter the 6-character code

To let phones on your Wi-Fi join, use your computer's LAN address (e.g. `http://192.168.1.20:3000/host.html`) so the QR code points there.

```bash
npm test                 # unit + HTTP tests
npm run simulate         # 1,000-game balance simulation -> SIMULATION_REPORT.md
node scripts/smoke.js    # plays a full quick game over HTTP against a running server
```

## Configuration (`.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | server port |
| `DATA_DIR` | `./data` | persisted games (`data/games/*.json`) and news cache |
| `NEWS_PROVIDER` | `demo` | `demo` = fictional practice scenarios only; `gdelt` = also attach real, linked GDELT coverage (free, no key; rate-limited so it loads in the background and is cached 24 h) |
| `CORS_ORIGIN` | `*` | origin allowed to call the API when the front-end is hosted elsewhere |

Honest data labelling: stock starting prices are **demo simulated reference prices** (marked `demo-simulated`; the real provider symbols such as `EDP.LS`, `GALP.LS`, `005930.KS`, `2222.SR` are stored in `src/stocks.js` for a future live-quote provider, with a locked FX snapshot). Practice-scenario headlines are fictional and labelled so. Real news is never invented. Stock reactions are always simulated.

## GitHub website

The `public/` folder is a static site (landing page that explains the game, plus the player and host apps). `.github/workflows/pages.yml` deploys it to GitHub Pages on every push to `main`:

1. Create the repo and push (`git remote add origin <url>`, `git push -u origin main`).
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. The page appears at `https://<user>.github.io/<repo>/`.

GitHub Pages only hosts static files, so the live multiplayer **server** must run elsewhere (Render, Railway, Fly.io, a VPS or your laptop: `npm start`). Once it has a public URL, add a repository variable **`APP_URL`** (Settings → Secrets and variables → Actions → Variables) and re-run the workflow; the Pages site then talks to that server. Set `CORS_ORIGIN` on the server to your Pages origin.

## Architecture

```
src/
  game.js      server-authoritative state machine, trades, power-ups, views, results
  trading.js   integer-cent buy/sell, FIFO lots, 28% / 20% tax
  market.js    seeded market: market + sector + news + bounded noise; secret until settled
  events.js    the 12 events, sensitivities and educational reasons
  stocks.js    21 companies, volatility tiers, provider symbols
  news.js      news provider abstraction (demo | gdelt), sanitised and cached
  store.js     atomic JSON persistence; running games resume paused after restart
  server.js    HTTP API + static files, hashed player/host tokens
public/        landing page, player app (2 screens), host dashboard
test/          engine + HTTP tests
```

- Prices, round returns and the seed never leave the server before a round is settled; players only get their own holdings and power-up results.
- Money is integer cents; shares are integer micro-shares. Orders carry a `requestId` for idempotency; settlement runs once per round.
- Sync is 1-second polling with a server clock, so refreshes and reconnects just work (the browser keeps a private token).
- Tie-breakers: highest wealth, then lower taxes paid, then higher % return, then shared rank.

## Known limits (v1)

- No live quote or FX provider yet (demo prices); the provider seam is `src/stocks.js` + `src/news.js`.
- Logos come from public favicon services at runtime (ticker badge fallback).
- State is stored in local JSON files, suited to a single server instance.

## Play online (Render)

1. Sign in at https://render.com with GitHub, choose **New > Blueprint**, and pick this repo. `render.yaml` sets everything up (free plan).
2. When it is live, open `https://<your-service>.onrender.com/host.html` to host; players use `/play.html` or the QR code. The server serves the whole site, so no other setup is needed.
3. Optional: set the GitHub repo variable `APP_URL` to the Render URL so the GitHub Pages site's buttons also work.

Free plan notes: the service sleeps after ~15 minutes idle (first load takes ~30 s) and its disk is not persistent, so games are lost on restart. Start it a minute before your game.
