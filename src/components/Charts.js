const { createElement: h, useEffect: useEffectC, useRef: useRefC, useMemo: useMemoC } = React;

function Charts({ trades, prices }) {
  const lineRef = useRefC(null);
  const barRef  = useRefC(null);
  const charts  = useRefC({});

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
