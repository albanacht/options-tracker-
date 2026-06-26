function legColor(t) {
  if (t.outcome === 'Assigned') return '#185fa5';
  if (t.strategy === 'Covered Call') return '#1d9e75';
  if (t.outcome === 'Open') return '#ef9f27';
  if (t.outcome === 'Expired Worthless' || t.outcome === 'Bought Back' || t.outcome === 'Closed Profit') return '#7ab648';
  if (t.outcome === 'Closed Loss' || t.outcome === 'Max Loss') return '#d65c5c';
  return '#9196b0';
}
function legLabel(t) {
  if (t.outcome === 'Assigned') return 'Put';
  if (t.strategy === 'Covered Call') return 'CC';
  if (t.strategy && t.strategy.includes('Spread')) return 'Spr';
  if (t.putCall === 'P') return 'Put';
  if (t.putCall === 'C') return 'Call';
  return '';
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function GanttChart({ trades }) {
  const relevant = trades.filter(t => t.dateOpened && t.ticker);
  const tickers = [...new Set(relevant.map(t => t.ticker))].filter(Boolean);

  if (!tickers.length) return h('div', { style: { fontSize: 11, color: 'var(--text2)' } }, 'No trades to display yet.');

  const now = today();
  const windowStart = getMonday(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()));
  const windowEnd   = new Date(now.getFullYear(), now.getMonth() + 2, now.getDate());

  const allDates = relevant.flatMap(t => [fd(t.dateOpened), fd(t.dateClosed || t.expiry)]).filter(Boolean);
  const minD = new Date(Math.min(windowStart.getTime(), ...allDates.map(d => d.getTime())));
  const maxD = new Date(Math.max(windowEnd.getTime(), ...allDates.map(d => d.getTime())));

  const totalMs = maxD - minD || 1;
  const pct = d => d ? Math.max(0, Math.min(100, (d - minD) / totalMs * 100)) : 0;

  const weeks = [];
  let cursor = getMonday(minD);
  while (cursor <= maxD) {
    weeks.push(new Date(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
  }

  const months = [];
  let mCursor = new Date(minD.getFullYear(), minD.getMonth(), 1);
  while (mCursor <= maxD) {
    months.push(new Date(mCursor));
    mCursor = new Date(mCursor.getFullYear(), mCursor.getMonth() + 1, 1);
  }

  const todayPct = pct(now);

  return h('div', { className: 'gantt-container' },

    h('div', { className: 'gantt-month-row' },
      h('div', { className: 'gantt-label' }, ''),
      h('div', { className: 'gantt-month-track' },
        months.map((m, i) => {
          const left = pct(m);
          const nextM = months[i + 1] || maxD;
          const width = pct(nextM) - left;
          return h('div', {
            key: i,
            className: 'gantt-month-label',
            style: { left: left + '%', width: Math.max(width, 4) + '%' }
          }, m.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        })
      )
    ),

    tickers.map(ticker => {
      const legs = trades
        .filter(t => t.ticker === ticker && t.dateOpened)
        .sort((a, b) => a.dateOpened.localeCompare(b.dateOpened));

      return h('div', { key: ticker, className: 'gantt-row' },
        h('div', { className: 'gantt-label', title: ticker }, ticker),
        h('div', { className: 'gantt-track' },

          weeks.map((w, i) => h('div', {
            key: 'w' + i,
            className: 'gantt-week-line',
            style: { left: pct(w) + '%' }
          })),

          h('div', { className: 'gantt-today-line', style: { left: todayPct + '%' } }),

          legs.map((l, i) => {
            const start = fd(l.dateOpened);
            const end   = fd(l.dateClosed || l.expiry) || now;
            if (!start) return null;
            const left  = pct(start);
            const width = Math.max(0.6, pct(end) - left);
            const col   = legColor(l);
            const label = legLabel(l);
            const m = calcMetrics(l);
            const tip = l.ticker + ' ' + (l.strategy || '') + ' · opened ' + l.dateOpened
              + ' · strike ' + (l.strike1 || '—')
              + (m.pnl != null ? ' → ' + f$(m.pnl) : ' (open, exp ' + (l.expiry || '—') + ')');

            return h('div', {
              key: i, className: 'gantt-seg',
              title: tip,
              style: {
                left: left + '%', width: width + '%',
                background: col + '30', borderLeft: '2px solid ' + col
              }
            },
              width > 5 && h('span', { style: { color: col } }, label)
            );
          })
        )
      );
    }),

    h('div', { className: 'gantt-row' },
      h('div', { className: 'gantt-label' }, ''),
      h('div', { className: 'gantt-week-axis' },
        weeks.filter((_, i) => i % 2 === 0).map((w, i) => h('span', {
          key: i,
          style: { left: pct(w) + '%' }
        }, w.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })))
      )
    ),

    h('div', { className: 'gantt-legend' },
      h('span', null, h('span', { className: 'dot', style: { background: '#185fa5' } }), ' Put / assigned'),
      h('span', null, h('span', { className: 'dot', style: { background: '#1d9e75' } }), ' Covered call'),
      h('span', null, h('span', { className: 'dot', style: { background: '#7ab648' } }), ' Closed — won'),
      h('span', null, h('span', { className: 'dot', style: { background: '#d65c5c' } }), ' Closed — lost'),
      h('span', null, h('span', { className: 'dot', style: { background: '#ef9f27' } }), ' Open'),
      h('span', null, h('span', { style: { display: 'inline-block', width: 2, height: 10, background: '#185fa5' } }), ' Today')
    )
  );
}


function CCForm({ ticker, onSave, onCancel }) {
  const [t, setT] = useStateWC({
    dateOpened: todayStr(), ticker, strategy: 'Covered Call', putCall: 'C',
    strike1: '', expiry: '', dte: '30', contracts: '1',
    underlyingAtEntry: '', premiumReceived: '', outcome: 'Open', dateClosed: '', notes: ''
  });
  const up = (k, v) => setT(p => ({ ...p, [k]: v }));

  return h('div', null,
    h('div', { className: 'form-grid' },
      h('div', { className: 'field' }, h('label', null, 'Date'), h('input', { type: 'date', value: t.dateOpened, onChange: e => up('dateOpened', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'Strike (call)'), h('input', { type: 'number', step: '0.5', value: t.strike1, onChange: e => up('strike1', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'Expiry'), h('input', { type: 'date', value: t.expiry, onChange: e => up('expiry', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'DTE'), h('input', { type: 'number', value: t.dte, onChange: e => up('dte', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'Premium ($)'), h('input', { type: 'number', step: '0.01', value: t.premiumReceived, onChange: e => up('premiumReceived', e.target.value) })),
      h('div', { className: 'field' },
        h('label', null, 'Outcome'),
        h('select', { value: t.outcome, onChange: e => up('outcome', e.target.value) },
          ['Open', 'Expired Worthless', 'Assigned'].map(o => h('option', { key: o, value: o }, o))
        )
      ),
      t.outcome !== 'Open' && h('div', { className: 'field' }, h('label', null, 'Date closed'), h('input', { type: 'date', value: t.dateClosed || '', onChange: e => up('dateClosed', e.target.value) }))
    ),
    h('div', { className: 'btn-group' },
      h('button', { className: 'btn btn-primary btn-sm', onClick: () => onSave({ ...t, id: String(Date.now()) }) }, 'Save covered call'),
      h('button', { className: 'btn btn-sm', onClick: onCancel }, 'Cancel')
    )
  );
}

function WheelCycles({ trades, prices, onUpdateTrade, onAddTrade }) {
  const [expanded, setExpanded] = useStateWC({});
  const [ccForm, setCcForm]     = useStateWC(null);
  const toggle = id => setExpanded(p => ({ ...p, [id]: !p[id] }));

  const cycles = useMemoWC(() => {
    const assigned = trades.filter(t => t.outcome === 'Assigned');
    return assigned.map(t => {
      const ticker = t.ticker;
      const openDate = t.dateOpened || '';

      const ccs = trades.filter(x =>
        x.strategy === 'Covered Call' && x.ticker === ticker &&
        (x.dateOpened || '') >= openDate && x.outcome !== 'Open'
      );
      const openCcs = trades.filter(x =>
        x.strategy === 'Covered Call' && x.ticker === ticker &&
        (x.dateOpened || '') >= openDate && x.outcome === 'Open'
      );

      const ccIncome = ccs.reduce((s, c) => { const m = calcMetrics(c); return s + (m.pnl || 0); }, 0);
      const strike   = parseFloat(t.strike1) || 0;
      const prem     = parseFloat(t.premiumReceived) || 0;
      const con      = parseInt(t.contracts) || 1;
      const costBasis = strike - prem;
      const price     = prices[ticker];
      const unrealized = price != null ? (price - strike) * 100 * con : null;
      const putPnl    = prem * 100 * con;

      const calledAway = ccs.find(c => c.outcome === 'Assigned');
      const isComplete = !!calledAway;
      const salePrice  = calledAway ? parseFloat(calledAway.strike1) || 0 : 0;
      const completePnl = isComplete
        ? putPnl + ccIncome + (salePrice - strike) * 100 * con
        : null;

      const startDate = fd(t.dateOpened);
      const endDate   = calledAway ? fd(calledAway.dateClosed || calledAway.expiry) : null;
      const totalDays = startDate && endDate
        ? daysBetween(startDate, endDate)
        : startDate ? daysBetween(startDate, today()) : 0;

      const cap = strike * 100 * con;
      const annRocar = completePnl != null && totalDays > 0
        ? (completePnl / cap) * (365 / totalDays) : null;

      const legs = [
        { type: 'Put', date: t.dateOpened, strike: t.strike1, prem, pnl: putPnl, expiry: t.expiry, outcome: 'Assigned' },
        ...ccs.map(c => ({ type: 'CC', date: c.dateOpened, strike: c.strike1, prem: parseFloat(c.premiumReceived) || 0, pnl: calcMetrics(c).pnl, expiry: c.expiry, outcome: c.outcome })),
        ...openCcs.map(c => ({ type: 'CC (open)', date: c.dateOpened, strike: c.strike1, prem: parseFloat(c.premiumReceived) || 0, pnl: null, expiry: c.expiry, outcome: 'Open' }))
      ];

      return { ...t, costBasis, ccIncome, unrealized, putPnl, completePnl, isComplete, legs, totalDays, annRocar, cap, openCcs };
    });
  }, [trades, prices]);

  const active   = cycles.filter(c => !c.isComplete);
  const complete = cycles.filter(c => c.isComplete);

  const CycleCard = ({ c, muted }) => {
    const exp  = expanded[c.id];
    const price = prices[c.ticker];
    const recov = c.unrealized != null && c.unrealized < 0 && c.ccIncome > 0
      ? Math.min(1, c.ccIncome / Math.abs(c.unrealized)) : 0;
    const netPnl = c.isComplete ? c.completePnl
      : (c.putPnl + c.ccIncome + (c.unrealized || 0));

    return h('div', { className: muted ? 'card-muted' : 'card' },
      h('div', { className: 'cycle-header' },
        h('div', { className: 'cycle-title' },
          h('span', { className: 'ticker' }, c.ticker),
          c.isComplete
            ? h('span', { className: 'badge badge-green' }, 'Cycle complete')
            : h('span', { className: 'badge badge-blue' }, 'Active wheel'),
          h('span', { style: { fontSize: 11, color: 'var(--text2)' } }, 'Day ' + c.totalDays)
        ),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          netPnl != null && h('span', { className: 'badge ' + (netPnl >= 0 ? 'badge-green' : 'badge-red') },
            (netPnl >= 0 ? '+' : '') + f$(netPnl) + ' ' + (c.isComplete ? 'total' : 'so far')),
          c.annRocar != null && h('span', { className: 'rocp' }, fp(c.annRocar) + ' ann.'),
          h('button', { className: 'btn btn-sm', onClick: () => toggle(c.id) }, exp ? 'Collapse' : 'Details')
        )
      ),

      h('div', { className: 'cycle-stats' },
        h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'Assigned '), h('strong', null, f$(parseFloat(c.strike1)))),
        h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'Cost basis '), h('strong', null, f$(c.costBasis, 2))),
        price && h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'Current '), h('strong', null, f$(price, 2))),
        h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'Put income '), h('strong', { className: 'pos-green' }, f$(c.putPnl))),
        h('div', null, h('span', { style: { color: 'var(--text2)' } }, 'CC income '), h('strong', { className: 'pos-green' }, f$(c.ccIncome))),
        c.unrealized != null && h('div', null,
          h('span', { style: { color: 'var(--text2)' } }, 'Unrealized '),
          h('strong', { className: c.unrealized >= 0 ? 'pos-green' : 'pos-red' }, f$(c.unrealized)))
      ),

      !c.isComplete && c.unrealized != null && c.unrealized < 0 && h('div', { className: 'prog-wrap' },
        h('div', { className: 'prog-label' },
          h('span', null, 'CC income recovering embedded loss'),
          h('span', null, Math.round(recov * 100) + '%')
        ),
        h('div', { className: 'prog-track' },
          h('div', { className: 'prog-fill', style: { width: (recov * 100) + '%', background: '#639922' } })
        )
      ),

      exp && h('div', { className: 'leg-list' },
        h('div', { className: 'sec' }, 'Legs'),
        c.legs.map((l, i) =>
          h('div', { key: i, className: 'leg-row' },
            h('div', { className: 'leg-dot', style: { background: l.type === 'Put' ? '#185fa5' : l.outcome === 'Open' ? '#ef9f27' : '#1d9e75' } }),
            h('span', { style: { minWidth: 72, fontWeight: 500 } }, l.type),
            h('span', { style: { minWidth: 90, color: 'var(--text2)' } }, l.date || '—'),
            h('span', { style: { minWidth: 60 } }, 'K=' + f$(parseFloat(l.strike), 2)),
            h('span', { style: { minWidth: 55 } }, f$(l.prem * 100)),
            l.pnl != null
              ? h('span', { className: l.pnl >= 0 ? 'pos-green' : 'pos-red' }, (l.pnl >= 0 ? '+' : '') + f$(l.pnl))
              : h('span', { className: 'badge badge-amber' }, 'open')
          )
        ),
        !c.isComplete && h('div', { style: { marginTop: 12 } },
          ccForm === c.id
            ? h('div', { style: { background: 'var(--bg2)', borderRadius: 8, padding: '12px 14px' } },
                h('div', { style: { fontWeight: 500, fontSize: 12, marginBottom: 10 } }, 'Log covered call on ' + c.ticker),
                h(CCForm, { ticker: c.ticker, onSave: t => { onAddTrade(t); setCcForm(null); }, onCancel: () => setCcForm(null) })
              )
            : h('button', { className: 'btn btn-sm', onClick: () => setCcForm(c.id) },
                h('i', { className: 'ti ti-plus', 'aria-hidden': true }), ' Log covered call')
        )
      )
    );
  };

  return h('div', null,
    active.length > 0 && h('div', null,
      h('div', { className: 'sec' }, 'Active cycles — ' + active.length),
      active.map(c => h(CycleCard, { key: c.id, c, muted: false }))
    ),

    complete.length > 0 && h('div', { style: { marginTop: 16 } },
      h('div', { className: 'sec' }, 'Completed cycles — ' + complete.length),
      complete.map(c => h(CycleCard, { key: c.id, c, muted: true }))
    ),

    !active.length && !complete.length && h('div', { className: 'empty' },
      h('i', { className: 'ti ti-refresh', 'aria-hidden': true }),
      h('div', null, 'No wheel cycles yet'),
      h('div', { style: { fontSize: 12, marginTop: 6 } }, 'Log a naked put and mark it assigned to start a cycle')
    ),

    h('div', { style: { marginTop: 20 } },
      h('div', { className: 'sec' }, 'Cycle timeline'),
      h('div', { className: 'card' }, h(GanttChart, { trades }))
    )
  );
}
