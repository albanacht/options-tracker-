const { createElement: h, useState, useEffect, useCallback, useMemo } = React;

const TABS = [
  { id: 'monitor',   label: 'Monitor',       icon: 'ti-eye' },
  { id: 'logger',    label: 'Log trade',      icon: 'ti-plus' },
  { id: 'wheel',     label: 'Wheel cycles',   icon: 'ti-refresh' },
  { id: 'risk',      label: 'Capital at risk',icon: 'ti-shield' },
  { id: 'charts',    label: 'Charts',         icon: 'ti-chart-bar' },
  { id: 'watchlist', label: 'Watchlist',      icon: 'ti-list' },
];

function App() {
  const [tab,       setTab]       = useState('monitor');
  const [trades,    setTrades]    = useState(() => Store.getTrades());
  const [showForm,  setShowForm]  = useState(false);
  const [editTrade, setEditTrade] = useState(null);
  const [prices,    setPrices]    = useState({});
  const [loading,   setLoading]   = useState(false);
  const [watchlist, setWatchlist] = useState(() => Store.getWatchlist());

  useEffect(() => Store.setTrades(trades),    [trades]);
  useEffect(() => Store.setWatchlist(watchlist), [watchlist]);

  const saveTrade = t => {
    setTrades(p => {
      const i = p.findIndex(x => x.id === t.id);
      if (i >= 0) { const n = [...p]; n[i] = t; return n; }
      return [...p, t];
    });
    setShowForm(false);
    setEditTrade(null);
  };

  const addTrade  = t => setTrades(p => [...p, t]);
  const delTrade  = id => setTrades(p => p.filter(t => t.id !== id));

  const handleResolve = (trade, outcome, price) => {
    saveTrade({ ...trade, outcome, dateClosed: trade.expiry });
  };

  const allTickers = useMemo(() =>
    [...new Set([
      ...trades.filter(t => t.outcome === 'Open').map(t => t.ticker),
      ...watchlist
    ])].filter(Boolean),
    [trades, watchlist]
  );

  const doFetchPrices = useCallback(async () => {
    if (!allTickers.length) return;
    setLoading(true);
    const res = await fetchPrices(allTickers);
    setPrices(p => ({ ...p, ...res }));
    setLoading(false);
  }, [allTickers]);

  useEffect(() => {
    if (allTickers.length) doFetchPrices();
  }, [allTickers.join(',')]);

  const openCount  = trades.filter(t => t.outcome === 'Open').length;
  const cycleCount = trades.filter(t => t.outcome === 'Assigned').length;

  return h('div', null,
    h('div', { className: 'app-header' },
      h('div', null,
        h('div', { className: 'app-title' }, 'Options tracker'),
        h('div', { className: 'app-sub' },
          openCount + ' open · ' + cycleCount + ' wheel cycle' + (cycleCount !== 1 ? 's' : '') + ' · ' + trades.length + ' total trades'
        )
      )
    ),

    h(ResolveBanner, { trades, prices, onResolve: handleResolve }),

    h('div', { className: 'tabs' },
      TABS.map(t => h('button', {
        key: t.id,
        className: 'tab' + (tab === t.id ? ' active' : ''),
        onClick: () => setTab(t.id)
      },
        h('i', { className: 'ti ' + t.icon, 'aria-hidden': true }),
        t.label
      ))
    ),

    tab === 'monitor' && h(ActiveMonitor, { trades, prices, loadingPrices: loading, refreshPrices: doFetchPrices, onUpdateTrade: saveTrade }),

    tab === 'logger' && h('div', null,
      !showForm && !editTrade && h('div', null,
        h('button', { className: 'btn btn-primary', style: { marginBottom: 14 }, onClick: () => setShowForm(true) },
          h('i', { className: 'ti ti-plus', 'aria-hidden': true }), ' Log new trade'
        ),
        trades.length > 0 && h('div', { className: 'card' },
          h('div', { className: 'sec' }, 'All trades'),
          h('div', { className: 'table-wrap' },
            h('table', null,
              h('thead', null, h('tr', null,
                ['Date','Ticker','Strategy','Strike','Premium','ROCAR','Status',''].map(c => h('th', { key: c }, c))
              )),
              h('tbody', null, [...trades].reverse().map(t => {
                const m   = calcMetrics(t);
                const won = ['Expired Worthless','Bought Back','Closed Profit'].includes(t.outcome);
                const statusCls = t.outcome === 'Open' ? 'badge-blue'
                  : won ? 'badge-green'
                  : t.outcome === 'Assigned' ? 'badge-amber'
                  : 'badge-red';
                return h('tr', { key: t.id },
                  h('td', { style: { whiteSpace: 'nowrap' } }, t.dateOpened),
                  h('td', null, h('strong', null, t.ticker)),
                  h('td', { style: { fontSize: 11 } }, t.strategy),
                  h('td', null, t.strike1 + (t.strike2 ? ' / ' + t.strike2 : '')),
                  h('td', null, f$((parseFloat(t.premiumReceived) || 0) * 100)),
                  h('td', null, h('span', { className: 'rocp' }, fp(m.annR))),
                  h('td', null, h('span', { className: 'badge ' + statusCls, style: { fontSize: 10 } }, t.outcome)),
                  h('td', { style: { whiteSpace: 'nowrap' } },
                    h('button', { className: 'btn btn-sm', style: { marginRight: 4 }, onClick: () => { setEditTrade(t); setShowForm(false); } }, 'Edit'),
                    h('button', { className: 'btn btn-sm btn-danger', onClick: () => delTrade(t.id) }, 'Del')
                  )
                );
              }))
            )
          )
        )
      ),
      (showForm || editTrade) && h(TradeForm, {
        initial: editTrade,
        onSave: saveTrade,
        onCancel: () => { setShowForm(false); setEditTrade(null); }
      })
    ),

    tab === 'wheel'     && h(WheelCycles,   { trades, prices, onUpdateTrade: saveTrade, onAddTrade: addTrade }),
    tab === 'risk'      && h(CapitalRisk,    { trades, prices }),
    tab === 'charts'    && h(Charts,         { trades, prices }),
    tab === 'watchlist' && h(Watchlist,      { watchlist, setWatchlist, prices, loadingPrices: loading, refresh: doFetchPrices })
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
