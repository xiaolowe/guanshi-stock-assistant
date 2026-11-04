import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const REFERER = 'https://quote.eastmoney.com/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SECID_RE = /^[0-9]{1,3}\.[A-Za-z0-9]{1,12}$/;
const CODE_RE = /^[0-9A-Za-z]{4,12}$/;
const KLT_ALLOWED = new Set([1, 5, 15, 30, 60, 101, 102, 103]);

const cache = new Map();

function cached(key, ttl, producer) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  cache.delete(key);
  return producer().then((value) => {
    if (cache.size > 400) {
      for (const [k, v] of cache) {
        if (v.expires <= Date.now()) cache.delete(k);
      }
    }
    cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  });
}

async function upstream(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, referer: REFERER, accept: '*/*' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const body = await res.json();
  if (body && body.rc !== undefined && body.rc !== 0 && body.rc !== 4 && body.rc !== 6) {
    throw new Error(`upstream rc ${body.rc}`);
  }
  return body;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function secidParts(secid) {
  const [market, code] = secid.split('.');
  return { market, code };
}

function normalizeQuote(it) {
  return {
    secid: `${it.f13}.${it.f12}`,
    code: it.f12,
    market: num(it.f13),
    name: it.f14,
    price: num(it.f2),
    change: num(it.f4),
    pct: num(it.f3),
    open: num(it.f17),
    prevClose: num(it.f18),
    high: num(it.f15),
    low: num(it.f16),
    volume: num(it.f5),
    amount: num(it.f6),
    amplitude: num(it.f7),
    turnover: num(it.f8),
    pe: num(it.f9),
    volumeRatio: num(it.f10),
    pb: num(it.f23),
    marketCap: num(it.f20),
    floatCap: num(it.f21),
    mainInflow: num(it.f62),
    mainInflowPct: num(it.f184),
    time: num(it.f124),
  };
}

function numText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text === '-' || text === '--') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function tencentSymbol(secid) {
  const { market, code } = secidParts(secid);
  if (market === '1') return `sh${code}`;
  if (market === '0') return /^(4|8|92)/.test(code) ? `bj${code}` : `sz${code}`;
  return null;
}

function normalizeTencentQuote(line) {
  const match = line.match(/^v_([a-z]{2})(\d{6})="(.*)";?\s*$/);
  if (!match) return null;
  const prefix = match[1];
  const code = match[2];
  const parts = match[3].split('~');
  if (parts.length < 50) return null;
  const price = numText(parts[3]);
  if (price === null) return null;

  const amountWan = numText(parts[37]);
  const floatCapYi = numText(parts[44]);
  const marketCapYi = numText(parts[45]);

  return {
    secid: `${prefix === 'sh' ? 1 : 0}.${code}`,
    code,
    market: prefix === 'sh' ? 1 : 0,
    name: parts[1],
    price,
    change: numText(parts[31]),
    pct: numText(parts[32]),
    open: numText(parts[5]),
    prevClose: numText(parts[4]),
    high: numText(parts[33]),
    low: numText(parts[34]),
    volume: numText(parts[6]),
    amount: amountWan === null ? null : amountWan * 10000,
    amplitude: numText(parts[43]),
    turnover: numText(parts[38]),
    pe: numText(parts[52]),
    volumeRatio: numText(parts[49]),
    pb: numText(parts[46]),
    marketCap: marketCapYi !== null && marketCapYi > 0 ? marketCapYi * 1e8 : null,
    floatCap: floatCapYi !== null && floatCapYi > 0 ? floatCapYi * 1e8 : null,
    mainInflow: null,
    mainInflowPct: null,
    time: null,
  };
}

async function fetchTencentQuotes(secids) {
  const symbols = secids.map(tencentSymbol).filter(Boolean);
  if (!symbols.length) return [];
  const res = await fetch(`https://qt.gtimg.cn/q=${symbols.join(',')}`, {
    headers: { 'user-agent': UA, referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`tencent ${res.status}`);
  const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
  return text.split('\n').map(normalizeTencentQuote).filter(Boolean);
}

async function fetchEastmoneySingle(secid) {
  const fields =
    'f12,f13,f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f62,f116,f117,f124,f162,f167,f168,f169,f170,f171,f184';
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(
    secid
  )}&fltt=2&invt=2&fields=${fields}`;
  const body = await upstream(url);
  const d = body?.data;
  if (!d || num(d.f43) === null) return null;
  return {
    secid: `${d.f13}.${d.f12}`,
    code: d.f12,
    market: num(d.f13),
    name: d.f58,
    price: num(d.f43),
    change: num(d.f169),
    pct: num(d.f170),
    open: num(d.f46),
    prevClose: num(d.f60),
    high: num(d.f44),
    low: num(d.f45),
    volume: num(d.f47),
    amount: num(d.f48),
    amplitude: num(d.f171),
    turnover: num(d.f168),
    pe: num(d.f162),
    volumeRatio: num(d.f50),
    pb: num(d.f167),
    marketCap: num(d.f116),
    floatCap: num(d.f117),
    mainInflow: num(d.f62),
    mainInflowPct: num(d.f184),
    time: num(d.f124),
  };
}

async function fetchEastmoneyBatch(secids) {
  const fields =
    'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f62,f124,f184';
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=${encodeURIComponent(
    secids.join(',')
  )}&fields=${fields}`;
  const body = await upstream(url);
  const items = Array.isArray(body?.data?.diff) ? body.data.diff : [];
  return items.map(normalizeQuote).filter((it) => it.secid);
}

async function handleQuote(params) {
  const raw = String(params.get('secids') || '');
  const secids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!secids.length || secids.length > 60 || secids.some((s) => !SECID_RE.test(s))) {
    const err = new Error('secids 参数不合法');
    err.status = 400;
    throw err;
  }

  const key = `q:${secids.join(',')}`;
  return cached(key, 3000, async () => {
    if (secids.length === 1) {
      try {
        const item = await fetchEastmoneySingle(secids[0]);
        if (item) return { items: [item] };
      } catch {
        /* fall back to Tencent */
      }
    }

    try {
      const items = await fetchTencentQuotes(secids);
      if (items.length) {
        const got = new Set(items.map((item) => item.secid));
        const missing = secids.filter((secid) => !got.has(secid));
        if (missing.length && missing.length <= 5) {
          const extra = await Promise.all(
            missing.map((secid) => fetchEastmoneySingle(secid).catch(() => null))
          );
          items.push(...extra.filter(Boolean));
        }
        return { items };
      }
    } catch {
      /* fall back to Eastmoney batch */
    }

    const items = await fetchEastmoneyBatch(secids);
    if (items.length) return { items };
    throw new Error('all quote providers failed');
  });
}

async function fetchEastmoneyKline(secid, klt, lmt) {
  const fields1 = 'f1,f2,f3,f4,f5,f6';
  const fields2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=1&lmt=${lmt}&end=20500101&fields1=${fields1}&fields2=${fields2}`;
  const body = await upstream(url);
  const data = body?.data;
  if (!data) throw new Error('no kline data');
  const klines = (data.klines || []).map((line) => {
    const p = line.split(',');
    return {
      date: p[0],
      open: Number(p[1]),
      close: Number(p[2]),
      high: Number(p[3]),
      low: Number(p[4]),
      volume: Number(p[5]),
      amount: Number(p[6]),
      amplitude: Number(p[7]),
      pct: Number(p[8]),
      change: Number(p[9]),
      turnover: Number(p[10]),
    };
  });
  return {
    secid,
    code: data.code,
    name: data.name,
    decimal: num(data.decimal),
    preClose: num(data.preKPrice),
    klines,
  };
}

async function fetchTencentKline(secid, klt, lmt) {
  const period = { 101: 'day', 102: 'week', 103: 'month' }[klt];
  if (!period) throw new Error(`tencent kline unsupported klt ${klt}`);
  const symbol = tencentSymbol(secid);
  if (!symbol) throw new Error('invalid symbol');

  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${period},,,${lmt},qfq`;
  const res = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`tencent kline ${res.status}`);
  const body = await res.json();
  const payload = body?.data?.[symbol];
  const rows = payload?.[`qfq${period}`] || payload?.[period];
  if (!Array.isArray(rows) || !rows.length) throw new Error('tencent kline empty');

  const klines = rows.map((row, index) => {
    const [date, openText, closeText, highText, lowText, volumeText] = row;
    const open = Number(openText);
    const close = Number(closeText);
    const high = Number(highText);
    const low = Number(lowText);
    const volume = Number(volumeText);
    const prevClose = index > 0 ? Number(rows[index - 1][2]) : open;
    const change = close - prevClose;
    return {
      date,
      open,
      close,
      high,
      low,
      volume,
      amount: null,
      amplitude: prevClose ? ((high - low) / prevClose) * 100 : 0,
      pct: prevClose ? (change / prevClose) * 100 : 0,
      change,
      turnover: null,
    };
  });

  return {
    secid,
    code: symbol.slice(2),
    name: '',
    decimal: 2,
    preClose: null,
    klines,
  };
}

async function handleKline(params) {
  const secid = String(params.get('secid') || '');
  const klt = Number(params.get('klt') || 101);
  const lmt = Math.min(Math.max(Number(params.get('lmt') || 160), 20), 500);
  if (!SECID_RE.test(secid)) throw Object.assign(new Error('secid 参数不合法'), { status: 400 });
  if (!KLT_ALLOWED.has(klt)) throw Object.assign(new Error('klt 参数不合法'), { status: 400 });

  const key = `k:${secid}:${klt}:${lmt}`;
  return cached(key, 30000, async () => {
    try {
      const data = await fetchEastmoneyKline(secid, klt, lmt);
      if (data.klines.length) return data;
    } catch {
      /* fall back to Tencent */
    }
    return fetchTencentKline(secid, klt, lmt);
  });
}

async function fetchEastmoneyTrend(secid) {
  const fields1 = 'f1,f2,f3,f4,f5,f6,f7,f8';
  const fields2 = 'f51,f52,f53,f54,f55,f56,f57,f58';
  const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&ndays=1&iscr=0&fields1=${fields1}&fields2=${fields2}`;
  const body = await upstream(url);
  const data = body?.data;
  if (!data) throw new Error('no trend data');
  const points = (data.trends || [])
    .map((line) => {
      const p = line.split(',');
      if (p.length < 8) return null;
      return {
        time: p[0],
        price: Number(p[2]),
        avg: Number(p[7]),
        volume: Number(p[5]),
        amount: Number(p[6]),
      };
    })
    .filter((p) => p && Number.isFinite(p.price));
  return {
    secid,
    code: data.code,
    name: data.name,
    decimal: num(data.decimal),
    preClose: num(data.preClose) || num(data.preSettlement),
    points,
  };
}

async function fetchTencentTrend(secid) {
  const symbol = tencentSymbol(secid);
  if (!symbol) throw new Error('invalid symbol');

  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`;
  const res = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`tencent minute ${res.status}`);
  const body = await res.json();
  const payload = body?.data?.[symbol]?.data;
  const rows = payload?.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error('tencent minute empty');

  const date = String(payload.date || '');
  const preClose = numText(payload.prec);
  const isIndex =
    (symbol.startsWith('sh') && symbol.slice(2).startsWith('000')) ||
    (symbol.startsWith('sz') && symbol.slice(2).startsWith('399'));
  let prevVolume = 0;
  let prevAmount = 0;
  let priceSum = 0;
  let priceCount = 0;

  const points = rows
    .map((row) => {
      const parts = String(row).split(/\s+/);
      if (parts.length < 4) return null;
      const clock = parts[0];
      const price = Number(parts[1]);
      const cumVolume = Number(parts[2]);
      const cumAmount = Number(parts[3]);
      if (!Number.isFinite(price) || !Number.isFinite(cumVolume) || !Number.isFinite(cumAmount)) {
        return null;
      }
      const volume = Math.max(0, cumVolume - prevVolume);
      const amount = Math.max(0, cumAmount - prevAmount);
      prevVolume = cumVolume;
      prevAmount = cumAmount;
      const mins = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(2, 4));
      const inSession = (mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900);
      if (!inSession) return null;
      priceSum += price;
      priceCount += 1;
      const time =
        date.length === 8
          ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${clock.slice(0, 2)}:${clock.slice(2, 4)}`
          : clock;
      return {
        time,
        price,
        avg: isIndex
          ? priceSum / priceCount
          : cumVolume > 0
            ? cumAmount / (cumVolume * 100)
            : price,
        volume,
        amount,
      };
    })
    .filter(Boolean);

  return {
    secid,
    code: symbol.slice(2),
    name: '',
    decimal: 2,
    preClose,
    points,
  };
}

async function handleTrends(params) {
  const secid = String(params.get('secid') || '');
  if (!SECID_RE.test(secid)) throw Object.assign(new Error('secid 参数不合法'), { status: 400 });

  return cached(`t:${secid}`, 5000, async () => {
    try {
      const data = await fetchEastmoneyTrend(secid);
      if (data.points.length) return data;
    } catch {
      /* fall back to Tencent */
    }
    return fetchTencentTrend(secid);
  });
}

async function handleSearch(params) {
  const q = String(params.get('q') || '').trim();
  if (!q || q.length > 24) throw Object.assign(new Error('搜索词不合法'), { status: 400 });

  return cached(`s:${q}`, 300000, async () => {
    const url = `https://search-codetable.eastmoney.com/codetable/search/web?client=web&clientType=web&clientVersion=1.0&keyword=${encodeURIComponent(
      q
    )}&pageIndex=1&pageSize=12`;
    const body = await upstream(url);
    const list = Array.isArray(body?.result) ? body.result : [];
    const items = list
      .filter((it) => it && it.code && it.shortName && (it.market === 0 || it.market === 1))
      .filter((it) => /^[0368]\d{5}$/.test(it.code))
      .map((it) => ({
        secid: `${it.market}.${it.code}`,
        code: it.code,
        name: it.shortName,
        market: it.market,
        type: it.securityTypeName || '',
        pinyin: it.pinyin || '',
      }));
    const seen = new Set();
    return { items: items.filter((it) => (seen.has(it.secid) ? false : seen.add(it.secid))) };
  });
}

const SINA_RANK = {
  up: { sort: 'changepercent', asc: 0 },
  down: { sort: 'changepercent', asc: 1 },
  amount: { sort: 'amount', asc: 0 },
};

async function fetchEastmoneyRank(type, limit) {
  const config = {
    up: { fid: 'f3', po: 1 },
    down: { fid: 'f3', po: 0 },
    amount: { fid: 'f6', po: 1 },
  }[type];
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';
  const fields = 'f2,f3,f5,f6,f8,f12,f13,f14,f20,f100';
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${limit}&po=${config.po}&np=1&fltt=2&invt=2&fid=${config.fid}&fs=${encodeURIComponent(
    fs
  )}&fields=${fields}`;
  const body = await upstream(url);
  const list = Array.isArray(body?.data?.diff) ? body.data.diff : [];
  return list
    .map((it) => ({
      secid: `${it.f13}.${it.f12}`,
      code: it.f12,
      market: num(it.f13),
      name: it.f14,
      price: num(it.f2),
      pct: num(it.f3),
      volume: num(it.f5),
      amount: num(it.f6),
      turnover: num(it.f8),
      marketCap: num(it.f20),
      industry: it.f100 || '',
    }))
    .filter((it) => it.price !== null);
}

async function fetchSinaRank(type, limit) {
  const config = SINA_RANK[type];
  const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=${
    limit + 15
  }&sort=${config.sort}&asc=${config.asc}&node=hs_a&symbol=&_s_r_a=page`;
  const res = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://finance.sina.com.cn/' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`sina rank ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('sina rank invalid');
  return list
    .filter((it) => it && /^(sh|sz)\d{6}$/.test(it.symbol))
    .slice(0, limit)
    .map((it) => {
      const marketCapWan = numText(it.mktcap);
      return {
        secid: `${it.symbol.startsWith('sh') ? 1 : 0}.${it.code}`,
        code: it.code,
        market: it.symbol.startsWith('sh') ? 1 : 0,
        name: it.name,
        price: numText(it.trade),
        pct: numText(it.changepercent),
        volume: numText(it.volume),
        amount: numText(it.amount),
        turnover: numText(it.turnoverratio),
        marketCap: marketCapWan === null ? null : marketCapWan * 10000,
        industry: '',
      };
    })
    .filter((it) => it.price !== null);
}

async function handleRank(params) {
  const type = String(params.get('type') || 'up');
  const limit = Math.min(Math.max(Number(params.get('limit') || 10), 5), 20);
  if (!SINA_RANK[type]) throw Object.assign(new Error('榜单类型不合法'), { status: 400 });

  return cached(`r:${type}:${limit}`, 12000, async () => {
    try {
      const items = await fetchEastmoneyRank(type, limit);
      if (items.length) return { items };
    } catch {
      /* fall through to Sina */
    }
    const items = await fetchSinaRank(type, limit);
    return { items };
  });
}

async function handleApi(pathname, params, res) {
  const routes = {
    '/api/quote': handleQuote,
    '/api/kline': handleKline,
    '/api/trends': handleTrends,
    '/api/search': handleSearch,
    '/api/rank': handleRank,
  };
  if (pathname === '/api/health') return sendJson(res, 200, { ok: true, time: Date.now() });

  const route = routes[pathname];
  if (!route) return sendJson(res, 404, { error: '接口不存在' });

  try {
    const data = await route(params);
    sendJson(res, 200, data);
  } catch (err) {
    const status = err.status || 502;
    console.error(`[api] ${pathname} -> ${status}: ${err.message}`);
    sendJson(res, status, {
      error: status === 400 ? err.message : '行情数据暂时不可用，请稍后重试',
    });
  }
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (rel === '/') rel = '/index.html';
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(url.pathname, url.searchParams, res);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`观市 · 股票小助手已启动  http://${HOST}:${PORT}`);
});
