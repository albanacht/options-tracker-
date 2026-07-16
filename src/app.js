const TABS = [
  { id: 'monitor',   label: 'Monitor',       icon: 'ti-eye' },
  { id: 'logger',    label: 'Log trade',      icon: 'ti-plus' },
  { id: 'wheel',     label: 'Wheel cycles',   icon: 'ti-refresh' },
  { id: 'timeline',  label: 'Timeline',       icon: 'ti-timeline' },
  { id: 'risk',      label: 'Capital at risk',icon: 'ti-shield' },
  { id: 'charts',    label: 'Charts',         icon: 'ti-chart-bar' },
  { id: 'watchlist', label: 'Watchlist',      icon: 'ti-list' },
  { id: 'ev',        label: 'EV / Edge',      icon: 'ti-math-function' },
  { id: 'scanner',   label: 'Scanner',        icon: 'ti-radar' },
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

  // ── Export / Import ──────────────────────────────────────────
  const downloadBlob = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    const data = { exportedAt: new Date().toISOString(), tradeCount: trades.length, trades, watchlist };
    downloadBlob(JSON.stringify(data, null, 2), 'options-tracker-' + todayStr() + '.json', 'application/json');
  };

  const exportCsv = () => {
    const cols = ['dateOpened','ticker','strategy','putCall','strike1','strike2','expiry','dte','contracts','underlyingAtEntry','ivhv','iv','delta','premiumReceived','outcome','closePrice','dateClosed','notes'];
    const esc = v => {
      let s = v == null ? '' : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const rows = trades.map(t => cols.map(c => esc(t[c])).join(','));
    downloadBlob(cols.join(',') + '\n' + rows.join('\n'), 'options-tracker-' + todayStr() + '.csv', 'text/csv');
  };

  const importJson = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const imported = Array.isArray(data) ? data : data.trades;
        if (!Array.isArray(imported)) throw new Error('No trades array found');
        if (!window.confirm('Import ' + imported.length + ' trades? This REPLACES your current ' + trades.length + ' trades. Export a backup first if unsure.')) return;
        setTrades(imported);
        if (data.watchlist && Array.isArray(data.watchlist)) setWatchlist(data.watchlist);
      } catch (err) {
        window.alert('Could not read that file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-importing the same file later
  };

  return h('div', null,
    h('div', { className: 'app-header' },
      h('div', null,
        h('div', { className: 'app-title' }, 'Options tracker'),
        h('div', { className: 'app-sub' },
          openCount + ' open · ' + cycleCount + ' wheel cycle' + (cycleCount !== 1 ? 's' : '') + ' · ' + trades.length + ' total trades'
        )
      ),
      h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        h('button', { className: 'btn btn-sm', onClick: exportJson, title: 'Full backup — use this one for analysis' }, 'Export JSON'),
        h('button', { className: 'btn btn-sm', onClick: exportCsv, title: 'Spreadsheet-friendly export' }, 'CSV'),
        h('label', { className: 'btn btn-sm', style: { cursor: 'pointer' }, title: 'Restore from a JSON export' },
          'Import',
          h('input', { type: 'file', accept: '.json,application/json', onChange: importJson, style: { display: 'none' } })
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
    tab === 'timeline'  && h(Timeline,       { trades, prices }),
    tab === 'risk'      && h(CapitalRisk,    { trades, prices }),
    tab === 'charts'    && h(Charts,         { trades, prices }),
    tab === 'watchlist' && h(Watchlist,      { watchlist, setWatchlist, prices, loadingPrices: loading, refresh: doFetchPrices }),
    tab === 'ev'        && h(EVCalculator,   { trades }),
    tab === 'scanner'   && h(Scanner, { onPick: draft => { setEditTrade(draft); setShowForm(false); setTab('logger'); } })
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
