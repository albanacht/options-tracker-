function CloseModal({ trade, onClose, onSave }) {
  const [price, setPrice] = useState2('');
  const [outcome, setOutcome] = useState2(
    trade.strategy && trade.strategy.includes('Spread') ? 'Closed Profit' : 'Bought Back'
  );
  const [date, setDate] = useState2(todayStr());

  const prem = parseFloat(trade.premiumReceived) || 0;
  const cp   = parseFloat(price) || 0;
  const con  = parseInt(trade.contracts) || 1;
  const pnl  = (prem - cp) * 100 * con;
  const isS  = trade.strategy && trade.strategy.includes('Spread');
  const outcomes = isS
    ? ['Closed Profit', 'Closed Loss', 'Max Loss']
    : ['Bought Back', 'Closed Loss'];

  return h('div', { className: 'modal-overlay' },
    h('div', { className: 'modal-box' },
      h('div', { className: 'modal-title' }, 'Close ' + trade.ticker + ' — ' + trade.strategy),
      h('div', { className: 'form-grid' },
        h('div', { className: 'field' },
          h('label', null, isS ? 'Spread close price ($)' : 'Buyback price ($)'),
          h('input', { type: 'number', step: '0.01', placeholder: '0.05', value: price, onChange: e => setPrice(e.target.value), autoFocus: true })
        ),
        h('div', { className: 'field' },
          h('label', null, 'Date'),
          h('input', { type: 'date', value: date, onChange: e => setDate(e.target.value) })
        ),
        h('div', { className: 'field' },
          h('label', null, 'Outcome'),
          h('select', { value: outcome, onChange: e => setOutcome(e.target.value) },
            outcomes.map(o => h('option', { key: o, value: o }, o))
          )
        )
      ),
      price && h('div', { className: 'modal-pnl' },
        h('span', { style: { color: 'var(--text2)' } }, 'Realized P&L'),
        h('span', { style: { fontWeight: 500, color: pnl >= 0 ? '#27500a' : '#791f1f' } },
          (pnl >= 0 ? '+' : '') + f$(pnl))
      ),
      h('div', { className: 'btn-group' },
        h('button', { className: 'btn btn-primary', onClick: () => onSave({ ...trade, outcome, closePrice: price, dateClosed: date }) }, 'Confirm close'),
        h('button', { className: 'btn', onClick: onClose }, 'Cancel')
      )
    )
  );
}

function ResolveBanner({ trades, prices, onResolve }) {
  const expired = trades.filter(t => {
    if (t.outcome !== 'Open') return false;
    if (!t.expiry) return false;
    // Only flag when today's DATE is strictly after the expiry DATE.
    // String comparison on YYYY-MM-DD avoids the midnight-vs-now datetime
    // bug: on expiry day itself ('2026-07-02' < '2026-07-02' is false),
    // the banner stays hidden; it appears the following day, once the
    // settled closing price is available.
    return t.expiry < todayStr();
  });

  if (!expired.length) return null;

  return h('div', null, expired.map(t => {
    const price = prices[t.ticker];
    const s1    = parseFloat(t.strike1);
    const isItm = t.putCall === 'P' ? price < s1 : price > s1;
    const autoOutcome = isItm ? 'Assigned' : 'Expired Worthless';

    return h('div', { key: t.id, className: 'resolve-banner' },
      h('div', { className: 'resolve-text' },
        h('strong', null, t.ticker), ' ', t.strategy, ' expired ', t.expiry,
        price && h('span', { style: { color: 'var(--text2)', marginLeft: 8 } },
          '— closed at ' + f$(price, 2) + (isItm ? ' (ITM → will assign)' : ' (OTM → worthless)'))
      ),
      h('button', { className: 'btn btn-sm', onClick: () => onResolve(t, autoOutcome, price) },
        'Confirm: ' + autoOutcome)
    );
  }));
}
