// ── Black-Scholes helpers (restored) ────────────────────────────
// Uses the IV stored per trade at entry (TradeForm "IV % at entry").
function normCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function bsPrice(S, K, T, sigma, isPut) {
  if (!S || !K || !sigma || sigma <= 0 || T <= 0) return null;
  const r = 0.04;
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / sq;
  const d2 = d1 - sq;
  if (isPut) return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
  return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
}

function ActiveMonitor({ trades, prices, loadingPrices, refreshPrices, onUpdateTrade }) {
  const [closing, setClosing] = useStateAM(null);
  const open = trades.filter(t => t.outcome === 'Open').slice().reverse();
  const tod  = today();

  if (!open.length) return h('div', { className: 'empty' },
    h('i', { className: 'ti ti-eye', 'aria-hidden': true }),
    h('div', null, 'No open positions'),
    h('div', { style: { fontSize: 12, marginTop: 6 } }, 'Log a trade to start tracking')
  );

  return h('div', null,
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
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
      const con    = parseInt(t.contracts) || 1;
      const prem   = parseFloat(t.premiumReceived) || 0;
      const exp    = fd(t.expiry);
      const dLeft  = exp ? daysBetween(tod, exp) : null;
      const isS    = t.strategy && t.strategy.includes('Spread');

      const dist   = price && s1 ? Math.abs(price - s1) / s1 : null;
      const isItm  = price && s1 && (t.putCall === 'P' ? price < s1 : price > s1);

      // ── Black-Scholes estimated option price + theta ─────────
      // Uses stored entry IV when available; otherwise assumes a
      // conservative 25% (roughly S&P average) and flags it visually.
      // For spreads, estOpt is the NET value (short leg − long leg) so
      // the number is comparable to the credit received, not a single
      // naked leg worth many times more.
      const s2 = parseFloat(t.strike2) || 0;
      const storedIv = parseFloat(t.iv) || null;
      const ivAssumed = !storedIv;
      const iv = storedIv || 0.25;
      const T  = dLeft != null && dLeft > 0 ? dLeft / 365 : null;
      const isPutLeg = t.putCall === 'P';

      const legVal = (K, tt) => bsPrice(price, K, tt, iv, isPutLeg);
      const netVal = (tt) => (isS && s2)
        ? legVal(s1, tt) - legVal(s2, tt)
        : legVal(s1, tt);

      const estOpt = (price && T) ? netVal(T) : null;
      const pctOfPrem = (estOpt != null && prem > 0) ? estOpt / prem : null;
      const thetaDay = (estOpt != null && T > 1 / 365)
        ? (estOpt - netVal(T - 1 / 365)) * 100 * con
        : null;

      // Live P&L: net BS estimate when priceable, intrinsic otherwise
      let livePnl = null;
      if (price && prem) {
        let optVal;
        if (estOpt != null) {
          optVal = estOpt;
        } else if (isS && s2) {
          const shortIntr = isPutLeg ? Math.max(0, s1 - price) : Math.max(0, price - s1);
          const longIntr  = isPutLeg ? Math.max(0, s2 - price) : Math.max(0, price - s2);
          optVal = shortIntr - longIntr;
        } else {
          optVal = isPutLeg ? Math.max(0, s1 - price) : Math.max(0, price - s1);
        }
        livePnl = (prem - optVal) * 100 * con;
      }
      const captured = (livePnl != null && prem > 0) ? livePnl / (prem * 100 * con) : null;

      // ── Spread doubled-loss alert ─────────────────────────────
      // Rule: close a spread in loss once its value ≈ 2× the credit
      // received (down ~1× credit). estOpt is the live net value.
      const spreadLossMult = (isS && estOpt != null && prem > 0) ? estOpt / prem : null;
      const spreadAlert = spreadLossMult != null && spreadLossMult >= 2;

      // ── Covered-call yield (ROCAR is 0 by design — no collateral) ──
      // Meaningful CC metric = premium ÷ shares' notional value.
      const ccYield = (m.isCoveredCall && s1 > 0)
        ? (prem * 100 * con) / (s1 * 100 * con)
        : null;
      const ccYieldAnn = (ccYield != null && (parseInt(t.dte) || 0) > 0)
        ? ccYield * (365 / parseInt(t.dte))
        : null;

      // ── Border semantics: green = deep OTM / buyback candidate,
      //    amber = normal, red = ITM ────────────────────────────
      let alertCls = 'pos-card card alert-amber';
      if (isItm || spreadAlert) alertCls = 'pos-card card alert-red';
      else if ((dist != null && dist >= 0.10) || (captured != null && captured >= 0.7))
        alertCls = 'pos-card card alert-green';

      const priceCol = !price ? 'var(--text2)'
        : isItm ? '#a32d2d'
        : dist < 0.05 ? '#854f0b'
        : '#27500a';

      const prem100 = prem * 100;

      return h('div', { key: t.id, className: alertCls, style: { padding: '10px 16px', marginBottom: 8 } },

        // ── Row 1: ticker + badges ────────────────────────────
        h('div', { className: 'pos-header', style: { marginBottom: 6 } },
          h('div', { className: 'pos-title' },
            h('span', { className: 'ticker', style: { fontSize: 16, fontWeight: 600 } }, t.ticker),
            h('span', { className: 'badge badge-gray' }, t.strategy),
            h('span', { className: 'badge badge-blue' }, t.putCall === 'P' ? 'Put' : 'Call')
          ),
          h('div', { className: 'pos-badges' },
            dLeft != null && h('span', {
              className: 'badge ' + (dLeft <= 5 ? 'badge-red' : dLeft <= 14 ? 'badge-amber' : 'badge-green')
            }, dLeft + 'd left'),
            t.expiry && h('span', { className: 'badge badge-gray' }, t.expiry),
            livePnl != null && h('span', {
              className: 'badge ' + (livePnl >= 0 ? 'badge-green' : 'badge-red')
            }, (livePnl >= 0 ? '+' : '') + f$(livePnl)),
            spreadAlert && h('span', { className: 'badge badge-red', title: 'Spread value ≈ ' + spreadLossMult.toFixed(1) + '× your credit — your rule says close in loss here' },
              '⚠ close: ' + spreadLossMult.toFixed(1) + '× credit'),
            m.isCoveredCall
              ? (ccYieldAnn != null && h('span', { className: 'rocp', title: 'Premium ÷ shares value, annualized' }, fp(ccYieldAnn) + ' yield'))
              : h('span', { className: 'rocp' }, fp(m.annR) + ' ann.')
          )
        ),

        // ── Row 2: compact strike | distance | price | est option ──
        h('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: 'auto auto auto auto 1fr',
            alignItems: 'center',
            gap: 20,
            background: 'var(--bg2)',
            borderRadius: 8,
            padding: '8px 14px',
            marginBottom: 8
          }
        },
          h('div', null,
            h('div', { style: { fontSize: 10, color: 'var(--text2)' } }, 'STRIKE'),
            h('div', { style: { fontSize: 20, fontWeight: 700 } },
              f$(s1, 2) + (t.strike2 ? ' / ' + f$(parseFloat(t.strike2), 2) : ''))
          ),
          h('div', { style: { textAlign: 'center' } },
            price
              ? h('span', {
                  style: {
                    fontSize: 12, fontWeight: 600, color: priceCol,
                    background: isItm ? '#fcebeb' : dist < 0.05 ? '#faeeda' : '#eaf3de',
                    padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap'
                  }
                }, isItm ? '⚠ ITM' : (dist * 100).toFixed(1) + '% away')
              : h('span', { style: { fontSize: 11, color: 'var(--text3)' } }, '—')
          ),
          h('div', null,
            h('div', { style: { fontSize: 10, color: 'var(--text2)' } }, 'PRICE'),
            price
              ? h('div', { style: { fontSize: 20, fontWeight: 700, color: priceCol } }, f$(price, 2))
              : h('div', { style: { fontSize: 13, color: 'var(--text3)' } }, 'Loading…'),
            h('div', { style: { fontSize: 9, color: 'var(--text3)' } }, 'via Finnhub')
          ),
          h('div', null,
            h('div', { style: { fontSize: 10, color: 'var(--text2)' } }, 'EST. OPTION'),
            estOpt != null
              ? h('div', {
                  style: { fontSize: 20, fontWeight: 700, color: ivAssumed ? '#854f0b' : '#185fa5' },
                  title: ivAssumed ? 'Rough estimate — no IV stored for this trade, assuming 25%. Edit the trade and add "IV % at entry" for an accurate figure.' : 'Black-Scholes estimate using the IV you stored at entry'
                }, (ivAssumed ? '~' : '') + f$(estOpt, 2))
              : h('div', { style: { fontSize: 13, color: 'var(--text3)' } }, '—'),
            estOpt != null && h('div', { style: { fontSize: 9, color: ivAssumed ? '#854f0b' : 'var(--text3)' } },
              ivAssumed ? 'assumed IV 25%' : (pctOfPrem != null ? fp(pctOfPrem, 0) + ' of prem' : ''))
          ),
          h('div', { style: { minWidth: 140 } }, h(DistBar, { t, price }))
        ),

        // ── Row 3: stats strip ────────────────────────────────
        h('div', { className: 'pos-stats', style: { marginBottom: 6 } },
          h('div', null, h('span', { className: 'pos-stat-label' }, 'Premium '), h('strong', null, f$(prem100))),
          h('div', null, h('span', { className: 'pos-stat-label' }, 'Break-even '), h('strong', null, f$(m.be, 2))),
          h('div', null, h('span', { className: 'pos-stat-label' }, 'At risk '),
            h('strong', null, m.isCoveredCall ? '$0 (shares owned)' : m.isNakedCall ? 'Unbounded' : f$(m.cap))),
          h('div', null, h('span', { className: 'pos-stat-label' }, 'BE cushion '),
            h('strong', { style: { color: m.bec > 0.1 ? '#27500a' : m.bec > 0.05 ? '#854f0b' : '#a32d2d' } },
              m.bec > 0 ? fp(m.bec) : '—')),
          thetaDay != null && h('div', null,
            h('span', { className: 'pos-stat-label' }, 'Θ est./day '),
            h('strong', { style: { color: ivAssumed ? '#854f0b' : '#3b6d11' } },
              (ivAssumed ? '~+' : '+') + f$(thetaDay, 2))),
          m.isCoveredCall && ccYieldAnn != null && h('div', null,
            h('span', { className: 'pos-stat-label' }, 'CC yield '),
            h('strong', { style: { color: '#185fa5' } }, fp(ccYieldAnn) + ' ann.'),
            h('span', { style: { color: 'var(--text2)', fontSize: 10 } }, ' (' + fp(ccYield) + ' period)')),
          isS && estOpt != null && h('div', null,
            h('span', { className: 'pos-stat-label' }, 'Spread now '),
            h('strong', { style: { color: spreadAlert ? '#a32d2d' : 'var(--text)' } },
              (ivAssumed ? '~' : '') + f$(estOpt * 100 * con)),
            h('span', { style: { color: 'var(--text2)', fontSize: 10 } }, ' vs ' + f$(prem100 * con) + ' credit')),
          h('div', null,
            h('span', { className: 'pos-stat-label' }, '50% '),
            h('strong', null, f$(prem100 * 0.5)),
            h('span', { style: { color: 'var(--text2)', fontSize: 10 } }, ' @ ' + f$(prem * 0.5, 2))),
          h('div', null,
            h('span', { className: 'pos-stat-label' }, '80% '),
            h('strong', null, f$(prem100 * 0.8)),
            h('span', { style: { color: 'var(--text2)', fontSize: 10 } }, ' @ ' + f$(prem * 0.2, 2)))
        ),

        t.notes && h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 6, fontStyle: 'italic' } }, t.notes),

        h('div', { style: { display: 'flex', gap: 6 } },
          h('button', { className: 'btn btn-sm', onClick: () => setClosing(t) },
            isS ? 'Close spread' : 'Buy back / close')
        )
      );
    })
  );
}
