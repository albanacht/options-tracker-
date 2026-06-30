// ── Constants ──────────────────────────────────────────────────
const STRATS = ['Naked Put','Naked Call','Bull Put Spread','Bear Call Spread','Iron Condor','Covered Call'];
const OUTCOMES = ['Open','Expired Worthless','Bought Back','Assigned','Closed Profit','Closed Loss','Max Loss'];

// ── Formatters ─────────────────────────────────────────────────
function f$(v, d = 0) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fp(v, d = 1) {
  if (v == null || isNaN(v)) return '—';
  return (v * 100).toFixed(d) + '%';
}
function fd(s) {
  if (!s) return null;
  try { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d; } catch { return null; }
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
function today() { return new Date(); }

// ── Core metrics calculator ─────────────────────────────────────
function calcMetrics(t) {
  const prem = parseFloat(t.premiumReceived) || 0;
  const s1   = parseFloat(t.strike1) || 0;
  const s2   = parseFloat(t.strike2) || 0;
  const und  = parseFloat(t.underlyingAtEntry) || 0;
  const con  = parseInt(t.contracts) || 1;
  const close = parseFloat(t.closePrice) || 0;
  const isSpread = t.strategy && (t.strategy.includes('Spread') || t.strategy.includes('Condor'));

  let cap = 0, maxLoss = 0, be = 0;
  const isCoveredCall = t.strategy === 'Covered Call';
  const isNakedCall = t.putCall === 'C' && !isCoveredCall && !isSpread;

  if (isSpread && s1 && s2) {
    const w = Math.abs(s1 - s2);
    maxLoss = (w - prem) * 100 * con;
    cap = maxLoss;
    be = t.putCall === 'P' ? s1 - prem : s1 + prem;
  } else if (t.putCall === 'P') {
    // Naked / cash-secured put — full strike is the real collateral requirement
    cap = s1 * 100 * con;
    maxLoss = cap - prem * 100 * con;
    be = s1 - prem;
  } else if (isCoveredCall) {
    // Covered call — shares already owned are the collateral, already
    // counted separately as "shares deployed" in Capital at Risk.
    // No additional capital is required to write this call.
    cap = 0;
    maxLoss = 0; // capped loss is on the underlying shares, not the call itself
    be = s1 + prem;
  } else {
    // True naked call (no shares owned) — risk is technically unbounded,
    // strike × 100 is not a meaningful collateral figure. Flagged via
    // isNakedCall rather than silently treated like a cash-secured put.
    cap = s1 * 100 * con; // shown for reference only, excluded from collateral sums
    maxLoss = null; // undefined / unbounded
    be = s1 + prem;
  }

  const dte = parseInt(t.dte) || 30;
  const roc   = cap > 0 ? (prem * con * 100) / cap : 0;
  const annR  = dte > 0 ? roc * (365 / dte) : 0;
  const bec   = und > 0 ? Math.abs(und - be) / und : 0;

  let pnl = null;
  if (t.outcome === 'Expired Worthless') {
    pnl = prem * 100 * con;
  } else if (t.outcome === 'Bought Back' || t.outcome === 'Closed Profit' || t.outcome === 'Closed Loss') {
    pnl = (prem - close) * 100 * con;
  } else if (t.outcome === 'Max Loss' && isSpread) {
    pnl = -maxLoss;
  }

  const d1 = fd(t.dateOpened);
  const d2 = fd(t.dateClosed || t.expiry);
  const held = d1 && d2 ? daysBetween(d1, d2) : dte;
  const actAnn = pnl != null && held > 0 && cap > 0 ? (pnl / cap) * (365 / held) : null;

  return { cap, maxLoss, be, roc, annR, bec, pnl, actAnn, isSpread, isCoveredCall, isNakedCall };
}

// ── Price fetch via Finnhub (fast, no proxy needed) ───────────
const FINNHUB_KEY = 'd8nsp69r01qvvn9b07p0d8nsp69r01qvvn9b07pg';

async function fetchPrices(tickers) {
  if (!tickers.length) return {};
  const results = {};

  // Fetch all tickers in parallel — Finnhub allows direct browser calls
  await Promise.all(tickers.map(async ticker => {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return;
      const d = await r.json();
      // c = current price, pc = previous close
      const price = d.c > 0 ? d.c : d.pc;
      if (price && price > 0) results[ticker] = price;
    } catch (_) {}
  }));

  return results;
}

// ── LocalStorage persistence ────────────────────────────────────
const Store = {
  getTrades()    { try { return JSON.parse(localStorage.getItem('opt_trades_v3') || '[]'); } catch { return []; } },
  setTrades(t)   { try { localStorage.setItem('opt_trades_v3', JSON.stringify(t)); } catch {} },
  getWatchlist() { try { return JSON.parse(localStorage.getItem('opt_watchlist')  || '[]'); } catch { return []; } },
  setWatchlist(w){ try { localStorage.setItem('opt_watchlist',  JSON.stringify(w)); } catch {} },
};

// ── Distance bar color ──────────────────────────────────────────
function distCol(pct) {
  return pct > 0.15 ? '#3b6d11' : pct > 0.05 ? '#854f0b' : '#a32d2d';
}

// ── Global React shorthands (used by all components) ───────────
const h         = React.createElement;
const useState  = React.useState;
const useEffect = React.useEffect;
const useCallback = React.useCallback;
const useMemo   = React.useMemo;
const useRef    = React.useRef;

// ── Aliased hooks to avoid re-declaration conflicts ────────────
const useStateWC  = React.useState;
const useMemoWC   = React.useMemo;
const useStateWL  = React.useState;
const useStateAM  = React.useState;
const useStateWB  = React.useState;
const useEffectC  = React.useEffect;
const useMemoC    = React.useMemo;
const useRefC     = React.useRef;
const useState2   = React.useState;
