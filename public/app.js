import { createPriceChart } from './chart.js';

/* ------------------------------------------------------------------ */
/* constants                                                          */
/* ------------------------------------------------------------------ */

const INDEXES = [
  { secid: '1.000001', code: '000001', name: '上证指数', suffix: 'SH' },
  { secid: '0.399001', code: '399001', name: '深证成指', suffix: 'SZ' },
  { secid: '0.399006', code: '399006', name: '创业板指', suffix: 'SZ' },
  { secid: '1.000300', code: '000300', name: '沪深300', suffix: 'SH' },
];

const DEFAULT_WATCH = [
  { secid: '1.600519', code: '600519', name: '贵州茅台' },
  { secid: '0.300750', code: '300750', name: '宁德时代' },
  { secid: '1.601318', code: '601318', name: '中国平安' },
  { secid: '1.600036', code: '600036', name: '招商银行' },
  { secid: '0.002594', code: '002594', name: '比亚迪' },
  { secid: '1.688981', code: '688981', name: '中芯国际' },
];

const WATCH_KEY = 'guanshi.watchlist.v1';
const SECID_RE = /^[0-9]{1,3}\.[A-Za-z0-9]{1,12}$/;

/* ------------------------------------------------------------------ */
/* dom                                                                */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);

const dom = {
  searchbox: $('#searchbox'),
  searchInput: $('#searchInput'),
  searchResults: $('#searchResults'),
  marketStatus: $('#marketStatus'),
  marketStatusText: $('#marketStatusText'),
  refreshBtn: $('#refreshBtn'),
  indices: $('#indices'),
  qName: $('#qName'),
  qCode: $('#qCode'),
  qSub: $('#qSub'),
  qPrice: $('#qPrice'),
  qDelta: $('#qDelta'),
  qStats: $('#qStats'),
  watchToggle: $('#watchToggle'),
  rangeTabs: $('#rangeTabs'),
  maLegend: $('#maLegend'),
  chartWrap: $('#chartWrap'),
  chart: $('#chart'),
  chartTooltip: $('#chartTooltip'),
  chartEmpty: $('#chartEmpty'),
  chartHint: $('#chartHint'),
  tableToggle: $('#tableToggle'),
  chartTable: $('#chartTable'),
  scoreBadge: $('#scoreBadge'),
  scoreNum: $('#scoreNum'),
  scoreLabel: $('#scoreLabel'),
  scoreMeter: $('#scoreMeter'),
  assistantSummary: $('#assistantSummary'),
  indicatorChips: $('#indicatorChips'),
  signalList: $('#signalList'),
  levelRow: $('#levelRow'),
  rangeDate: $('#rangeDate'),
  rangeBody: $('#rangeBody'),
  watchList: $('#watchList'),
  watchCount: $('#watchCount'),
  rankTabs: $('#rankTabs'),
  rankList: $('#rankList'),
  toast: $('#toast'),
};

/* ------------------------------------------------------------------ */
/* state                                                              */
/* ------------------------------------------------------------------ */

const state = {
  secid: '1.600519',
  code: '600519',
  name: '贵州茅台',
  range: 'day',
  quote: null,
  daily: [],
  chartPayload: null,
  hoverIdx: null,
  watch: loadWatch(),
  watchQuotes: new Map(),
  indexQuotes: new Map(),
  spark: new Map(),
  rankType: 'up',
  rank: [],
  prevPrice: null,
  maVisible: { ma5: true, ma10: true, ma20: true },
  lastDaily: 0,
  lastRank: 0,
  lastChart: 0,
  selectToken: 0,
  searchSeq: 0,
  searchItems: [],
  searchActive: -1,
};

let chartToken = 0;
let refreshTimer = null;
let toastTimer = null;
let searchTimer = null;

/* ------------------------------------------------------------------ */
/* formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function fmtPrice(v, digits = 2) {
  if (!isNum(v)) return '--';
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(v) {
  if (!isNum(v)) return '--';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function fmtSigned(v, digits = 2) {
  if (!isNum(v)) return '--';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}`;
}

function fmtAmount(v) {
  if (!isNum(v)) return '--';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(2)}万亿`;
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${sign}${(a / 1e4).toFixed(2)}万`;
  return `${sign}${a.toFixed(0)}`;
}

function fmtVolume(v) {
  if (!isNum(v)) return '--';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿手`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万手`;
  return `${Math.round(v)}手`;
}

function fmtCap(v) {
  if (!isNum(v)) return '--';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(0)}亿`;
  return `${(v / 1e4).toFixed(0)}万`;
}

function fmtTurnover(v) {
  return isNum(v) ? `${v.toFixed(2)}%` : '--';
}

function dirClass(v) {
  if (!isNum(v) || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

function arrow(v) {
  if (!isNum(v) || v === 0) return '—';
  return v > 0 ? '▲' : '▼';
}

function isBseCode(code) {
  return /^[48]/.test(String(code || ''));
}

function codeLabel(secid, code) {
  const market = String(secid).split('.')[0];
  const c = code || String(secid).split('.')[1] || '';
  if (market === '1') return `SH${c}`;
  if (market === '0') return isBseCode(c) ? `BJ${c}` : `SZ${c}`;
  return c;
}

function marketName(market, code = '') {
  if (market === 1) return '上海证券交易所';
  if (market === 0) return isBseCode(code) ? '北京证券交易所' : '深圳证券交易所';
  return '行情';
}

function exchangeLabel(market, code = '') {
  if (market === 1) return 'SH';
  if (market === 0) return isBseCode(code) ? 'BJ' : 'SZ';
  return '--';
}

function beijingNow() {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
}

function isTradingTime() {
  const bj = beijingNow();
  const day = bj.getDay();
  if (day === 0 || day === 6) return false;
  const mins = bj.getHours() * 60 + bj.getMinutes();
  return (mins >= 570 && mins < 690) || (mins >= 780 && mins < 900);
}

function updateMarketStatus() {
  const bj = beijingNow();
  const day = bj.getDay();
  const mins = bj.getHours() * 60 + bj.getMinutes();
  let text = '已收盘';
  let cls = 'is-closed';
  if (day === 0 || day === 6) {
    text = '休市 · 周末';
  } else if (mins < 570) {
    text = '未开盘';
  } else if (mins < 690) {
    text = '交易中';
    cls = 'is-open';
  } else if (mins < 780) {
    text = '午间休市';
    cls = 'is-break';
  } else if (mins < 900) {
    text = '交易中';
    cls = 'is-open';
  }
  dom.marketStatus.className = `market-status ${cls}`;
  dom.marketStatusText.textContent = text;
}

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 2600);
}

/* ------------------------------------------------------------------ */
/* api                                                                */
/* ------------------------------------------------------------------ */

async function api(path, params) {
  const url = new URL(path, location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* ignore malformed body */
  }
  if (!res.ok) throw new Error(body.error || `请求失败（${res.status}）`);
  return body;
}

/* ------------------------------------------------------------------ */
/* watchlist persistence                                              */
/* ------------------------------------------------------------------ */

function loadWatch() {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (!raw) return DEFAULT_WATCH.slice();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_WATCH.slice();
    const clean = parsed.filter(
      (w) => w && SECID_RE.test(w.secid) && typeof w.name === 'string' && typeof w.code === 'string'
    );
    return clean.slice(0, 30);
  } catch {
    return DEFAULT_WATCH.slice();
  }
}

function saveWatch() {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(state.watch.slice(0, 30)));
  } catch {
    /* storage may be unavailable */
  }
}

/* ------------------------------------------------------------------ */
/* chart                                                              */
/* ------------------------------------------------------------------ */

const chart = createPriceChart(dom.chart, {
  onHover(index, pos) {
    const payload = state.chartPayload;
    if (!payload) return;
    const changed = state.hoverIdx !== index;
    state.hoverIdx = index;
    if (changed || !dom.chartTooltip.innerHTML) {
      renderLegend();
      const html =
        payload.mode === 'kline'
          ? klineTooltip(payload.items[index])
          : trendTooltip(payload.points[index]);
      if (html) dom.chartTooltip.innerHTML = html;
    }
    dom.chartTooltip.hidden = false;
    positionTooltip(pos);
  },
  onLeave() {
    dom.chartTooltip.hidden = true;
    state.hoverIdx = null;
    renderLegend();
  },
});

function positionTooltip(pos) {
  const tip = dom.chartTooltip;
  const tw = 194;
  const th = tip.offsetHeight || 160;
  let left = pos.x + 16;
  let top = pos.y + 14;
  if (left + tw > pos.w - 8) left = pos.x - tw - 16;
  if (top + th > pos.h - 8) top = pos.y - th - 14;
  tip.style.left = `${Math.max(6, Math.min(left, pos.w - tw - 6))}px`;
  tip.style.top = `${Math.max(6, Math.min(top, pos.h - th - 6))}px`;
}

function klineTooltip(item) {
  if (!item) return '';
  const cls = dirClass(item.pct);
  return `
    <div class="tt-date">${esc(item.date)}</div>
    <div class="tt-row"><span>开盘</span><b>${fmtPrice(item.open)}</b></div>
    <div class="tt-row"><span>最高</span><b>${fmtPrice(item.high)}</b></div>
    <div class="tt-row"><span>最低</span><b>${fmtPrice(item.low)}</b></div>
    <div class="tt-row"><span>收盘</span><b class="${cls}">${fmtPrice(item.close)}</b></div>
    <div class="tt-sep"></div>
    <div class="tt-row"><span>涨跌幅</span><b class="${cls}">${fmtPct(item.pct)}</b></div>
    <div class="tt-row"><span>成交量</span><b>${fmtVolume(item.volume)}</b></div>
    <div class="tt-row"><span>成交额</span><b>${fmtAmount(item.amount)}</b></div>`;
}

function trendTooltip(point) {
  if (!point) return '';
  return `
    <div class="tt-date">${esc((point.time || '').slice(11))}</div>
    <div class="tt-row"><span>价格</span><b>${fmtPrice(point.price)}</b></div>
    <div class="tt-row"><span>均价</span><b>${fmtPrice(point.avg)}</b></div>
    <div class="tt-sep"></div>
    <div class="tt-row"><span>成交量</span><b>${fmtVolume(point.volume)}</b></div>
    <div class="tt-row"><span>成交额</span><b>${fmtAmount(point.amount)}</b></div>`;
}

/* ------------------------------------------------------------------ */
/* indicators                                                         */
/* ------------------------------------------------------------------ */

function movingAverage(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function buildMAs(items) {
  const closes = items.map((item) => item.close);
  return [
    { key: 'ma5', label: 'MA5', color: '#3987e5', values: movingAverage(closes, 5) },
    { key: 'ma10', label: 'MA10', color: '#d95926', values: movingAverage(closes, 10) },
    { key: 'ma20', label: 'MA20', color: '#b9b7ad', values: movingAverage(closes, 20) },
  ];
}

function lastValue(values) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return null;
}

function calcRsi(closes, period = 14) {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(diff, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (gain === 0 && loss === 0) return 50;
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  values.forEach((value, index) => {
    prev = index === 0 ? value : value * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

function calcMacd(closes) {
  if (closes.length < 35) return { dif: null, dea: null, hist: null, prevHist: null };
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const dif = e12.map((value, index) => value - e26[index]);
  const dea = emaSeries(dif, 9);
  const hist = dif.map((value, index) => (value - dea[index]) * 2);
  return {
    dif: dif[dif.length - 1],
    dea: dea[dea.length - 1],
    hist: hist[hist.length - 1],
    prevHist: hist[hist.length - 2] ?? null,
  };
}

function analyze(daily) {
  if (!daily || daily.length < 20) return null;

  const closes = daily.map((item) => item.close);
  const last = daily[daily.length - 1];
  const price = last.close;

  const ma5 = lastValue(movingAverage(closes, 5));
  const ma10 = lastValue(movingAverage(closes, 10));
  const ma20 = lastValue(movingAverage(closes, 20));
  const ma60 = closes.length >= 60 ? lastValue(movingAverage(closes, 60)) : null;
  const rsi = calcRsi(closes, 14);
  const macd = calcMacd(closes);

  const avgVolume = (len) => {
    const slice = daily.slice(-len);
    if (!slice.length) return null;
    return slice.reduce((sum, item) => sum + (item.volume || 0), 0) / slice.length;
  };
  const vol5 = avgVolume(5);
  const vol20 = avgVolume(20);
  const volRatio = vol20 ? vol5 / vol20 : null;

  const recent20 = daily.slice(-20);
  const high20 = Math.max(...recent20.map((item) => item.high));
  const low20 = Math.min(...recent20.map((item) => item.low));
  const recent60 = daily.slice(-60);
  const high60 = Math.max(...recent60.map((item) => item.high));
  const low60 = Math.min(...recent60.map((item) => item.low));
  const pos60 = high60 > low60 ? (price - low60) / (high60 - low60) : 0.5;

  let score = 50;
  const signals = [];
  const addSignal = (tone, tag, text) => signals.push({ tone, tag, text });

  // trend structure
  let alignment = 0;
  if (isNum(ma5) && isNum(ma10) && isNum(ma20)) {
    if (ma5 > ma10 && ma10 > ma20) {
      alignment = 1;
      score += 14;
      addSignal('pos', '多', `MA5 > MA10 > MA20，均线多头排列，短期趋势结构偏强。`);
    } else if (ma5 < ma10 && ma10 < ma20) {
      alignment = -1;
      score -= 14;
      addSignal('neg', '空', `MA5 < MA10 < MA20，均线空头排列，短期趋势承压。`);
    } else {
      addSignal('neutral', '中性', '短中期均线相互交织，方向选择尚未明朗。');
    }
  }

  if (isNum(ma20)) {
    if (price > ma20) {
      score += 5;
      addSignal('pos', '多', `股价站在 20 日均线（${fmtPrice(ma20)}）上方，中期结构占优。`);
    } else {
      score -= 5;
      addSignal('neg', '空', `股价位于 20 日均线（${fmtPrice(ma20)}）下方，反弹面临均线压制。`);
    }
  }

  if (isNum(ma60)) {
    score += price > ma60 ? 4 : -4;
  }

  // momentum
  if (isNum(rsi)) {
    if (rsi >= 70) {
      score -= 2;
      addSignal('warn', '留意', `RSI（14）为 ${rsi.toFixed(1)}，进入超买区，短线追高性价比下降。`);
    } else if (rsi >= 55) {
      score += 6;
      addSignal('pos', '多', `RSI（14）为 ${rsi.toFixed(1)}，动能偏强且尚未过热。`);
    } else if (rsi >= 45) {
      addSignal('neutral', '中性', `RSI（14）为 ${rsi.toFixed(1)}，多空力量大致均衡。`);
    } else if (rsi > 30) {
      score -= 4;
      addSignal('neg', '空', `RSI（14）为 ${rsi.toFixed(1)}，动能偏弱，未见明显止跌信号。`);
    } else {
      score += 1;
      addSignal('warn', '留意', `RSI（14）为 ${rsi.toFixed(1)}，处于超卖区，可留意反弹持续性。`);
    }
  }

  if (isNum(macd.dif)) {
    const rising = isNum(macd.hist) && isNum(macd.prevHist) && macd.hist > macd.prevHist;
    if (macd.dif > macd.dea) {
      score += rising ? 10 : 8;
      addSignal(
        'pos',
        '多',
        `MACD 位于信号线上方，${rising ? '红柱继续扩张，短线动能增强' : '红柱有所收敛，动能边际放缓'}。`
      );
    } else {
      score -= rising ? 8 : 10;
      addSignal(
        'neg',
        '空',
        `MACD 位于信号线下方，${rising ? '绿柱收窄，下跌动能减弱' : '绿柱扩张，短线仍未企稳'}。`
      );
    }
  }

  // volume
  if (isNum(volRatio) && volRatio > 1.25) {
    if (last.close >= last.open) {
      score += 5;
      addSignal('pos', '多', `5 日均量是 20 日均量的 ${volRatio.toFixed(2)} 倍，放量上行，量价配合较好。`);
    } else {
      score -= 5;
      addSignal('neg', '空', `5 日均量放大至 20 日均量的 ${volRatio.toFixed(2)} 倍，放量下跌需警惕。`);
    }
  } else if (isNum(volRatio) && volRatio < 0.7) {
    score -= 1;
    addSignal('neutral', '中性', `量能缩至 20 日均量的 ${volRatio.toFixed(2)} 倍，观望情绪较浓。`);
  }

  // position in 60-day range
  if (pos60 > 0.85) {
    score += 3;
    addSignal('warn', '留意', '股价接近近 60 日区间上沿，关注突破能否获得放量确认。');
  } else if (pos60 < 0.15) {
    score -= 3;
    addSignal('warn', '留意', '股价接近近 60 日区间下沿，支撑有效性仍需观察。');
  }

  score = Math.round(Math.min(Math.max(score, 8), 96));

  const supports = [low20, ma20, ma60]
    .filter((v) => isNum(v) && v < price)
    .sort((a, b) => b - a);
  const resistances = [high20, high60, ma20, ma60]
    .filter((v) => isNum(v) && v > price)
    .sort((a, b) => a - b);
  const support = supports[0] ?? low20;
  const resistance = resistances[0] ?? high20;

  const label =
    score >= 70 ? '强势' : score >= 58 ? '偏强' : score >= 45 ? '中性' : score >= 32 ? '偏弱' : '弱势';

  const trendSentence =
    alignment > 0
      ? '均线呈多头排列'
      : alignment < 0
        ? '均线呈空头排列'
        : '均线相互交织';
  const macdSentence = isNum(macd.dif)
    ? macd.dif > macd.dea
      ? `MACD 处于信号线上方${macd.hist > macd.prevHist ? '且红柱扩张' : ''}`
      : `MACD 处于信号线下方${macd.hist < macd.prevHist ? '且绿柱扩张' : ''}`
    : '';
  const rsiSentence = isNum(rsi)
    ? rsi >= 70
      ? 'RSI 已进入超买区，短线追高需谨慎'
      : rsi <= 30
        ? 'RSI 处于超卖区，留意反弹持续性'
        : `RSI ${rsi.toFixed(1)}，处于${rsi >= 55 ? '偏强' : rsi >= 45 ? '中性' : '偏弱'}区间`
    : '';

  const verdict =
    score >= 70
      ? '技术面整体强势'
      : score >= 58
        ? '技术面偏强'
        : score >= 45
          ? '技术面中性'
          : score >= 32
            ? '技术面偏弱'
            : '技术面弱势';

  const summaryParts = [verdict];
  summaryParts.push(
    `${trendSentence}，股价${isNum(ma20) ? (price > ma20 ? '位于 20 日均线上方' : '位于 20 日均线下方') : '围绕均线震荡'}`
  );
  if (macdSentence) summaryParts.push(macdSentence);
  if (rsiSentence) summaryParts.push(rsiSentence);
  const summary = `${summaryParts.join('；')}。上方压力 ${fmtPrice(resistance)}，下方支撑 ${fmtPrice(support)}。`;

  return {
    score,
    label,
    summary,
    signals: signals.slice(0, 6),
    rsi,
    macd,
    volRatio,
    pos60,
    support,
    resistance,
    ma20,
    high20,
    low20,
    high60,
    low60,
  };
}

/* ------------------------------------------------------------------ */
/* rendering: quote                                                   */
/* ------------------------------------------------------------------ */

function stat(label, value, cls = '') {
  return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value ${cls}">${value}</span></div>`;
}

function renderQuote(quote, { flash = true } = {}) {
  if (!quote) return;
  state.quote = quote;

  const cls = dirClass(quote.pct);
  const prev = state.prevPrice;
  state.prevPrice = quote.price;

  dom.qName.textContent = quote.name || state.name || '--';
  dom.qCode.textContent = codeLabel(quote.secid, quote.code);
  const timeText = quoteTime(Date.now());
  dom.qSub.textContent = `A 股 · ${marketName(quote.market, quote.code)}${timeText ? ` · 刷新 ${timeText}` : ''}`;
  dom.qPrice.textContent = fmtPrice(quote.price);
  dom.qPrice.className = `quote-price ${cls}`;
  dom.qDelta.className = `quote-delta ${cls}`;
  dom.qDelta.innerHTML = `<span class="delta-abs">${arrow(quote.pct)} ${fmtSigned(quote.change)}</span><span>${fmtPct(quote.pct)}</span>`;

  if (flash && isNum(prev) && isNum(quote.price) && prev !== quote.price) {
    dom.qPrice.classList.remove('flash-up', 'flash-down');
    void dom.qPrice.offsetWidth;
    dom.qPrice.classList.add(quote.price > prev ? 'flash-up' : 'flash-down');
    setTimeout(() => dom.qPrice.classList.remove('flash-up', 'flash-down'), 800);
  }

  dom.qStats.innerHTML = [
    stat('今开', fmtPrice(quote.open)),
    stat('昨收', fmtPrice(quote.prevClose)),
    stat('最高', fmtPrice(quote.high)),
    stat('最低', fmtPrice(quote.low)),
    stat('成交量', fmtVolume(quote.volume)),
    stat('成交额', fmtAmount(quote.amount)),
    stat('换手率', fmtTurnover(quote.turnover)),
    stat('量比', isNum(quote.volumeRatio) ? quote.volumeRatio.toFixed(2) : '--'),
    stat('市盈率(动)', isNum(quote.pe) ? quote.pe.toFixed(2) : '--'),
    stat('市净率', isNum(quote.pb) ? quote.pb.toFixed(2) : '--'),
    stat('总市值', fmtCap(quote.marketCap)),
    stat(
      '主力净流入',
      quote.mainInflow === null ? '--' : fmtAmount(quote.mainInflow),
      dirClass(quote.mainInflow)
    ),
  ].join('');

  document.title = `${quote.name || state.name} ${fmtPrice(quote.price)} ${fmtPct(quote.pct)} · 观市`;
  updateWatchToggle();
}

function quoteTime(ts) {
  if (!isNum(ts)) return '';
  const ms = ts > 1e12 ? ts : ts * 1000;
  try {
    return new Date(ms).toLocaleTimeString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    });
  } catch {
    return '';
  }
}

function setQuoteLoading(loading) {
  dom.qStats.closest('.quote-card').classList.toggle('is-loading', loading);
  if (loading) dom.qSub.textContent = '行情读取中…';
}

function updateWatchToggle() {
  const on = state.watch.some((item) => item.secid === state.secid);
  dom.watchToggle.classList.toggle('is-on', on);
  dom.watchToggle.setAttribute('aria-pressed', String(on));
  const label = dom.watchToggle.querySelector('span');
  if (label) label.textContent = on ? '已自选' : '自选';
}

/* ------------------------------------------------------------------ */
/* rendering: chart legend                                            */
/* ------------------------------------------------------------------ */

function renderLegend() {
  const payload = state.chartPayload;
  if (!payload) {
    dom.maLegend.innerHTML = '';
    return;
  }
  if (payload.mode === 'kline') {
    const index = state.hoverIdx != null ? state.hoverIdx : payload.items.length - 1;
    const item = payload.items[index];
    dom.maLegend.innerHTML =
      payload.mas
        .map((ma) => {
          const visible = state.maVisible[ma.key] !== false;
          const value = ma.values[index];
          return `<button type="button" class="legend-item ${visible ? '' : 'is-off'}" data-ma="${ma.key}" aria-pressed="${visible}">
            <span class="legend-key" style="--key:${ma.color}"></span>${ma.label}
            <b>${isNum(value) ? fmtPrice(value) : '--'}</b>
          </button>`;
        })
        .join('') +
      `<span class="legend-item" style="color:var(--muted-2)">${item ? esc(item.date) : ''}</span>`;
  } else {
    const index = state.hoverIdx != null ? state.hoverIdx : payload.points.length - 1;
    const p = payload.points[index];
    dom.maLegend.innerHTML = `
      <span class="legend-item"><span class="legend-key" style="--key:#f0efec"></span>价格
        <b>${p ? fmtPrice(p.price) : '--'}</b></span>
      <span class="legend-item"><span class="legend-key" style="--key:#3987e5"></span>均价
        <b>${p && isNum(p.avg) ? fmtPrice(p.avg) : '--'}</b></span>`;
  }
}

function showChartEmpty(empty) {
  dom.chartEmpty.hidden = !empty;
}

function renderDataTable() {
  if (dom.chartTable.hidden) return;
  const scrollTop = dom.chartTable.scrollTop;
  const payload = state.chartPayload;
  if (!payload) {
    dom.chartTable.innerHTML = '';
    return;
  }
  if (payload.mode === 'kline') {
    const rows = payload.items
      .slice(-40)
      .reverse()
      .map(
        (item) => `<tr>
          <td>${esc(item.date)}</td>
          <td>${fmtPrice(item.open)}</td>
          <td class="col-aux">${fmtPrice(item.high)}</td>
          <td class="col-aux">${fmtPrice(item.low)}</td>
          <td>${fmtPrice(item.close)}</td>
          <td class="${dirClass(item.pct)}">${fmtPct(item.pct)}</td>
          <td class="col-aux">${fmtVolume(item.volume)}</td>
        </tr>`
      )
      .join('');
    dom.chartTable.innerHTML = `<table>
      <thead><tr><th>日期</th><th>开盘</th><th class="col-aux">最高</th><th class="col-aux">最低</th><th>收盘</th><th>涨跌幅</th><th class="col-aux">成交量</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  } else {
    const rows = payload.points
      .slice(-40)
      .reverse()
      .map(
        (point) => `<tr>
          <td>${esc((point.time || '').slice(11))}</td>
          <td>${fmtPrice(point.price)}</td>
          <td>${fmtPrice(point.avg)}</td>
          <td class="col-aux">${fmtVolume(point.volume)}</td>
          <td class="col-aux">${fmtAmount(point.amount)}</td>
        </tr>`
      )
      .join('');
    dom.chartTable.innerHTML = `<table>
      <thead><tr><th>时间</th><th>价格</th><th>均价</th><th class="col-aux">成交量</th><th class="col-aux">成交额</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }
  dom.chartTable.scrollTop = scrollTop;
}

function renderDayChart() {
  if (!state.daily?.length) {
    showChartEmpty(true);
    return;
  }
  state.hoverIdx = null;
  dom.chartTooltip.hidden = true;
  const mas = buildMAs(state.daily);
  state.chartPayload = { mode: 'kline', items: state.daily, mas, period: 'day', decimals: 2 };
  chart.setData(state.chartPayload);
  showChartEmpty(false);
  renderLegend();
  renderDataTable();
}

async function loadChart() {
  const token = ++chartToken;
  const { secid, range } = state;
  state.hoverIdx = null;
  dom.chartTooltip.hidden = true;

  if (range === 'day') {
    renderDayChart();
    return;
  }

  try {
    if (range === 'intraday') {
      const data = await api('/api/trends', { secid });
      if (token !== chartToken) return;
      if (!data.points?.length) {
        showChartEmpty(true);
        return;
      }
      state.chartPayload = {
        mode: 'trend',
        points: data.points,
        preClose: data.preClose,
        decimals: data.decimal ?? 2,
      };
      chart.setData(state.chartPayload);
      showChartEmpty(false);
      renderLegend();
      renderDataTable();
      state.lastChart = Date.now();
      return;
    }

    const klt = range === 'week' ? 102 : 103;
    const lmt = range === 'week' ? 130 : 72;
    const data = await api('/api/kline', { secid, klt, lmt });
    if (token !== chartToken) return;
    if (!data.klines?.length) {
      showChartEmpty(true);
      return;
    }
    const mas = buildMAs(data.klines);
    state.chartPayload = {
      mode: 'kline',
      items: data.klines,
      mas,
      period: range,
      decimals: 2,
    };
    chart.setData(state.chartPayload);
    showChartEmpty(false);
    renderLegend();
    renderDataTable();
    state.lastChart = Date.now();
  } catch (error) {
    if (token === chartToken) toast(`走势加载失败：${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* rendering: indices                                                 */
/* ------------------------------------------------------------------ */

function sparkSvg(values, pct) {
  if (!values || values.length < 2) return '';
  const w = 76;
  const h = 32;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (value - min) / span) * (h - pad * 2);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const area = `${line} L${points[points.length - 1][0]} ${h - pad} L${points[0][0]} ${h - pad} Z`;
  const color = isNum(pct) && pct < 0 ? '#0ca30c' : '#e66767';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${area}" fill="${color}" opacity=".1"></path>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"></path>
  </svg>`;
}

function renderIndices(quoteMap) {
  const map = quoteMap instanceof Map ? quoteMap : state.indexQuotes;
  const scrollLeft = dom.indices.scrollLeft;
  dom.indices.innerHTML = INDEXES.map((index) => {
    const quote = map.get(index.secid);
    if (!quote) return '<div class="index-skeleton skeleton"></div>';
    const spark = state.spark.get(index.secid)?.values;
    const active = state.secid === index.secid;
    return `<button type="button" class="index-card ${active ? 'is-active' : ''}" data-secid="${index.secid}">
      <span class="index-top">
        <span class="index-name">${esc(quote.name || index.name)}</span>
        <span class="index-code">${index.code}.${index.suffix}</span>
      </span>
      <span class="index-bottom">
        <span class="index-nums">
          <span class="index-value">${fmtPrice(quote.price)}</span>
          <span class="index-pct ${dirClass(quote.pct)}">${arrow(quote.pct)} ${fmtPct(quote.pct)}</span>
        </span>
        ${sparkSvg(spark, quote.pct)}
      </span>
    </button>`;
  }).join('');
  dom.indices.scrollLeft = scrollLeft;
}

async function loadIndices() {
  if (!state.indexQuotes.size) {
    dom.indices.innerHTML = INDEXES.map(() => '<div class="index-skeleton skeleton"></div>').join('');
  }
  try {
    const { items } = await api('/api/quote', { secids: INDEXES.map((i) => i.secid).join(',') });
    const map = new Map(items.map((item) => [item.secid, item]));
    state.indexQuotes = map;
    renderIndices(map);

    const stale = INDEXES.filter((index) => {
      const hit = state.spark.get(index.secid);
      return !hit || Date.now() - hit.ts > 300000;
    });
    if (stale.length) {
      const results = await Promise.allSettled(
        stale.map((index) => api('/api/kline', { secid: index.secid, klt: 101, lmt: 32 }))
      );
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value.klines?.length) {
          state.spark.set(stale[i].secid, {
            values: result.value.klines.map((item) => item.close),
            ts: Date.now(),
          });
        }
      });
      renderIndices(map);
    }
  } catch (error) {
    if (!state.indexQuotes.size) {
      dom.indices.innerHTML = '<div class="index-skeleton skeleton"></div>'.repeat(4);
    }
    toast(`指数加载失败：${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* rendering: watchlist                                               */
/* ------------------------------------------------------------------ */

function renderWatch() {
  dom.watchCount.textContent = String(state.watch.length);
  const scrollTop = dom.watchList.scrollTop;
  if (!state.watch.length) {
    dom.watchList.innerHTML = '<div class="watch-empty">自选列表为空<br>搜索股票后点击 ☆ 添加</div>';
    return;
  }
  dom.watchList.innerHTML = state.watch
    .map((item) => {
      const quote = state.watchQuotes.get(item.secid);
      const cls = quote ? dirClass(quote.pct) : 'flat';
      const active = item.secid === state.secid;
      return `<div class="watch-row ${active ? 'is-active' : ''}" data-secid="${esc(item.secid)}" role="button" tabindex="0" aria-label="${esc(item.name)}">
        <span class="watch-ident">
          <span class="watch-name">${esc(item.name)}</span>
          <span class="watch-code">${codeLabel(item.secid, item.code)}</span>
        </span>
        <span class="watch-nums">
          <span class="watch-price ${cls}">${quote ? fmtPrice(quote.price) : '--'}</span>
          <span class="watch-pct ${cls}">${quote ? fmtPct(quote.pct) : '--'}</span>
        </span>
        <button type="button" class="watch-remove" data-remove="${esc(item.secid)}" aria-label="移除 ${esc(item.name)}">×</button>
      </div>`;
    })
    .join('');
  dom.watchList.scrollTop = scrollTop;
}

async function loadWatchQuotes() {
  if (!state.watch.length) {
    state.watchQuotes = new Map();
    renderWatch();
    return;
  }
  try {
    const { items } = await api('/api/quote', {
      secids: state.watch.map((item) => item.secid).join(','),
    });
    state.watchQuotes = new Map(items.map((item) => [item.secid, item]));
    let renamed = false;
    for (const entry of state.watch) {
      const quote = state.watchQuotes.get(entry.secid);
      if (quote && entry.name !== quote.name) {
        entry.name = quote.name;
        renamed = true;
      }
    }
    if (renamed) saveWatch();
    renderWatch();
  } catch {
    renderWatch();
  }
}

function addWatch(quote) {
  if (!quote?.secid) return;
  if (state.watch.length >= 30) {
    toast('自选股最多 30 只');
    return;
  }
  if (state.watch.some((item) => item.secid === quote.secid)) return;
  state.watch.unshift({ secid: quote.secid, code: quote.code, name: quote.name });
  saveWatch();
  state.watchQuotes.set(quote.secid, quote);
  renderWatch();
  updateWatchToggle();
  toast(`已加入自选：${quote.name}`);
}

function removeWatch(secid) {
  const index = state.watch.findIndex((item) => item.secid === secid);
  if (index < 0) return;
  const [removed] = state.watch.splice(index, 1);
  state.watchQuotes.delete(secid);
  saveWatch();
  renderWatch();
  updateWatchToggle();
  toast(`已移除自选：${removed.name}`);
}

/* ------------------------------------------------------------------ */
/* rendering: rankings                                                */
/* ------------------------------------------------------------------ */

function renderRank() {
  if (!state.rank.length) {
    dom.rankList.innerHTML = '<div class="rank-empty">榜单暂无数据</div>';
    return;
  }
  dom.rankList.innerHTML = state.rank
    .map((item, index) => {
      const cls = dirClass(item.pct);
      const meta = state.rankType === 'amount' ? fmtAmount(item.amount) : item.industry || codeLabel(item.secid, item.code);
      return `<button type="button" class="rank-row" data-secid="${esc(item.secid)}">
        <span class="rank-no ${index < 3 ? 'top' : ''}">${index + 1}</span>
        <span class="rank-ident">
          <span class="rank-name">${esc(item.name)}</span>
          <span class="rank-meta">${esc(meta)}</span>
        </span>
        <span class="rank-nums">
          <span class="rank-price">${fmtPrice(item.price)}</span>
          <span class="rank-pct ${cls}">${fmtPct(item.pct)}</span>
        </span>
      </button>`;
    })
    .join('');
}

async function loadRank() {
  try {
    const { items } = await api('/api/rank', { type: state.rankType, limit: 10 });
    state.rank = items || [];
    state.lastRank = Date.now();
    renderRank();
  } catch {
    dom.rankList.innerHTML = '<div class="rank-empty">榜单加载失败</div>';
  }
}

/* ------------------------------------------------------------------ */
/* rendering: assistant + range                                       */
/* ------------------------------------------------------------------ */

function renderAssistant() {
  const result = analyze(state.daily);
  if (!result) {
    dom.scoreNum.textContent = '--';
    dom.scoreLabel.textContent = '数据不足';
    dom.assistantSummary.textContent = '日线数据不足，暂时无法生成技术面解读。';
    dom.indicatorChips.innerHTML = '';
    dom.signalList.innerHTML = '';
    dom.levelRow.innerHTML = '';
    return;
  }

  dom.scoreNum.textContent = String(result.score);
  dom.scoreLabel.textContent = result.label;
  dom.scoreBadge.className = `score-badge ${
    result.score >= 58 ? 'is-strong' : result.score <= 42 ? 'is-weak' : 'is-neutral'
  }`;
  dom.scoreMeter.style.width = `${result.score}%`;
  const meter =
    result.score >= 58
      ? ['#e66767', '#f0a0a0']
      : result.score <= 42
        ? ['#0ca30c', '#5bd45b']
        : ['#c98500', '#e3b35c'];
  dom.scoreMeter.style.setProperty('--meter-from', meter[0]);
  dom.scoreMeter.style.setProperty('--meter-to', meter[1]);

  dom.assistantSummary.textContent = result.summary;

  const macdText = isNum(result.macd.hist) ? fmtSigned(result.macd.hist) : '--';
  dom.indicatorChips.innerHTML = [
    `<span class="ind-chip">RSI(14) <b>${isNum(result.rsi) ? result.rsi.toFixed(1) : '--'}</b></span>`,
    `<span class="ind-chip">MACD 柱 <b>${macdText}</b></span>`,
    `<span class="ind-chip">5/20 量比 <b>${isNum(result.volRatio) ? result.volRatio.toFixed(2) : '--'}</b></span>`,
    `<span class="ind-chip">60 日分位 <b>${(result.pos60 * 100).toFixed(0)}%</b></span>`,
  ].join('');

  dom.signalList.innerHTML = result.signals
    .map(
      (signal) =>
        `<li><span class="signal-tag ${signal.tone}">${signal.tag}</span><span>${signal.text}</span></li>`
    )
    .join('');

  dom.levelRow.innerHTML = `
    <div class="level-item"><span class="level-label">短期支撑</span><span class="level-value">${fmtPrice(result.support)}</span></div>
    <div class="level-item"><span class="level-label">短期压力</span><span class="level-value">${fmtPrice(result.resistance)}</span></div>
    <div class="level-item"><span class="level-label">60 日分位</span><span class="level-value">${(result.pos60 * 100).toFixed(0)}%</span></div>`;
}

function rangeItemHtml(label, low, high, price, positionPct) {
  const left = Math.min(Math.max(positionPct, 0), 100);
  return `<div class="range-item">
    <div class="range-head"><span>${label}</span><b>${fmtPrice(low)} — ${fmtPrice(high)}</b></div>
    <div class="range-track">
      <i class="range-fill" style="left:0;width:100%"></i>
      <b class="range-dot" style="left:${left}%"></b>
    </div>
    <div class="range-foot">
      <span>低 ${fmtPrice(low)}</span>
      <span>现价 ${fmtPrice(price)}</span>
      <span>高 ${fmtPrice(high)}</span>
    </div>
  </div>`;
}

function renderRangeCard() {
  const daily = state.daily;
  if (!daily?.length) {
    dom.rangeBody.innerHTML = '<div class="range-note">等待日线数据…</div>';
    return;
  }
  const last = daily[daily.length - 1];
  const quote = state.quote;
  const price = isNum(quote?.price) ? quote.price : last.close;
  const low = isNum(quote?.low) && quote.low > 0 ? quote.low : last.low;
  const high = isNum(quote?.high) && quote.high > 0 ? quote.high : last.high;

  const dayPct = high > low ? ((price - low) / (high - low)) * 100 : 50;

  const recent = daily.slice(-60);
  const low60 = Math.min(...recent.map((item) => item.low));
  const high60 = Math.max(...recent.map((item) => item.high));
  const pos60 = high60 > low60 ? ((price - low60) / (high60 - low60)) * 100 : 50;

  const analysis = analyze(daily);
  const note = analysis
    ? `近 20 日结构显示，短线支撑参考 <b>${fmtPrice(analysis.support)}</b>，上方压力参考 <b>${fmtPrice(analysis.resistance)}</b>。`
    : '区间位置随行情滚动更新。';

  const closeAgo = (n) => (daily.length > n ? daily[daily.length - 1 - n].close : null);
  const pct20 = isNum(closeAgo(20)) ? ((price / closeAgo(20)) - 1) * 100 : null;
  const pct60 = isNum(closeAgo(60)) ? ((price / closeAgo(60)) - 1) * 100 : null;
  const amplitude60 = low60 > 0 ? ((high60 - low60) / low60) * 100 : null;

  dom.rangeDate.textContent = `${last.date} 收盘`;
  dom.rangeBody.innerHTML = `
    ${rangeItemHtml('今日区间', low, high, price, dayPct)}
    ${rangeItemHtml('近 60 日区间', low60, high60, price, pos60)}
    <p class="range-note">${note}</p>
    <div class="range-stats">
      <div><span>近 20 日</span><b class="${dirClass(pct20)}">${fmtPct(pct20)}</b></div>
      <div><span>近 60 日</span><b class="${dirClass(pct60)}">${fmtPct(pct60)}</b></div>
      <div><span>60 日振幅</span><b>${isNum(amplitude60) ? `${amplitude60.toFixed(1)}%` : '--'}</b></div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* stock selection                                                    */
/* ------------------------------------------------------------------ */

function hashSecid() {
  const raw = location.hash.replace(/^#/, '');
  return SECID_RE.test(raw) ? raw : null;
}

async function selectStock(secid, meta = {}) {
  if (!SECID_RE.test(secid)) return;
  const token = ++state.selectToken;

  state.secid = secid;
  if (meta.name) state.name = meta.name;
  if (meta.code) state.code = meta.code;
  state.quote = null;
  state.hoverIdx = null;
  state.prevPrice = null;
  dom.chartTooltip.hidden = true;
  history.replaceState(null, '', `#${secid}`);
  setQuoteLoading(true);
  renderIndices();
  renderWatch();

  try {
    const [quoteRes, klineRes] = await Promise.all([
      api('/api/quote', { secids: secid }),
      api('/api/kline', { secid, klt: 101, lmt: 180 }),
    ]);
    if (token !== state.selectToken) return;

    const quote = quoteRes.items?.[0];
    if (!quote) throw new Error('未找到该证券的行情数据');

    state.quote = quote;
    state.name = quote.name;
    state.code = quote.code;
    state.daily = klineRes.klines || [];
    state.lastDaily = Date.now();
    state.watchQuotes.set(quote.secid, quote);

    renderQuote(quote, { flash: false });
    renderWatch();
    renderAssistant();
    renderRangeCard();
    updateWatchToggle();
    renderIndices();

    if (state.range === 'day') renderDayChart();
    else await loadChart();
  } catch (error) {
    if (token === state.selectToken) toast(error.message || '行情加载失败');
  } finally {
    if (token === state.selectToken) setQuoteLoading(false);
  }
}

/* ------------------------------------------------------------------ */
/* search                                                             */
/* ------------------------------------------------------------------ */

function closeSearch() {
  state.searchSeq += 1;
  dom.searchResults.hidden = true;
  dom.searchInput.setAttribute('aria-expanded', 'false');
  state.searchItems = [];
  state.searchActive = -1;
}

function openSearch(items) {
  state.searchItems = items;
  state.searchActive = -1;
  if (!items.length) {
    dom.searchResults.innerHTML = '<div class="sr-empty">没有找到匹配的 A 股</div>';
  } else {
    dom.searchResults.innerHTML = items
      .map(
        (item, index) => `<button type="button" class="search-result" role="option" data-idx="${index}" aria-selected="false">
          <span class="sr-name">${esc(item.name)}</span>
          <span class="sr-code">${exchangeLabel(item.market, item.code)}${esc(item.code)}</span>
        </button>`
      )
      .join('');
  }
  dom.searchResults.hidden = false;
  dom.searchInput.setAttribute('aria-expanded', 'true');
}

function setSearchActive(index) {
  const buttons = [...dom.searchResults.querySelectorAll('.search-result')];
  if (!buttons.length) return;
  state.searchActive = (index + buttons.length) % buttons.length;
  buttons.forEach((button, i) => {
    button.setAttribute('aria-selected', String(i === state.searchActive));
  });
  buttons[state.searchActive].scrollIntoView({ block: 'nearest' });
}

function chooseSearch(index) {
  const item = state.searchItems[index];
  if (!item) return;
  closeSearch();
  dom.searchInput.value = '';
  dom.searchInput.blur();
  selectStock(item.secid, { name: item.name, code: item.code });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function runSearch(keyword) {
  const seq = ++state.searchSeq;
  try {
    const { items } = await api('/api/search', { q: keyword });
    if (seq !== state.searchSeq) return;
    openSearch(items || []);
  } catch {
    if (seq === state.searchSeq) openSearch([]);
  }
}

/* ------------------------------------------------------------------ */
/* refresh loop                                                       */
/* ------------------------------------------------------------------ */

async function refreshAll({ manual = false } = {}) {
  const ids = [
    ...new Set([...INDEXES.map((index) => index.secid), ...state.watch.map((item) => item.secid), state.secid]),
  ];
  try {
    const { items } = await api('/api/quote', { secids: ids.join(',') });
    const map = new Map(items.map((item) => [item.secid, item]));

    state.indexQuotes = new Map(
      INDEXES.map((index) => [index.secid, map.get(index.secid)]).filter(([, quote]) => quote)
    );
    state.watchQuotes = new Map(
      state.watch.map((item) => [item.secid, map.get(item.secid)]).filter(([, quote]) => quote)
    );
    const quote = map.get(state.secid);
    if (quote) renderQuote(quote, { flash: true });

    renderIndices();
    renderWatch();
    updateWatchToggle();
    updateMarketStatus();
    if (manual) toast('行情已刷新');
  } catch (error) {
    if (manual) toast(error.message || '刷新失败');
  }
}

async function refreshDaily() {
  const secid = state.secid;
  try {
    const data = await api('/api/kline', { secid, klt: 101, lmt: 180 });
    if (secid !== state.secid || !data.klines?.length) return;
    state.daily = data.klines;
    state.lastDaily = Date.now();
    renderAssistant();
    renderRangeCard();
    if (state.range === 'day') renderDayChart();
  } catch {
    /* keep the previous daily data */
  }
}

async function refreshFromButton() {
  dom.refreshBtn.classList.add('is-spinning');
  await Promise.allSettled([
    refreshAll({ manual: true }),
    loadRank(),
    loadIndices(),
    loadChart(),
    refreshDaily(),
  ]);
  dom.refreshBtn.classList.remove('is-spinning');
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  const delay = isTradingTime() ? 15000 : 60000;
  refreshTimer = setTimeout(async () => {
    if (!document.hidden) {
      await refreshAll();
      if (Date.now() - state.lastDaily > 60000) await refreshDaily();
      if (Date.now() - state.lastRank > 30000) await loadRank();
      if (state.range === 'intraday' && Date.now() - state.lastChart > 60000) await loadChart();
    }
    updateMarketStatus();
    scheduleRefresh();
  }, delay);
}

/* ------------------------------------------------------------------ */
/* events                                                             */
/* ------------------------------------------------------------------ */

function bindEvents() {
  dom.refreshBtn.addEventListener('click', refreshFromButton);

  dom.watchToggle.addEventListener('click', () => {
    if (!state.quote) return;
    const exists = state.watch.some((item) => item.secid === state.secid);
    if (exists) removeWatch(state.secid);
    else addWatch(state.quote);
  });

  dom.rangeTabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-range]');
    if (!button) return;
    const range = button.dataset.range;
    if (range === state.range) return;
    state.range = range;
    [...dom.rangeTabs.querySelectorAll('button')].forEach((item) => {
      item.setAttribute('aria-selected', String(item.dataset.range === range));
    });
    state.hoverIdx = null;
    dom.chartTooltip.hidden = true;
    showChartEmpty(false);
    loadChart();
  });

  dom.maLegend.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ma]');
    if (!button) return;
    const key = button.dataset.ma;
    const currentlyVisible = state.maVisible[key] !== false;
    state.maVisible[key] = !currentlyVisible;
    chart.setVisible(key, !currentlyVisible);
    renderLegend();
  });

  dom.tableToggle.addEventListener('click', () => {
    const opening = dom.chartTable.hidden;
    dom.chartTable.hidden = !opening;
    dom.tableToggle.setAttribute('aria-expanded', String(opening));
    if (opening) renderDataTable();
  });

  dom.indices.addEventListener('click', (event) => {
    const card = event.target.closest('[data-secid]');
    if (!card) return;
    selectStock(card.dataset.secid);
  });

  dom.watchList.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      event.stopPropagation();
      removeWatch(remove.dataset.remove);
      return;
    }
    const row = event.target.closest('.watch-row[data-secid]');
    if (row) selectStock(row.dataset.secid);
  });

  dom.watchList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('.watch-row[data-secid]');
    if (!row) return;
    event.preventDefault();
    selectStock(row.dataset.secid);
  });

  dom.rankTabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-rank]');
    if (!button) return;
    const type = button.dataset.rank;
    if (type === state.rankType) return;
    state.rankType = type;
    [...dom.rankTabs.querySelectorAll('button')].forEach((item) => {
      item.setAttribute('aria-selected', String(item.dataset.rank === type));
    });
    state.rank = [];
    dom.rankList.innerHTML = '<div class="rank-empty">加载中…</div>';
    loadRank();
  });

  dom.rankList.addEventListener('click', (event) => {
    const row = event.target.closest('[data-secid]');
    if (!row) return;
    selectStock(row.dataset.secid);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  dom.searchInput.addEventListener('input', () => {
    const keyword = dom.searchInput.value.trim();
    clearTimeout(searchTimer);
    if (!keyword) {
      closeSearch();
      return;
    }
    searchTimer = setTimeout(() => runSearch(keyword), 220);
  });

  dom.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (dom.searchResults.hidden) return;
      setSearchActive(state.searchActive + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (dom.searchResults.hidden) return;
      setSearchActive(state.searchActive - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!dom.searchResults.hidden && state.searchItems.length) {
        chooseSearch(state.searchActive >= 0 ? state.searchActive : 0);
      }
    } else if (event.key === 'Escape') {
      closeSearch();
      dom.searchInput.blur();
    }
  });

  dom.searchResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-idx]');
    if (!button) return;
    chooseSearch(Number(button.dataset.idx));
  });

  document.addEventListener('click', (event) => {
    if (!dom.searchbox.contains(event.target)) closeSearch();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (typing) return;
    event.preventDefault();
    dom.searchInput.focus();
  });

  window.addEventListener('hashchange', () => {
    const secid = hashSecid();
    if (secid && secid !== state.secid) selectStock(secid);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshAll();
      updateMarketStatus();
    }
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  bindEvents();
  updateMarketStatus();
  renderWatch();
  updateWatchToggle();

  const initial = hashSecid() || state.secid;
  await Promise.allSettled([
    loadIndices(),
    loadRank(),
    selectStock(initial),
    loadWatchQuotes(),
  ]);

  if (!state.daily.length) {
    dom.assistantSummary.textContent = '行情数据加载失败，请点击右上角刷新重试。';
  }
  scheduleRefresh();
}

boot();
