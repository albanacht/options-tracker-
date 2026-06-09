function ActiveMonitor({ trades, prices, loadingPrices, refreshPrices, onUpdateTrade }) {
  const [closing, setClosing] = useStateAM(null);
  const open = trades.filter(t => t.outcome === 'Open');
  const tod  = today();

  if (!open.length) return h('div', { className: 'empty' },
    h('i', { className: 'ti ti-eye', 'aria-hidden': true }),
    h('div', null, 'No open positions'),
    h('div', { style: { fontSize: 12, marginTop: 6 } }, 'Log a trade to start tracking')
  );

  return h('div', null,
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
      h('span', { className: 'sec' }, open.length + ' open position' + (open.length !== 1 ? 's' : '')),
      h('button', { className: 'btn btn-sm', onClick: refreshPrices, disabled: loadingPrices },
        loadingPrices ? 'Refreshing…' : 'Refresh prices')
    ),

    closing && h(CloseModal, {
      trade: closing,
      onClose: () => setClosing(null),
      onSave: t => { onUpdateTrade(t); setClosing(null); }
    }),

    open.map(t => {
      const m    = calcMetrics(t);
      const price = prices[t.ticker];
      const exp  = fd(t.expiry);
      const dLeft = exp ? daysBetween(tod, exp) : null;
      const dist  = price && t.strike1 ? Math.abs(price - parseFloat(t.strike1)) / parseFloat(t.strike1) : null;
      const alertCls = (dLeft != null && dLeft <= 5) || (dist != null && dist < 0.04)
        ? 'pos-card card alert-red'
        : (dist != null && dist < 0.1) ? 'pos-card card alert-amber'
        : 'pos-card card';

      let livePnl = null;
      if (price && t.premiumReceived) {
        const prem = parseFloat(t.premiumReceived);
        const s1   = parseFloat(t.strike1);
        const con  = parseInt(t.contracts) || 1;
        const optVal = t.putCall === 'P' ? Math.max(0, s1 - price) : Math.max(0, price - s1);
        livePnl = (prem - optVal) * 100 * con;
      }

      return h('div', { key: t.id, className: alertCls },
        h('div', { className: 'pos-header' },
          h('div', { className: 'pos-title' },
            h('span', { className: 'ticker' }, t.ticker),
            h('span', { className: 'badge badge-gray' }, t.strategy),
            h('span', { className: 'badge badge-blue' }, t.putCall === 'P' ? 'Put' : 'Call')
          ),
          h('div', { className: 'pos-badges' },
            dLeft != null && h('span', { className: 'badge ' + (dLeft <= 5 ? 'badge-red' : dLeft <= 14 ? 'badge-amber' : 'badge-green') },
              dLeft + 'd left'),
            livePnl != null && h('span', { className: 'badge ' + (livePnl >= 0 ? 'badge-green' : 'badge-red') },
              (livePnl >= 0 ? '+' : '') + f$(livePnl)),
            h('span', { className: 'rocp' }, fp(m.annR) + ' ann.')
          )
        ),

        h('div', { className: 'pos-stats' },
          h('div', null, h('span', { className: 'pos-stat-label' }, 'Strike '), h('strong', null, t.strike1 + (t.strike2 ? ' / ' + t.strike2 : ''))),
          h('div', null, h('span', { className: 'pos-stat-label' }, 'Premium '), h('strong', null, f$((parseFloat(t.premiumReceived) || 0) * 100))),
          h('div', null, h('span', { className: 'pos-stat-label' }, 'Break-even '), h('strong', null, f$(m.be, 2))),
          h('div', null, h('span', { className: 'pos-stat-label' }, 'At risk '), h('strong', null, f$(m.cap))),
          h('div', null, h('span', { className: 'pos-stat-label' }, '50% target '), h('strong', null, f$((parseFloat(t.premiumReceived) || 0) * 50))),
          h('div', null, h('span', { className: 'pos-stat-label' }, '80% target '), h('strong', null, f$((parseFloat(t.premiumReceived) || 0) * 20)))
        ),

        h(DistBar, { t, price }),

        t.notes && h('div', { style: { fontSize: 11, color: 'var(--text2)', marginTop: 6 } }, t.notes),

        h('div', { className: 'pos-actions' },
          h('button', { className: 'btn btn-sm', onClick: () => setClosing(t) },
            t.strategy && t.strategy.includes('Spread') ? 'Close spread' : 'Buy back / close')
        )
      );
    })
  );
}
