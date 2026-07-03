// ── Scanner: on-demand candidate finder ─────────────────────────
// Stage 1 (Finnhub): earnings dates for the universe, throttled to the
// 60 calls/min free tier.
// Stage 2 (marketdata.app): one option-chain call per ticker — returns
// spot, real deltas, IV, bid/ask, OI directly. Free tier: 100 calls/day,
// so ~3 full scans per day.

const SCANNER_DEFAULT_UNIVERSE = [
  'VZ','T','KO','PEP','PG','JNJ','BMY','MRK','PFE','ABBV','MO','BTI',
  'O','WPC','VICI','ARE','OKE','KMI','XOM','CVX','JPM','BAC','USB',
  'CSCO','QCOM','INTC','GOOG','AMZN','AAPL','MSFT','CRM','TGT'
];

const MARKETDATA_KEY = 'Wk9KWF9SdExJRlc4VWhwMnhtcllydjZFLS1xeGtNclBsSDRMQTR0VXJUaz0';

// Throttled batch runner for Finnhub (60 calls/min free tier)
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

// marketdata.app returns 200 for live data and 203 for cached — both valid
async function mdGet(path) {
  const r = await fetch('https://api.marketdata.app/v1' + path + (path.includes('?') ? '&' : '?') + 'token=' + MARKETDATA_KEY, { signal: AbortSignal.timeout(10000) });
  if (r.status === 429) throw new Error('quota');
  if (!r.ok && r.status !== 203) throw new Error('marketdata ' + r.status);
  return r.json();
}

function contractOk(row) {
  if (!row.bid || row.bid <= 0.05) return false;
  const mid = ((row.ask || 0) + row.bid) / 2;
  if ((row.ask || 0) - row.bid > Math.max(0.15, mid * 0.12)) return false;
  if ((row.oi || 0) < 100) return false;
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
    const candidates = [];
    let chainsTried = 0, chainsOk = 0, quotaHit = false;

    try {
      // ── Stage 1: earnings dates (Finnhub, throttled) ─────────
      setPhase('Stage 1/2 — checking earnings dates');
      setProgress(0);
      const from = todayStr();
      const toDate = new Date(); toDate.setDate(toDate.getDate() + 60);
      const to = toDate.toISOString().slice(0, 10);
      const earnTasks = universe.map(tk => () =>
        finnhubGet('/calendar/earnings?from=' + from + '&to=' + to + '&symbol=' + tk)
          .then(e => ({ tk, earnings: (e.earningsCalendar && e.earningsCalendar[0] && e.earningsCalendar[0].date) || null }))
      );
      const earnings = await batchRun(earnTasks, 20, 21000, (done, total) => setProgress(done / total * 0.45));
      const earnMap = {};
      earnings.forEach(e => { if (e) earnMap[e.tk] = e.earnings; });

      // ── Stage 2: option chains (marketdata.app, parallel) ────
      setPhase('Stage 2/2 — analyzing option chains');
      let done = 0;
      const chainBatch = 4;
      for (let i = 0; i < universe.length; i += chainBatch) {
        const slice = universe.slice(i, i + chainBatch);
        await Promise.all(slice.map(async tk => {
          done++;
          setProgress(0.45 + (done / universe.length) * 0.55);
          chainsTried++;
          try {
            // One call: OTM contracts (both sides) at the expiry closest to 35 DTE.
            const md = await mdGet('/options/chain/' + tk + '/?dte=35&range=otm');
            if (!md || md.s !== 'ok' || !md.strike || !md.strike.length) return;
            chainsOk++;

            const rows = md.strike.map((k, ix) => ({
              side: md.side[ix], strike: k,
              bid: md.bid ? md.bid[ix] : 0, ask: md.ask ? md.ask[ix] : 0,
              oi: md.openInterest ? md.openInterest[ix] : 0,
              iv: md.iv ? md.iv[ix] : null,
              delta: md.delta ? md.delta[ix] : null,
              exp: md.expiration[ix], dte: md.dte ? md.dte[ix] : null
            }));

            const dte = rows[0].dte;
            if (dte == null || dte < 21 || dte > 55) return;
            const expiryStr = new Date(rows[0].exp * 1000).toISOString().slice(0, 10);
            const spot = md.underlyingPrice && md.underlyingPrice[0] ? md.underlyingPrice[0] : null;
            if (!spot) return;

            // Earnings inside the option window → skip entirely
            const earn = earnMap[tk];
            if (earn && earn <= expiryStr) return;

            const puts  = rows.filter(r => r.side === 'put'  && contractOk(r));
            const calls = rows.filter(r => r.side === 'call' && contractOk(r));

            // Vol context: IV of the nearest-to-money put
            const nearPut = rows.filter(r => r.side === 'put' && r.iv)
              .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
            const atmIv = nearPut ? nearPut.iv : null;

            // ── Wheel candidate: best put in 0.12–0.30 |delta| band ──
            let bestPut = null;
            for (const r of puts) {
              if (r.strike >= spot || r.delta == null) continue;
              const ad = Math.abs(r.delta);
              if (ad < 0.12 || ad > 0.30) continue;
              const prem = r.bid;
              const cap = r.strike * 100;
              const annR = (prem * 100 / cap) * (365 / dte);
              const be = r.strike - prem;
              const cushion = (spot - be) / spot;
              const cand = { tk, spot, strategy: 'Naked Put', putCall: 'P', strike1: r.strike, strike2: null, expiry: expiryStr, dte, prem, cap, annR, cushion, iv: r.iv, delta: ad, oi: r.oi, earn };
              if (!bestPut || cand.annR > bestPut.annR) bestPut = cand;
            }
            if (bestPut) candidates.push(bestPut);

            // ── Bull put spread: when vol is elevated (ATM IV ≥ 30%) ──
            if (bestPut && atmIv && atmIv >= 0.30) {
              const shortR = puts.find(r => r.strike === bestPut.strike1);
              const longR = puts
                .filter(r => r.strike < bestPut.strike1 && bestPut.strike1 - r.strike >= 5 && bestPut.strike1 - r.strike <= 10 && r.ask > 0)
                .sort((a, b) => b.strike - a.strike)[0];
              if (shortR && longR) {
                const credit = shortR.bid - longR.ask;
                const width = bestPut.strike1 - longR.strike;
                if (credit > 0.1 && credit / width >= 0.12) {
                  const cap = (width - credit) * 100;
                  const annR = (credit * 100 / cap) * (365 / dte);
                  candidates.push({ tk, spot, strategy: 'Bull Put Spread', putCall: 'P', strike1: bestPut.strike1, strike2: longR.strike, expiry: expiryStr, dte, prem: credit, cap, annR, cushion: bestPut.cushion, iv: atmIv, delta: bestPut.delta, oi: shortR.oi, earn });
                }
              }
            }

            // ── Bear call spread: only in hot vol (IV ≥ 40%) ─────
            if (atmIv && atmIv >= 0.40 && calls.length) {
              let shortCall = null;
              for (const r of calls) {
                if (r.strike <= spot || r.delta == null) continue;
                if (r.delta < 0.15 || r.delta > 0.28) continue;
                if (!shortCall || r.strike < shortCall.strike) shortCall = r;
              }
              const longCall = shortCall && calls
                .filter(r => r.strike > shortCall.strike && r.strike - shortCall.strike >= 5 && r.strike - shortCall.strike <= 10 && r.ask > 0)
                .sort((a, b) => a.strike - b.strike)[0];
              if (shortCall && longCall) {
                const credit = shortCall.bid - longCall.ask;
                const width = longCall.strike - shortCall.strike;
                if (credit > 0.1 && credit / width >= 0.15) {
                  const cap = (width - credit) * 100;
                  const annR = (credit * 100 / cap) * (365 / dte);
                  candidates.push({ tk, spot, strategy: 'Bear Call Spread', putCall: 'C', strike1: shortCall.strike, strike2: longCall.strike, expiry: expiryStr, dte, prem: credit, cap, annR, cushion: (shortCall.strike - spot) / spot, iv: atmIv, delta: shortCall.delta, oi: shortCall.oi, earn, aggressive: true });
                }
              }
            }
          } catch (err) {
            if (err.message === 'quota') quotaHit = true;
          }
        }));
      }

      candidates.sort((a, b) => b.annR - a.annR);
      const top = candidates.slice(0, 12);
      const payload = { at: new Date().toISOString(), universeSize: universe.length, results: top };
      setResults(payload);
      try { localStorage.setItem('opt_scan_cache', JSON.stringify(payload)); } catch {}

      if (!top.length) {
        if (quotaHit) setError('marketdata.app daily quota exhausted (100 calls/day on the free tier). Try again tomorrow, or shrink the universe.');
        else if (chainsOk === 0) setError('No option chains could be fetched (' + chainsTried + ' attempted). If markets just closed for a holiday, data may be unavailable — otherwise check the marketdata.app token.');
        else setError('Chains fetched for ' + chainsOk + ' tickers, but no contracts passed the filters (delta 0.12-0.30, OI ≥ 100, tight spreads, earnings-clear). Vol may simply be low across your universe today.');
      }
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
            universe.length + ' tickers · earnings-cleared · 21-55 DTE · ~40s scan · ~3 scans/day (data quota)')
        ),
        h('div', { style: { display: 'flex', gap: 6 } },
          h('button', { className: 'btn btn-sm', onClick: () => setShowSettings(s => !s) }, 'Universe'),
          h('button', { className: 'btn btn-primary btn-sm', onClick: runScan, disabled: scanning },
            scanning ? 'Scanning…' : 'Scan now')
        )
      ),

      showSettings && h('div', { style: { marginTop: 12 } },
        h('label', { style: { fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 4 } },
          'Tickers to scan (comma or space separated). Fewer tickers = more scans per day within the data quota.'),
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
        'Candidates are math-screened only — data may be delayed. Verify the live premium at your broker and run the EV/Edge checklist before entering.')
    )
  );
}
