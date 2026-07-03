// ── Scanner: on-demand candidate finder ─────────────────────────
// Stage 1 (Finnhub): quotes + earnings dates for the universe, throttled
// to respect the 60 calls/min free tier.
// Stage 2 (Yahoo chains via CORS proxy): option chains for survivors,
// Black-Scholes deltas, ROCAR / BE cushion, strategy classification.

const SCANNER_DEFAULT_UNIVERSE = [
  'VZ','T','KO','PEP','PG','JNJ','BMY','MRK','PFE','ABBV','MO','BTI',
  'O','WPC','VICI','ARE','OKE','KMI','XOM','CVX','JPM','BAC','USB',
  'CSCO','QCOM','INTC','GOOG','AMZN','AAPL','MSFT','CRM','TGT'
];

const SCAN_RISK_FREE = 0.04;

// Normal CDF (Abramowitz & Stegun approximation)
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function bsPutDelta(S, K, T, sigma, r) {
  if (!S || !K || !T || !sigma || T <= 0 || sigma <= 0) return null;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  return normCdf(d1) - 1;
}
function bsCallDelta(S, K, T, sigma, r) {
  if (!S || !K || !T || !sigma || T <= 0 || sigma <= 0) return null;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  return normCdf(d1);
}

// Throttled batch runner: Finnhub free tier allows 60 calls/min.
async function batchRun(tasks, batchSize, gapMs, onProgress) {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const settled = await Promise.all(batch.map(fn => fn().catch(() => null)));
    results.push(...settled);
    if (onProgress) onProgress(Math.min(i + batchSize, tasks.length), tasks.length);
    if (i + batchSize < tasks.length) await new Promise(res => setTimeout(res, gapMs));
  }
  return results;
}

async function finnhubGet(path) {
  const r = await fetch('https://finnhub.io/api/v1' + path + (path.includes('?') ? '&' : '?') + 'token=' + FINNHUB_KEY, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('finnhub ' + r.status);
  return r.json();
}

async function yahooGet(url) {
  // corsproxy.io primary, allorigins fallback
  try {
    const r = await fetch('https://corsproxy.io/?' + encodeURIComponent(url), { signal: AbortSignal.timeout(9000) });
    if (r.ok) return r.json();
    throw new Error('corsproxy ' + r.status);
  } catch (_) {
    const r2 = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
    if (!r2.ok) throw new Error('allorigins ' + r2.status);
    return r2.json();
  }
}

function goodContract(c, spotMid) {
  if (!c || !c.bid || c.bid <= 0.05) return false;
  const spread = (c.ask || 0) - c.bid;
  const mid = ((c.ask || 0) + c.bid) / 2;
  if (spread > Math.max(0.15, mid * 0.12)) return false;
  if ((c.openInterest || 0) < 100) return false;
  return true;
}

function Scanner({ onPick }) {
  const [universe, setUniverse] = useState(() => {
    try { return JSON.parse(localStorage.getItem('opt_scan_universe')) || SCANNER_DEFAULT_UNIVERSE; }
    catch { return SCANNER_DEFAULT_UNIVERSE; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [universeText, setUniverseText] = useState(universe.join(', '));
  const [scanning, setScanning] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(() => {
    try { return JSON.parse(localStorage.getItem('opt_scan_cache')) || null; }
    catch { return null; }
  });
  const [error, setError] = useState('');

  const saveUniverse = () => {
    const list = universeText.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    setUniverse(list);
    try { localStorage.setItem('opt_scan_universe', JSON.stringify(list)); } catch {}
    setShowSettings(false);
  };

  const runScan = async () => {
    setScanning(true);
    setError('');
    setResults(null);
    const nowMs = Date.now();
    const candidates = [];

    try {
      // ── Stage 1: quotes (throttled) ─────────────────────────
      setPhase('Stage 1/3 — fetching quotes');
      setProgress(0);
      const quoteTasks = universe.map(tk => () => finnhubGet('/quote?symbol=' + tk).then(q => ({ tk, q })));
      const quotes = await batchRun(quoteTasks, 20, 21000, (done, total) => setProgress(done / total * 0.3));
      const priced = quotes.filter(x => x && x.q && x.q.c > 0);

      // ── Stage 1b: earnings dates (throttled) ────────────────
      setPhase('Stage 2/3 — checking earnings dates');
      const from = todayStr();
      const toDate = new Date(); toDate.setDate(toDate.getDate() + 60);
      const to = toDate.toISOString().slice(0, 10);
      const earnTasks = priced.map(x => () =>
        finnhubGet('/calendar/earnings?from=' + from + '&to=' + to + '&symbol=' + x.tk)
          .then(e => ({ tk: x.tk, earnings: (e.earningsCalendar && e.earningsCalendar[0] && e.earningsCalendar[0].date) || null }))
      );
      const earnings = await batchRun(earnTasks, 20, 21000, (done, total) => setProgress(0.3 + done / total * 0.3));
      const earnMap = {};
      earnings.forEach(e => { if (e) earnMap[e.tk] = e.earnings; });

      // Survivors: have a price; cap at 14 to keep stage 3 sane
      const survivors = priced.slice(0, 40);

      // ── Stage 3: option chains via Yahoo ────────────────────
      setPhase('Stage 3/3 — analyzing option chains');
      let done = 0;
      for (const { tk, q } of survivors) {
        if (candidates.length >= 24) break;
        done++;
        setProgress(0.6 + (done / survivors.length) * 0.4);
        setPhase('Stage 3/3 — ' + tk + ' (' + done + '/' + survivors.length + ')');
        try {
          const spot = q.c;
          const root = await yahooGet('https://query1.finance.yahoo.com/v7/finance/options/' + tk);
          const res0 = root && root.optionChain && root.optionChain.result && root.optionChain.result[0];
          if (!res0 || !res0.expirationDates || !res0.expirationDates.length) continue;

          // Pick expiry closest to 35 DTE within 21-55
          let bestExp = null, bestDist = 1e9;
          for (const ep of res0.expirationDates) {
            const dte = (ep * 1000 - nowMs) / 86400000;
            if (dte < 21 || dte > 55) continue;
            const dist = Math.abs(dte - 35);
            if (dist < bestDist) { bestDist = dist; bestExp = ep; }
          }
          if (!bestExp) continue;
          const dte = Math.round((bestExp * 1000 - nowMs) / 86400000);
          const expiryStr = new Date(bestExp * 1000).toISOString().slice(0, 10);
          const T = dte / 365;

          // Earnings inside the option window (+3d buffer) → skip entirely
          const earn = earnMap[tk];
          if (earn && earn <= expiryStr) continue;

          const chainData = await yahooGet('https://query1.finance.yahoo.com/v7/finance/options/' + tk + '?date=' + bestExp);
          const chain = chainData && chainData.optionChain && chainData.optionChain.result && chainData.optionChain.result[0] && chainData.optionChain.result[0].options && chainData.optionChain.result[0].options[0];
          if (!chain) continue;

          const puts = (chain.puts || []).filter(c => goodContract(c));
          const calls = (chain.calls || []).filter(c => goodContract(c));

          // ATM IV estimate for vol context
          const atmPut = (chain.puts || []).reduce((best, c) =>
            (!best || Math.abs(c.strike - spot) < Math.abs(best.strike - spot)) ? c : best, null);
          const atmIv = atmPut && atmPut.impliedVolatility ? atmPut.impliedVolatility : null;

          // ── Wheel candidate: best put in 0.12–0.30 |delta| band ──
          let bestPut = null;
          for (const c of puts) {
            if (c.strike >= spot) continue;
            const iv = c.impliedVolatility || atmIv;
            const delta = bsPutDelta(spot, c.strike, T, iv, SCAN_RISK_FREE);
            if (delta == null || Math.abs(delta) < 0.12 || Math.abs(delta) > 0.30) continue;
            const prem = c.bid;
            const cap = c.strike * 100;
            const annR = (prem * 100 / cap) * (365 / dte);
            const be = c.strike - prem;
            const cushion = (spot - be) / spot;
            const cand = { tk, spot, strategy: 'Naked Put', putCall: 'P', strike1: c.strike, strike2: null, expiry: expiryStr, dte, prem, cap, annR, cushion, iv, delta: Math.abs(delta), oi: c.openInterest, earn };
            if (!bestPut || cand.annR > bestPut.annR) bestPut = cand;
          }
          if (bestPut) candidates.push(bestPut);

          // ── Bull put spread: when vol is elevated (ATM IV ≥ 30%) ──
          if (bestPut && atmIv && atmIv >= 0.30) {
            const shortC = puts.find(c => c.strike === bestPut.strike1);
            const longC = puts
              .filter(c => c.strike < bestPut.strike1 && bestPut.strike1 - c.strike >= 5 && bestPut.strike1 - c.strike <= 10 && c.ask > 0)
              .sort((a, b) => b.strike - a.strike)[0];
            if (shortC && longC) {
              const credit = shortC.bid - longC.ask;
              const width = bestPut.strike1 - longC.strike;
              if (credit > 0.1 && credit / width >= 0.12) {
                const cap = (width - credit) * 100;
                const annR = (credit * 100 / cap) * (365 / dte);
                candidates.push({ tk, spot, strategy: 'Bull Put Spread', putCall: 'P', strike1: bestPut.strike1, strike2: longC.strike, expiry: expiryStr, dte, prem: credit, cap, annR, cushion: bestPut.cushion, iv: atmIv, delta: bestPut.delta, oi: shortC.openInterest, earn });
              }
            }
          }

          // ── Bear call spread: only near 52w-high territory + hot IV ──
          if (atmIv && atmIv >= 0.40 && calls.length) {
            let shortCall = null;
            for (const c of calls) {
              if (c.strike <= spot) continue;
              const iv = c.impliedVolatility || atmIv;
              const delta = bsCallDelta(spot, c.strike, T, iv, SCAN_RISK_FREE);
              if (delta == null || delta < 0.15 || delta > 0.28) continue;
              if (!shortCall || c.strike < shortCall.strike) shortCall = { ...c, delta };
            }
            const longCall = shortCall && calls
              .filter(c => c.strike > shortCall.strike && c.strike - shortCall.strike >= 5 && c.strike - shortCall.strike <= 10 && c.ask > 0)
              .sort((a, b) => a.strike - b.strike)[0];
            if (shortCall && longCall) {
              const credit = shortCall.bid - longCall.ask;
              const width = longCall.strike - shortCall.strike;
              if (credit > 0.1 && credit / width >= 0.15) {
                const cap = (width - credit) * 100;
                const annR = (credit * 100 / cap) * (365 / dte);
                candidates.push({ tk, spot, strategy: 'Bear Call Spread', putCall: 'C', strike1: shortCall.strike, strike2: longCall.strike, expiry: expiryStr, dte, prem: credit, cap, annR, cushion: (shortCall.strike - spot) / spot, iv: atmIv, delta: shortCall.delta, oi: shortCall.openInterest, earn, aggressive: true });
              }
            }
          }
        } catch (_) { /* skip ticker on any failure */ }
      }

      candidates.sort((a, b) => b.annR - a.annR);
      const top = candidates.slice(0, 12);
      const payload = { at: new Date().toISOString(), universeSize: universe.length, results: top };
      setResults(payload);
      try { localStorage.setItem('opt_scan_cache', JSON.stringify(payload)); } catch {}
      if (!top.length) setError('Scan completed but no candidates passed the filters. Vol may be low across the board, or the option-chain source was unreachable — try again in a minute.');
    } catch (err) {
      setError('Scan failed: ' + err.message);
    }
    setScanning(false);
    setPhase('');
    setProgress(0);
  };

  const pick = c => {
    onPick({
      dateOpened: todayStr(), ticker: c.tk,
      strategy: c.strategy, putCall: c.putCall,
      strike1: String(c.strike1), strike2: c.strike2 ? String(c.strike2) : '',
      expiry: c.expiry, dte: String(c.dte), contracts: '1',
      underlyingAtEntry: String(c.spot.toFixed(2)), ivhv: '', iv: c.iv ? String(c.iv.toFixed(2)) : '',
      delta: String(c.delta.toFixed(2)), premiumReceived: String(c.prem.toFixed(2)),
      outcome: 'Open', closePrice: '', dateClosed: '',
      notes: 'From scanner ' + todayStr() + ' — verify premium at broker before entering'
    });
  };

  return h('div', null,
    h('div', { className: 'card' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 } },
        h('div', null,
          h('div', { style: { fontWeight: 500, marginBottom: 2 } }, 'Candidate scanner'),
          h('div', { style: { fontSize: 11, color: 'var(--text2)' } },
            universe.length + ' tickers in universe · earnings-cleared 21-55 DTE · scan takes ~2 min (API rate limits)')
        ),
        h('div', { style: { display: 'flex', gap: 6 } },
          h('button', { className: 'btn btn-sm', onClick: () => setShowSettings(s => !s) }, 'Universe'),
          h('button', { className: 'btn btn-primary btn-sm', onClick: runScan, disabled: scanning },
            scanning ? 'Scanning…' : 'Scan now')
        )
      ),

      showSettings && h('div', { style: { marginTop: 12 } },
        h('label', { style: { fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 4 } },
          'Tickers to scan (comma or space separated). Fewer = faster scan.'),
        h('textarea', { rows: 3, value: universeText, onChange: e => setUniverseText(e.target.value), style: { width: '100%', fontSize: 12 } }),
        h('div', { style: { marginTop: 6 } },
          h('button', { className: 'btn btn-sm btn-primary', onClick: saveUniverse }, 'Save universe'))
      ),

      scanning && h('div', { style: { marginTop: 12 } },
        h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 4 } }, phase),
        h('div', { className: 'prog-track' },
          h('div', { className: 'prog-fill', style: { width: (progress * 100) + '%', background: '#378add' } }))
      ),

      error && h('div', { style: { marginTop: 10, fontSize: 12, color: '#a32d2d' } }, error)
    ),

    results && results.results && results.results.length > 0 && h('div', null,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
        h('span', { className: 'sec', style: { marginBottom: 0 } },
          results.results.length + ' candidates'),
        h('span', { style: { fontSize: 10, color: 'var(--text3)' } },
          'Scanned ' + new Date(results.at).toLocaleString())
      ),
      results.results.map((c, i) =>
        h('div', { key: i, className: 'card', style: { marginBottom: 8 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
              h('span', { style: { fontWeight: 600, fontSize: 15 } }, c.tk),
              h('span', { className: 'badge ' + (c.strategy === 'Naked Put' ? 'badge-blue' : c.strategy === 'Bull Put Spread' ? 'badge-green' : 'badge-red') }, c.strategy),
              c.aggressive && h('span', { className: 'badge badge-amber' }, 'aggressive'),
              h('span', { style: { fontSize: 11, color: 'var(--text2)' } }, f$(c.spot, 2))
            ),
            h('div', { style: { display: 'flex', gap: 5, alignItems: 'center' } },
              h('span', { className: 'rocp' }, fp(c.annR) + ' ann.'),
              h('button', { className: 'btn btn-sm', onClick: () => pick(c) }, 'Log this trade')
            )
          ),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))', gap: 5, fontSize: 11 } },
            h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'Strike '), h('strong', null, c.strike1 + (c.strike2 ? ' / ' + c.strike2 : ''))),
            h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'Expiry '), h('strong', null, c.expiry + ' (' + c.dte + 'd)')),
            h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'Credit '), h('strong', null, f$(c.prem * 100))),
            h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'At risk '), h('strong', null, f$(c.cap))),
            h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'Cushion '), h('strong', { style: { color: c.cushion > 0.08 ? '#27500a' : '#854f0b' } }, fp(c.cushion))),
            h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'Delta '), h('strong', null, c.delta.toFixed(2))),
            h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'IV '), h('strong', null, c.iv ? fp(c.iv) : '—')),
            h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'OI '), h('strong', null, c.oi || '—'))
          ),
          c.earn && h('div', { style: { fontSize: 10, color: 'var(--text2)', marginTop: 6 } },
            'Next earnings ' + c.earn + ' — after this expiry')
        )
      ),
      h('div', { style: { fontSize: 11, color: 'var(--text2)', marginTop: 4 } },
        'Candidates are math-screened only — bid prices from delayed data. Verify the live premium at your broker and run the EV/Edge checklist before entering. IV/HV needs your broker\'s HV number.')
    )
  );
}
