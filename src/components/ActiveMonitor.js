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
        loadingPrices ? 'Refreshing…' : '↻ Refresh prices')
    ),

    closing && h(CloseModal, {
      trade: closing,
      onClose: () => setClosing(null),
      onSave: t => { onUpdateTrade(t); setClosing(null); }
    }),

    open.map(t => {
      const m      = calcMetrics(t);
      const price  = prices[t.ticker];
      const s1     = parseFloat(t.strike1);
      const exp    = fd(t.expiry);
      const dLeft  = exp ? daysBetween(tod, exp) : null;
      const isS    = t.strategy && t.strategy.includes('Spread');

      // Distance from strike
      const dist   = price && s1 ? Math.abs(price - s1) / s1 : null;
      const isItm  = price && s1 && (t.putCall === 'P' ? price < s1 : price > s1);

      // Live P&L estimate
      let livePnl = null;
      if (price && t.premiumReceived) {
        const prem   = parseFloat(t.premiumReceived);
        const con    = parseInt(t.contracts) || 1;
        const optVal = t.putCall === 'P' ? Math.max(0, s1 - price) : Math.max(0, price - s1);
        livePnl = (prem - optVal) * 100 * con;
      }

      // Alert level
      const alertCls = isItm ? 'pos-card card alert-red'
        : (dLeft != null && dLeft <= 5) || (dist != null && dist < 0.03) ? 'pos-card card alert-red'
        : dist != null && dist < 0.08 ? 'pos-card card alert-amber'
        : 'pos-card card';

      // Price status color
      const priceCol = !price ? 'var(--text2)'
        : isItm ? '#a32d2d'
        : dist < 0.05 ? '#854f0b'
        : '#27500a';

      const prem100 = (parseFloat(t.premiumReceived) || 0) * 100;

      return h('div', { key: t.id, className: alertCls },

        // ── Top row: ticker + key badges ──────────────────────
        h('div', { className: 'pos-header' },
          h('div', { className: 'pos-title' },
            h('span', { className: 'ticker', style: { fontSize: 18, fontWeight: 600 } }, t.ticker),
            h('span', { className: 'badge badge-gray' }, t.strategy),
            h('span', { className: 'badge badge-blue' }, t.putCall === 'P' ? 'Put' : 'Call')
          ),
          h('div', { className: 'pos-badges' },
            dLeft != null && h('span', {
              className: 'badge ' + (dLeft <= 5 ? 'badge-red' : dLeft <= 14 ? 'badge-amber' : 'badge-green')
            }, dLeft + 'd left'),
            livePnl != null && h('span', {
              className: 'badge ' + (livePnl >= 0 ? 'badge-green' : 'badge-red')
            }, (livePnl >= 0 ? '+' : '') + f$(livePnl)),
            h('span', { className: 'rocp' }, fp(m.annR) + ' ann.')
          )
        ),

        // ── THE MAIN PRICE vs STRIKE DISPLAY ──────────────────
        h('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            gap: 12,
            background: 'var(--bg2)',
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 12
          }
        },
          // Strike
          h('div', { style: { textAlign: 'center' } },
            h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 3 } }, 'STRIKE'),
            h('div', { style: { fontSize: 28, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' } },
              f$(s1, 2)),
            t.strike2 && h('div', { style: { fontSize: 13, color: 'var(--text2)', marginTop: 2 } },
              '/ ' + f$(parseFloat(t.strike2), 2))
          ),

          // Arrow + distance
          h('div', { style: { textAlign: 'center' } },
            price
              ? h('div', null,
                  h('div', {
                    style: {
                      fontSize: 13, fontWeight: 600,
                      color: priceCol,
                      background: isItm ? '#fcebeb' : dist < 0.05 ? '#faeeda' : '#eaf3de',
                      padding: '4px 10px', borderRadius: 20,
                      marginBottom: 4, whiteSpace: 'nowrap'
                    }
                  }, isItm ? '⚠ ITM' : (dist * 100).toFixed(1) + '% away'),
                  h('div', { style: { fontSize: 10, color: 'var(--text3)' } },
                    t.putCall === 'P' ? '↓ put' : '↑ call')
                )
              : h('div', { style: { fontSize: 11, color: 'var(--text3)' } }, '— no price —')
          ),

          // Current price
          h('div', { style: { textAlign: 'center' } },
            h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 3 } }, 'CURRENT PRICE'),
            price
              ? h('div', { style: { fontSize: 28, fontWeight: 700, color: priceCol, letterSpacing: '-0.5px' } },
                  f$(price, 2))
              : h('div', { style: { fontSize: 16, color: 'var(--text3)', fontWeight: 500 } }, 'Loading…'),
            h('div', { style: { fontSize: 10, color: 'var(--text3)', marginTop: 2 } }, 'via Yahoo Finance')
          )
        ),

        // ── Distance bar (visual) ──────────────────────────────
        price && h(DistBar, { t, price }),

        // ── Stats grid ────────────────────────────────────────
        h('div', { className: 'pos-stats', style: { marginTop: 10 } },
          h('div', null, h('span', { className: 'pos-stat-label' }, 'Premium '), h('strong', null, f$(prem100))),
          h('div', null, h('span', { className: 'pos-stat-label' }, 'Break-even '), h('strong', null, f$(m.be, 2))),
          h('div', null, h('span', { className: 'pos-stat-label' }, 'At risk '),
            h('strong', null, m.isCoveredCall ? '$0 (shares owned)' : m.isNakedCall ? 'Unbounded' : f$(m.cap))),
          h('div', null, h('span', { className: 'pos-stat-label' }, 'BE cushion '),
            h('strong', { style: { color: m.bec > 0.1 ? '#27500a' : m.bec > 0.05 ? '#854f0b' : '#a32d2d' } },
              m.bec > 0 ? fp(m.bec) : '—')),
          h('div', null,
            h('span', { className: 'pos-stat-label' }, '50% target '),
            h('strong', null, f$(prem100 * 0.5), h('span', { style: { color: 'var(--text2)', fontWeight: 400 } }, ' → buy back at ' + f$((parseFloat(t.premiumReceived)||0)*0.5, 2)))),
          h('div', null,
            h('span', { className: 'pos-stat-label' }, '80% target '),
            h('strong', null, f$(prem100 * 0.8), h('span', { style: { color: 'var(--text2)', fontWeight: 400 } }, ' → buy back at ' + f$((parseFloat(t.premiumReceived)||0)*0.2, 2))))
        ),

        t.notes && h('div', { style: { fontSize: 11, color: 'var(--text2)', marginTop: 6, fontStyle: 'italic' } }, t.notes),

        h('div', { className: 'pos-actions' },
          h('button', { className: 'btn btn-sm', onClick: () => setClosing(t) },
            isS ? 'Close spread' : 'Buy back / close')
        )
      );
    })
  );
}
