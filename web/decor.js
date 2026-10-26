// 機台上的貼紙與台紙：Canvas 畫成貼圖
import { t, lang } from './i18n.js';

// 背景插畫來自 Gemini（assets/tex/*.webp，沒有文字）；名稱、價錢、獎品縮圖由這裡疊上去
export const RARITY = [
  { key: 'N', color: '#8f9bad', glow: '#dfe6ef', get label() { return t('r.0'); } },
  { key: 'R', color: '#2f80ed', glow: '#8cc3ff', get label() { return t('r.1'); } },
  { key: 'SR', color: '#a45cf0', glow: '#e3c7ff', get label() { return t('r.2'); } },
  { key: 'SSR', color: '#f2a900', glow: '#ffe28a', get label() { return t('r.3'); } },
];

export const FONT_DISPLAY = '"Huninn", "Noto Sans TC", system-ui, sans-serif';
// 內文字型跟著語言：日文用日本字形
const bodyFont = () => (lang === 'ja' ? '"Noto Sans JP", "Noto Sans TC"' : '"Noto Sans TC"') + ', system-ui, sans-serif';
export const FONT_NUM = '"Dela Gothic One", "Huninn", system-ui, sans-serif';

export async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`40px ${FONT_DISPLAY}`, '轉蛋機一般稀有'),
      document.fonts.load(`40px ${FONT_NUM}`, 'NT$0123456789'),
      document.fonts.load('700 40px "Noto Sans TC"', '取出口退幣'),
      lang === 'ja' ? document.fonts.load('700 40px "Noto Sans JP"', 'とりだし口返却') : null,
    ]);
  } catch (e) {
    /* 字型載不到就用備用字型 */
  }
}

export function priceText(price) {
  const total = price.coins * price.unit;
  if (price.cur === '代幣') return t('tokensN', { n: price.coins });
  return `${price.cur}${formatNum(total)}`;
}

export function formatNum(n) {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 文字太長就縮小字級，直到放得下
function fitText(g, text, maxW, size, font, weight = '') {
  let s = size;
  g.font = `${weight} ${s}px ${font}`;
  while (g.measureText(text).width > maxW && s > 8) {
    s -= 2;
    g.font = `${weight} ${s}px ${font}`;
  }
  return s;
}

// 沒有上傳照片的獎品：用名字第一個字＋顏色做縮圖
export function placeholderThumb(name, index, size = 128) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const hues = [2, 42, 210, 160, 330, 25, 265, 190];
  const h = hues[index % hues.length];
  const grd = g.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, `hsl(${h} 85% 66%)`);
  grd.addColorStop(1, `hsl(${h} 75% 48%)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.arc(((i * 47) % size) + 8, ((i * 83) % size) + 6, size * 0.08, 0, Math.PI * 2);
    g.fill();
  }
  const ch = [...(name || '？').trim()][0] || '？';
  g.fillStyle = '#fff';
  g.font = `${size * 0.56}px ${FONT_DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.25)';
  g.shadowBlur = size * 0.04;
  g.fillText(ch, size / 2, size * 0.54);
  return c;
}

function drawCover(g, img, x, y, w, h) {
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

// 上蓋正面的橫幅（0.66 × 0.082 m）
export function drawLid(cfg, theme, art) {
  const c = canvas(1024, 128);
  const g = c.getContext('2d');
  if (art) {
    // Gemini 橫幅中間本來就留了白色膠囊形 → 字直接寫在裡面
    g.drawImage(art, 0, 0, 1024, 128);
  } else {
    g.fillStyle = theme.body;
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = 'rgba(255,255,255,0.94)';
    roundRect(g, 170, 14, 684, 100, 50);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#1c2340';
    g.stroke();
  }
  g.fillStyle = '#1c2340';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, cfg.name, 620, 64, FONT_DISPLAY);
  g.fillText(cfg.name, 512, 68);
  return c;
}

// 圓形價格貼紙：1回 NT$50（真實機台的價錢都標在投幣口旁）
export function drawPrice(cfg, art) {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  if (art) {
    g.drawImage(art, 0, 0, 256, 256);
  } else {
    g.fillStyle = '#ffd23f';
    g.beginPath();
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r = i % 2 ? 112 : 126;
      g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#d8262c';
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(128, 128, 84, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#d8262c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `34px ${FONT_DISPLAY}`;
  fitText(g, t('oneSpin'), 140, 34, FONT_DISPLAY);
  g.fillText(t('oneSpin'), 128, 84);
  const pt = priceText(cfg.price);
  fitText(g, pt, 150, 54, FONT_NUM);
  g.fillText(pt, 128, 136);
  g.fillStyle = '#1c2340';
  g.font = `26px ${FONT_DISPLAY}`;
  fitText(g, t('coinsN', { n: cfg.price.coins }), 140, 26, FONT_DISPLAY);
  g.fillText(t('coinsN', { n: cfg.price.coins }), 128, 182);
  return c;
}

// 把手左上方的順時針箭頭（0.46 × 0.46 m，中心＝把手中心）
export function drawArrow(art) {
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  const cx = 256;
  const cy = 256;
  const r = (0.195 / 0.46) * 512;
  const a0 = (185 * Math.PI) / 180;
  const a1 = (282 * Math.PI) / 180;
  g.lineCap = 'round';
  g.strokeStyle = '#1c2340';
  g.lineWidth = 30;
  g.beginPath();
  g.arc(cx, cy, r, a0, a1);
  g.stroke();
  g.strokeStyle = '#ffd23f';
  g.lineWidth = 18;
  g.beginPath();
  g.arc(cx, cy, r, a0, a1);
  g.stroke();
  // 箭頭
  const tip = a1 + 0.2;
  const px = cx + Math.cos(tip) * r;
  const py = cy + Math.sin(tip) * r;
  const tx = -Math.sin(tip);
  const ty = Math.cos(tip);
  const nx = Math.cos(tip);
  const ny = Math.sin(tip);
  g.beginPath();
  g.moveTo(px + tx * 26, py + ty * 26);
  g.lineTo(px - tx * 18 + nx * 30, py - ty * 18 + ny * 30);
  g.lineTo(px - tx * 18 - nx * 30, py - ty * 18 - ny * 30);
  g.closePath();
  g.fillStyle = '#ffd23f';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#1c2340';
  g.stroke();
  // 「轉」字
  const la = (232 * Math.PI) / 180;
  const lx = cx + Math.cos(la) * (r - 52);
  const ly = cy + Math.sin(la) * (r - 52);
  g.fillStyle = '#1c2340';
  g.beginPath();
  g.arc(lx, ly, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffd23f';
  g.font = `32px ${FONT_DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(t('d.turn'), lx, ly + 2);
  if (art) {
    /* 箭頭用程式畫：位置要剛好繞著把手 */
  }
  return c;
}

// 小標籤：取出口、退幣口
export function drawLabel(text, arrow, bg = '#1c2340', fg = '#ffffff') {
  const c = canvas(256, 128);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  roundRect(g, 6, 14, 244, 100, 22);
  g.fill();
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = arrow === 'left' ? `◀ ${text}` : arrow === 'down' ? `${text} ▼` : text;
  fitText(g, label, 220, 52, bodyFont(), '900');
  g.fillText(label, 128, 66);
  return c;
}

// 窗內的台紙（0.68 × 0.45 m）：機台名稱、價錢、獎品陣容
// 下面約 1/4 會被扭蛋擋住 → 重要的東西都放上面
export function drawCard(cfg, thumbs, art) {
  const W = 1024;
  const H = 678;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  // 內框：Gemini 台紙中間的白色區域（約 x 8–92%、y 12–88%）
  const ix = W * 0.085;
  const iy = H * 0.13;
  const iw = W * 0.83;
  if (art) g.drawImage(art, 0, 0, W, H);
  else {
    g.fillStyle = '#fffaf2';
    g.fillRect(0, 0, W, H);
  }
  // 標題帶
  g.fillStyle = 'rgba(28,35,64,0.94)';
  roundRect(g, ix + 10, iy + 8, iw - 20, 88, 44);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, cfg.name, iw - 260, 58, FONT_DISPLAY);
  g.fillText(cfg.name, ix + iw / 2 - 50, iy + 54);
  g.fillStyle = '#ffd23f';
  g.font = `32px ${FONT_DISPLAY}`;
  g.textAlign = 'right';
  fitText(g, t('d.kinds', { n: cfg.items.length }), 170, 32, FONT_DISPLAY);
  g.fillText(t('d.kinds', { n: cfg.items.length }), ix + iw - 40, iy + 54);

  // 獎品格子（下面 1/4 會被扭蛋擋住，所以只用上半）
  const n = Math.min(cfg.items.length, 8);
  const cols = n <= 4 ? n : Math.ceil(n / 2);
  const rows = n <= 4 ? 1 : 2;
  const areaX = ix + 6;
  const areaY = iy + 104;
  const areaW = iw - 12;
  const areaH = rows === 1 ? 250 : 300;
  const cell = Math.min(areaW / cols, areaH / rows);
  const ox = areaX + (areaW - cell * cols) / 2;
  for (let i = 0; i < n; i++) {
    const it = cfg.items[i];
    const cx = ox + (i % cols) * cell;
    const cy = areaY + Math.floor(i / cols) * cell;
    const pad = cell * 0.07;
    const s = cell - pad * 2;
    const rar = RARITY[it.rarity];
    g.save();
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.18)';
    g.shadowBlur = 10;
    roundRect(g, cx + pad, cy + pad, s, s, s * 0.12);
    g.fill();
    g.restore();
    g.save();
    roundRect(g, cx + pad * 1.6, cy + pad * 1.6, s - pad * 1.2, s - pad * 1.2 - s * 0.16, s * 0.09);
    g.clip();
    const th = thumbs[i];
    if (th) drawCover(g, th, cx + pad * 1.6, cy + pad * 1.6, s - pad * 1.2, s - pad * 1.2 - s * 0.16);
    g.restore();
    g.fillStyle = '#1c2340';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, it.name, s - 16, s * 0.12, bodyFont(), '700');
    g.fillText(it.name, cx + cell / 2, cy + pad + s - s * 0.09);
    // 稀有度標籤
    g.fillStyle = rar.color;
    roundRect(g, cx + pad - 4, cy + pad - 6, s * 0.36, s * 0.16, s * 0.08);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `${Math.round(s * 0.11)}px ${FONT_NUM}`;
    g.fillText(rar.key, cx + pad - 4 + s * 0.18, cy + pad - 6 + s * 0.085);
  }
  if (cfg.items.length > 8) {
    g.fillStyle = '#1c2340';
    g.font = `28px ${FONT_DISPLAY}`;
    g.textAlign = 'center';
    g.fillText(t('d.more', { n: cfg.items.length - 8 }), W / 2, areaY + areaH + 22);
  }
  return c;
}

// 10 連抽：格子裡開出來的獎品小卡（稀有度色框＋照片＋名字，NEW 角標）
export function drawPrizeCard(item, thumb, isNew) {
  const W = 192;
  const H = 216;
  const P = 142; // 照片邊長
  const px = (W - P) / 2;
  const py = 34;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rar = RARITY[item.rarity];
  g.fillStyle = '#1c2340'; // toon 粗描邊
  roundRect(g, 2, 2, W - 4, H - 4, 26);
  g.fill();
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, rar.glow);
  grd.addColorStop(1, rar.color);
  g.fillStyle = grd;
  roundRect(g, 9, 9, W - 18, H - 18, 20);
  g.fill();
  g.fillStyle = '#ffffff';
  roundRect(g, px - 5, py - 5, P + 10, P + 10, 13);
  g.fill();
  g.save();
  roundRect(g, px, py, P, P, 9);
  g.clip();
  if (thumb) drawCover(g, thumb, px, py, P, P);
  g.restore();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.font = `24px ${FONT_NUM}`;
  g.lineWidth = 6;
  g.strokeStyle = '#1c2340';
  g.strokeText(rar.key, W / 2, 20);
  g.fillStyle = '#ffffff';
  g.fillText(rar.key, W / 2, 20);
  fitText(g, item.name, W - 32, 22, bodyFont(), '900');
  g.lineWidth = 5;
  g.strokeText(item.name, W / 2, H - 24);
  g.fillText(item.name, W / 2, H - 24);
  if (isNew) {
    g.save();
    g.translate(W - 30, 30);
    g.rotate(0.3);
    g.fillStyle = '#ff3d5a';
    g.strokeStyle = '#1c2340';
    g.lineWidth = 4;
    roundRect(g, -30, -14, 60, 28, 14);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = `17px ${FONT_NUM}`;
    g.fillText('NEW', 0, 1);
    g.restore();
  }
  return c;
}

// ---------- 轉卡機 ----------
// 卡片正面（59 × 86 mm 的比例）：轉卡機以圖為主 → 全圖卡（圖片鋪滿整張卡，外面一圈細稀有度框）
// 分三層給 3D 照片效果用（cardkit.js 的 shader）：
//   frame＝框＋稀有度章＋星星＋名字帶（窗的地方透明）、photo＝鋪滿窗的圖、depth＝從圖估出來的深度（白＝前、黑＝後）
export const CARD_PX = { w: 512, h: 746 };
export const CARD_WIN = { x: 18, y: 18, w: 476, h: 710 }; // 圖片窗（px）
const STARS = [1, 2, 3, 4];

export function drawCardLayers(item, thumb, rarity = item.rarity, mask = null) {
  const { w: W, h: H } = CARD_PX;
  const { x: wx, y: wy, w: ww, h: wh } = CARD_WIN;
  const rar = RARITY[rarity];
  // 圖片層
  const photo = canvas(ww, wh);
  const pg = photo.getContext('2d');
  pg.fillStyle = '#fffaf2';
  pg.fillRect(0, 0, ww, wh);
  if (thumb) drawCover(pg, thumb, 0, 0, ww, wh);
  // 框層
  const frame = canvas(W, H);
  const g = frame.getContext('2d');
  g.fillStyle = '#1c2340'; // toon 粗描邊
  roundRect(g, 0, 0, W, H, 34);
  g.fill();
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, rar.glow);
  grd.addColorStop(0.55, rar.color);
  grd.addColorStop(1, rar.glow);
  g.fillStyle = grd;
  roundRect(g, 7, 7, W - 14, H - 14, 28);
  g.fill();
  g.globalCompositeOperation = 'destination-out'; // 挖出圖片窗
  roundRect(g, wx, wy, ww, wh, 22);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  return {
    frame,
    photo,
    bg: mask ? inpaintBehind(photo, mask) : null,
    over: drawCardOver(item, rarity),
    depth: mask ? depthFromMask(mask, ww, wh) : estimateDepth(photo),
  };
}

// 主體後面的背景（3D 卡斜著看時露出來的地方）：把主體挖掉，用四周的顏色由粗到細補回去（push-pull）
function inpaintBehind(photo, mask) {
  const w = 160;
  const h = Math.round((w * photo.height) / photo.width);
  const m = canvas(w, h);
  const mg = m.getContext('2d', { willReadFrequently: true });
  mg.filter = 'blur(3px)'; // 放寬一點，主體的毛邊也一起挖掉
  drawCover(mg, mask, 0, 0, w, h);
  mg.filter = 'none';
  const md = mg.getImageData(0, 0, w, h).data;
  const hole = canvas(w, h);
  const hg = hole.getContext('2d', { willReadFrequently: true });
  hg.drawImage(photo, 0, 0, w, h);
  const hd = hg.getImageData(0, 0, w, h);
  for (let i = 0; i < md.length; i += 4) hd.data[i + 3] = Math.round(255 * (1 - Math.min(1, (md[i] / 255) * 4)));
  hg.putImageData(hd, 0, 0);
  const lv = [hole];
  let cur = hole;
  while (cur.width > 6) {
    const n = canvas(Math.max(1, cur.width >> 1), Math.max(1, cur.height >> 1));
    n.getContext('2d').drawImage(cur, 0, 0, n.width, n.height);
    lv.push(n);
    cur = n;
  }
  // 最粗那層：還是透明的格子填平均色，其他的不透明
  const cg = cur.getContext('2d', { willReadFrequently: true });
  const cd = cg.getImageData(0, 0, cur.width, cur.height);
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < cd.data.length; i += 4) {
    const a = cd.data[i + 3];
    r += cd.data[i] * a;
    gg += cd.data[i + 1] * a;
    b += cd.data[i + 2] * a;
    n += a;
  }
  for (let i = 0; i < cd.data.length; i += 4) {
    if (!cd.data[i + 3] && n) [cd.data[i], cd.data[i + 1], cd.data[i + 2]] = [r / n, gg / n, b / n];
    cd.data[i + 3] = 255;
  }
  cg.putImageData(cd, 0, 0);
  let acc = cur;
  for (let i = lv.length - 2; i >= 0; i--) {
    const o = canvas(lv[i].width, lv[i].height);
    const og = o.getContext('2d');
    og.drawImage(acc, 0, 0, o.width, o.height);
    og.drawImage(lv[i], 0, 0);
    acc = o;
  }
  // 補好的背景放大回照片尺寸；主體外面還是用原圖（清楚）
  const out = canvas(photo.width, photo.height);
  const g = out.getContext('2d');
  g.filter = 'blur(2px)';
  g.drawImage(acc, 0, 0, out.width, out.height);
  g.filter = 'none';
  const keep = canvas(photo.width, photo.height);
  const kg = keep.getContext('2d');
  kg.drawImage(photo, 0, 0);
  kg.globalCompositeOperation = 'destination-in';
  kg.drawImage(hole, 0, 0, out.width, out.height);
  g.drawImage(keep, 0, 0);
  return out;
}

// 浮在卡面上的一層（稀有度章、星星、名字帶）：3D 時比卡面更靠近你，底下有影子
function drawCardOver(item, rarity) {
  const { w: W, h: H } = CARD_PX;
  const rar = RARITY[rarity];
  const over = canvas(W, H);
  const g = over.getContext('2d');
  // 左上：稀有度章
  g.fillStyle = '#1c2340';
  roundRect(g, 26, 26, 128, 64, 20);
  g.fill();
  g.fillStyle = rar.color;
  roundRect(g, 31, 31, 118, 54, 16);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `40px ${FONT_NUM}`;
  g.fillText(rar.key, 90, 60);
  // 右上：星星
  g.font = `40px ${FONT_NUM}`;
  g.lineWidth = 7;
  g.strokeStyle = '#1c2340';
  g.lineJoin = 'round';
  const n = STARS[rarity];
  for (let i = 0; i < n; i++) {
    const x = W - 50 - i * 44;
    g.fillStyle = rarity >= 2 ? '#ffd23f' : '#ffffff';
    g.strokeText('★', x, 58);
    g.fillText('★', x, 58);
  }
  // 下方：名字帶
  g.fillStyle = 'rgba(28,35,64,0.9)';
  roundRect(g, 26, H - 104, W - 52, 76, 22);
  g.fill();
  g.fillStyle = '#ffffff';
  fitText(g, item.name, W - 100, 40, bodyFont(), '900');
  g.fillText(item.name, W / 2, H - 66);
  return over;
}

// 平面的全圖卡（台紙、截圖用）＝圖片層＋框層疊起來
export function drawTradingCard(item, thumb, rarity = item.rarity) {
  const L = drawCardLayers(item, thumb, rarity);
  const c = canvas(CARD_PX.w, CARD_PX.h);
  const g = c.getContext('2d');
  g.save();
  roundRect(g, CARD_WIN.x, CARD_WIN.y, CARD_WIN.w, CARD_WIN.h, 22);
  g.clip();
  g.drawImage(L.photo, CARD_WIN.x, CARD_WIN.y);
  g.restore();
  g.drawImage(L.frame, 0, 0);
  g.drawImage(L.over, 0, 0);
  return c;
}

// 主體遮罩（seg.js）→ 深度：主體＝前、背景＝後，邊緣模糊一點才不會切得太硬；混一點「中間比較前面」
export function depthFromMask(mask, ww, wh) {
  const out = canvas(128, Math.round((128 * wh) / ww));
  const g = out.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, out.width, out.height);
  g.filter = 'blur(2px)';
  drawCover(g, mask, 0, 0, out.width, out.height); // 跟照片一樣的裁切（照片也是 cover 進窗）
  g.filter = 'none';
  const grd = g.createRadialGradient(out.width / 2, out.height / 2, 0, out.width / 2, out.height / 2, out.height * 0.6);
  grd.addColorStop(0, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, out.width, out.height);
  return out;
}

// 從一張圖估深度（像 iPhone 的「空間照片」：主體在前、背景在後）
//   背景色＝四周一圈的平均色；跟背景差越多越「前面」；再混一點「中間比較前面」的假設；最後模糊成平滑的深度
export function estimateDepth(photo) {
  const w = 64;
  const h = Math.round((w * photo.height) / photo.width);
  const s = canvas(w, h);
  const sg = s.getContext('2d', { willReadFrequently: true });
  sg.drawImage(photo, 0, 0, w, h);
  const d = sg.getImageData(0, 0, w, h);
  const px = d.data;
  const band = Math.max(2, Math.round(w * 0.07));
  let br = 0, bgc = 0, bb = 0, bn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 4;
      br += px[i];
      bgc += px[i + 1];
      bb += px[i + 2];
      bn++;
    }
  }
  br /= bn;
  bgc /= bn;
  bb /= bn;
  const diff = new Float32Array(w * h);
  let max = 1e-3;
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4] - br, gg = px[i * 4 + 1] - bgc, b = px[i * 4 + 2] - bb;
    diff[i] = Math.sqrt(r * r + gg * gg + b * b);
    max = Math.max(max, diff[i]);
  }
  const sm = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const fg = sm(0.12, 0.42, diff[i] / max);
      const nx = (x / (w - 1)) * 2 - 1;
      const ny = (y / (h - 1)) * 2 - 1;
      const center = Math.max(0, 1 - (nx * nx + ny * ny) * 0.7);
      const v = Math.round(255 * Math.min(1, fg * 0.72 + center * 0.28));
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
      px[i * 4 + 3] = 255;
    }
  }
  sg.putImageData(d, 0, 0);
  const out = canvas(128, Math.round((128 * h) / w));
  const og = out.getContext('2d');
  og.filter = 'blur(4px)';
  og.drawImage(s, 0, 0, out.width, out.height);
  return out;
}

// 卡背：Gemini 的卡背圖（沒有字）＋描邊圓角；tier 2＝金箔、3＝彩虹（SR、SSR 從卡背就看得出來）
// 卡背：預設＝Gemini 畫的卡背圖；店家可以換自己的圖、加一行字、改邊框顏色（使用者 2026-10-26：「增加卡面的背面也可以編輯」）
//   back＝{ img（已解碼的圖）、text、color }；SR 金、SSR 彩虹（翻開前的稀有度暗示）照樣疊上去
export function drawCardBack(art, tier = 0, back = null) {
  const { w: W, h: H } = CARD_PX;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const edge = /^#[0-9a-f]{6}$/i.test(back?.color || '') ? back.color : '#1c2340';
  g.fillStyle = edge;
  roundRect(g, 0, 0, W, H, 34);
  g.fill();
  if (edge !== '#1c2340') {
    // 自己選的邊框色：外圈還是描一道深色線（跟其他東西一樣的 toon 描邊）
    g.lineWidth = 6;
    g.strokeStyle = '#1c2340';
    roundRect(g, 3, 3, W - 6, H - 6, 32);
    g.stroke();
  }
  const inset = edge !== '#1c2340' ? 22 : 10;
  g.save();
  roundRect(g, inset, inset, W - inset * 2, H - inset * 2, 26);
  g.clip();
  if (back?.img) drawCover(g, back.img, inset, inset, W - inset * 2, H - inset * 2);
  else if (art) drawCover(g, art, 10, 10, W - 20, H - 20);
  else {
    // 備用：藍色放射＋星星
    const grd = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, H * 0.7);
    grd.addColorStop(0, '#5aa0ff');
    grd.addColorStop(1, '#1f3f9e');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd23f';
    g.font = `220px ${FONT_NUM}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('★', W / 2, H / 2);
  }
  if (tier >= 2) {
    // 金：整張蓋一層金色（保留圖案明暗）；彩虹：斜向七彩
    g.globalCompositeOperation = 'color';
    if (tier === 2) g.fillStyle = '#e8a000';
    else {
      const rb = g.createLinearGradient(0, 0, W, H);
      ['#ff5a7a', '#ffb13b', '#ffe94a', '#52e08a', '#4cc3ff', '#9b6bff', '#ff5ad1'].forEach((col, i, a) => rb.addColorStop(i / (a.length - 1), col));
      g.fillStyle = rb;
    }
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
  if (back?.text) {
    // 一行字（店名之類）：下方的深色帶子
    const txt = String(back.text).slice(0, 16);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, txt, W - 120, 44, bodyFont(), '900');
    const tw = Math.min(W - 80, g.measureText(txt).width + 60);
    g.fillStyle = 'rgba(28, 35, 64, 0.88)';
    roundRect(g, (W - tw) / 2, H - 132, tw, 70, 35);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = tier >= 2 ? (tier === 3 ? '#fff6c8' : '#ffe08a') : '#ffffff';
    g.fillText(txt, W / 2, H - 96);
  }
  return c;
}

// 轉卡機的窗（直的 0.387 × 0.694 m）：台紙＝機台名稱＋獎品陣容（卡片小圖、兩欄）
export function drawBoard(cfg, thumbs) {
  const W = 560;
  const H = 1004;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#fffaf2');
  grd.addColorStop(1, '#ffe9c9');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255, 210, 63, 0.35)';
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.arc((i * 137) % W, (i * 271) % H, 18 + (i % 4) * 10, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(28,35,64,0.94)';
  roundRect(g, 24, 24, W - 48, 110, 30);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, cfg.name, W - 100, 52, FONT_DISPLAY);
  g.fillText(cfg.name, W / 2, 66);
  g.fillStyle = '#ffd23f';
  fitText(g, t('d.kinds', { n: cfg.items.length }), W - 100, 30, FONT_DISPLAY);
  g.fillText(t('d.kinds', { n: cfg.items.length }), W / 2, 112);
  // 欄數挑卡片最大的（1–3 欄），整組置中
  const n = Math.min(cfg.items.length, 9);
  const AW = W - 48;
  const AH = H - 156 - 60;
  const gap = 14;
  let best = null;
  for (let cols = 1; cols <= 3; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((AW - (cols - 1) * gap) / cols, ((AH - (rows - 1) * gap) / rows) * 0.686);
    if (!best || w > best.w) best = { cols, rows, w };
  }
  const { cols, rows, w } = best;
  const h = w / 0.686;
  const ox = 24 + (AW - (cols * w + (cols - 1) * gap)) / 2;
  const oy = 156 + (AH - (rows * h + (rows - 1) * gap)) / 2;
  for (let i = 0; i < n; i++) {
    const it = cfg.items[i];
    const cx = ox + (i % cols) * (w + gap);
    const cy = oy + Math.floor(i / cols) * (h + gap);
    const card = drawTradingCard(it, thumbs[i], it.rarity);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.25)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 4;
    g.drawImage(card, cx, cy, w, h);
    g.restore();
  }
  if (cfg.items.length > 9) {
    g.fillStyle = '#1c2340';
    g.font = `30px ${FONT_DISPLAY}`;
    g.fillText(t('d.more', { n: cfg.items.length - 9 }), W / 2, H - 30);
  }
  return c;
}

// 機身側面（下段 0.70 × 0.60 m，上段 0.26 × 0.52 m）：直接用 Gemini 插畫，四周留圓角
export function drawSide(art, w, h, theme) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  roundRect(g, 0, 0, w, h, Math.min(w, h) * 0.08);
  g.clip();
  if (art) drawCover(g, art, 0, 0, w, h);
  else {
    g.fillStyle = theme.lid;
    g.fillRect(0, 0, w, h);
  }
  return c;
}
