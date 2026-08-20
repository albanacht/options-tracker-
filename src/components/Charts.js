// ── Performance tab ─────────────────────────────────────────────
// All "is this actually working" analytics in one place. Every helper
// (SGOV_YIELD, deployedCapital, tradeSpan, riskTier, daysInMonth,
// monthAxis) comes from utils.js — nothing is defined locally, which is
// what caused the earlier not-defined crashes.

const MIN_BUCKET = 5;   // below this a bucket is noise, shown greyed

function Charts({ trades, prices }) {
  const lineRef  = useRefC(null);
  const barRef   = useRefC(null);
  const yieldRef = useRefC(null);
  const charts   = useRefC({});

  const resolved = trades.filter(t => calcMetrics(t).isResolved);
  // Only put-assignments are share lots — an assigned covered call sold
  // the shares, so counting it here double-booked the unrealised P&L.
  // Only lots still held — retired ones are realised, not unrealised.
  const assigned = openShareLots(trades);

  // Fixed trailing-12-month axis so two data points don't stretch into
  // fat bars and a meaningless straight line.
  const axis = useMemoC(() => monthAxis(12), []);

  // ── Monthly premium + realised P&L ───────────────────────────
  const monthly = useMemoC(() => axis.map(mo => {
    let prem = 0, realized = 0, count = 0, wins = 0;
    trades.forEach(t => {
      const m = calcMetrics(t);
      if (t.dateOpened && t.dateOpened.slice(0, 7) === mo) {
        prem += (parseFloat(t.premiumReceived) || 0) * 100 * (parseInt(t.contracts) || 1);
      }
      const rd = t.dateClosed || t.expiry;
      if (m.isResolved && m.pnl != null && rd && rd.slice(0, 7) === mo) {
        realized += m.pnl;
        if (m.countsWinRate) { count++; if (m.isWin) wins++; }
      }
    });
    return { month: mo, prem: prem, realized: realized, count: count, wins: wins };
  }), [trades, axis]);

  // ── Cumulative realised / unrealised / net ───────────────────
  const cumData = useMemoC(() => {
    let cum = 0;
    return monthly.map(m => {
      cum += m.realized;
      const unreal = assigned.reduce((s, t) => {
        if (t.dateOpened && t.dateOpened.slice(0, 7) <= m.month) {
          const s1 = parseFloat(t.strike1) || 0;
          const con = parseInt(t.contracts) || 1;
          return s + ((prices[t.ticker] || s1) - s1) * 100 * con;
        }
        return s;
      }, 0);
      return { month: m.month, realized: Math.round(cum), unrealized: Math.round(unreal), net: Math.round(cum + unreal) };
    });
  }, [monthly, assigned, prices]);

  // ── Return on deployed capital — ACCRUAL basis ───────────────
  // Premium is earned across the life of a trade, not on its close
  // date. Booking it all at close made months heavy with open
  // positions (capital in the denominator, no income in the
  // numerator) look far worse than they were. Each trade's P&L is now
  // spread evenly over the days it was live.
  //   solid bar  = income from trades that have RESOLVED
  //   light bar  = income accruing on positions still OPEN
  // Assigned share capital is deliberately excluded: it dwarfs option
  // collateral and would swamp the options yield.
  const yieldData = useMemoC(() => axis.map(mo => {
    const parts = mo.split('-').map(Number);
    const y = parts[0], mIdx = parts[1] - 1;
    const dim = new Date(y, parts[1], 0).getDate();

    let capDays = 0, accrRes = 0, accrOpen = 0;
    trades.forEach(t => {
      const dc = deployedCapital(t);
      const span = tradeSpan(t);
      if (!span) return;
      const overlap = daysInMonth(span, y, mIdx);
      if (overlap <= 0) return;
      if (dc > 0) capDays += dc * overlap;

      const life = daysBetween(span[0], span[1]) + 1;
      if (life <= 0) return;
      const m = calcMetrics(t);
      const share = overlap / life;
      if (m.isResolved && m.pnl != null) accrRes += m.pnl * share;
      else if (t.outcome === 'Open') accrOpen += (m.prem * 100 * m.con) * share;
    });

    const avgCap = dim > 0 ? capDays / dim : 0;
    return {
      month: mo, avgCap: Math.round(avgCap),
      resolved: Math.round(accrRes), open: Math.round(accrOpen),
      rocRes:  avgCap > 0 ? accrRes  / avgCap : 0,
      rocOpen: avgCap > 0 ? accrOpen / avgCap : 0
    };
  }), [trades, axis]);

  // ── Is high IV actually paying? (vol harvesting test) ────────
  const ivBuckets = useMemoC(() => {
    const defs = [
      { key: '< 20%',  lo: 0,    hi: 0.20 },
      { key: '20-30%', lo: 0.20, hi: 0.30 },
      { key: '30-40%', lo: 0.30, hi: 0.40 },
      { key: '40%+',   lo: 0.40, hi: 99 }
    ];
    const agg = defs.map(d => ({ key: d.key, lo: d.lo, hi: d.hi, n: 0, wins: 0, pnl: 0, capYears: 0 }));
    resolved.forEach(t => {
      const iv = parseFloat(t.iv);
      if (!iv || iv <= 0) return;
      const b = agg.filter(x => iv >= x.lo && iv < x.hi)[0];
      if (!b) return;
      const m = calcMetrics(t);
      const span = tradeSpan(t);
      const dc = deployedCapital(t);
      if (dc > 0 && span) b.capYears += dc * (daysBetween(span[0], span[1]) + 1) / 365;
      if (m.pnl != null) b.pnl += m.pnl;
      if (m.countsWinRate) { b.n++; if (m.isWin) b.wins++; }
    });
    return agg.map(b => ({
      key: b.key, n: b.n, pnl: b.pnl, capYears: b.capYears,
      wr: b.n ? b.wins / b.n : null,
      yld: b.capYears > 0 ? b.pnl / b.capYears : null,
      thin: b.n < MIN_BUCKET
    })).filter(b => b.n > 0 || b.capYears > 0);
  }, [resolved]);

  // ── Delta calibration ────────────────────────────────────────
  const deltaBuckets = useMemoC(() => {
    const defs = [
      { key: '0.10-0.15', lo: 0.10, hi: 0.15 },
      { key: '0.15-0.20', lo: 0.15, hi: 0.20 },
      { key: '0.20-0.25', lo: 0.20, hi: 0.25 },
      { key: '0.25+',     lo: 0.25, hi: 99 }
    ];
    const agg = defs.map(d => ({ key: d.key, lo: d.lo, hi: d.hi, n: 0, asg: 0, sumDelta: 0 }));
    resolved.forEach(t => {
      const d = Math.abs(parseFloat(t.delta) || 0);
      if (!d) return;
      const b = agg.filter(x => d >= x.lo && d < x.hi)[0];
      if (!b) return;
      b.n++; b.sumDelta += d;
      if (t.outcome === 'Assigned') b.asg++;
    });
    return agg.map(b => ({
      key: b.key, n: b.n,
      predicted: b.n ? b.sumDelta / b.n : null,
      actual: b.n ? b.asg / b.n : null,
      thin: b.n < MIN_BUCKET
    })).filter(b => b.n > 0);
  }, [resolved]);

  // ── Wheel vs buy-and-hold ────────────────────────────────────
  const vsHold = useMemoC(() => {
    let opt = 0, hold = 0, n = 0;
    resolved.forEach(t => {
      const m = calcMetrics(t);
      const entry = parseFloat(t.underlyingAtEntry) || 0;
      const now = prices[t.ticker];
      const cap = m.cap || 0;
      if (!entry || !now || cap <= 0 || m.pnl == null) return;
      opt  += m.pnl;
      hold += (cap / entry) * (now - entry);
      n++;
    });
    return { opt: opt, hold: hold, n: n, edge: opt - hold };
  }, [resolved, prices]);

  // ── Early close vs held to expiry ────────────────────────────
  const closeStyle = useMemoC(() => {
    const early = { n: 0, pnl: 0, days: 0, cap: 0 };
    const held  = { n: 0, pnl: 0, days: 0, cap: 0 };
    resolved.forEach(t => {
      const m = calcMetrics(t);
      const span = tradeSpan(t);
      if (m.pnl == null || !span || (m.cap || 0) <= 0) return;
      const d = daysBetween(span[0], span[1]) + 1;
      if (d <= 0) return;
      const tgt = t.outcome === 'Bought Back' ? early
                : t.outcome === 'Expired Worthless' ? held : null;
      if (!tgt) return;
      tgt.n++; tgt.pnl += m.pnl; tgt.days += d; tgt.cap += m.cap;
    });
    const rate = g => (g.n && g.cap > 0 && g.days > 0)
      ? (g.pnl / (g.cap / g.n)) / (g.days / g.n) * 365 : null;
    return {
      early: { n: early.n, pnl: early.pnl, days: early.days, ann: rate(early) },
      held:  { n: held.n,  pnl: held.pnl,  days: held.days,  ann: rate(held) }
    };
  }, [resolved]);

  // ── Days held: winners vs losers ─────────────────────────────
  const holdTime = useMemoC(() => {
    let wN = 0, wD = 0, lN = 0, lD = 0;
    resolved.forEach(t => {
      const m = calcMetrics(t);
      const span = tradeSpan(t);
      if (!m.countsWinRate || !span || m.pnl == null) return;
      const d = daysBetween(span[0], span[1]) + 1;
      if (m.pnl >= 0) { wN++; wD += d; } else { lN++; lD += d; }
    });
    return { winN: wN, winAvg: wN ? wD / wN : null, lossN: lN, lossAvg: lN ? lD / lN : null };
  }, [resolved]);

  // ── Per-ticker P&L + concentration ───────────────────────────
  const byTicker = useMemoC(() => {
    const map = {};
    trades.forEach(t => {
      if (!t.ticker) return;
      if (!map[t.ticker]) map[t.ticker] = { ticker: t.ticker, n: 0, pnl: 0, cap: 0, open: 0 };
      const s = map[t.ticker];
      const m = calcMetrics(t);
      s.n++;
      if (m.isResolved && m.pnl != null) s.pnl += m.pnl;
      if (t.outcome === 'Open')     { s.open++; s.cap += deployedCapital(t); }
      if (isShareLot(t)) { s.cap += shareCapital(t); }
    });
    const rows = Object.keys(map).map(k => map[k]).sort((a, b) => (b.cap - a.cap) || (b.pnl - a.pnl));
    const totCap = rows.reduce((s, r) => s + r.cap, 0);
    return rows.map(r => ({
      ticker: r.ticker, n: r.n, pnl: r.pnl, cap: r.cap, open: r.open,
      share: totCap > 0 ? r.cap / totCap : 0
    }));
  }, [trades, prices]);

  // ── Headline numbers ─────────────────────────────────────────
  const totalRealized = resolved.reduce((s, t) => s + (calcMetrics(t).pnl || 0), 0);
  const totalPrem = trades.reduce((s, t) => s + (parseFloat(t.premiumReceived) || 0) * 100 * (parseInt(t.contracts) || 1), 0);
  const wrPool = resolved.filter(t => calcMetrics(t).countsWinRate);
  const wr = wrPool.length ? wrPool.filter(t => calcMetrics(t).isWin).length / wrPool.length : 0;
  const totalUnreal = assigned.reduce((s, t) => {
    const s1 = parseFloat(t.strike1) || 0, con = parseInt(t.contracts) || 1;
    return s + ((prices[t.ticker] || s1) - s1) * 100 * con;
  }, 0);

  const gridCol = () => (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches) ? '#2a2d42' : '#e2e5f0';
  const tickCol = '#9196b0';

  useEffectC(() => {
    if (!lineRef.current || !cumData.length) return;
    if (charts.current.line) charts.current.line.destroy();
    charts.current.line = new Chart(lineRef.current, {
      type: 'line',
      data: { labels: cumData.map(d => d.month.slice(2)), datasets: [
        { label: 'Realised', data: cumData.map(d => d.realized), borderColor: '#639922', backgroundColor: 'rgba(99,153,34,0.10)', borderWidth: 2, pointRadius: 0, fill: true, stepped: true },
        { label: 'Unrealised', data: cumData.map(d => d.unrealized), borderColor: '#e24b4a', borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [5, 3], stepped: true },
        { label: 'Net', data: cumData.map(d => d.net), borderColor: '#378add', borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [2, 2], stepped: true }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tickCol, font: { size: 9 }, maxRotation: 45, autoSkip: false }, grid: { display: false } },
          y: { ticks: { color: tickCol, font: { size: 10 }, callback: v => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString() }, grid: { color: gridCol() } }
        }
      }
    });
  }, [cumData]);

  useEffectC(() => {
    if (!barRef.current || !monthly.length) return;
    if (charts.current.bar) charts.current.bar.destroy();
    charts.current.bar = new Chart(barRef.current, {
      type: 'bar',
      data: { labels: monthly.map(d => d.month.slice(2)), datasets: [
        { label: 'Premium', data: monthly.map(d => Math.round(d.prem)), backgroundColor: '#85b7eb', borderRadius: 3, maxBarThickness: 22 },
        { label: 'Realised', data: monthly.map(d => Math.round(d.realized)), backgroundColor: monthly.map(d => d.realized >= 0 ? '#97c459' : '#f09595'), borderRadius: 3, maxBarThickness: 22 }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tickCol, font: { size: 9 }, maxRotation: 45, autoSkip: false }, grid: { display: false } },
          y: { ticks: { color: tickCol, font: { size: 10 }, callback: v => (v < 0 ? '-$' : '$') + Math.abs(v) }, grid: { color: gridCol() } }
        }
      }
    });
  }, [monthly]);

  useEffectC(() => {
    if (!yieldRef.current || !yieldData.length) return;
    if (charts.current.yield) charts.current.yield.destroy();
    const sgovMo = SGOV_YIELD / 12;
    charts.current.yield = new Chart(yieldRef.current, {
      type: 'bar',
      data: { labels: yieldData.map(d => d.month.slice(2)), datasets: [
        { label: 'Earned (resolved)', data: yieldData.map(d => +(d.rocRes * 100).toFixed(3)),
          backgroundColor: yieldData.map(d => d.rocRes < 0 ? '#f09595' : '#97c459'), borderRadius: 2, stack: 's', maxBarThickness: 26 },
        { label: 'Accruing (open)', data: yieldData.map(d => +(d.rocOpen * 100).toFixed(3)),
          backgroundColor: 'rgba(151,196,89,0.38)', borderRadius: 2, stack: 's', maxBarThickness: 26 },
        { type: 'line', label: 'SGOV', data: yieldData.map(() => +(sgovMo * 100).toFixed(3)),
          borderColor: '#7a869a', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, fill: false }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.parsed.y.toFixed(2) + '%' } } },
        scales: {
          x: { stacked: true, ticks: { color: tickCol, font: { size: 9 }, maxRotation: 45, autoSkip: false }, grid: { display: false } },
          y: { stacked: true, ticks: { color: tickCol, font: { size: 10 }, callback: v => v.toFixed(2) + '%' }, grid: { color: gridCol() } }
        }
      }
    });
  }, [yieldData]);

  if (!trades.length) return h('div', { className: 'empty' },
    h('i', { className: 'ti ti-chart-bar', 'aria-hidden': true }),
    h('div', null, 'No trade data yet')
  );

  const note = txt => h('div', { className: 'chart-note' }, txt);
  const thinCell = b => b.thin ? { color: 'var(--text3)' } : {};

  return h('div', null,
    h('div', { className: 'metrics-grid' },
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Realised P&L'),
        h('div', { className: 'mc-val', style: { color: totalRealized >= 0 ? '#3b6d11' : '#a32d2d' } }, f$(totalRealized))),
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Unrealised'),
        h('div', { className: 'mc-val', style: { color: totalUnreal >= 0 ? '#3b6d11' : '#a32d2d' } }, f$(totalUnreal))),
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Premium written'), h('div', { className: 'mc-val' }, f$(totalPrem))),
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Win rate'),
        h('div', { className: 'mc-val' }, wrPool.length ? fp(wr) : '—'),
        h('div', { style: { fontSize: 10, color: 'var(--text2)' } }, wrPool.length + ' resolved'))
    ),

    vsHold.n > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Wheel vs buy-and-hold'),
      h('div', { className: 'cap-split' },
        h('div', null, h('span', { className: 'pos-stat-label' }, 'Option P&L '),
          h('strong', { className: vsHold.opt >= 0 ? 'pos-green' : 'pos-red' }, f$(vsHold.opt))),
        h('div', null, h('span', { className: 'pos-stat-label' }, 'Same capital in shares '),
          h('strong', { className: vsHold.hold >= 0 ? 'pos-green' : 'pos-red' }, f$(vsHold.hold))),
        h('div', null, h('span', { className: 'pos-stat-label' }, 'Wheel edge '),
          h('strong', { style: { color: vsHold.edge >= 0 ? '#27500a' : '#a32d2d' } },
            (vsHold.edge >= 0 ? '+' : '') + f$(vsHold.edge)))
      ),
      note('Across ' + vsHold.n + ' resolved trades: what you actually made selling the option, versus buying the shares at your entry price and holding them to today. Positive edge means the wheel beat simply owning the stock.')
    ),

    h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Cumulative P&L — 12 months'),
      h('div', { className: 'chart-legend' },
        h('span', null, h('span', { className: 'legend-line', style: { background: '#639922' } }), ' Realised'),
        h('span', null, h('span', { className: 'legend-line', style: { background: '#e24b4a' } }), ' Unrealised'),
        h('span', null, h('span', { className: 'legend-line', style: { background: '#378add' } }), ' Net')
      ),
      h('div', { style: { position: 'relative', height: 190 } },
        h('canvas', { ref: lineRef, role: 'img', 'aria-label': 'Cumulative profit and loss over the trailing twelve months' }, 'Cumulative P&L.'))
    ),

    h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Premium written vs realised — monthly'),
      h('div', { className: 'chart-legend' },
        h('span', null, h('span', { className: 'legend-box', style: { background: '#85b7eb' } }), ' Premium written'),
        h('span', null, h('span', { className: 'legend-box', style: { background: '#97c459' } }), ' Realised P&L')
      ),
      h('div', { style: { position: 'relative', height: 170 } },
        h('canvas', { ref: barRef, role: 'img', 'aria-label': 'Monthly premium written versus realised profit and loss' }, 'Monthly bars.'))
    ),

    h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Return on deployed capital — monthly'),
      h('div', { className: 'chart-legend' },
        h('span', null, h('span', { className: 'legend-box', style: { background: '#97c459' } }), ' Earned (resolved)'),
        h('span', null, h('span', { className: 'legend-box', style: { background: 'rgba(151,196,89,0.38)' } }), ' Accruing (open)'),
        h('span', null, h('span', { className: 'legend-line', style: { background: '#7a869a' } }), ' SGOV (' + fp(SGOV_YIELD / 12, 2) + '/mo)')
      ),
      h('div', { style: { position: 'relative', height: 170 } },
        h('canvas', { ref: yieldRef, role: 'img', 'aria-label': 'Monthly return on deployed option collateral against the SGOV baseline' }, 'Monthly yield.')),
      note('Premium accrues across the days a trade is live rather than landing entirely on its close date — so a month full of open positions no longer shows capital with no income against it. Assigned share capital is excluded here; it would swamp the option collateral. Total capital is on the Positions tab.')
    ),

    ivBuckets.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Harvesting volatility, or selling cheap insurance?'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['IV at entry','Trades','Win rate','Realised','Ann. yield on capital'].map(x => h('th', { key: x }, x)))),
          h('tbody', null, ivBuckets.map(b => h('tr', { key: b.key },
            h('td', { style: thinCell(b) }, h('strong', null, b.key)),
            h('td', { style: thinCell(b) }, b.n + (b.thin ? ' ⚠' : '')),
            h('td', { style: thinCell(b) }, b.wr != null ? fp(b.wr) : '—'),
            h('td', { style: thinCell(b), className: b.pnl >= 0 ? 'pos-green' : 'pos-red' }, (b.pnl >= 0 ? '+' : '') + f$(b.pnl)),
            h('td', { style: thinCell(b) }, b.yld != null ? h('span', { className: 'rocp' }, fp(b.yld)) : '—')
          )))
        )
      ),
      note('If yield rises with entry IV you are being paid a real volatility premium. If it is flat, the extra IV is just extra risk for the same money. Rows marked ⚠ have fewer than ' + MIN_BUCKET + ' trades — treat as noise.')
    ),

    deltaBuckets.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Delta calibration — predicted vs actual assignment'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['Delta at entry','Trades','Market predicted','You actually got','Read'].map(x => h('th', { key: x }, x)))),
          h('tbody', null, deltaBuckets.map(b => {
            const diff = (b.actual != null && b.predicted != null) ? b.actual - b.predicted : null;
            const read = b.thin ? 'insufficient data'
              : diff == null ? '—'
              : diff < -0.05 ? 'selection adding value'
              : diff > 0.05 ? 'assigned more than expected'
              : 'as priced';
            const col = (!b.thin && diff != null)
              ? { color: diff > 0.05 ? '#a32d2d' : diff < -0.05 ? '#27500a' : 'var(--text2)' } : {};
            return h('tr', { key: b.key },
              h('td', { style: thinCell(b) }, h('strong', null, b.key)),
              h('td', { style: thinCell(b) }, b.n + (b.thin ? ' ⚠' : '')),
              h('td', { style: thinCell(b) }, b.predicted != null ? fp(b.predicted) : '—'),
              h('td', { style: thinCell(b) }, b.actual != null ? fp(b.actual) : '—'),
              h('td', { style: Object.assign({ fontSize: 11 }, thinCell(b), col) }, read)
            );
          }))
        )
      ),
      note('Delta at entry is the market\u2019s own estimate of assignment probability. Getting assigned less often than predicted means your selection is adding value; more often means the opposite.')
    ),

    (closeStyle.early.n > 0 || closeStyle.held.n > 0 || holdTime.winN > 0 || holdTime.lossN > 0) && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Exit discipline'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['','Trades','Avg days held','Annualised return'].map(x => h('th', { key: x }, x)))),
          h('tbody', null,
            h('tr', null,
              h('td', null, h('strong', null, 'Bought back early')),
              h('td', null, closeStyle.early.n || '—'),
              h('td', null, closeStyle.early.n ? (closeStyle.early.days / closeStyle.early.n).toFixed(0) : '—'),
              h('td', null, closeStyle.early.ann != null ? h('span', { className: 'rocp' }, fp(closeStyle.early.ann)) : '—')),
            h('tr', null,
              h('td', null, h('strong', null, 'Held to expiry')),
              h('td', null, closeStyle.held.n || '—'),
              h('td', null, closeStyle.held.n ? (closeStyle.held.days / closeStyle.held.n).toFixed(0) : '—'),
              h('td', null, closeStyle.held.ann != null ? h('span', { className: 'rocp' }, fp(closeStyle.held.ann)) : '—')),
            h('tr', { style: { borderTop: '2px solid var(--border2)' } },
              h('td', null, h('em', { style: { color: 'var(--text2)' } }, 'Winners')),
              h('td', null, holdTime.winN || '—'),
              h('td', null, holdTime.winAvg != null ? holdTime.winAvg.toFixed(0) : '—'),
              h('td', null, '')),
            h('tr', null,
              h('td', null, h('em', { style: { color: 'var(--text2)' } }, 'Losers')),
              h('td', null, holdTime.lossN || '—'),
              h('td', { style: (holdTime.lossAvg != null && holdTime.winAvg != null && holdTime.lossAvg > holdTime.winAvg * 1.5) ? { color: '#a32d2d', fontWeight: 500 } : {} },
                holdTime.lossAvg != null ? holdTime.lossAvg.toFixed(0) : '—'),
              h('td', null, ''))
          )
        )
      ),
      note('Closing early versus letting trades run to expiry, on a per-day basis. If losers are held far longer than winners, that is the "waiting for it to come back" pattern showing up in your own data.')
    ),

    byTicker.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'By ticker — P&L and concentration'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['Ticker','Trades','Realised P&L','Capital tied up','% of deployed'].map(x => h('th', { key: x }, x)))),
          h('tbody', null, byTicker.map(r => h('tr', { key: r.ticker },
            h('td', null, h('strong', null, r.ticker),
              r.open > 0 && h('span', { className: 'badge badge-blue', style: { fontSize: 9, marginLeft: 6 } }, 'open')),
            h('td', null, r.n),
            h('td', { className: r.pnl >= 0 ? 'pos-green' : 'pos-red' }, (r.pnl >= 0 ? '+' : '') + f$(r.pnl)),
            h('td', null, r.cap > 0 ? f$(r.cap) : '—'),
            h('td', null, r.cap > 0
              ? h('span', { className: 'badge ' + (r.share > 0.4 ? 'badge-red' : r.share > 0.25 ? 'badge-amber' : 'badge-gray') }, fp(r.share))
              : '—')
          )))
        )
      ),
      note('Amber above 25% of deployed capital, red above 40%. Concentration is the risk that does the real damage — better seen before a position becomes a problem than after.')
    ),

    resolved.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Resolved trades'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['Date','Ticker','Strategy','Strike','Premium','Outcome','P&L','Ann.'].map(x => h('th', { key: x }, x)))),
          h('tbody', null, [...resolved].reverse().map(t => {
            const m = calcMetrics(t);
            const cls = m.isAssigned ? 'badge-amber' : m.isWin ? 'badge-green' : 'badge-red';
            return h('tr', { key: t.id },
              h('td', { style: { whiteSpace: 'nowrap' } }, t.dateOpened),
              h('td', null, h('strong', null, t.ticker)),
              h('td', { style: { fontSize: 11 } }, t.strategy),
              h('td', null, t.strike1 + (t.strike2 ? ' / ' + t.strike2 : '')),
              h('td', null, f$((parseFloat(t.premiumReceived) || 0) * 100)),
              h('td', null, h('span', { className: 'badge ' + cls, style: { fontSize: 10 } }, t.outcome)),
              h('td', { className: (m.pnl || 0) >= 0 ? 'pos-green' : 'pos-red' },
                m.pnl != null ? ((m.pnl >= 0 ? '+' : '') + f$(m.pnl)) : '—'),
              h('td', null, h('span', { className: 'rocp' }, m.actAnn != null ? fp(m.actAnn) : fp(m.annR)))
            );
          }))
        )
      )
    )
  );
}
