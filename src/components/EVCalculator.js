function EVCalculator({ trades }) {
  const closed = trades.filter(t => t.outcome && t.outcome !== 'Open');

  // ── Per-strategy stats from actual trade history ───────────
  const stratStats = useMemo(() => {
    const map = {};
    closed.forEach(t => {
      const s = t.strategy || 'Unknown';
      if (!map[s]) map[s] = { count: 0, wins: 0, totalPnl: 0, totalCap: 0, losses: [], wins_pnl: [] };
      const m = calcMetrics(t);
      if (m.pnl == null) return;
      map[s].count++;
      map[s].totalCap += m.cap;
      map[s].totalPnl += m.pnl;
      if (m.pnl >= 0) { map[s].wins++; map[s].wins_pnl.push(m.pnl); }
      else { map[s].losses.push(Math.abs(m.pnl)); }
    });
    return Object.entries(map).map(([strat, d]) => {
      const wr = d.count > 0 ? d.wins / d.count : 0;
      const avgWin  = d.wins_pnl.length > 0 ? d.wins_pnl.reduce((a,b)=>a+b,0) / d.wins_pnl.length : 0;
      const avgLoss = d.losses.length > 0   ? d.losses.reduce((a,b)=>a+b,0)   / d.losses.length   : 0;
      const ev = (wr * avgWin) - ((1 - wr) * avgLoss);
      const avgCap = d.count > 0 ? d.totalCap / d.count : 0;
      const evRoc  = avgCap > 0 ? ev / avgCap : 0;
      return { strat, count: d.count, wr, avgWin, avgLoss, ev, evRoc, totalPnl: d.totalPnl };
    }).sort((a, b) => b.ev - a.ev);
  }, [closed]);

  // ── Manual EV calculator (what-if for a new trade) ─────────
  const [premium, setPremium]   = useState('');
  const [capital, setCapital]   = useState('');
  const [winRate, setWinRate]   = useState('75');
  const [avgLossM, setAvgLossM] = useState('');
  const [dte, setDte]           = useState('30');

  const calcEV = () => {
    const p  = parseFloat(premium) * 100;
    const cap = parseFloat(capital);
    const wr  = parseFloat(winRate) / 100;
    const al  = parseFloat(avgLossM) || cap * 0.5;
    const d   = parseFloat(dte) || 30;
    if (!p || !cap || !wr) return null;
    const ev     = (wr * p) - ((1 - wr) * al);
    const evRoc  = ev / cap;
    const annEv  = evRoc * (365 / d);
    const be_wr  = al / (p + al);
    return { ev, evRoc, annEv, be_wr };
  };
  const ev = useMemo(calcEV, [premium, capital, winRate, avgLossM, dte]);

  // ── Kelly criterion ────────────────────────────────────────
  const kelly = useMemo(() => {
    const wr = parseFloat(winRate) / 100;
    const p  = parseFloat(premium) * 100;
    const cap = parseFloat(capital);
    const al = parseFloat(avgLossM) || (cap * 0.5);
    if (!wr || !p || !al) return null;
    const b = p / al;
    const k = (wr * b - (1 - wr)) / b;
    return Math.max(0, k);
  }, [winRate, premium, capital, avgLossM]);

  const hasHistory = stratStats.length > 0;

  return h('div', null,

    // ── Section 1: What-if calculator ─────────────────────────
    h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Expected value calculator — new trade'),
      h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 12 } },
        'Enter a potential trade to see if the risk/reward makes sense before entering.'
      ),
      h('div', { className: 'form-grid' },
        h('div', { className: 'field' },
          h('label', null, 'Premium received ($)'),
          h('input', { type: 'number', step: '0.01', placeholder: '0.70', value: premium, onChange: e => setPremium(e.target.value) })
        ),
        h('div', { className: 'field' },
          h('label', null, 'Capital at risk ($)'),
          h('input', { type: 'number', placeholder: '4500', value: capital, onChange: e => setCapital(e.target.value) })
        ),
        h('div', { className: 'field' },
          h('label', null, 'Your win rate estimate (%)'),
          h('input', { type: 'number', placeholder: '75', value: winRate, onChange: e => setWinRate(e.target.value) })
        ),
        h('div', { className: 'field' },
          h('label', null, 'Avg loss if wrong ($) — leave blank for 50% of capital'),
          h('input', { type: 'number', placeholder: 'e.g. 800', value: avgLossM, onChange: e => setAvgLossM(e.target.value) })
        ),
        h('div', { className: 'field' },
          h('label', null, 'DTE'),
          h('input', { type: 'number', placeholder: '30', value: dte, onChange: e => setDte(e.target.value) })
        )
      ),

      ev && h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 4 } },
        h('div', { className: 'mc' },
          h('div', { className: 'mc-label' }, 'Expected value / trade'),
          h('div', { className: 'mc-val', style: { color: ev.ev >= 0 ? '#3b6d11' : '#a32d2d' } }, f$(ev.ev, 2))
        ),
        h('div', { className: 'mc' },
          h('div', { className: 'mc-label' }, 'EV / capital'),
          h('div', { className: 'mc-val', style: { color: ev.evRoc >= 0 ? '#3b6d11' : '#a32d2d' } }, fp(ev.evRoc))
        ),
        h('div', { className: 'mc' },
          h('div', { className: 'mc-label' }, 'Ann. EV return'),
          h('div', { className: 'mc-val', style: { color: ev.annEv >= 0 ? '#3b6d11' : '#a32d2d' } }, fp(ev.annEv))
        ),
        h('div', { className: 'mc' },
          h('div', { className: 'mc-label' }, 'Break-even win rate'),
          h('div', { className: 'mc-val' }, fp(ev.be_wr))
        ),
        kelly != null && h('div', { className: 'mc' },
          h('div', { className: 'mc-label' }, 'Kelly % of capital'),
          h('div', { className: 'mc-val', style: { color: '#185fa5' } }, fp(kelly * 0.25)),
          h('div', { style: { fontSize: 10, color: 'var(--text2)', marginTop: 2 } }, '25% fractional Kelly')
        )
      ),

      ev && h('div', { style: { marginTop: 12, padding: '10px 14px', background: ev.ev > 0 ? 'var(--green-light)' : 'var(--red-light)', borderRadius: 8, fontSize: 12 } },
        ev.ev > 0
          ? h('span', { style: { color: 'var(--green)' } },
              'Positive EV trade. For every trade like this you take, you expect to make ' + f$(ev.ev, 2) + ' on average. ' +
              'Your win rate needs to be above ' + fp(ev.be_wr) + ' to be profitable — you estimated ' + winRate + '%.')
          : h('span', { style: { color: 'var(--red)' } },
              'Negative EV. The premium does not justify the risk at this win rate. Either the premium is too low, the loss too large, or your win rate estimate is too pessimistic.')
      )
    ),

    // ── Section 2: EV formula explanation ─────────────────────
    h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'How EV is calculated'),
      h('div', { style: { fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 } },
        h('div', { style: { fontFamily: 'monospace', background: 'var(--bg2)', padding: '8px 12px', borderRadius: 6, marginBottom: 10, fontSize: 12 } },
          'EV = (win rate × avg win) − (loss rate × avg loss)'
        ),
        h('div', { style: { marginBottom: 6 } }, 'Example: sell a $0.70 put, capital at risk $4,500, 75% win rate, avg loss $600:'),
        h('div', { style: { fontFamily: 'monospace', background: 'var(--bg2)', padding: '8px 12px', borderRadius: 6, marginBottom: 10, fontSize: 12 } },
          'EV = (0.75 × $70) − (0.25 × $600) = $52.50 − $150 = −$97.50'
        ),
        h('div', { style: { marginBottom: 6 } },
          'Negative EV despite 75% win rate — because the loss is 8.5× the win. This is the core tension in wheel trading. ' +
          'High win rate feels good but does not guarantee profitability if losses are large.'
        ),
        h('div', null,
          'Break-even win rate = avg loss ÷ (avg win + avg loss). ' +
          'If your actual win rate exceeds this, you have edge. If not, you are losing money slowly.'
        )
      )
    ),

    // ── Section 3: Historical EV by strategy ──────────────────
    h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Your historical EV by strategy'),
      !hasHistory
        ? h('div', { style: { fontSize: 12, color: 'var(--text2)', padding: '12px 0' } },
            'No closed trades yet. Once you have 10+ closed trades the stats here become meaningful.')
        : h('div', null,
            h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 10 } },
              'Based on your ' + closed.length + ' closed trades. EV becomes reliable above ~20 trades per strategy.'
            ),
            h('div', { className: 'table-wrap' },
              h('table', null,
                h('thead', null, h('tr', null,
                  ['Strategy','Trades','Win rate','Avg win','Avg loss','EV / trade','EV / capital','Total P&L'].map(c => h('th', { key: c }, c))
                )),
                h('tbody', null, stratStats.map(s =>
                  h('tr', { key: s.strat },
                    h('td', null, h('span', { className: 'badge badge-gray', style: { fontSize: 10 } }, s.strat)),
                    h('td', null, s.count),
                    h('td', null, h('span', { className: 'badge ' + (s.wr >= 0.7 ? 'badge-green' : s.wr >= 0.5 ? 'badge-amber' : 'badge-red') }, fp(s.wr))),
                    h('td', { className: 'pos-green' }, f$(s.avgWin, 0)),
                    h('td', { className: 'pos-red' }, f$(s.avgLoss, 0)),
                    h('td', { className: s.ev >= 0 ? 'pos-green' : 'pos-red', style: { fontWeight: 500 } },
                      (s.ev >= 0 ? '+' : '') + f$(s.ev, 2)),
                    h('td', null, h('span', { className: 'rocp' }, fp(s.evRoc))),
                    h('td', { className: s.totalPnl >= 0 ? 'pos-green' : 'pos-red' },
                      (s.totalPnl >= 0 ? '+' : '') + f$(s.totalPnl))
                  )
                ))
              )
            ),

            // Insight callout
            stratStats.length > 1 && h('div', { style: { marginTop: 12, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 8, fontSize: 12, color: 'var(--text2)' } },
              h('strong', { style: { color: 'var(--text)' } }, 'Key insight: '),
              (() => {
                const best = stratStats[0];
                const worst = stratStats[stratStats.length - 1];
                if (best.ev > 0 && worst.ev < 0) {
                  return best.strat + ' is your strongest strategy (' + f$(best.ev, 2) + ' EV/trade). ' +
                    worst.strat + ' is currently negative EV (' + f$(worst.ev, 2) + '/trade) — consider whether the thesis holds.';
                } else if (best.ev > 0) {
                  return 'All strategies are positive EV so far. ' + best.strat + ' leads at ' + f$(best.ev, 2) + ' per trade.';
                } else {
                  return 'All strategies are currently negative EV — but with fewer than 20 trades per strategy this may just be variance. Keep logging.';
                }
              })()
            )
          )
    ),

    // ── Section 4: Stock screening checklist ──────────────────
    h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'Pre-trade checklist'),
      h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 10 } },
        'Run through this before every naked put. All 7 should pass.'
      ),
      [
        { q: 'Earnings more than 30 days away?', why: 'Avoids IV spike blowing through your strike' },
        { q: 'Stock above its 200-day moving average?', why: 'Not catching a falling knife' },
        { q: 'IV/HV ratio above 1.2?', why: 'Selling vol when it\'s elevated, not cheap' },
        { q: 'Bid/ask spread on the option below $0.10?', why: 'Wide spreads silently destroy edge' },
        { q: 'Would you own this stock at the strike for up to 12 months?', why: 'The wheel only works if assignment is survivable' },
        { q: 'Dividend stable for 5+ years (if dividend stock)?', why: 'A cut collapses the thesis and the stock price simultaneously' },
        { q: 'Ann. ROCAR above 8% after realistic assignment probability?', why: 'Minimum hurdle to beat a simple ETF strategy' },
      ].map((item, i) => {
        const [checked, setChecked] = useState(false);
        return h('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '0.5px solid var(--border)' } },
          h('input', {
            type: 'checkbox', checked, onChange: () => setChecked(p => !p),
            style: { marginTop: 2, flexShrink: 0, width: 14, height: 14, cursor: 'pointer' }
          }),
          h('div', null,
            h('div', { style: { fontSize: 12, fontWeight: checked ? 400 : 500, textDecoration: checked ? 'line-through' : 'none', color: checked ? 'var(--text2)' : 'var(--text)' } }, item.q),
            h('div', { style: { fontSize: 11, color: 'var(--text2)', marginTop: 2 } }, item.why)
          )
        );
      })
    )
  );
}
