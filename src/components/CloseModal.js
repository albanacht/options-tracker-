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
  // Assignment and worthless expiry were missing here, so a put that got
  // assigned could only be logged as a buyback — which invents a loss and
  // never creates the share lot. Both belong on every single-leg position.
  const outcomes = isS
    ? ['Closed Profit', 'Closed Loss', 'Max Loss', 'Expired Worthless']
    : ['Bought Back', 'Closed Loss', 'Assigned', 'Expired Worthless'];

  // No cash changes hands on the option itself for these two — you keep
  // the whole premium, so there is no buyback price to enter.
  const noPrice = outcome === 'Assigned' || outcome === 'Expired Worthless';
  const keptPnl = prem * 100 * con;

  return h('div', { className: 'modal-overlay' },
    h('div', { className: 'modal-box' },
      h('div', { className: 'modal-title' }, 'Close ' + trade.ticker + ' — ' + trade.strategy),
      h('div', { className: 'form-grid' },
        !noPrice && h('div', { className: 'field' },
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
      noPrice && h('div', { className: 'modal-pnl' },
        h('span', { style: { color: 'var(--text2)' } },
          outcome === 'Assigned' ? 'Premium kept (shares acquired at strike)' : 'Premium kept'),
        h('span', { style: { fontWeight: 500, color: '#27500a' } }, '+' + f$(keptPnl))
      ),

      outcome === 'Assigned' && h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.5 } },
        'Logs ' + (con * 100) + ' shares of ' + trade.ticker + ' at $' + trade.strike1 +
        '. Set the date to the day you were actually assigned \u2014 early assignment is fine, ' +
        'the expiry is ignored. The lot then appears on the Wheel tab.'),

      !noPrice && price && h('div', { className: 'modal-pnl' },
        h('span', { style: { color: 'var(--text2)' } }, 'Realized P&L'),
        h('span', { style: { fontWeight: 500, color: pnl >= 0 ? '#27500a' : '#791f1f' } },
          (pnl >= 0 ? '+' : '') + f$(pnl))
      ),
      h('div', { className: 'btn-group' },
        h('button', { className: 'btn btn-primary', onClick: () => onSave({ ...trade, outcome, closePrice: noPrice ? '' : price, dateClosed: date }) },
          outcome === 'Assigned' ? 'Confirm assignment' : 'Confirm close'),
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
