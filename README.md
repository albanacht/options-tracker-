# Options Tracker

A browser-based options trading tracker with wheel cycle management, live price monitoring, and P&L charts.

## Features

- **Active monitor** — open positions with live price distance bars, 50%/80% profit targets, days-to-expiry countdown, buy-back / close-spread buttons
- **Wheel cycles** — full wheel cycle tracker (put → assignment → covered calls → called away), progress bar showing CC income recovering embedded loss, Gantt timeline
- **Capital at risk** — worst-case collateral, spread max losses, delta-weighted exposure, utilization vs SGOV buffer
- **Charts** — cumulative realized P&L (green), unrealized mark-to-market (red dashed), net combined (blue dotted), monthly premium vs P&L bars
- **Trade logger** — instant ROCAR, break-even, and BE cushion calculation at entry
- **Watchlist** — live prices via Yahoo Finance, IV/HV signal entry, estimated ROCAR

## Hosting on GitHub Pages

1. Create a new GitHub repo (e.g. `options-tracker`)
2. Push this folder to the `main` branch
3. Go to **Settings → Pages → Source → GitHub Actions**
4. Push any commit — the workflow deploys automatically
5. Access at `https://yourusername.github.io/options-tracker/`

## Data storage

All data is stored in `localStorage` in your browser. It persists across sessions on the same device/browser. To use across devices, export/import via the browser console:

```js
// Export
copy(localStorage.getItem('opt_trades_v3'))

// Import (paste your exported string)
localStorage.setItem('opt_trades_v3', '<paste here>')
location.reload()
```

## Local development

No build step needed — plain HTML/JS. Just open `index.html` in a browser, or serve with:

```bash
npx serve .
# or
python3 -m http.server 8080
```

## Metrics reference

| Metric | Formula |
|--------|---------|
| Capital at risk (naked put) | Strike × 100 × contracts |
| Capital at risk (spread) | (Width − premium) × 100 × contracts |
| Ann. ROCAR | (Premium / Capital) × (365 / DTE) |
| Break-even (put) | Strike − premium |
| BE cushion | (Underlying − BE) / Underlying |
| Actual ann. ROCAR | (P&L / Capital) × (365 / days held) |
| Wheel cycle P&L | Put premium + all CC premiums − stock loss on assignment/sale |
