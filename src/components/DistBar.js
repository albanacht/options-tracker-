const { createElement: h } = React;

function DistBar({ t, price }) {
  if (!price || !t.strike1) return null;
  const s1 = parseFloat(t.strike1);
  const s2 = parseFloat(t.strike2) || 0;
  const isS = t.strategy && t.strategy.includes('Spread');
  const lo  = isS ? Math.min(s1, s2) * 0.88 : s1 * 0.84;
  const hi  = isS ? Math.max(s1, s2) * 1.12 : s1 * 1.16;
  const rng = hi - lo;
  const pp  = Math.max(0, Math.min(100, (price - lo) / rng * 100));
  const sp  = Math.max(0, Math.min(100, (s1 - lo) / rng * 100));
  const s2p = isS && s2 ? Math.max(0, Math.min(100, (s2 - lo) / rng * 100)) : null;
  const dist = Math.abs(price - s1) / s1;
  const col  = distCol(dist);

  return h('div', { className: 'dist-wrap' },
    h('div', { className: 'dist-header' },
      h('span', null, f$(lo, 0)),
      h('span', { style: { fontWeight: 500, color: col } }, (dist * 100).toFixed(1) + '% from strike'),
      h('span', null, f$(hi, 0))
    ),
    h('div', { className: 'dist-track' },
      h('div', { className: 'dist-fill', style: { width: pp + '%', background: col + '28' } }),
      h('div', { className: 'strike-mk', style: { left: sp + '%' } }),
      s2p != null && h('div', { className: 'strike-mk', style: { left: s2p + '%', background: 'var(--text3)' } }),
      h('div', { className: 'price-dot', style: { left: pp + '%', background: col } })
    ),
    h('div', { className: 'dist-footer' },
      h('span', null, 'K=' + f$(s1, 2) + (s2p != null ? ' / ' + f$(s2, 2) : '')),
      h('span', { style: { color: 'var(--text)', fontWeight: 500 } }, 'Price=' + f$(price, 2))
    )
  );
}
