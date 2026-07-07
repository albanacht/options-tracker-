function Charts({ trades, prices }) {
  const lineRef  = useRefC(null);
  const barRef   = useRefC(null);
  const yieldRef = useRefC(null);
  const charts   = useRefC({});

  const closed   = trades.filter(t => t.outcome && t.outcome !== 'Open');
  const assigned = trades.filter(t => t.outcome === 'Assigned');

  const monthly = useMemoC(() => {
    const map = {};
    trades.forEach(t => {
      if (!t.dateOpened) return;
      const mo = t.dateOpened.slice(0, 7);
      if (!map[mo]) map[mo] = { month: mo, realized: 0, prem: 0, count: 0, wins: 0 };
      map[mo].prem += (parseFloat(t.premiumReceived) || 0) * 100 * (parseInt(t.contracts) || 1);
      if (t.outcome && t.outcome !== 'Open') {
        const m = calcMetrics(t);
        map[mo].realized += (m.pnl || 0);
        map[mo].count++;
        if (['Expired Worthless','Bought Back','Closed Profit'].includes(t.outcome)) map[mo].wins++;
      }
    });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [trades]);

  const cumData = useMemoC(() => {
    let cumR = 0;
    return monthly.map(m => {
      cumR += m.realized;
      const unreal = assigned.reduce((s, t) => {
        if (t.dateOpened && t.dateOpened.slice(0, 7) <= m.month) {
          const s1  = parseFloat(t.strike1) || 0;
          const con = parseInt(t.contracts) || 1;
          const price = prices[t.ticker] || s1;
          return s + (price - s1) * 100 * con;
        }
        return s;
      }, 0);
      return { month: m.month, realized: Math.round(cumR), unrealized: Math.round(unreal), net: Math.round(cumR + unreal) };
    });
  }, [monthly, assigned, prices]);

  // ── Return on deployed capital, monthly ──────────────────────
  // Capital is time-weighted: each position contributes (collateral ×
  // days it was open within the month). Realized P&L is booked in the
  // month the position actually resolved (close date / expiry), so the
  // yield reflects cash actually captured, not premium still at risk.
  const yieldData = useMemoC(() => {
    return monthly.map(({ month: mo }) => {
      const [y, mm] = mo.split('-').map(Number);
      const mStart      = new Date(y, mm - 1, 1);
      const daysInMonth = new Date(y, mm, 0).getDate();
      const mEnd        = new Date(y, mm - 1, daysInMonth);

      let capDays = 0;
      trades.forEach(t => {
        const dc = deployedCapital(t);
        if (dc <= 0) return;
        const span = tradeSpan(t);
        if (!span) return;
        const start = span[0] > mStart ? span[0] : mStart;
        const end   = span[1] < mEnd  ? span[1] : mEnd;
        const od    = daysBetween(start, end) + 1; // inclusive
        if (od > 0) capDays += dc * od;
      });
      const avgCap = daysInMonth > 0 ? capDays / daysInMonth : 0;

      let realized = 0;
      trades.forEach(t => {
        if (!t.outcome || t.outcome === 'Open') return;
        const m = calcMetrics(t);
        if (m.pnl == null) return;
        const rd = t.dateClosed || t.expiry;
        if (rd && rd.slice(0, 7) === mo) realized += m.pnl;
      });

      const roc = avgCap > 0 ? realized / avgCap : 0;
      return { month: mo, avgCap: Math.round(avgCap), realized: Math.round(realized), roc };
    });
  }, [monthly, trades]);

  // ── Yield by risk tier (annualized) ──────────────────────────
  // Groups trades by entry delta (fallback: break-even cushion) and
  // reports return per capital-year deployed = realized P&L ÷
  // Σ(collateral × days held / 365). This is the honest risk lens:
  // did taking more assignment risk actually pay proportionally more?
  const bucketData = useMemoC(() => {
    const order = ['Conservative', 'Moderate', 'Aggressive', 'Unclassified'];
    const agg = {};
    order.forEach(k => agg[k] = { tier: k, capYears: 0, realized: 0, count: 0, wins: 0, closed: 0 });
    trades.forEach(t => {
      const a = agg[riskTier(t)];
      const dc = deployedCapital(t);
      const span = tradeSpan(t);
      if (dc > 0 && span) {
        const days = daysBetween(span[0], span[1]) + 1;
        a.capYears += dc * days / 365;
      }
      a.count++;
      if (t.outcome && t.outcome !== 'Open') {
        const m = calcMetrics(t);
        if (m.pnl != null) {
          a.realized += m.pnl;
          a.closed++;
          if (['Expired Worthless','Bought Back','Closed Profit'].includes(t.outcome)) a.wins++;
        }
      }
    });
    return order.map(k => {
      const a = agg[k];
      return { ...a, annYield: a.capYears > 0 ? a.realized / a.capYears : null, wr: a.closed ? a.wins / a.closed : null };
    }).filter(a => a.count > 0);
  }, [trades]);

  const tierColor = t => t === 'Conservative' ? '#3b6d11'
    : t === 'Moderate' ? '#854f0b'
    : t === 'Aggressive' ? '#a32d2d' : '#777';

  useEffectC(() => {
    if (!lineRef.current || !cumData.length) return;
    if (charts.current.line) charts.current.line.destroy();
    charts.current.line = new Chart(lineRef.current, {
      type: 'line',
      data: {
        labels: cumData.map(d => d.month),
        datasets: [
          { label: 'Realized P&L', data: cumData.map(d => d.realized), borderColor: '#639922', borderWidth: 2, pointRadius: 2, fill: false, tension: 0.3 },
          { label: 'Unrealized (assigned)', data: cumData.map(d => d.unrealized), borderColor: '#e24b4a', borderWidth: 2, pointRadius: 2, fill: false, tension: 0.3, borderDash: [5, 3] },
          { label: 'Net combined', data: cumData.map(d => d.net), borderColor: '#378add', borderWidth: 1.5, pointRadius: 1, fill: false, tension: 0.3, borderDash: [2, 2] },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
          y: { ticks: { font: { size: 10 }, callback: v => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString() } }
        }
      }
    });
  }, [cumData]);

  useEffectC(() => {
    if (!barRef.current || !monthly.length) return;
    if (charts.current.bar) charts.current.bar.destroy();
    charts.current.bar = new Chart(barRef.current, {
      type: 'bar',
      data: {
        labels: monthly.map(d => d.month),
        datasets: [
          { label: 'Premium collected', data: monthly.map(d => d.prem), backgroundColor: '#85b7eb', borderRadius: 3 },
          { label: 'Realized P&L', data: monthly.map(d => d.realized), backgroundColor: monthly.map(d => d.realized >= 0 ? '#97c459' : '#f09595'), borderRadius: 3 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
          y: { ticks: { font: { size: 10 }, callback: v => (v < 0 ? '-$' : '$') + Math.abs(v) } }
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
      data: {
        labels: yieldData.map(d => d.month),
        datasets: [
          { label: 'Return on deployed capital', data: yieldData.map(d => +(d.roc * 100).toFixed(2)),
            backgroundColor: yieldData.map(d => d.roc < 0 ? '#f09595' : d.roc >= sgovMo ? '#97c459' : '#f0b95f'), borderRadius: 3 },
          { type: 'line', label: 'SGOV baseline', data: yieldData.map(() => +(sgovMo * 100).toFixed(3)),
            borderColor: '#7a869a', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, fill: false, tension: 0 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) + '%' } }
        },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
          y: { ticks: { font: { size: 10 }, callback: v => v.toFixed(1) + '%' } }
        }
      }
    });
  }, [yieldData]);

  const totalRealized = closed.reduce((s, t) => { const m = calcMetrics(t); return s + (m.pnl || 0); }, 0);
  const totalPrem     = trades.reduce((s, t) => s + (parseFloat(t.premiumReceived) || 0) * 100 * (parseInt(t.contracts) || 1), 0);
  const wins          = closed.filter(t => ['Expired Worthless','Bought Back','Closed Profit'].includes(t.outcome)).length;
  const wr            = closed.length ? wins / closed.length : 0;
  const totalUnreal   = assigned.reduce((s, t) => {
    const s1 = parseFloat(t.strike1) || 0; const con = parseInt(t.contracts) || 1;
    return s + ((prices[t.ticker] || s1) - s1) * 100 * con;
  }, 0);

  if (!trades.length) return h('div', { className: 'empty' },
    h('i', { className: 'ti ti-chart-bar', 'aria-hidden': true }),
    h('div', null, 'No trade data yet')
  );

  return h('div', null,
    h('div', { className: 'metrics-grid' },
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Realized P&L'), h('div', { className: 'mc-val', style: { color: totalRealized >= 0 ? '#3b6d11' : '#a32d2d' } }, f$(totalRealized))),
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Unrealized'), h('div', { className: 'mc-val', style: { color: totalUnreal >= 0 ? '#3b6d11' : '#a32d2d' } }, f$(totalUnreal))),
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Total premium'), h('div', { className: 'mc-val' }, f$(totalPrem))),
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Win rate'), h('div', { className: 'mc-val' }, fp(wr)))
    ),

    h('div', { className: 'chart-legend' },
      h('span', null, h('span', { className: 'legend-line', style: { background: '#639922' } }), ' Realized P&L'),
      h('span', null, h('span', { className: 'legend-line', style: { background: '#e24b4a' } }), ' Unrealized (dashed)'),
      h('span', null, h('span', { className: 'legend-line', style: { background: '#378add' } }), ' Net combined')
    ),

    cumData.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Cumulative P&L'),
      h('div', { style: { position: 'relative', height: 200 } },
        h('canvas', { ref: lineRef, role: 'img', 'aria-label': 'Cumulative P&L chart with realized, unrealized and net lines' }, 'Cumulative P&L chart.')
      )
    ),

    monthly.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Monthly — premium collected vs realized P&L'),
      h('div', { className: 'chart-legend' },
        h('span', null, h('span', { className: 'legend-box', style: { background: '#85b7eb' } }), ' Premium collected'),
        h('span', null, h('span', { className: 'legend-box', style: { background: '#97c459' } }), ' P&L (green = profit, red = loss)')
      ),
      h('div', { style: { position: 'relative', height: 180 } },
        h('canvas', { ref: barRef, role: 'img', 'aria-label': 'Monthly premium collected and realized P&L bar chart' }, 'Monthly P&L chart.')
      )
    ),

    yieldData.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Return on deployed capital — monthly'),
      h('div', { className: 'chart-legend' },
        h('span', null, h('span', { className: 'legend-box', style: { background: '#97c459' } }), ' Beat SGOV'),
        h('span', null, h('span', { className: 'legend-box', style: { background: '#f0b95f' } }), ' Below SGOV'),
        h('span', null, h('span', { className: 'legend-box', style: { background: '#f09595' } }), ' Negative'),
        h('span', null, h('span', { className: 'legend-line', style: { background: '#7a869a' } }), ' SGOV baseline (' + fp(SGOV_YIELD / 12) + '/mo)')
      ),
      h('div', { style: { position: 'relative', height: 180 } },
        h('canvas', { ref: yieldRef, role: 'img', 'aria-label': 'Monthly return on deployed capital versus SGOV baseline' }, 'Monthly return on deployed capital chart.')
      ),

      h('div', { className: 'sec', style: { marginTop: 18 } }, 'Yield by risk tier (annualized)'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null,
            ['Risk tier','Trades','Realized P&L','Ann. yield on deployed $','Win rate'].map(c => h('th', { key: c }, c))
          )),
          h('tbody', null,
            bucketData.map(b => h('tr', { key: b.tier },
              h('td', null, h('span', {
                style: { background: tierColor(b.tier), color: '#fff', fontSize: 10, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }
              }, b.tier)),
              h('td', null, b.count),
              h('td', { className: b.realized >= 0 ? 'pos-green' : 'pos-red' }, (b.realized >= 0 ? '+' : '') + f$(b.realized)),
              h('td', null, h('span', { className: 'rocp', style: { color: b.annYield == null ? '#777' : b.annYield >= SGOV_YIELD ? '#185fa5' : '#854f0b' } }, b.annYield != null ? fp(b.annYield) : '—')),
              h('td', null, b.wr != null ? fp(b.wr) : '—')
            )),
            h('tr', { style: { borderTop: '2px solid #d8d8d8' } },
              h('td', null, h('em', { style: { color: '#555' } }, 'SGOV (risk-free)')),
              h('td', null, '—'),
              h('td', null, '—'),
              h('td', null, h('span', { className: 'rocp', style: { color: '#7a869a' } }, fp(SGOV_YIELD))),
              h('td', null, '—')
            )
          )
        )
      ),
      h('div', { style: { fontSize: 11, color: '#777', marginTop: 8, lineHeight: 1.5 } },
        'Yield = realized P&L ÷ capital-years deployed (collateral × days held). Tiers by entry delta; falls back to break-even cushion when delta is blank. Covered-call collateral = share value; naked calls excluded. A tier beating SGOV by little is being under-paid for its assignment risk.')
    ),

    h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Closed trade history'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null,
            ['Date','Ticker','Strategy','Strike','Premium','Outcome','P&L','Ann. ROCAR'].map(c => h('th', { key: c }, c))
          )),
          h('tbody', null, [...closed].reverse().map(t => {
            const m = calcMetrics(t);
            const won = ['Expired Worthless','Bought Back','Closed Profit'].includes(t.outcome);
            return h('tr', { key: t.id },
              h('td', { style: { whiteSpace: 'nowrap' } }, t.dateOpened),
              h('td', null, h('strong', null, t.ticker)),
              h('td', { style: { fontSize: 11 } }, t.strategy),
              h('td', null, t.strike1 + (t.strike2 ? ' / ' + t.strike2 : '')),
              h('td', null, f$((parseFloat(t.premiumReceived) || 0) * 100)),
              h('td', null, h('span', { className: 'badge ' + (won ? 'badge-green' : 'badge-red'), style: { fontSize: 10 } }, t.outcome)),
              h('td', { className: m.pnl >= 0 ? 'pos-green' : 'pos-red' }, m.pnl != null ? (m.pnl >= 0 ? '+' : '') + f$(m.pnl) : '—'),
              h('td', null, h('span', { className: 'rocp' }, m.actAnn != null ? fp(m.actAnn) : fp(m.annR)))
            );
          }))
        )
      )
    )
  );
}
