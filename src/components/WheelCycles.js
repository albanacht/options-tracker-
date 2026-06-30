function GanttChart({ trades }) {
  const relevant = trades.filter(t =>
    t.outcome === 'Assigned' || t.strategy === 'Covered Call' ||
    (t.outcome && t.outcome !== 'Open' && t.dateOpened)
  );
  const tickers = [...new Set(relevant.map(t => t.ticker))].filter(Boolean).slice(0, 10);
  if (!tickers.length) return h('div', { style: { fontSize: 11, color: 'var(--text2)' } }, 'No closed trades to display yet.');

  const allDates = relevant.flatMap(t => [fd(t.dateOpened), fd(t.dateClosed || t.expiry)]).filter(Boolean);
  if (!allDates.length) return null;

  const minD = new Date(Math.min(...allDates.map(d => d.getTime())));
  const maxD = new Date(Math.max(...allDates.map(d => d.getTime()), today().getTime()));
  const totalMs = maxD - minD || 1;
  const pct = d => d ? Math.max(0, Math.min(100, (d - minD) / totalMs * 100)) : 0;

  return h('div', { className: 'gantt-container' },
    tickers.map(ticker => {
      const legs = trades
        .filter(t => t.ticker === ticker && t.dateOpened)
        .sort((a, b) => a.dateOpened.localeCompare(b.dateOpened));

      return h('div', { key: ticker, className: 'gantt-row' },
        h('div', { className: 'gantt-label', title: ticker }, ticker),
        h('div', { className: 'gantt-track' },
          legs.map((l, i) => {
            const start = fd(l.dateOpened);
            const end   = fd(l.dateClosed || l.expiry) || today();
            if (!start) return null;
            const left  = pct(start);
            const width = Math.max(0.5, pct(end) - left);
            const isPut = l.outcome === 'Assigned';
            const isCC  = l.strategy === 'Covered Call';
            const isOpen = l.outcome === 'Open';
            const col = isPut ? '#185fa5' : isOpen ? '#ef9f27' : '#1d9e75';
            const m = calcMetrics(l);
            const tip = l.ticker + ' ' + (l.strategy || '') + ' ' + l.dateOpened
              + (m.pnl != null ? ' → ' + f$(m.pnl) : ' (open)');

            return h('div', {
              key: i, className: 'gantt-seg',
              title: tip,
              style: {
                left: left + '%', width: width + '%',
                background: col + '28', borderLeft: '2px solid ' + col
              }
            },
              width > 6 && h('span', { style: { color: col } }, isPut ? 'Put' : isCC ? 'CC' : '')
            );
          })
        )
      );
    }),

    h('div', { className: 'gantt-axis' },
      h('span', null, minD.toISOString().slice(0, 7)),
      h('span', null, maxD.toISOString().slice(0, 7))
    ),
    h('div', { className: 'gantt-legend' },
      h('span', null, h('span', { className: 'dot', style: { background: '#185fa5' } }), ' Put / assigned'),
      h('span', null, h('span', { className: 'dot', style: { background: '#1d9e75' } }), ' Covered call'),
      h('span', null, h('span', { className: 'dot', style: { background: '#ef9f27' } }), ' Open')
    )
  );
}

function CCForm({ ticker, onSave, onCancel }) {
  const [t, setT] = useStateWC({
    dateOpened: todayStr(), ticker, strategy: 'Covered Call', putCall: 'C',
    strike1: '', expiry: '', dte: '30', contracts: '1',
    underlyingAtEntry: '', ivhv: '', iv: '', delta: '', premiumReceived: '',
    outcome: 'Open', dateClosed: '', notes: ''
  });
  const up = (k, v) => setT(p => ({ ...p, [k]: v }));

  // Auto-calculate DTE from dates, unless the user types directly into the field
  const [dteOverridden, setDteOverridden] = useStateWC(false);
  useEffectC(() => {
    if (dteOverridden) return;
    const d1 = fd(t.dateOpened);
    const d2 = fd(t.expiry);
    if (d1 && d2) {
      const calculated = daysBetween(d1, d2);
      if (calculated > 0 && String(calculated) !== t.dte) {
        setT(p => ({ ...p, dte: String(calculated) }));
      }
    }
  }, [t.dateOpened, t.expiry]);

  const m = useMemoWC(() => calcMetrics(t), [t]);

  return h('div', null,
    h('div', { className: 'form-grid' },
      h('div', { className: 'field' }, h('label', null, 'Date'), h('input', { type: 'date', value: t.dateOpened, onChange: e => up('dateOpened', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'Strike (call)'), h('input', { type: 'number', step: '0.5', value: t.strike1, onChange: e => up('strike1', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'Expiry'), h('input', { type: 'date', value: t.expiry, onChange: e => up('expiry', e.target.value) })),
      h('div', { className: 'field' },
        h('label', null, 'DTE ' + (dteOverridden ? '(manual)' : '(auto)')),
        h('input', {
          type: 'number', value: t.dte || '',
          onChange: e => { setDteOverridden(true); up('dte', e.target.value); },
          style: dteOverridden ? { borderColor: 'var(--blue)' } : {}
        })
      ),
      h('div', { className: 'field' }, h('label', null, 'Contracts'), h('input', { type: 'number', value: t.contracts, onChange: e => up('contracts', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'Underlying at entry'), h('input', { type: 'number', step: '0.01', value: t.underlyingAtEntry, onChange: e => up('underlyingAtEntry', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'IV/HV ratio'), h('input', { type: 'number', step: '0.01', placeholder: '1.5', value: t.ivhv, onChange: e => up('ivhv', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'IV % at entry'), h('input', { type: 'number', step: '0.01', placeholder: '0.35', value: t.iv, onChange: e => up('iv', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'Delta'), h('input', { type: 'number', step: '0.01', placeholder: '0.20', value: t.delta, onChange: e => up('delta', e.target.value) })),
      h('div', { className: 'field' }, h('label', null, 'Premium ($)'), h('input', { type: 'number', step: '0.01', value: t.premiumReceived, onChange: e => up('premiumReceived', e.target.value) })),
      h('div', { className: 'field' },
        h('label', null, 'Outcome'),
        h('select', { value: t.outcome, onChange: e => up('outcome', e.target.value) },
          ['Open', 'Expired Worthless', 'Assigned'].map(o => h('option', { key: o, value: o }, o))
        )
      ),
      t.outcome !== 'Open' && h('div', { className: 'field' }, h('label', null, 'Date closed'), h('input', { type: 'date', value: t.dateClosed || '', onChange: e => up('dateClosed', e.target.value) }))
    ),

    (t.strike1 || t.premiumReceived) && h('div', { className: 'calc-preview' },
      h('div', { className: 'calc-item' }, h('div', { className: 'calc-label' }, 'Capital at risk'), h('div', { className: 'calc-val' }, f$(m.cap))),
      h('div', { className: 'calc-item' }, h('div', { className: 'calc-label' }, 'Break-even (call)'), h('div', { className: 'calc-val' }, f$(m.be, 2))),
      h('div', { className: 'calc-item' }, h('div', { className: 'calc-label' }, 'BE cushion'),
        h('div', { className: 'calc-val', style: { color: m.bec > 0.1 ? '#3b6d11' : m.bec > 0.05 ? '#854f0b' : '#a32d2d' } }, m.bec > 0 ? fp(m.bec) : '—')),
      h('div', { className: 'calc-item' }, h('div', { className: 'calc-label' }, 'Ann. ROCAR'),
        h('div', { className: 'calc-val', style: { color: '#185fa5' } },
          (!t.premiumReceived || parseFloat(t.premiumReceived) === 0) ? '— add premium' : fp(m.annR)))
    ),

    h('div', { className: 'field full', style: { marginTop: 4, marginBottom: 10 } },
      h('label', null, 'Notes'),
      h('textarea', { rows: 2, value: t.notes || '', onChange: e => up('notes', e.target.value) })
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
