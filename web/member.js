// 收藏者會員卡（使用者 2026-10-28：「嘗試加入這個」— Apple Wallet 會員卡：
//   每人一張、選一張收集到的卡面當主題 → 伺服器簽 .pkpass → 更新同一張 Wallet 卡；卡上有會員號、QR、積分）
//   卡號＝錢包 id（也是好友碼），QR＝加好友的邀請連結 #f.<碼>，積分照收集簿算（N 10、R 30、SR 100、SSR 300）
//   Wallet 的卡面圖在這裡用 canvas 畫好（iOS 27 Poster：artwork 358×448 pt）送上去；簽名、推播在 supabase/functions/wallet
//   收集簿 → 會員卡 分頁：預覽（跟 Wallet 上長得差不多）＋換主題卡＋名字＋加入 Apple Wallet／存成圖片
import { CLOUD } from './cloud.js';
import { finOf } from './codec.js';
import { titleOf } from './albumedit.js';

export const WALLET_FN = CLOUD.url + '/functions/v1/wallet';
// 每個獎品幾分（照稀有度）、升級門檻（伺服器卡背的說明寫的是同一組數字）
export const POINTS = [10, 30, 100, 300];
export const TIERS = [0, 300, 1000, 3000];
const ART_VERSION = 'a1'; // 卡面圖的畫法改了就換，iPhone 上的卡會重拿圖
const RC = [
  ['#c9d2de', '#8f9bad'],
  ['#8cc4ff', '#2f80ed'],
  ['#e2b8ff', '#a45cf0'],
  ['#ffe28a', '#e8a000'],
];
const LABEL = ['rgb(220, 228, 238)', 'rgb(170, 210, 255)', 'rgb(225, 196, 255)', 'rgb(255, 214, 120)'];

// ---------- 收集簿 → 積分、可以當主題的卡 ----------
export function memberStats(album) {
  let points = 0;
  let kinds = 0;
  let pieces = 0;
  for (const e of Object.values(album || {})) {
    if (e.hidden) continue;
    for (const [nm, n] of Object.entries(e.got || {})) {
      if (!(n > 0)) continue;
      kinds++;
      pieces += n;
      points += (POINTS[e.items?.[nm]?.r] || POINTS[0]) * n;
    }
  }
  let tier = 0;
  while (tier < TIERS.length - 1 && points >= TIERS[tier + 1]) tier++;
  return { points, tier, kinds, pieces, next: TIERS[tier + 1] ?? null };
}

// 手上有的獎品（有圖的）：卡片冊的先、稀有的先、最近的先
export function ownedFaces(album) {
  const out = [];
  for (const [key, e] of Object.entries(album || {})) {
    if (e.hidden) continue;
    for (const [name, n] of Object.entries(e.got || {})) {
      const it = e.items?.[name];
      if (!(n > 0) || !it?.t) continue;
      out.push({ id: key + '|' + name, key, name, n, r: it.r | 0, t: it.t, s: it.s || null, b: it.b || null, st: it.st ?? null, kind: e.kind === 'card' ? 'card' : 'capsule', fin: finOf(e.fin, it.r | 0), from: titleOf(e), ts: e.ts || 0 });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'card' ? -1 : 1) || b.r - a.r || b.ts - a.ts);
}

// ---------- 畫卡面 ----------
const imgCache = new Map();
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im); // decode() 在背景分頁不會 resolve → 用 onload
    im.onerror = () => res(null);
    im.src = src;
  });
  imgCache.set(src, p);
  return p;
}
const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
function cover(g, im, x, y, w, h) {
  const s = Math.max(w / im.width, h / im.height);
  g.drawImage(im, x + (w - im.width * s) / 2, y + (h - im.height * s) / 2, im.width * s, im.height * s);
}
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
// 照片的平均色（主題色）：太灰的拉一點彩度
function avgColor(im) {
  const c = canvas(16, 16);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  let r = 0;
  let gg = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    gg += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  return [r / n, gg / n, b / n];
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
// 主題色 → 卡的底色（深）、字（白）、標籤（稀有度的淺色）
export async function themeColors(face) {
  const im = await loadImg(face?.b || face?.t);
  const base = im ? avgColor(im) : [60, 70, 110];
  return { bg: rgb(mix(base, [10, 12, 24], 0.62)), fg: 'rgb(255, 255, 255)', label: LABEL[face?.r | 0] };
}

// 四角星
function star(g, x, y, r) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
}
// 偽亂數（同一張卡每次畫都一樣）
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const hashStr = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

// 一張卡（框＋照片＋去背主體衝出框）畫在 (cx, cy)，寬 w；回傳框的範圍
async function drawFace(g, face, cx, cy, w, opt = {}) {
  const [t, s, b] = await Promise.all([loadImg(face.t), loadImg(face.s), loadImg(face.b)]);
  const r = face.r | 0;
  const round = face.kind !== 'card';
  const h = round ? w : w * (350 / 240);
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rad = round ? w / 2 : w * 0.07;
  const [c1, c2] = RC[r];
  // 框（影子＋稀有度色的漸層）
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.45)';
  g.shadowBlur = w * 0.12;
  g.shadowOffsetY = w * 0.05;
  const fr = g.createLinearGradient(x, y, x + w, y + h);
  fr.addColorStop(0, c1);
  fr.addColorStop(0.5, c2);
  fr.addColorStop(1, c1);
  g.fillStyle = fr;
  rrect(g, x, y, w, h, rad);
  g.fill();
  g.restore();
  // 照片窗
  const bw = w * (round ? 0.07 : 0.055);
  const wx = x + bw;
  const wy = y + bw;
  const ww = w - bw * 2;
  const wh = h - bw * 2;
  const wr = round ? ww / 2 : rad * 0.6;
  g.save();
  rrect(g, wx, wy, ww, wh, wr);
  g.clip();
  g.fillStyle = '#fff';
  g.fillRect(wx, wy, ww, wh);
  if (s && b) cover(g, b, wx, wy, ww, wh);
  else if (t) cover(g, t, wx, wy, ww, wh);
  // SR／SSR：斜的虹光
  if (r >= 2) {
    g.globalCompositeOperation = 'soft-light';
    const rb = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
    ['#ff7a7a', '#ffe26a', '#7dff9a', '#6ad8ff', '#a98bff', '#ff7ad9'].forEach((col, i, a) => rb.addColorStop(i / (a.length - 1), col));
    g.globalAlpha = r === 3 ? 0.55 : 0.4;
    g.fillStyle = rb;
    g.fillRect(wx, wy, ww, wh);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
  // 去背主體：放大一點、從窗的下緣往上長，頭衝出框（裁切範圍＝照片窗 ∪ 窗上半部往上延伸的一塊）
  if (s) {
    g.save();
    g.beginPath();
    if (round) g.arc(cx, cy, ww / 2, 0, Math.PI * 2);
    else g.roundRect(wx, wy, ww, wh, wr);
    g.rect(wx, y - h * 0.18, ww, wy + wh * 0.35 - (y - h * 0.18));
    g.clip();
    g.shadowColor = 'rgba(0, 0, 0, 0.35)';
    g.shadowBlur = w * 0.04;
    g.shadowOffsetY = w * 0.015;
    const k = 1.08;
    const sw = ww * k;
    const sh = wh * k;
    cover(g, s, cx - sw / 2, wy + wh - sh, sw, sh);
    g.restore();
  }
  // 窗的內框線
  g.save();
  g.lineWidth = Math.max(2, w * 0.012);
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  rrect(g, wx, wy, ww, wh, wr);
  g.stroke();
  g.restore();
  // SSR：亮粉
  if (r === 3 && !opt.plain) {
    const rand = rng(hashStr(face.id || face.name || 'x'));
    g.save();
    rrect(g, x, y, w, h, rad);
    g.clip();
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `hsla(${rand() * 360}, 90%, 85%, ${0.35 + rand() * 0.5})`;
      star(g, x + rand() * w, y + rand() * h, w * (0.006 + rand() * 0.014));
    }
    g.restore();
  }
  return { x, y, w, h };
}

// Wallet 的 Poster 卡面（artwork）：主題色＋模糊的照片當底、中間一張大卡、星星；上面放 logo／積分、下面放名字、QR，所以卡放中間偏上
export async function drawArtwork(face, W = 716, H = 896) {
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const r = face?.r | 0;
  const im = face && (await loadImg(face.b || face.t));
  const base = im ? avgColor(im) : [70, 80, 130];
  const top = mix(base, [12, 14, 28], 0.45);
  const bot = mix(base, [8, 10, 20], 0.78);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, rgb(top));
  bg.addColorStop(1, rgb(bot));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  if (im) {
    g.save();
    g.globalAlpha = 0.5;
    g.filter = `blur(${Math.round(W * 0.035)}px) saturate(1.3)`;
    cover(g, im, -W * 0.1, -H * 0.1, W * 1.2, H * 1.2);
    g.restore();
  }
  // 中間的光（稀有度色）＋放射線
  const cx = W / 2;
  const cy = H * 0.42;
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, W * 0.7);
  glow.addColorStop(0, RC[r][0] + 'cc');
  glow.addColorStop(0.45, RC[r][1] + '33');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  if (r >= 1) {
    g.save();
    g.translate(cx, cy);
    g.globalAlpha = r === 3 ? 0.22 : 0.13;
    g.fillStyle = '#fff';
    const rays = 18;
    for (let i = 0; i < rays; i++) {
      g.rotate((Math.PI * 2) / rays);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(W, -W * 0.07);
      g.lineTo(W, W * 0.07);
      g.fill();
    }
    g.restore();
  }
  // 上下壓暗（字比較清楚）
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0.42)');
  shade.addColorStop(0.16, 'rgba(0,0,0,0)');
  shade.addColorStop(0.62, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  // 點點
  const rand = rng(hashStr(face?.id || 'clatter'));
  g.fillStyle = 'rgba(255,255,255,0.08)';
  const step = W / 18;
  for (let y = step / 2; y < H; y += step) for (let x = ((y / step) % 2) * (step / 2); x < W; x += step) {
    g.beginPath();
    g.arc(x, y, W * 0.004, 0, Math.PI * 2);
    g.fill();
  }
  if (face) await drawFace(g, face, cx, cy, face.kind === 'card' ? W * 0.48 : W * 0.52);
  // 星星
  for (let i = 0; i < 6 + r * 4; i++) {
    const a = rand() * Math.PI * 2;
    const d = W * (0.34 + rand() * 0.18);
    g.fillStyle = `rgba(255, ${235 + rand() * 20}, ${180 + rand() * 75}, ${0.55 + rand() * 0.45})`;
    star(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 1.15, W * (0.012 + rand() * 0.022));
  }
  return c;
}

// 舊版 iOS（generic）右邊的小圖：卡本身（透明底）
async function drawThumb(face, S = 180) {
  const c = canvas(S, S);
  if (face) await drawFace(c.getContext('2d'), face, S / 2, S / 2 + S * 0.02, face.kind === 'card' ? S * 0.62 : S * 0.86, { plain: true });
  return c;
}
async function appIcon(S, round = 0.22) {
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const im = await loadImg(new URL('./assets/icons/icon-192.png', import.meta.url).href);
  g.save();
  rrect(g, 0, 0, S, S, S * round);
  g.clip();
  if (im) g.drawImage(im, 0, 0, S, S);
  g.restore();
  return c;
}
// iOS 27 卡面左上的 logo（30 pt 高）：App 圖示＋Clatter
async function drawPrimaryLogo(H = 60) {
  await document.fonts?.load?.(`700 ${H}px "Dela Gothic One"`).catch(() => {});
  const font = `${Math.round(H * 0.56)}px "Dela Gothic One", "Huninn", system-ui, sans-serif`;
  const m = canvas(1, 1).getContext('2d');
  m.font = font;
  const tw = Math.ceil(m.measureText('Clatter').width);
  const c = canvas(Math.min(H * 4.2, H + H * 0.25 + tw + 4), H);
  const g = c.getContext('2d');
  g.drawImage(await appIcon(H), 0, 0);
  g.font = font;
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText('Clatter', H * 1.25, H * 0.54);
  return c;
}

const b64 = (c) => c.toDataURL('image/png').split(',')[1];
async function sha(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
// 這張主題卡的圖組代號：圖沒變就不用再傳
const imgKey = (face) => sha([ART_VERSION, face?.id, face?.r, face?.t?.length, face?.s?.length].join('|'));

// 送上去的卡面圖：圖示、logo、小圖、Poster artwork（＋background 同一張，名字不確定兩個都放）
async function passFiles(face) {
  const art = await drawArtwork(face, 716, 896);
  const bgc = canvas(690, 1010);
  cover(bgc.getContext('2d'), art, 0, 0, 690, 1010);
  return {
    'icon.png': b64(await appIcon(29)),
    'icon@2x.png': b64(await appIcon(58)),
    'icon@3x.png': b64(await appIcon(87)),
    'logo@2x.png': b64(await appIcon(100)),
    'thumbnail@2x.png': b64(await drawThumb(face, 180)),
    'artwork@2x.png': b64(art),
    'background@2x.png': b64(bgc),
    'primaryLogo@2x.png': b64(await drawPrimaryLogo(60)),
  };
}

// ---------- 伺服器 ----------
async function call(path, body) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(WALLET_FN + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal } : { signal: ac.signal, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(r.status === 401 ? 'e.locked' : r.status === 503 ? 'mb.off' : 'e.network'), { status: r.status });
    return j;
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('e.network');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
let statusP = null;
export function walletStatus() {
  // 連不上不記住（下次再問）；問到了就記著
  statusP = statusP || call('/status').catch(() => ((statusP = null), { enabled: false, offline: true }));
  return statusP;
}
// 存會員卡（伺服器沒有這組圖才傳圖）
export async function syncMember(w, face, data, lang) {
  const img = face ? await imgKey(face) : null;
  const base = { id: w.id, key: w.key, lang, data, img };
  let r = await call('/card', base);
  if (r.needFiles) r = await call('/card', { ...base, files: await passFiles(face) });
  return r;
}
export async function walletTicket(w) {
  return (await call('/ticket', { id: w.id, key: w.key })).url;
}

// ---------- QR（qrcode-generator，用到才載） ----------
let qrLib = null;
async function qrMatrix(text) {
  qrLib = qrLib || import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm').then((m) => m.default || m);
  const qrcode = await qrLib;
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  return { n, dark: (x, y) => q.isDark(y, x) };
}
async function drawQr(c, text, size) {
  const m = await qrMatrix(text);
  const q = 2; // 白邊
  const cell = Math.floor(size / (m.n + q * 2));
  const S = cell * (m.n + q * 2);
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#111';
  for (let y = 0; y < m.n; y++) for (let x = 0; x < m.n; x++) if (m.dark(x, y)) g.fillRect((x + q) * cell, (y + q) * cell, cell, cell);
  return c;
}

// ---------- 收集簿 → 會員卡 分頁 ----------
const el = (tag, cls, text) => {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text != null) x.textContent = text;
  return x;
};
const fmtNo = (id) => (id ? id.slice(0, 5) + ' ' + id.slice(5) : '— —');
const nf = (n) => (n == null ? '—' : Number(n).toLocaleString());

export class MemberCard {
  // d＝{ t, toast, store, sfx, lang(), loadWallet(), wallet(), myName(), setName(v), inviteUrl(code), isIos() }
  constructor(root, d) {
    this.root = root;
    this.d = d;
    this.artFor = '';
    this.syncTimer = 0;
  }
  get st() {
    return this.d.store.get('clatter.member') || {};
  }
  set st(v) {
    this.d.store.set('clatter.member', v);
  }
  album() {
    return this.d.store.get('clatter.album') || {};
  }
  faces() {
    return ownedFaces(this.album());
  }
  face(list = this.faces()) {
    return list.find((f) => f.id === this.st.theme) || list[0] || null;
  }
  // 卡上的字（網頁預覽跟 Wallet 一樣）
  data(face, stats) {
    const w = this.d.wallet();
    return { name: this.d.myName() || '', points: stats.points, tier: stats.tier, kinds: stats.kinds, pieces: stats.pieces, theme: face?.name || '', from: face?.from || '', coins: w?.balance ?? null };
  }
  summary() {
    const s = memberStats(this.album());
    return this.d.t('mb.sum', { tier: this.d.t('mb.tier' + s.tier), p: nf(s.points) });
  }

  async render() {
    const { t } = this.d;
    const root = this.root;
    const faces = this.faces();
    const face = this.face(faces);
    const stats = memberStats(this.album());
    const w = this.d.wallet();
    root.textContent = '';
    const wrap = el('div', 'mb');
    // 左：卡的預覽（跟 Wallet 上的 Poster 卡同樣的擺法）
    const stage = el('div', 'mb-stage');
    const pass = el('div', 'mb-pass');
    const art = el('img', 'mb-art');
    art.alt = '';
    const topRow = el('div', 'mb-top');
    const logo = el('div', 'mb-logo');
    const ico = el('img');
    ico.src = new URL('./assets/icons/icon-192.png', import.meta.url).href;
    ico.alt = '';
    logo.append(ico, el('span', null, 'Clatter'));
    const hdr = el('div', 'mb-hdr');
    hdr.append(el('small', null, t('mb.points')), el('b', null, nf(stats.points)));
    topRow.append(logo, hdr);
    const prim = el('div', 'mb-prim');
    const f1 = el('div');
    f1.append(el('small', null, `${t('mb.member')} · ${t('mb.tier' + stats.tier)}`), el('b', null, this.d.myName() || t('mb.member')));
    const f2 = el('div');
    f2.append(el('small', null, t('mb.theme')), el('b', null, face?.name || '—'));
    prim.append(f1, f2);
    const strip = el('div', 'mb-strip');
    const foot = el('div', 'mb-foot');
    const c1 = el('div');
    c1.append(el('small', null, t('mb.coins')), el('b', null, nf(w?.balance)));
    const c2 = el('div');
    c2.append(el('small', null, t('mb.col')), el('b', null, t('mb.pieces', { k: stats.kinds, n: stats.pieces })));
    foot.append(c1, c2);
    const qrBox = el('div', 'mb-qr');
    const qr = el('canvas');
    qrBox.append(qr, el('small', null, fmtNo(w?.id)));
    strip.append(foot, qrBox);
    pass.append(art, topRow, prim, strip, el('div', 'mb-glare'));
    stage.append(pass);
    // 右：等級、名字、主題卡、按鈕
    const side = el('div', 'mb-side');
    const tier = el('div', 'mb-tierbox card-box');
    const tl = el('div', 'mb-tierline');
    tl.append(el('b', 'mb-badge t' + stats.tier, t('mb.tier' + stats.tier)), el('span', null, t('mb.ptsLine', { p: nf(stats.points) })));
    const bar = el('div', 'mb-bar');
    const lo = TIERS[stats.tier];
    const fill = el('i');
    fill.style.width = stats.next ? `${Math.round(((stats.points - lo) / (stats.next - lo)) * 100)}%` : '100%';
    bar.append(fill);
    tier.append(tl, bar, el('small', null, stats.next ? t('mb.next', { n: nf(stats.next - stats.points), tier: t('mb.tier' + (stats.tier + 1)) }) : t('mb.max')));
    const nameF = el('form', 'mb-name');
    const lab = el('label', null, t('mb.name'));
    const inp = el('input');
    inp.maxLength = 24;
    inp.placeholder = t('mb.namePh');
    inp.value = this.d.myName() || '';
    inp.id = 'mb-name-in';
    lab.htmlFor = inp.id;
    const save = el('button', 'btn', t('mb.saveName'));
    save.type = 'submit';
    nameF.append(lab, inp, save);
    nameF.onsubmit = async (ev) => {
      ev.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      try {
        await this.d.setName(v);
        this.d.toast(t('mb.nameSaved'));
        this.render();
        this.touch();
      } catch (e) {
        this.d.toast(t(e.message));
      }
    };
    const th = el('div', 'mb-themes');
    th.append(el('h3', null, t('mb.theme')), el('p', 'mb-hint', faces.length ? t('mb.themeHint') : t('mb.noFaces')));
    const grid = el('div', 'mb-faces');
    for (const f of faces.slice(0, 60)) {
      const b = el('button', 'mb-face r' + f.r + (f.kind === 'card' ? '' : ' round'));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(f.id === face?.id));
      b.title = `${f.name} · ${f.from}`;
      const im = el('img');
      im.src = f.t;
      im.alt = f.name;
      im.loading = 'lazy';
      b.append(im);
      b.onclick = () => {
        this.st = { ...this.st, theme: f.id };
        this.d.sfx?.tap?.();
        this.render();
        this.touch(true);
      };
      grid.append(b);
    }
    th.append(grid);
    const acts = el('div', 'mb-acts');
    const add = el('button', 'btn mb-wallet');
    add.type = 'button';
    add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.5 9.5h19M15 14h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    add.append(el('span', null, t('mb.addWallet')));
    add.disabled = !w;
    add.onclick = () => this.addToWallet(add);
    const img = el('button', 'btn ghost', t('mb.saveImg'));
    img.type = 'button';
    img.onclick = () => this.saveImage();
    acts.append(add, img);
    const note = el('p', 'mb-note');
    this.note = note;
    side.append(tier, nameF, th, acts, note);
    wrap.append(stage, side);
    root.append(wrap);
    // 卡面圖、QR（非同步）
    const key = (face?.id || '') + '|' + ART_VERSION;
    if (this.artFor !== key || !this.artUrl) {
      this.artFor = key;
      this.artUrl = null;
      drawArtwork(face, 716, 896).then((c) => {
        if (this.artFor !== key) return;
        this.artUrl = c.toDataURL('image/jpeg', 0.9);
        art.src = this.artUrl;
      });
    } else art.src = this.artUrl;
    if (w) drawQr(qr, this.d.inviteUrl(w.id), 168).catch(() => (qrBox.hidden = true));
    else qrBox.hidden = true;
    this.tiltPass(pass);
    this.showStatus();
  }

  // 預覽卡跟著游標斜一點＋反光
  tiltPass(pass) {
    const move = (x, y) => {
      pass.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 6}deg)`;
      pass.style.setProperty('--gx', `${50 + x * 40}%`);
      pass.style.setProperty('--gy', `${50 - y * 40}%`);
    };
    pass.onpointermove = (e) => {
      const r = pass.getBoundingClientRect();
      move(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    };
    pass.onpointerleave = () => move(0, 0);
  }

  async showStatus() {
    const { t } = this.d;
    const s = await walletStatus();
    if (!this.note?.isConnected) return;
    const w = this.d.wallet();
    this.note.textContent = !w ? t('mb.noWallet') : s.offline || !s.enabled ? t('mb.off') : this.st.issued ? t('mb.issued') : this.d.isIos() ? t('mb.howAdd') : t('mb.needIos');
  }

  async addToWallet(btn) {
    const { t } = this.d;
    const w = await this.d.loadWallet().catch(() => null);
    if (!w) return this.d.toast(t('e.network'));
    const s = await walletStatus();
    if (!s.enabled) {
      this.d.toast(t('mb.off'));
      return this.showStatus();
    }
    btn.disabled = true;
    const label = btn.querySelector('span');
    const old = label.textContent;
    label.textContent = t('mb.preparing');
    try {
      const face = this.face();
      const stats = memberStats(this.album());
      const data = this.data(face, stats);
      await syncMember(w, face, data, this.d.lang());
      const url = await walletTicket(w);
      this.st = { ...this.st, issued: true, sig: await this.sig(face, data) };
      location.href = url; // Safari：跳出「加入 Apple Wallet」
      this.showStatus();
    } catch (e) {
      this.d.toast(t(e.message === 'mb.off' ? 'mb.off' : e.message));
    } finally {
      btn.disabled = false;
      label.textContent = old;
    }
  }

  sig(face, data) {
    return sha(JSON.stringify([face?.id, face?.r, data, this.d.lang(), ART_VERSION]));
  }
  // 收集簿、錢包、名字、主題變了 → 已經加進 Wallet 的話，幾秒後更新同一張卡（伺服器會推播）
  touch(now = false) {
    if (!this.st.issued) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.syncNow().catch(() => {}), now ? 300 : 4000);
  }
  async syncNow() {
    const w = this.d.wallet();
    if (!w || !this.st.issued) return;
    const face = this.face();
    const data = this.data(face, memberStats(this.album()));
    const sig = await this.sig(face, data);
    if (sig === this.st.sig) return;
    await syncMember(w, face, data, this.d.lang());
    this.st = { ...this.st, sig };
    if (this.root.isConnected && !this.root.hidden) this.d.toast(this.d.t('mb.synced'));
  }

  // 存成圖片：卡面＋字＋QR 一張 PNG（不用 iPhone 也能拿去用）
  async saveImage() {
    const { t } = this.d;
    const W = 716;
    const H = 1132;
    const face = this.face();
    const stats = memberStats(this.album());
    const w = this.d.wallet();
    const c = canvas(W, H);
    const g = c.getContext('2d');
    await document.fonts?.load?.('700 40px "Dela Gothic One"').catch(() => {});
    const colors = await themeColors(face);
    g.fillStyle = colors.bg;
    rrect(g, 0, 0, W, H, 44);
    g.fill();
    g.save();
    rrect(g, 0, 0, W, H, 44);
    g.clip();
    g.drawImage(await drawArtwork(face, W, 896), 0, 0);
    const fade = g.createLinearGradient(0, 700, 0, 896);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, colors.bg);
    g.fillStyle = fade;
    g.fillRect(0, 700, W, 196);
    g.restore();
    g.drawImage(await drawPrimaryLogo(60), 36, 36);
    const body = '"Huninn", "Noto Sans TC", system-ui, sans-serif';
    const num = '"Dela Gothic One", "Huninn", system-ui, sans-serif';
    const field = (label, value, x, y, align = 'left', size = 40) => {
      g.textAlign = align;
      g.fillStyle = colors.label;
      g.font = `700 22px ${body}`;
      g.fillText(label, x, y);
      g.fillStyle = '#fff';
      g.font = `${size}px ${num}`;
      g.fillText(value, x, y + size + 6);
    };
    g.textBaseline = 'alphabetic';
    field(t('mb.points'), nf(stats.points), W - 36, 56, 'right', 44);
    field(`${t('mb.member')} · ${t('mb.tier' + stats.tier)}`, this.d.myName() || t('mb.member'), 40, 760, 'left', 44);
    field(t('mb.theme'), face?.name || '—', 40, 860, 'left', 34);
    field(t('mb.coins'), nf(w?.balance), 40, 968, 'left', 34);
    field(t('mb.col'), t('mb.pieces', { k: stats.kinds, n: stats.pieces }), 40, 1062, 'left', 30);
    if (w) {
      const q = await drawQr(canvas(1, 1), this.d.inviteUrl(w.id), 250).catch(() => null);
      if (q) {
        const s = 170;
        g.fillStyle = '#fff';
        rrect(g, W - 40 - s - 16, 912, s + 16, s + 50, 18);
        g.fill();
        g.drawImage(q, W - 40 - s - 8, 920, s, s);
        g.fillStyle = '#333';
        g.font = `700 20px ${body}`;
        g.textAlign = 'center';
        g.fillText(fmtNo(w.id), W - 40 - s / 2 - 8, 912 + s + 38);
      }
    }
    const a = document.createElement('a');
    a.download = 'clatter-member.png';
    a.href = c.toDataURL('image/png');
    document.body.append(a);
    a.click();
    a.remove();
  }
}
