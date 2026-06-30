function CapitalRisk({ trades, prices }) {
  const open     = trades.filter(t => t.outcome === 'Open');
  const assigned = trades.filter(t => t.outcome === 'Assigned');

  let nakedCap = 0, spreadMax = 0, dw = 0, ccCount = 0, nakedCallCount = 0;
  open.forEach(t => {
    const m = calcMetrics(t);
    if (m.isCoveredCall) {
      // Zero additional collateral — shares already counted as "shares deployed"
      ccCount++;
      return;
    }
    if (m.isNakedCall) {
      // Risk is technically unbounded — don't pretend strike×100 is the real number
      nakedCallCount++;
      return;
    }
    if (m.isSpread) spreadMax += m.cap; else nakedCap += m.cap;
    dw += m.cap * (parseFloat(t.delta) || 0.2);
  });

  let assVal = 0, assLoss = 0;
  assigned.forEach(t => {
    const s   = parseFloat(t.strike1) || 0;
    const con = parseInt(t.contracts) || 1;
    const mkt = (prices[t.ticker] || s) * 100 * con;
    assVal  += mkt;
    assLoss += mkt - s * 100 * con;
  });

  const total = nakedCap + spreadMax + assVal;
  const sgov  = 25000;
  const util  = total / sgov;
  const uc    = util > 1 ? '#a32d2d' : util > 0.8 ? '#854f0b' : '#27500a';

  return h('div', null,
    h('div', { className: 'metrics-grid' },
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Naked put collateral'), h('div', { className: 'mc-val' }, f$(nakedCap))),
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Spread max loss'), h('div', { className: 'mc-val' }, f$(spreadMax))),
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Shares deployed'), h('div', { className: 'mc-val' }, f$(assVal))),
      h('div', { className: 'mc' }, h('div', { className: 'mc-label' }, 'Delta-weighted'), h('div', { className: 'mc-val' }, f$(dw)))
    ),

    (ccCount > 0 || nakedCallCount > 0) && h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 10 } },
      ccCount > 0 && (ccCount + ' covered call' + (ccCount !== 1 ? 's' : '') + ' open — $0 additional collateral, already covered by shares deployed.'),
      ccCount > 0 && nakedCallCount > 0 && ' ',
      nakedCallCount > 0 && (nakedCallCount + ' naked call' + (nakedCallCount !== 1 ? 's' : '') + ' open — risk is unbounded, excluded from the dollar totals below.')
    ),

    h('div', { className: 'card' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 } },
        h('span', { className: 'sec', style: { marginBottom: 0 } }, 'Utilization vs SGOV $25k'),
        h('span', { style: { fontWeight: 500, color: uc, fontSize: 13 } }, (Math.min(util, 9.99) * 100).toFixed(1) + '%')
      ),
      h('div', { className: 'util-bar' },
        h('div', { className: 'util-fill', style: { width: Math.min(util * 100, 100) + '%', background: uc } })
      ),
      h('div', { className: 'util-labels' },
        h('span', null, 'Committed: ' + f$(total)),
        h('span', null, 'Dry powder: ' + f$(Math.max(0, sgov - total)))
      )
    ),

    open.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Open positions'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null,
            ['Ticker','Strategy','Strike','At risk','Delta','D-wtd','ROCAR','BE cushion'].map(c => h('th', { key: c }, c))
          )),
          h('tbody', null, open.map(t => {
            const m = calcMetrics(t);
            const atRiskDisplay = m.isCoveredCall ? f$(0) : m.isNakedCall ? 'Unbounded' : f$(m.cap);
            const dWtdDisplay = m.isCoveredCall ? f$(0) : m.isNakedCall ? '—' : f$(m.cap * (parseFloat(t.delta) || 0.2));
            return h('tr', { key: t.id },
              h('td', null, h('strong', null, t.ticker)),
              h('td', null, h('span', { className: 'badge badge-gray', style: { fontSize: 10 } }, t.strategy)),
              h('td', null, t.strike1 + (t.strike2 ? ' / ' + t.strike2 : '')),
              h('td', null, atRiskDisplay),
              h('td', null, t.delta || '0.20'),
              h('td', null, dWtdDisplay),
              h('td', null, h('span', { className: 'rocp' }, m.isCoveredCall ? '—' : fp(m.annR))),
              h('td', null, h('span', { className: 'badge ' + (m.bec > 0.1 ? 'badge-green' : m.bec > 0.05 ? 'badge-amber' : 'badge-red') }, fp(m.bec)))
            );
          }))
        )
      )
    ),

    assigned.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Assigned shares'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null,
            ['Ticker','Strike','Market value','Unrealized P&L'].map(c => h('th', { key: c }, c))
          )),
          h('tbody', null, assigned.map(t => {
            const s   = parseFloat(t.strike1) || 0;
            const con = parseInt(t.contracts) || 1;
            const mkt = (prices[t.ticker] || s) * 100 * con;
            const loss = mkt - s * 100 * con;
            return h('tr', { key: t.id },
              h('td', null, h('strong', null, t.ticker)),
              h('td', null, f$(s)),
              h('td', null, f$(mkt)),
              h('td', { className: loss >= 0 ? 'pos-green' : 'pos-red' }, (loss >= 0 ? '+' : '') + f$(loss))
            );
          }))
        )
      )
    )
  );
}
