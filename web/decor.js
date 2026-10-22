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
