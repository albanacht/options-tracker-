const { createElement: h, useState, useMemo } = React;

function TradeForm({ onSave, initial, onCancel }) {
  const [t, setT] = useState(initial || {
    dateOpened: todayStr(), ticker: '', strategy: 'Naked Put', putCall: 'P',
    strike1: '', strike2: '', expiry: '', dte: '30', contracts: '1',
    underlyingAtEntry: '', ivhv: '', delta: '', premiumReceived: '',
    outcome: 'Open', closePrice: '', dateClosed: '', notes: ''
  });

  const up = (k, v) => setT(p => ({ ...p, [k]: v }));
  const m = useMemo(() => calcMetrics(t), [t]);
  const isS = t.strategy && (t.strategy.includes('Spread') || t.strategy.includes('Condor'));
  const showClose = t.outcome !== 'Open' && t.outcome !== 'Expired Worthless'
    && t.outcome !== 'Assigned' && t.outcome !== 'Max Loss';

  const field = (label, key, type = 'text', opts = {}) =>
    h('div', { className: 'field' },
      h('label', null, label),
      h('input', {
        type, value: t[key] || '',
        onChange: e => up(key, type === 'text' ? e.target.value.toUpperCase() : e.target.value),
        ...opts
      })
    );

  const select = (label, key, options) =>
    h('div', { className: 'field' },
      h('label', null, label),
      h('select', { value: t[key], onChange: e => up(key, e.target.value) },
        options.map(o => h('option', { key: o, value: o }, o))
      )
    );

  return h('div', { className: 'card' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 } },
      h('span', { style: { fontWeight: 500 } }, initial ? 'Edit trade' : 'Log new trade'),
      onCancel && h('button', { className: 'btn btn-sm', onClick: onCancel }, 'Cancel')
    ),
    h('div', { className: 'form-grid' },
      field('Date opened', 'dateOpened', 'date'),
      field('Ticker', 'ticker'),
      select('Strategy', 'strategy', STRATS),
      select('Put / Call', 'putCall', ['P', 'C']),
      field('Strike', 'strike1', 'number', { placeholder: '285', step: '0.5' }),
      isS && field('Strike 2 (lower leg)', 'strike2', 'number', { placeholder: '275', step: '0.5' }),
      field('Expiry date', 'expiry', 'date'),
      field('DTE', 'dte', 'number', { placeholder: '30' }),
      field('Contracts', 'contracts', 'number', { placeholder: '1' }),
      field('Underlying at entry', 'underlyingAtEntry', 'number', { step: '0.01' }),
      field('IV/HV ratio', 'ivhv', 'number', { step: '0.01', placeholder: '1.5' }),
      field('Delta', 'delta', 'number', { step: '0.01', placeholder: '0.15' }),
      field('Premium received ($)', 'premiumReceived', 'number', { step: '0.01' })
    ),

    (t.strike1 || t.premiumReceived) && h('div', { className: 'calc-preview' },
      h('div', { className: 'calc-item' }, h('div', { className: 'calc-label' }, 'Capital at risk'), h('div', { className: 'calc-val' }, f$(m.cap))),
      h('div', { className: 'calc-item' }, h('div', { className: 'calc-label' }, 'Break-even'), h('div', { className: 'calc-val' }, f$(m.be, 2))),
      h('div', { className: 'calc-item' }, h('div', { className: 'calc-label' }, 'BE cushion'),
        h('div', { className: 'calc-val', style: { color: m.bec > 0.1 ? '#3b6d11' : m.bec > 0.05 ? '#854f0b' : '#a32d2d' } }, fp(m.bec))),
      h('div', { className: 'calc-item' }, h('div', { className: 'calc-label' }, 'Ann. ROCAR'),
        h('div', { className: 'calc-val', style: { color: '#185fa5' } }, fp(m.annR))),
      isS && h('div', { className: 'calc-item' }, h('div', { className: 'calc-label' }, 'Max loss'),
        h('div', { className: 'calc-val', style: { color: '#a32d2d' } }, f$(m.maxLoss)))
    ),

    h('div', { className: 'form-grid' },
      select('Outcome', 'outcome', OUTCOMES),
      showClose && field('Close / buyback price ($)', 'closePrice', 'number', { step: '0.01' }),
      t.outcome !== 'Open' && field('Date closed', 'dateClosed', 'date'),
      h('div', { className: 'field full' },
        h('label', null, 'Notes'),
        h('textarea', { rows: 2, value: t.notes || '', onChange: e => up('notes', e.target.value) })
      )
    ),

    h('button', { className: 'btn btn-primary', onClick: () => onSave({ ...t, id: initial?.id || String(Date.now()) }) },
      initial ? 'Update trade' : 'Save trade')
  );
}
