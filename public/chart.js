/* Canvas price chart: candlesticks, moving averages, volume, intraday line. */

const C = {
  surface: '#141413',
  grid: '#262624',
  axis: '#3a3a37',
  text: '#898781',
  textDim: '#6a6862',
  ink: '#f0efec',
  ink2: '#c3c2b7',
  up: '#e66767',
  down: '#0ca30c',
  upFill: 'rgba(230,103,103,0.55)',
  downFill: 'rgba(12,163,12,0.55)',
  blue: '#3987e5',
  accent: '#e3b35c',
};

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(max || 1) * 0.01;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

function axisNum(v) {
  const a = Math.abs(v);
  if (a >= 10000) return `${(v / 1000).toFixed(1)}k`;
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function priceText(v, decimals = 2) {
  if (!Number.isFinite(v)) return '--';
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: Math.min(decimals, 2),
  });
}

function tagText(v) {
  if (!Number.isFinite(v)) return '--';
  return Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}

export function createPriceChart(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const wrap = canvas.parentElement;
  let data = null;
  let hover = -1;
  let geom = null;
  const visibleMa = { ma5: true, ma10: true, ma20: true };

  function measure() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(240, Math.round(rect.width));
    const h = Math.max(180, Math.round(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function buildGeometry(w, h) {
    const padL = 10;
    const padR = 62;
    const padT = 14;
    const padB = 26;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const volH = Math.round(Math.min(96, Math.max(52, plotH * 0.21)));
    const gap = 18;
    const priceH = plotH - volH - gap;
    const n = data.mode === 'kline' ? data.items.length : data.points.length;
    const slot = plotW / Math.max(n, 1);
    return {
      w,
      h,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      priceH,
      volH,
      gap,
      volTop: padT + priceH + gap,
      slot,
      n,
      x: (i) => padL + slot * (i + 0.5),
    };
  }

  function draw() {
    if (!ctx) return;
    const { w, h } = measure();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, w, h);
    if (!data || !data.mode) return;

    geom = buildGeometry(w, h);
    if (!geom.n) return;

    if (data.mode === 'kline') drawKline(geom);
    else drawTrend(geom);
    drawHover(geom);
  }

  function scaleRange(values, padRatio = 0.06) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min)) return { min: 0, max: 1 };
    if (min === max) {
      const pad = Math.abs(max || 1) * 0.01;
      return { min: min - pad, max: max + pad };
    }
    const pad = (max - min) * padRatio;
    return { min: min - pad, max: max + pad };
  }

  function drawFrame(g, min, max, ticks) {
    const { padL, padT, plotW, priceH, x, n, padB, h } = g;
    const y = (v) => padT + ((max - v) / (max - min)) * priceH;

    ctx.save();
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = C.text;
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const t of ticks) {
      const py = Math.round(y(t)) + 0.5;
      if (py < padT - 1 || py > padT + priceH + 1) continue;
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(padL + plotW, py);
      ctx.stroke();
      ctx.fillText(axisNum(t), padL + plotW + 8, py);
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = C.textDim;
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textBaseline = 'top';
    const labelY = h - padB + 8;

    if (data.mode === 'kline') {
      const count = Math.min(6, n);
      const step = Math.max(1, Math.floor((n - 1) / Math.max(count - 1, 1)));
      const idxs = [];
      for (let i = n - 1; i >= 0 && idxs.length < count; i -= step) idxs.push(i);
      idxs.reverse();
      ctx.textAlign = 'center';
      for (const i of idxs) {
        const label = shortDate(data.items[i].date);
        const tx = clamp(x(i), padL + 16, padL + plotW - 16);
        ctx.fillText(label, tx, labelY);
      }
    } else {
      const times = ['09:30', '11:30', '15:00'];
      const positions = [x(0), x(Math.floor(n / 2)), x(n - 1)];
      ctx.textAlign = 'left';
      ctx.fillText(times[0], padL, labelY);
      ctx.textAlign = 'center';
      ctx.fillText(times[1], positions[1], labelY);
      ctx.textAlign = 'right';
      ctx.fillText(times[2], padL + plotW, labelY);
    }
    ctx.restore();
    return y;
  }

  function drawKline(g) {
    const { padL, padT, plotW, priceH, volTop, volH, x, n, slot } = g;
    const items = data.items;
    const values = [];
    for (const it of items) values.push(it.high, it.low);
    for (const ma of data.mas || []) {
      if (!visibleMa[ma.key]) continue;
      for (const v of ma.values) if (Number.isFinite(v)) values.push(v);
    }
    const { min, max } = scaleRange(values);
    const ticks = niceTicks(min, max, 4);
    const y = drawFrame(g, min, max, ticks);

    let volMax = 0;
    for (const it of items) volMax = Math.max(volMax, it.volume || 0);
    volMax = volMax || 1;

    const bw = Math.max(1, Math.min(11, slot * 0.62));

    // volume first, so hollow candles sit above it cleanly
    ctx.save();
    for (let i = 0; i < n; i++) {
      const it = items[i];
      if (!it.volume) continue;
      const up = it.close >= it.open;
      const bh = Math.max(1, (it.volume / volMax) * volH);
      ctx.fillStyle = up ? C.upFill : C.downFill;
      ctx.fillRect(x(i) - bw / 2, volTop + volH - bh, Math.max(1, bw), bh);
    }
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(volTop + volH) + 0.5);
    ctx.lineTo(padL + plotW, Math.round(volTop + volH) + 0.5);
    ctx.stroke();
    ctx.fillStyle = C.textDim;
    ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('成交量', padL + 2, volTop + 3);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT - 2, plotW, priceH + 4);
    ctx.clip();

    for (let i = 0; i < n; i++) {
      const it = items[i];
      const up = it.close >= it.open;
      const cx = x(i);
      ctx.strokeStyle = up ? C.up : C.down;
      ctx.fillStyle = up ? C.up : C.down;
      ctx.lineWidth = 1;
      const top = Math.min(y(it.open), y(it.close));
      const bottom = Math.max(y(it.open), y(it.close));
      const bodyH = Math.max(1, bottom - top);

      ctx.beginPath();
      ctx.moveTo(cx, y(it.high));
      ctx.lineTo(cx, y(it.low));
      ctx.stroke();

      if (bw >= 3.5) {
        if (up) {
          ctx.fillStyle = C.surface;
          ctx.fillRect(cx - bw / 2, top, bw, bodyH);
          ctx.strokeStyle = C.up;
          ctx.strokeRect(cx - bw / 2 + 0.5, top + 0.5, Math.max(1, bw - 1), Math.max(1, bodyH - 1));
        } else {
          ctx.fillStyle = C.down;
          ctx.fillRect(cx - bw / 2, top, bw, bodyH);
        }
      } else {
        ctx.fillStyle = up ? C.up : C.down;
        ctx.fillRect(cx - Math.max(0.5, bw / 2), top, Math.max(1, bw), bodyH);
      }
    }

    for (const ma of data.mas || []) {
      if (!visibleMa[ma.key]) continue;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const v = ma.values[i];
        if (!Number.isFinite(v)) {
          started = false;
          continue;
        }
        const px = x(i);
        const py = y(v);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.strokeStyle = ma.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTrend(g) {
    const { padL, padT, plotW, priceH, volTop, volH, x, n } = g;
    const points = data.points;
    const values = points.map((p) => p.price);
    if (Number.isFinite(data.preClose)) values.push(data.preClose);
    for (const p of points) if (Number.isFinite(p.avg)) values.push(p.avg);
    const { min, max } = scaleRange(values, 0.09);
    const ticks = niceTicks(min, max, 4);
    const y = drawFrame(g, min, max, ticks);

    const yPre = Number.isFinite(data.preClose) ? y(data.preClose) : null;
    if (yPre !== null) {
      ctx.save();
      ctx.strokeStyle = 'rgba(240,239,236,0.22)';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(yPre) + 0.5);
      ctx.lineTo(padL + plotW, Math.round(yPre) + 0.5);
      ctx.stroke();
      ctx.restore();
    }

    let volMax = 0;
    for (const p of points) volMax = Math.max(volMax, p.volume || 0);
    volMax = volMax || 1;

    const barW = Math.max(1, Math.min(6, g.slot * 0.7));
    ctx.save();
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const prev = i > 0 ? points[i - 1].price : data.preClose;
      if (!p.volume) continue;
      const up = p.price >= (Number.isFinite(prev) ? prev : p.price);
      const bh = Math.max(1, ((p.volume || 0) / volMax) * volH);
      ctx.fillStyle = up ? C.upFill : C.downFill;
      ctx.fillRect(x(i) - barW / 2, volTop + volH - bh, barW, bh);
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT - 2, plotW, priceH + 4);
    ctx.clip();

    // area wash under the price line
    const gradient = ctx.createLinearGradient(0, padT, 0, padT + priceH);
    gradient.addColorStop(0, 'rgba(240,239,236,0.12)');
    gradient.addColorStop(1, 'rgba(240,239,236,0)');
    ctx.beginPath();
    points.forEach((p, i) => {
      const px = x(i);
      const py = y(p.price);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(x(n - 1), padT + priceH);
    ctx.lineTo(x(0), padT + priceH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // average price line
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = points[i].avg;
      if (!Number.isFinite(v)) {
        started = false;
        continue;
      }
      const px = x(i);
      const py = y(v);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // price line
    ctx.beginPath();
    points.forEach((p, i) => {
      const px = x(i);
      const py = y(p.price);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // lunch break divider
    const lunch = points.findIndex((p) => (p.time || '').slice(11) >= '13:00');
    if (lunch > 0) {
      const bx = Math.round((x(lunch - 1) + x(lunch)) / 2) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, padT);
      ctx.lineTo(bx, padT + priceH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(volTop + volH) + 0.5);
    ctx.lineTo(padL + plotW, Math.round(volTop + volH) + 0.5);
    ctx.stroke();
  }

  function drawHover(g) {
    if (hover < 0 || hover >= g.n) return;
    const { padL, padT, plotW, plotH, x } = g;
    const hx = Math.round(x(hover)) + 0.5;

    let priceY = null;
    let priceLabel = '';
    if (data.mode === 'kline') {
      const it = data.items[hover];
      if (it) {
        priceY = null;
        priceLabel = tagText(it.close);
      }
    } else {
      const p = data.points[hover];
      if (p) priceLabel = tagText(p.price);
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(240,239,236,0.28)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, padT);
    ctx.lineTo(hx, padT + plotH);
    ctx.stroke();

    if (data.mode === 'trend' && hover >= 0) {
      const p = data.points[hover];
      const scale = scaleForHover(g);
      priceY = scale.y(p.price);
    } else if (data.mode === 'kline') {
      const it = data.items[hover];
      priceY = scaleForHover(g).y(it.close);
    }

    if (priceY !== null && Number.isFinite(priceY)) {
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(priceY) + 0.5);
      ctx.lineTo(padL + plotW, Math.round(priceY) + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // price tag on right axis
    if (priceLabel && priceY !== null) {
      ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
      const tw = Math.max(44, ctx.measureText(priceLabel).width + 12);
      const th = 17;
      const tx = padL + plotW + 5;
      const ty = clamp(priceY - th / 2, padT, padT + plotH - th);
      ctx.fillStyle = C.ink;
      roundRect(ctx, tx, ty, tw, th, 4);
      ctx.fill();
      ctx.fillStyle = '#0b0b0a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(priceLabel, tx + tw / 2, ty + th / 2 + 0.5);
    }

    // date tag under axis
    let dateLabel = '';
    if (data.mode === 'kline') dateLabel = data.items[hover]?.date || '';
    else dateLabel = (data.points[hover]?.time || '').slice(11);
    if (dateLabel) {
      ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
      const tw = ctx.measureText(dateLabel).width + 14;
      const tx = clamp(hx - tw / 2, padL, padL + plotW - tw);
      const ty = g.h - g.padB + 3;
      ctx.fillStyle = '#2a2a26';
      roundRect(ctx, tx, ty, tw, 17, 4);
      ctx.fill();
      ctx.fillStyle = C.ink2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dateLabel, tx + tw / 2, ty + 9);
    }
    ctx.restore();
  }

  // Recompute the current price scale so hover tags land on the right pixel.
  function scaleForHover(g) {
    let values;
    if (data.mode === 'kline') {
      values = [];
      for (const it of data.items) values.push(it.high, it.low);
      for (const ma of data.mas || []) {
        if (!visibleMa[ma.key]) continue;
        for (const v of ma.values) if (Number.isFinite(v)) values.push(v);
      }
    } else {
      values = data.points.map((p) => p.price);
      if (Number.isFinite(data.preClose)) values.push(data.preClose);
      for (const p of data.points) if (Number.isFinite(p.avg)) values.push(p.avg);
    }
    const { min, max } = scaleRange(values, data.mode === 'kline' ? 0.06 : 0.09);
    return {
      y: (v) => g.padT + ((max - v) / (max - min)) * g.priceH,
    };
  }

  function shortDate(date) {
    if (!date) return '';
    if (data.period === 'month' || data.period === 'week') return date.slice(2, 7);
    return date.slice(5);
  }

  function pointerIndex(e) {
    if (!data || !geom) return -1;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (
      px < geom.padL ||
      px > geom.padL + geom.plotW ||
      py < geom.padT ||
      py > geom.padT + geom.plotH
    ) {
      return -1;
    }
    return clamp(Math.floor((px - geom.padL) / geom.slot), 0, geom.n - 1);
  }

  function handleMove(e) {
    if (!data) return;
    const rect = canvas.getBoundingClientRect();
    const idx = pointerIndex(e);
    if (idx < 0) {
      if (hover !== -1) {
        hover = -1;
        draw();
        options.onLeave?.();
      }
      return;
    }
    if (idx !== hover) {
      hover = idx;
      draw();
    }
    options.onHover?.(idx, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    });
  }

  function handleLeave() {
    if (hover !== -1) {
      hover = -1;
      draw();
      options.onLeave?.();
    }
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(wrap);
  canvas.addEventListener('pointermove', handleMove);
  canvas.addEventListener('pointerdown', handleMove);
  canvas.addEventListener('pointerleave', handleLeave);

  return {
    setData(next) {
      data = next;
      hover = -1;
      draw();
    },
    setVisible(key, visible) {
      visibleMa[key] = visible;
      draw();
    },
    redraw: draw,
    clearHover() {
      hover = -1;
      draw();
    },
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('pointerdown', handleMove);
      canvas.removeEventListener('pointerleave', handleLeave);
    },
  };
}

export { priceText };
