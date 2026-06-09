const { createElement: h, useState: useStateWL } = React;

const QUICK_TICKERS = ['GOOG','GOOGL','QCOM','NVO','VZ','ARE','CRM','NEM','SCHD','VOO','O','BTI','ADM','WPC','JPM','AAPL','UNH','NVDA'];

function Watchlist({ watchlist, setWatchlist, prices, loadingPrices, refresh }) {
  const [newT, setNewT]     = useStateWL('');
  const [ivhvMap, setIvhvMap] = useStateWL({});

  const add = () => {
    const t = newT.trim().toUpperCase();
    if (t && !watchlist.includes(t)) { setWatchlist(p => [...p, t]); setNewT(''); }
  };

  const remove = ticker => setWatchlist(p => p.filter(x => x !== ticker));

  const setIv = (ticker, val) => setIvhvMap(p => ({ ...p, [ticker]: val }));

  return h('div', null,
    h('div', { className: 'card' },
      h('div', { style: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' } },
        h('input', {
          placeholder: 'Add ticker…', value: newT,
          onChange: e => setNewT(e.target.value.toUpperCase()),
          onKeyDown: e => e.key === 'Enter' && add(),
          style: { width: 120, flex: 'none' }
        }),
        h('button', { className: 'btn btn-sm', onClick: add }, 'Add'),
        h('button', { className: 'btn btn-sm', onClick: refresh, disabled: loadingPrices },
          loadingPrices ? 'Loading…' : 'Refresh prices')
      ),

      h('div', { className: 'watchlist-chips' },
        watchlist.map(t => h('div', { key: t, className: 'wchip' },
          h('strong', null, t),
          prices[t] && h('span', { className: 'price' }, f$(prices[t], 2)),
          h('button', { onClick: () => remove(t), 'aria-label': 'Remove ' + t }, '×')
        )),
        !watchlist.length && h('span', { style: { fontSize: 12, color: 'var(--text2)' } }, 'No tickers yet — add above or pick from suggestions below')
      ),

      !watchlist.length && h('div', null,
        h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 8 } }, 'Quick-add from your usual names:'),
        h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
          QUICK_TICKERS.map(t => h('button', { key: t, className: 'btn btn-sm', onClick: () => setWatchlist(p => p.includes(t) ? p : [...p, t]) }, t))
        )
      )
    ),

    watchlist.length > 0 && h('div', { className: 'card' },
      h('div', { className: 'sec' }, 'IV/HV signal — enter from your broker'),
      h('div', { style: { fontSize: 11, color: 'var(--text2)', marginBottom: 12 } },
        'IV rank requires paid data. Enter IV/HV ratio from Tastytrade or IBKR. Above 1.2 is favorable for premium selling. The ROCAR estimate assumes a 0.15Δ put at 30 DTE.'),
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null,
            ['Ticker','Current price','IV/HV (from broker)','Signal','Est. ann. ROCAR','Notes'].map(c => h('th', { key: c }, c))
          )),
          h('tbody', null, watchlist.map(ticker => {
            const iv    = ivhvMap[ticker] || '';
            const sig   = parseFloat(iv);
            const price = prices[ticker];
            const estPrem = price ? price * 0.015 : null;
            const estRocar = estPrem && price ? (estPrem / (price * 100)) * (365 / 30) : null;
            const signalBadge = sig >= 1.5 ? h('span', { className: 'badge badge-green' }, 'Strong sell')
              : sig >= 1.2 ? h('span', { className: 'badge badge-amber' }, 'Sell vol')
              : sig > 0    ? h('span', { className: 'badge badge-red' }, 'Wait')
              : h('span', { className: 'badge badge-gray' }, '—');
            const note = sig >= 1.5 ? 'IV elevated — good premium environment'
              : sig >= 1.2 ? 'Acceptable — check earnings calendar'
              : sig > 0    ? 'Wait for higher IV before selling'
              : '';

            return h('tr', { key: ticker },
              h('td', null, h('strong', null, ticker)),
              h('td', null, price ? f$(price, 2) : '—'),
              h('td', null,
                h('input', {
                  type: 'number', step: '0.01', placeholder: '1.5',
                  value: iv, onChange: e => setIv(ticker, e.target.value),
                  style: { width: 70 }
                })
              ),
              h('td', null, signalBadge),
              h('td', null, estRocar ? h('span', { className: 'rocp' }, '~' + fp(estRocar)) : '—'),
              h('td', { style: { fontSize: 11, color: 'var(--text2)' } }, note)
            );
          }))
        )
      )
    )
  );
}
