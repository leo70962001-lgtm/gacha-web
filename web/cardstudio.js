// カード工房（使用者 2026-10-28：「追加一個卡片 編輯 以遊戲王的卡牌型式為主可以編輯邊框等等還有家音樂的功能 做完後可以追加到抽卡機裡」）
//   卡面照現行的對戰卡配置（自己畫的框，沒有官方標誌）：上面卡名＋屬性圓章 → 等級星（超量＝左邊黑星、連結＝沒有）／魔法陷阱的種類
//   → 正方形卡圖（連結卡四周 8 個箭頭）→ 卡號 → 效果欄（【種族／類型】＋效果文字，自動縮字）→ ATK／DEF（連結：LINK-n）→ 密碼、版權
//   可以改：卡片種類（框的顏色）、外框（黑金銀白）、自訂框色、名字顏色（自動照稀有度：R 銀、SR 金、SSR 彩虹）
//   做好 → 整張卡畫成一張圖（360×525）當轉卡機的獎品照片，item.framed＝這張圖本身就是完整的卡面（機台、結果卡、收集簿不再加框跟名字牌）
//         設計（含原始卡圖）存在本機草稿的 item.design，可以再打開來改；音樂＝獎品的影音（預設曲、上傳、網址）
const W0 = 590; // 卡面的基準寬（59 × 86 mm → 590 × 860）
const H0 = 860;
export const CARD_OUT = [360, 525]; // 放進機台的大小

// 卡片種類：框的底色（亮、暗）、名字預設顏色
export const TYPES = {
  normal: { c: ['#e8c983', '#c99b4a'], name: '#111' },
  effect: { c: ['#e39a5b', '#b8642c'], name: '#111' },
  ritual: { c: ['#8fb2e6', '#4c78c2'], name: '#111' },
  fusion: { c: ['#b98fd3', '#7d4fa0'], name: '#111' },
  synchro: { c: ['#f6f6f4', '#c9c9c4'], name: '#111' },
  xyz: { c: ['#4a4a4f', '#18181b'], name: '#fff' },
  link: { c: ['#3d78c4', '#173f7c'], name: '#fff' },
  token: { c: ['#b9b9b9', '#7f7f84'], name: '#111' },
  spell: { c: ['#2fb3a0', '#127566'], name: '#fff' },
  trap: { c: ['#cf5a98', '#8e2763'], name: '#fff' },
};
export const TYPE_KEYS = Object.keys(TYPES);
export const isST = (ty) => ty === 'spell' || ty === 'trap';
// 屬性圓章：顏色＋中文／日文一個字、英文縮寫
export const ATTRS = {
  light: { c: ['#fff4b0', '#d9a91a'], zh: '光', ja: '光', en: 'LIGHT' },
  dark: { c: ['#d6a8f0', '#5b2a86'], zh: '闇', ja: '闇', en: 'DARK' },
  fire: { c: ['#ffb08a', '#c9301c'], zh: '炎', ja: '炎', en: 'FIRE' },
  water: { c: ['#a8dcff', '#1d6fc4'], zh: '水', ja: '水', en: 'WATER' },
  earth: { c: ['#e3c69a', '#7a5524'], zh: '地', ja: '地', en: 'EARTH' },
  wind: { c: ['#b9f2a8', '#2f9a3a'], zh: '風', ja: '風', en: 'WIND' },
  divine: { c: ['#ffe9a8', '#c27a10'], zh: '神', ja: '神', en: 'DIVINE' },
};
export const ATTR_KEYS = Object.keys(ATTRS);
const ST_ATTR = { spell: { c: ['#8ff0de', '#127566'], zh: '魔', ja: '魔', en: 'SPELL' }, trap: { c: ['#ffa8d2', '#8e2763'], zh: '罠', ja: '罠', en: 'TRAP' } };
export const ICONS = ['none', 'quick', 'continuous', 'equip', 'field', 'ritual', 'counter']; // 魔法陷阱的種類
export const BORDERS = ['black', 'gold', 'silver', 'white'];
export const NAME_STYLES = ['auto', 'black', 'white', 'silver', 'gold', 'rainbow'];

const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b % 10).join('');
export function defaultDesign(t) {
  return {
    type: 'effect', name: t('cs.sampleName'), attr: 'dark', level: 4, arrows: [0, 0, 0, 0, 0, 0, 0, 0], icon: 'none',
    border: 'black', frame: '', nameStyle: 'auto', race: t('cs.sampleRace'), text: t('cs.sampleText'),
    atk: '2500', def: '2000', set: 'CLTR-' + rand(3), pass: rand(8), rarity: 1, art: null,
    // 寶可夢風
    style: 'duel', mtype: 'lightning', mborder: 'yellow', stage: 'basic', efrom: '', hp: '90',
    ability: { on: false, name: t('cs.sAbil'), text: t('cs.sAbilText') },
    attacks: [
      { on: true, cost: ['colorless'], name: t('cs.sAtk1'), dmg: '20', text: '' },
      { on: true, cost: ['lightning', 'colorless', 'colorless'], name: t('cs.sAtk2'), dmg: '70+', text: t('cs.sAtk2Text') },
    ],
    weak: 'fighting', resist: '', retreat: 1,
    info: t('cs.sInfo'), flavor: t('cs.sFlavor'), illus: 'Clatter', setno: '001/100',
  };
}

// ---------- 畫卡 ----------
const canvasOf = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}
function seeded(seed) {
  let s = seed >>> 0 || 7;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const SERIF = '"Noto Serif TC", "Noto Serif JP", "Songti TC", "MS Mincho", serif';
const SANS = '"Noto Sans TC", "Noto Sans JP", system-ui, sans-serif';
export async function studioFonts() {
  await Promise.all(['900 40px "Noto Serif TC"', '700 20px "Noto Serif TC"', '400 18px "Noto Sans TC"'].map((f) => document.fonts?.load?.(f).catch(() => {})));
}

// 文字太長：橫向壓扁（像真的卡），最多壓到 55%
function fitX(g, text, x, y, maxW, align = 'left') {
  const w = g.measureText(text).width;
  const k = w > maxW ? Math.max(0.55, maxW / w) : 1;
  g.save();
  g.translate(x, y);
  g.scale(k, 1);
  g.textAlign = align;
  g.fillText(text, 0, 0);
  g.restore();
  return k;
}
// 換行（中日文一個字一個字斷、英文照空白斷）
function wrap(g, text, maxW) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    const tokens = para.match(/[A-Za-z0-9'’\-.,:;!?()/]+\s*|\s+|./gu) || [''];
    for (const tok of tokens) {
      const next = line + tok;
      if (g.measureText(next).width > maxW && line) {
        out.push(line.trimEnd());
        line = tok.trimStart();
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function star(g, cx, cy, r, fill) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr2 = i % 2 ? r * 0.45 : r;
    g.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
  }
  g.closePath();
  const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  gr.addColorStop(0, fill[0]);
  gr.addColorStop(1, fill[1]);
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = r * 0.12;
  g.strokeStyle = '#5a1a00';
  g.stroke();
}
function orb(g, cx, cy, r, a, lang) {
  const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  gr.addColorStop(0, a.c[0]);
  gr.addColorStop(1, a.c[1]);
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = r * 0.12;
  g.strokeStyle = '#3a2a10';
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  g.lineWidth = r * 0.05;
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.stroke();
  const label = a[lang] || a.en;
  g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = r * 0.14;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (label.length === 1) {
    g.font = `900 ${r * 1.15}px ${SERIF}`;
    g.strokeText(label, cx, cy + r * 0.05);
    g.fillText(label, cx, cy + r * 0.05);
  } else {
    g.font = `900 ${r * 0.42}px ${SERIF}`;
    g.strokeText(label, cx, cy, r * 1.6);
    g.fillText(label, cx, cy, r * 1.6);
  }
  g.textBaseline = 'alphabetic';
}
// 魔法陷阱種類的小圖示（方框裡畫符號）
function stIcon(g, x, y, s, icon, col) {
  g.save();
  g.fillStyle = '#fff';
  g.strokeStyle = col;
  g.lineWidth = s * 0.08;
  rr(g, x, y, s, s, s * 0.15);
  g.fill();
  g.stroke();
  g.fillStyle = g.strokeStyle = col;
  const cx = x + s / 2;
  const cy = y + s / 2;
  g.lineWidth = s * 0.11;
  g.lineCap = 'round';
  g.beginPath();
  if (icon === 'quick') {
    g.moveTo(cx + s * 0.12, y + s * 0.15);
    g.lineTo(cx - s * 0.18, cy + s * 0.05);
    g.lineTo(cx + s * 0.05, cy + s * 0.05);
    g.lineTo(cx - s * 0.12, y + s * 0.85);
    g.lineTo(cx + s * 0.2, cy - s * 0.08);
    g.lineTo(cx - s * 0.02, cy - s * 0.08);
    g.closePath();
    g.fill();
  } else if (icon === 'continuous') {
    g.ellipse(cx - s * 0.15, cy, s * 0.17, s * 0.13, 0, 0, Math.PI * 2);
    g.moveTo(cx + s * 0.32, cy);
    g.ellipse(cx + s * 0.15, cy, s * 0.17, s * 0.13, 0, 0, Math.PI * 2);
    g.stroke();
  } else if (icon === 'equip') {
    g.moveTo(cx, y + s * 0.2);
    g.lineTo(cx, y + s * 0.8);
    g.moveTo(x + s * 0.2, cy);
    g.lineTo(x + s * 0.8, cy);
    g.stroke();
  } else if (icon === 'field') {
    g.arc(cx, cy, s * 0.28, 0, Math.PI * 2);
    g.moveTo(cx, y + s * 0.12);
    g.lineTo(cx, y + s * 0.88);
    g.moveTo(x + s * 0.12, cy);
    g.lineTo(x + s * 0.88, cy);
    g.stroke();
  } else if (icon === 'ritual') {
    g.moveTo(cx, y + s * 0.14);
    g.bezierCurveTo(cx + s * 0.4, cy, cx + s * 0.22, y + s * 0.86, cx, y + s * 0.86);
    g.bezierCurveTo(cx - s * 0.22, y + s * 0.86, cx - s * 0.4, cy, cx, y + s * 0.14);
    g.fill();
  } else if (icon === 'counter') {
    g.moveTo(x + s * 0.75, y + s * 0.3);
    g.arc(cx, cy, s * 0.28, -0.6, Math.PI * 1.25, false);
    g.stroke();
    g.beginPath();
    g.moveTo(x + s * 0.82, y + s * 0.14);
    g.lineTo(x + s * 0.82, y + s * 0.42);
    g.lineTo(x + s * 0.54, y + s * 0.36);
    g.closePath();
    g.fill();
  }
  g.restore();
}
// 名字的顏色：自動＝照卡片種類（暗框白字、亮框黑字），稀有度 R 銀、SR 金、SSR 彩虹
function nameFill(g, d, x, y, w) {
  let st = d.nameStyle;
  if (!st || st === 'auto') st = ['', 'silver', 'gold', 'rainbow'][d.rarity | 0] || '';
  if (!st || st === 'black' || st === 'white') return st === 'white' ? '#fff' : st === 'black' ? '#111' : TYPES[d.type].name;
  const gr = g.createLinearGradient(x, y - 40, x + w, y);
  const stops = {
    silver: ['#8d939c', '#f4f6fa', '#a7adb6', '#ffffff', '#7d838c'],
    gold: ['#8a5a0a', '#ffe9a0', '#c8901c', '#fff3c8', '#9a6a10'],
    rainbow: ['#ff9ab8', '#ffe68a', '#a8ffb8', '#8ad8ff', '#d2a8ff'],
  }[st];
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
}

const ARROW_POS = [
  // 左上、上、右上、左、右、左下、下、右下（卡圖框外面）
  [62, 150, -135], [295, 142, -90], [528, 150, -45], [54, 383, 180], [536, 383, 0], [62, 616, 135], [295, 624, 90], [528, 616, 45],
];
const ART = { x: 70, y: 158, s: 450 }; // 卡圖（正方形）

// d＝設計、art＝卡圖（Image／Canvas／ImageBitmap，沒有就畫空白）、W＝輸出寬 → canvas
export function drawDesignCard(d, art, W = W0, lang = 'zh') {
  if (d.style === 'monster') return drawMonsterCard(d, art, W, lang);
  const k = W / W0;
  const c = canvasOf(Math.round(W), Math.round(W * (H0 / W0)));
  const g = c.getContext('2d');
  g.scale(k, k);
  const ty = TYPES[d.type] ? d.type : 'effect';
  const base = /^#[0-9a-f]{6}$/i.test(d.frame || '') ? [shade(d.frame, 0.25), shade(d.frame, -0.3)] : TYPES[ty].c;
  // 外框
  const bc = { black: ['#2a2a2e', '#0b0b0d'], gold: ['#fff1b8', '#a8740e'], silver: ['#ffffff', '#8a909a'], white: ['#ffffff', '#d9d9d6'] }[d.border] || ['#2a2a2e', '#0b0b0d'];
  let gr = g.createLinearGradient(0, 0, W0, H0);
  gr.addColorStop(0, bc[0]);
  gr.addColorStop(0.5, bc[1]);
  gr.addColorStop(1, bc[0]);
  g.fillStyle = gr;
  rr(g, 0, 0, W0, H0, 22);
  g.fill();
  // 卡框：底色漸層＋細細的斑紋＋斜紋
  gr = g.createLinearGradient(0, 18, W0, H0 - 18);
  gr.addColorStop(0, base[0]);
  gr.addColorStop(0.55, base[1]);
  gr.addColorStop(1, base[0]);
  g.fillStyle = gr;
  rr(g, 16, 16, W0 - 32, H0 - 32, 8);
  g.fill();
  g.save();
  rr(g, 16, 16, W0 - 32, H0 - 32, 8);
  g.clip();
  const rnd = seeded(7);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
    g.fillRect(16 + rnd() * (W0 - 32), 16 + rnd() * (H0 - 32), 1 + rnd() * 3, 1 + rnd() * 3);
  }
  g.globalAlpha = 0.06;
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  for (let x = -H0; x < W0; x += 14) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x + H0, H0);
    g.stroke();
  }
  g.restore();
  const bevel = (x, y, w, h, r, dark = false) => {
    g.save();
    g.lineWidth = 3;
    g.strokeStyle = dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)';
    rr(g, x - 1.5, y - 1.5, w + 3, h + 3, r);
    g.stroke();
    g.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.5)';
    rr(g, x + 1.5, y + 1.5, w - 3, h - 3, r);
    g.stroke();
    g.restore();
  };
  // 卡名欄
  const nb = { x: 36, y: 34, w: 518, h: 66 };
  gr = g.createLinearGradient(0, nb.y, 0, nb.y + nb.h);
  gr.addColorStop(0, shade(base[0], 0.15));
  gr.addColorStop(1, shade(base[1], -0.05));
  g.fillStyle = gr;
  rr(g, nb.x, nb.y, nb.w, nb.h, 4);
  g.fill();
  bevel(nb.x, nb.y, nb.w, nb.h, 4, true);
  g.textBaseline = 'alphabetic';
  g.font = `900 46px ${SERIF}`;
  g.fillStyle = nameFill(g, d, nb.x, nb.y + 50, 420);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 2;
  g.shadowOffsetY = 1;
  fitX(g, d.name || ' ', nb.x + 14, nb.y + 50, 420);
  g.restore();
  // 屬性圓章
  const st = isST(ty);
  orb(g, 512, nb.y + nb.h / 2, 30, st ? ST_ATTR[ty] : ATTRS[d.attr] || ATTRS.dark, lang === 'en' ? 'en' : lang);
  // 等級星／魔法陷阱種類
  if (st) {
    // 【魔法カード ⚡】：字、圖示、右括號分開排（靠右）
    const left = `【${lang === 'en' ? (ty === 'spell' ? 'SPELL CARD' : 'TRAP CARD') : lang === 'ja' ? (ty === 'spell' ? '魔法カード' : '罠カード') : ty === 'spell' ? '魔法卡' : '陷阱卡'}`;
    const icon = d.icon && d.icon !== 'none';
    g.font = `900 30px ${SERIF}`;
    g.fillStyle = '#111';
    const wl = g.measureText(left).width;
    const wr = g.measureText('】').width;
    const x0 = 534 - (wl + (icon ? 38 : 0) + wr);
    g.fillText(left, x0, 142);
    if (icon) stIcon(g, x0 + wl + 4, 116, 30, d.icon, ty === 'spell' ? '#127566' : '#c0285a');
    g.fillText('】', x0 + wl + (icon ? 38 : 0), 142);
  } else if (ty !== 'link') {
    const n = Math.max(1, Math.min(12, d.level | 0 || 1));
    const xyz = ty === 'xyz';
    for (let i = 0; i < n; i++) {
      const cx = xyz ? 64 + i * 38.5 : 526 - i * 38.5;
      star(g, cx, 130, 17, xyz ? ['#c7c7c7', '#1a1a1a'] : ['#ffe27a', '#e04a00']);
    }
  }
  // 卡圖＋框
  g.fillStyle = shade(base[1], -0.35);
  g.fillRect(ART.x - 8, ART.y - 8, ART.s + 16, ART.s + 16);
  bevel(ART.x - 8, ART.y - 8, ART.s + 16, ART.s + 16, 2);
  g.save();
  g.beginPath();
  g.rect(ART.x, ART.y, ART.s, ART.s);
  g.clip();
  if (art) {
    const s = Math.max(ART.s / art.width, ART.s / art.height);
    g.drawImage(art, ART.x + (ART.s - art.width * s) / 2, ART.y + (ART.s - art.height * s) / 2, art.width * s, art.height * s);
  } else {
    gr = g.createLinearGradient(ART.x, ART.y, ART.x + ART.s, ART.y + ART.s);
    gr.addColorStop(0, '#dfe6ee');
    gr.addColorStop(1, '#aab6c4');
    g.fillStyle = gr;
    g.fillRect(ART.x, ART.y, ART.s, ART.s);
  }
  g.restore();
  bevel(ART.x, ART.y, ART.s, ART.s, 0, true);
  // 連結箭頭
  if (ty === 'link') {
    ARROW_POS.forEach(([x, y, deg], i) => {
      g.save();
      g.translate(x, y);
      g.rotate((deg * Math.PI) / 180);
      g.beginPath();
      g.moveTo(18, 0);
      g.lineTo(-8, -15);
      g.lineTo(-8, 15);
      g.closePath();
      g.fillStyle = d.arrows?.[i] ? '#ff3b2f' : '#3a3f4a';
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = '#111';
      g.stroke();
      g.restore();
    });
  }
  // 卡號（卡圖右下）
  g.font = `700 18px ${SANS}`;
  g.fillStyle = TYPES[ty].name === '#fff' && !/^#[0-9a-f]{6}$/i.test(d.frame || '') ? '#f2f2f2' : '#111';
  g.textAlign = 'right';
  g.fillText(d.set || '', ty === 'link' ? 482 : 522, 642);
  g.textAlign = 'left';
  // 效果欄
  const tb = { x: 34, y: 652, w: 522, h: 160 };
  gr = g.createLinearGradient(tb.x, tb.y, tb.x + tb.w, tb.y + tb.h);
  gr.addColorStop(0, '#f1e6cc');
  gr.addColorStop(1, '#e2d2ad');
  g.fillStyle = gr;
  g.fillRect(tb.x, tb.y, tb.w, tb.h);
  bevel(tb.x, tb.y, tb.w, tb.h, 0, true);
  g.fillStyle = '#111';
  let y = tb.y + 26;
  if (!st) {
    g.font = `900 22px ${SERIF}`;
    fitX(g, `【${d.race || ''}】`, tb.x + 10, y, tb.w - 20);
    y += 6;
  } else y -= 18;
  // 效果文字：放得下就用大一點的字
  const bottom = st ? tb.y + tb.h - 10 : tb.y + tb.h - 36;
  const normalFlavor = ty === 'normal';
  let fs = 19;
  let lines;
  for (; fs >= 10; fs -= 1) {
    g.font = `${normalFlavor ? 'italic ' : ''}400 ${fs}px ${SANS}`;
    lines = wrap(g, d.text, tb.w - 22);
    if (y + lines.length * fs * 1.22 <= bottom) break;
  }
  for (const ln of lines) {
    y += fs * 1.22;
    if (y > bottom + 2) break;
    g.fillText(ln, tb.x + 11, y);
  }
  // ATK／DEF（連結：LINK-n）
  if (!st) {
    g.strokeStyle = '#111';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(tb.x + 10, tb.y + tb.h - 32);
    g.lineTo(tb.x + tb.w - 10, tb.y + tb.h - 32);
    g.stroke();
    g.font = `900 22px ${SERIF}`;
    g.textAlign = 'right';
    const lk = (d.arrows || []).filter(Boolean).length;
    g.fillText(ty === 'link' ? `ATK/${d.atk || '?'}   LINK-${lk}` : `ATK/${d.atk || '?'}  DEF/${d.def || '?'}`, tb.x + tb.w - 12, tb.y + tb.h - 9);
    g.textAlign = 'left';
  }
  // 最下面：密碼、版權、角落的防偽小方塊
  const dark = TYPES[ty].name === '#fff' || d.border === 'black';
  g.font = `400 15px ${SANS}`;
  g.fillStyle = TYPES[ty].name === '#fff' ? '#f2f2f2' : '#111';
  g.fillText(d.pass || '', 40, 834);
  g.textAlign = 'right';
  g.fillText('© Clatter', 518, 834);
  g.textAlign = 'left';
  gr = g.createLinearGradient(526, 818, 548, 840);
  gr.addColorStop(0, '#f4f6fa');
  gr.addColorStop(0.5, '#9aa1ae');
  gr.addColorStop(1, '#ffffff');
  g.fillStyle = gr;
  g.fillRect(527, 819, 22, 22);
  void dark;
  return c;
}

// 3D 卡（cardkit）用的深度：框在前面、卡圖往後退一點（像隔著窗看）；style＝'duel'（正方形卡圖）／'monster'（橫的卡圖）
export function framedDepth(style = 'duel', w = 64) {
  const A = style === 'monster' ? { x: ART_M.x, y: ART_M.y, w: ART_M.w, h: ART_M.h } : { x: ART.x, y: ART.y, w: ART.s, h: ART.s };
  const h = Math.round((w * H0) / W0);
  const c = canvasOf(w, h);
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(165,165,165)';
  g.fillRect(0, 0, w, h);
  g.filter = 'blur(1px)';
  g.fillStyle = 'rgb(95,95,95)';
  g.fillRect((A.x / W0) * w, (A.y / H0) * h, (A.w / W0) * w, (A.h / H0) * h);
  return c;
}


// ---------- 寶可夢風（使用者 2026-10-28：「再增加不只是遊戲王還有寶可夢卡牌 讓用戶可以做出自己的戰鬥卡牌」） ----------
//   自己畫的「怪獸對戰卡」：上面 進化階段＋名字＋HP＋屬性章 → 橫的卡圖（金框）→ 圖鑑資料帶 → 特性／招式（能量、名字、傷害、說明）
//   → 弱點、抵抗力、撤退 → 繪師、卡片編號、稀有度記號＋圖鑑說明。框色照屬性（能量）；沒有官方標誌、寶貝球
export const MTYPES = {
  grass: { c: ['#e4f6c8', '#74c250'], g: '#3f9b3a' },
  fire: { c: ['#ffdcc6', '#ec6d3c'], g: '#e0452b' },
  water: { c: ['#d9eeff', '#4c9fe6'], g: '#2a86d8' },
  lightning: { c: ['#fff7bf', '#f3c623'], g: '#f2c014', dark: true },
  psychic: { c: ['#f1deff', '#b066db'], g: '#9a4fc9' },
  fighting: { c: ['#f6dfc6', '#c87e40'], g: '#b8652a' },
  darkness: { c: ['#7d8794', '#262d36'], g: '#2b3540', text: '#fff' },
  metal: { c: ['#f2f4f7', '#a4acb7'], g: '#8a939e' },
  dragon: { c: ['#f4e9b8', '#c1a43f'], g: '#a8892a' },
  colorless: { c: ['#ffffff', '#dddcd4'], g: '#c9c9c2', dark: true },
  fairy: { c: ['#ffe3f2', '#e87fb6'], g: '#e05ea3' },
};
export const MTYPE_KEYS = Object.keys(MTYPES);
export const STAGES = ['basic', 'stage1', 'stage2'];
export const MBORDERS = ['yellow', 'silver', 'gold', 'black'];
export const STYLES = ['duel', 'monster'];
const ART_M = { x: 48, y: 108, w: 494, h: 336 }; // 寶可夢風的卡圖（橫的）

// 能量記號：圓章＋白色圖案（雷、無色是深色圖案）
export function energy(g, cx, cy, r, type) {
  const t = MTYPES[type] || MTYPES.colorless;
  const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  gr.addColorStop(0, shade(t.g, 0.35));
  gr.addColorStop(1, t.g);
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = r * 0.12;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.stroke();
  g.translate(cx, cy);
  const ink = t.dark ? '#2b2b2b' : '#fff';
  g.fillStyle = g.strokeStyle = ink;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  const u = r;
  switch (type) {
    case 'grass':
      g.save();
      g.rotate(-Math.PI / 4);
      g.ellipse(0, -u * 0.05, u * 0.28, u * 0.52, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.lineWidth = u * 0.1;
      g.strokeStyle = t.g;
      g.beginPath();
      g.moveTo(-u * 0.3, u * 0.3);
      g.lineTo(u * 0.22, -u * 0.22);
      g.stroke();
      break;
    case 'fire':
      g.moveTo(0, -u * 0.62);
      g.bezierCurveTo(u * 0.55, -u * 0.1, u * 0.5, u * 0.55, 0, u * 0.58);
      g.bezierCurveTo(-u * 0.5, u * 0.55, -u * 0.5, -u * 0.05, -u * 0.12, -u * 0.2);
      g.bezierCurveTo(-u * 0.05, 0, u * 0.05, -u * 0.3, 0, -u * 0.62);
      g.fill();
      break;
    case 'water':
      g.moveTo(0, -u * 0.62);
      g.bezierCurveTo(u * 0.25, -u * 0.25, u * 0.45, u * 0.05, u * 0.42, u * 0.22);
      g.arc(0, u * 0.22, u * 0.42, 0, Math.PI);
      g.bezierCurveTo(-u * 0.45, u * 0.05, -u * 0.25, -u * 0.25, 0, -u * 0.62);
      g.fill();
      break;
    case 'lightning':
      g.moveTo(u * 0.12, -u * 0.62);
      g.lineTo(-u * 0.32, u * 0.08);
      g.lineTo(-u * 0.02, u * 0.08);
      g.lineTo(-u * 0.14, u * 0.62);
      g.lineTo(u * 0.34, -u * 0.12);
      g.lineTo(u * 0.04, -u * 0.12);
      g.closePath();
      g.fill();
      break;
    case 'psychic':
      g.lineWidth = u * 0.11;
      g.moveTo(-u * 0.55, 0);
      g.quadraticCurveTo(0, -u * 0.55, u * 0.55, 0);
      g.quadraticCurveTo(0, u * 0.55, -u * 0.55, 0);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, u * 0.18, 0, Math.PI * 2);
      g.fill();
      break;
    case 'fighting':
      g.roundRect(-u * 0.42, -u * 0.32, u * 0.84, u * 0.66, u * 0.16);
      g.fill();
      g.strokeStyle = t.g;
      g.lineWidth = u * 0.07;
      g.beginPath();
      for (const x of [-0.14, 0.14]) {
        g.moveTo(u * x, -u * 0.32);
        g.lineTo(u * x, u * 0.02);
      }
      g.moveTo(-u * 0.42, u * 0.02);
      g.lineTo(u * 0.42, u * 0.02);
      g.stroke();
      break;
    case 'darkness':
      g.arc(0, 0, u * 0.52, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.fillStyle = t.g;
      g.arc(u * 0.24, -u * 0.16, u * 0.46, 0, Math.PI * 2);
      g.fill();
      break;
    case 'metal':
      for (let i = 0; i < 8; i++) {
        g.save();
        g.rotate((i * Math.PI) / 4);
        g.fillRect(-u * 0.1, -u * 0.62, u * 0.2, u * 0.25);
        g.restore();
      }
      g.arc(0, 0, u * 0.44, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.fillStyle = t.g;
      g.arc(0, 0, u * 0.18, 0, Math.PI * 2);
      g.fill();
      break;
    case 'dragon':
      g.lineWidth = u * 0.14;
      for (const o of [-0.3, 0, 0.3]) {
        g.moveTo(-u * 0.35 + u * o, u * 0.45);
        g.quadraticCurveTo(-u * 0.05 + u * o, 0, u * 0.3 + u * o, -u * 0.5);
      }
      g.stroke();
      break;
    case 'fairy':
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 4;
        const rr2 = i % 2 ? u * 0.18 : u * 0.6;
        g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
      }
      g.closePath();
      g.fill();
      break;
    default: // colorless：六角星
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 6;
        const rr2 = i % 2 ? u * 0.26 : u * 0.58;
        g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
      }
      g.closePath();
      g.fill();
  }
  g.restore();
}

const MT = {
  stage: { zh: ['基礎', '1階進化', '2階進化'], ja: ['たね', '1進化', '2進化'], en: ['BASIC', 'STAGE 1', 'STAGE 2'] },
  efrom: { zh: '由{n}進化', ja: '{n}から進化', en: 'Evolves from {n}' },
  ability: { zh: '特性', ja: '特性', en: 'Ability' },
  weak: { zh: '弱點', ja: '弱点', en: 'weakness' },
  resist: { zh: '抵抗力', ja: '抵抗力', en: 'resistance' },
  retreat: { zh: '撤退', ja: 'にげる', en: 'retreat' },
};
const mt = (k, lang) => MT[k][lang] || MT[k].en;

// 寶可夢風的卡面（基準 590×860，跟遊戲王風一樣大，放進機台不用改）
export function drawMonsterCard(d, art, W = W0, lang = 'zh') {
  const k = W / W0;
  const c = canvasOf(Math.round(W), Math.round(W * (H0 / W0)));
  const g = c.getContext('2d');
  g.scale(k, k);
  const ty = MTYPES[d.mtype] || MTYPES.colorless;
  const ink = ty.text || '#151515';
  const base = /^#[0-9a-f]{6}$/i.test(d.frame || '') ? [shade(d.frame, 0.55), shade(d.frame, 0)] : ty.c;
  // 外框（黃、銀、金、黑）
  const bc = { yellow: ['#fff08a', '#e8b414'], silver: ['#ffffff', '#a6acb6'], gold: ['#fff2b8', '#b8860b'], black: ['#3a3a3e', '#0d0d0f'] }[d.mborder] || ['#fff08a', '#e8b414'];
  let gr = g.createLinearGradient(0, 0, W0, H0);
  gr.addColorStop(0, bc[0]);
  gr.addColorStop(0.5, bc[1]);
  gr.addColorStop(1, bc[0]);
  g.fillStyle = gr;
  rr(g, 0, 0, W0, H0, 28);
  g.fill();
  // 卡身：屬性色（上面濃、下面淡）＋斜的光紋＋細斑
  gr = g.createLinearGradient(0, 16, 0, H0 - 16);
  gr.addColorStop(0, base[1]);
  gr.addColorStop(0.45, base[0]);
  gr.addColorStop(1, base[1]);
  g.fillStyle = gr;
  rr(g, 16, 16, W0 - 32, H0 - 32, 16);
  g.fill();
  g.save();
  rr(g, 16, 16, W0 - 32, H0 - 32, 16);
  g.clip();
  const rnd = seeded(11);
  g.globalAlpha = 0.12;
  for (let i = 0; i < 9; i++) {
    const x = rnd() * W0;
    const sh = g.createLinearGradient(x - 80, 0, x + 80, H0);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(0.5, '#fff');
    sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh;
    g.beginPath();
    g.moveTo(x - 40, 0);
    g.lineTo(x + 40, 0);
    g.lineTo(x + 240, H0);
    g.lineTo(x + 160, H0);
    g.fill();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 700; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    g.fillRect(16 + rnd() * (W0 - 32), 16 + rnd() * (H0 - 32), 1 + rnd() * 2, 1 + rnd() * 2);
  }
  g.restore();
  // 進化階段（左上的小牌子）
  const stI = Math.max(0, STAGES.indexOf(d.stage));
  g.font = `italic 900 17px ${SANS}`;
  const stLabel = mt('stage', lang)[stI];
  const pw = g.measureText(stLabel).width + 26;
  gr = g.createLinearGradient(0, 28, 0, 54);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(1, '#b9bec7');
  g.fillStyle = gr;
  rr(g, 30, 28, pw, 24, 12);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.stroke();
  g.fillStyle = '#222';
  g.fillText(stLabel, 43, 46);
  if (stI > 0 && d.efrom) {
    g.font = `italic 700 14px ${SANS}`;
    g.fillStyle = ink;
    fitX(g, mt('efrom', lang).replace('{n}', d.efrom), 40 + pw, 46, 260);
  }
  // 名字
  g.font = `900 40px ${SANS}`;
  g.fillStyle = nameFillM(g, d, ink);
  fitX(g, d.name || ' ', 36, 88, 320);
  // HP＋屬性章
  g.textAlign = 'right';
  g.fillStyle = ink;
  g.font = `900 40px ${SANS}`;
  const hp = String(d.hp || '').slice(0, 4);
  g.fillText(hp, 494, 88);
  const hw = g.measureText(hp).width;
  g.font = `900 18px ${SANS}`;
  g.fillText('HP', 494 - hw - 4, 88);
  g.textAlign = 'left';
  energy(g, 528, 72, 23, d.mtype);
  // 卡圖＋金框
  gr = g.createLinearGradient(ART_M.x, ART_M.y, ART_M.x + ART_M.w, ART_M.y + ART_M.h);
  ['#fff2b8', '#c9962a', '#fff5cc', '#b07d18', '#ffe9a0'].forEach((col, i, a) => gr.addColorStop(i / (a.length - 1), col));
  g.fillStyle = gr;
  g.fillRect(ART_M.x - 8, ART_M.y - 8, ART_M.w + 16, ART_M.h + 16);
  g.save();
  g.beginPath();
  g.rect(ART_M.x, ART_M.y, ART_M.w, ART_M.h);
  g.clip();
  if (art) {
    const s = Math.max(ART_M.w / art.width, ART_M.h / art.height);
    g.drawImage(art, ART_M.x + (ART_M.w - art.width * s) / 2, ART_M.y + (ART_M.h - art.height * s) / 2, art.width * s, art.height * s);
  } else {
    const ag = g.createLinearGradient(ART_M.x, ART_M.y, ART_M.x, ART_M.y + ART_M.h);
    ag.addColorStop(0, '#e9f3ff');
    ag.addColorStop(1, '#b8cbe0');
    g.fillStyle = ag;
    g.fillRect(ART_M.x, ART_M.y, ART_M.w, ART_M.h);
  }
  g.restore();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeRect(ART_M.x, ART_M.y, ART_M.w, ART_M.h);
  // 圖鑑資料帶（斜的緞帶）
  gr = g.createLinearGradient(70, 0, 520, 0);
  gr.addColorStop(0, '#d9b34a');
  gr.addColorStop(0.5, '#fff0b8');
  gr.addColorStop(1, '#d9b34a');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(82, 454);
  g.lineTo(518, 454);
  g.lineTo(508, 478);
  g.lineTo(72, 478);
  g.closePath();
  g.fill();
  g.fillStyle = '#3a2a00';
  g.font = `italic 700 14px ${SANS}`;
  g.textAlign = 'center';
  fitX(g, d.info || '', 295, 471, 420, 'center');
  g.textAlign = 'left';
  // 特性＋招式：放得下就用大字，放不下整塊一起縮
  const top = 490;
  const bottom = 726;
  const atks = (d.attacks || []).filter((a) => a?.on);
  const abil = d.ability?.on ? d.ability : null;
  const layout = (s, draw) => {
    let y = top;
    const tw = 500;
    if (abil) {
      y += 30 * s;
      if (draw) {
        g.fillStyle = '#d6332a';
        g.font = `italic 900 ${16 * s}px ${SANS}`;
        const lw = g.measureText(mt('ability', lang)).width + 20 * s;
        rr(g, 40, y - 21 * s, lw, 26 * s, 6 * s);
        g.fill();
        g.fillStyle = '#fff';
        g.fillText(mt('ability', lang), 50, y - 2 * s);
        g.fillStyle = '#c62a22';
        g.font = `900 ${25 * s}px ${SANS}`;
        fitX(g, abil.name || '', 52 + lw, y, 480 - lw);
      }
      g.font = `400 ${16.5 * s}px ${SANS}`;
      for (const ln of wrap(g, abil.text, tw)) {
        y += 20 * s;
        if (draw) {
          g.fillStyle = ink;
          g.fillText(ln, 46, y);
        }
      }
      y += 10 * s;
    }
    atks.forEach((a, i) => {
      if (i || abil) {
        if (draw) {
          g.strokeStyle = ink === '#fff' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.25)';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(44, y + 2);
          g.lineTo(546, y + 2);
          g.stroke();
        }
        y += 8 * s;
      }
      y += 32 * s;
      const cost = (a.cost || []).slice(0, 5);
      if (draw) {
        cost.forEach((e, j) => energy(g, 58 + j * 28 * s, y - 10 * s, 12.5 * s, e));
        g.fillStyle = ink;
        g.font = `900 ${26 * s}px ${SANS}`;
        const nx = 58 + Math.max(cost.length, 1) * 28 * s + 2;
        fitX(g, a.name || '', nx, y, 440 - nx);
        g.textAlign = 'right';
        g.font = `900 ${32 * s}px ${SANS}`;
        g.fillText(a.dmg || '', 546, y + 1);
        g.textAlign = 'left';
      }
      if (a.text) {
        g.font = `400 ${16.5 * s}px ${SANS}`;
        for (const ln of wrap(g, a.text, tw)) {
          y += 20 * s;
          if (draw) {
            g.fillStyle = ink;
            g.fillText(ln, 46, y);
          }
        }
      }
      y += 8 * s;
    });
    return y;
  };
  let s = 1;
  while (s > 0.62 && layout(s, false) > bottom) s -= 0.04;
  layout(s, true);
  // 弱點／抵抗力／撤退
  g.strokeStyle = ink === '#fff' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(40, 732);
  g.lineTo(550, 732);
  g.stroke();
  g.font = `700 13px ${SANS}`;
  g.fillStyle = ink;
  const cell = (x, label) => g.fillText(label, x, 750);
  cell(46, mt('weak', lang));
  cell(214, mt('resist', lang));
  cell(384, mt('retreat', lang));
  g.font = `900 18px ${SANS}`;
  if (d.weak) {
    energy(g, 60, 770, 11, d.weak);
    g.fillText('×2', 76, 776);
  }
  if (d.resist) {
    energy(g, 228, 770, 11, d.resist);
    g.fillText('-30', 244, 776);
  }
  for (let i = 0; i < Math.max(0, Math.min(4, d.retreat | 0)); i++) energy(g, 398 + i * 26, 770, 11, 'colorless');
  // 繪師、卡片編號＋稀有度、圖鑑說明
  g.font = `italic 400 12px ${SANS}`;
  g.fillStyle = ink;
  fitX(g, `Illus. ${d.illus || ''}`, 40, 808, 180);
  g.font = `700 12px ${SANS}`;
  const rs = ['●', '◆', '★', '★'][d.rarity | 0] || '●';
  g.fillText(`${d.setno || ''}`, 40, 828);
  g.fillStyle = (d.rarity | 0) === 3 ? '#d4a017' : ink;
  g.fillText(rs, 40 + g.measureText(`${d.setno || ''} `).width, 828);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  rr(g, 228, 790, 322, 46, 8);
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.stroke();
  g.fillStyle = '#2a2a2a';
  let fs = 12;
  let lines;
  for (; fs >= 9; fs -= 0.5) {
    g.font = `italic 400 ${fs}px ${SANS}`;
    lines = wrap(g, d.flavor, 308);
    if (lines.length * fs * 1.2 <= 40) break;
  }
  lines.slice(0, 3).forEach((ln, i) => g.fillText(ln, 236, 803 + i * fs * 1.2));
  return c;
}
// 寶可夢風的名字顏色：自動＝跟字一樣（暗的屬性白字），也可以選金銀彩虹
function nameFillM(g, d, ink) {
  const st = d.nameStyle;
  if (!st || st === 'auto') return ink;
  if (st === 'black') return '#111';
  if (st === 'white') return '#fff';
  return nameFill(g, { ...d, nameStyle: st }, 36, 88, 330);
}

// ---------- 作品冊（使用者 2026-10-28：「追加卡片製作可以做完後存到一個製作好的簿子裡存著 然後可以在編輯」「或放到卡片機裡」） ----------
//   IndexedDB clatter-cards／works：{ id, d＝設計（含卡圖 base64、wid＝自己的 id）, m＝音樂（上傳的檔案也存）, thumb＝小張卡面, ts }
let dbp = null;
function wdb() {
  dbp =
    dbp ||
    new Promise((res, rej) => {
      const r = indexedDB.open('clatter-cards', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('works', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}
async function wtx(mode, fn) {
  const db = await wdb();
  return new Promise((res, rej) => {
    const tx = db.transaction('works', mode);
    const req = fn(tx.objectStore('works'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}
export const listWorks = () => wtx('readonly', (st) => st.getAll()).then((a) => (a || []).sort((x, y) => y.ts - x.ts));
const putWork = (w) => wtx('readwrite', (st) => st.put(w));
const delWork = (id) => wtx('readwrite', (st) => st.delete(id));
const newWid = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const artOf = (d) => (d?.art?.b64 ? createImageBitmap(new Blob([Uint8Array.from(atob(d.art.b64), (c) => c.charCodeAt(0))], { type: d.art.mime })).catch(() => null) : Promise.resolve(null));

// ---------- 編輯畫面 ----------
const el = (tag, cls, text) => {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text != null) x.textContent = text;
  return x;
};
export const BGM_IDS = ['shop', 'arcade', 'sakura', 'night', 'festival', 'dream'];

// d＝{ t, lang(), toast, sfx, openCrop, targets() → [{ uid, label, cur }], onAdd(design, artCanvas, cardBlob, music, target, qty), parseMediaUrl, bgmUrl(id) }
export class CardStudio {
  // root＝工房那一頁（使用者 2026-10-28：「把卡片製作拆開到出來」→ 從對話框改成上方列的一個分頁）
  constructor(root, d) {
    this.root = root;
    this.d = d;
    this.box = root.querySelector('.studio-body');
    this.worksBox = root.querySelector('.works-box');
    this.music = { k: 'none' };
    this.edit = null; // 正在改機台上的哪一張（{ uid, itemUid }），null＝新的一張
  }

  // design＝要接著改的設計（機台上那張），沒給＝上次沒做完的／新的
  async open(design = null, edit = null) {
    const { t } = this.d;
    this.edit = edit;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('clatter.studio') || 'null');
    } catch {}
    this.ds = { ...defaultDesign(t), ...(design || saved?.d || {}) };
    this.music = design ? edit?.music || { k: 'none' } : saved?.m || { k: 'none' };
    this.art = await artOf(this.ds);
    await studioFonts();
    this.build();
    this.built = true;
    this.renderWorks();
  }

  // 存進作品冊（有 wid＝改同一張）；放進機台時也會自動存
  async saveWork(silent = false) {
    const { t } = this.d;
    const ds = this.ds;
    if (!ds.wid) ds.wid = newWid();
    const thumb = drawDesignCard(ds, this.art, 220, this.d.lang()).toDataURL('image/webp', 0.8);
    const m = this.music.k === 'keep' ? { k: 'none' } : { ...this.music };
    try {
      await putWork({ id: ds.wid, d: { ...ds }, m, thumb, ts: Date.now() });
    } catch (e) {
      console.warn(e);
      return this.d.toast(t('cs.workFail'));
    }
    this.saveLocal();
    this.paintSaveBtn();
    await this.renderWorks();
    if (!silent) this.d.toast(t('cs.workSaved', { name: ds.name || '?' }));
  }
  // 作品冊的一張 → 拿來改
  async loadWork(w) {
    this.edit = null;
    this.ds = { ...defaultDesign(this.d.t), ...w.d, wid: w.id };
    this.music = w.m || { k: 'none' };
    this.art = await artOf(this.ds);
    this.build();
    this.renderWorks();
    this.box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // 作品冊：每張卡＝縮圖＋名字＋「編輯」「放進機台」「刪除」；最前面一格「＋ 新しいカード」
  async renderWorks() {
    const { t } = this.d;
    const box = this.worksBox;
    if (!box) return;
    let works = [];
    try {
      works = await listWorks();
    } catch {}
    box.textContent = '';
    const head = el('div', 'works-head');
    head.append(el('h2', null, t('cs.works')), el('small', null, t('cs.worksN', { n: works.length })));
    box.append(head);
    const grid = el('div', 'works-grid');
    const nw = el('button', 'work work-new');
    nw.type = 'button';
    nw.append(el('span', 'work-plus', '＋'), el('b', null, t('cs.newCard')));
    nw.onclick = () => {
      this.edit = null;
      this.ds = { ...defaultDesign(t), style: this.ds?.style || 'duel' };
      this.art = null;
      this.music = { k: 'none' };
      this.build();
      this.renderWorks();
      this.box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    grid.append(nw);
    for (const w of works) {
      const card = el('div', 'work' + (w.id === this.ds?.wid ? ' on' : ''));
      const im = el('img');
      im.src = w.thumb;
      im.alt = w.d?.name || '';
      im.loading = 'lazy';
      const name = el('b', null, w.d?.name || '?');
      const tag = el('small', null, `${t('cs.s.' + (w.d?.style === 'monster' ? 'monster' : 'duel'))} · ${['N', 'R', 'SR', 'SSR'][w.d?.rarity | 0]}`);
      const acts = el('div', 'work-acts');
      const ed = el('button', 'btn', t('cs.workEdit'));
      ed.type = 'button';
      ed.onclick = () => this.loadWork(w);
      const put = el('button', 'btn sun', t('cs.workPut'));
      put.type = 'button';
      const del = el('button', 'btn ghost', '🗑');
      del.type = 'button';
      del.setAttribute('aria-label', t('cs.workDel'));
      del.onclick = async () => {
        if (del.dataset.arm !== '1') {
          del.dataset.arm = '1';
          del.textContent = t('cs.workDelConfirm');
          return;
        }
        await delWork(w.id).catch(() => {});
        if (this.ds?.wid === w.id) {
          delete this.ds.wid;
          this.saveLocal();
          this.paintSaveBtn();
        }
        this.renderWorks();
      };
      // 放進機台：選哪台、幾張（跟編輯畫面一樣）
      const form = el('div', 'work-put');
      form.hidden = true;
      const sel = el('select', 'cs-in');
      for (const x of this.d.targets()) sel.append(new Option(x.label, x.uid, false, x.cur));
      sel.append(new Option(t('cs.newMachine'), '__new'));
      const qty = el('input', 'cs-in cs-qty');
      qty.type = 'number';
      qty.min = 1;
      qty.max = 999;
      qty.value = 3;
      qty.setAttribute('aria-label', t('qty'));
      const ok = el('button', 'btn primary', t('cs.add'));
      ok.type = 'button';
      ok.onclick = async () => {
        ok.disabled = true;
        try {
          const art = await artOf(w.d);
          await studioFonts();
          const cardC = drawDesignCard(w.d, art, CARD_OUT[0], this.d.lang());
          await this.d.onAdd({ design: { ...w.d, wid: w.id }, card: cardC, music: w.m || { k: 'none' }, target: sel.value, qty: Math.max(1, Math.min(999, +qty.value || 1)), edit: null });
        } finally {
          ok.disabled = false;
        }
      };
      form.append(sel, qty, ok);
      put.onclick = () => (form.hidden = !form.hidden);
      acts.append(ed, put, del);
      card.append(im, name, tag, acts, form);
      grid.append(card);
    }
    box.append(grid);
  }
  paintSaveBtn() {
    if (this.saveBtn) this.saveBtn.textContent = this.d.t(this.ds?.wid ? 'cs.workUpdate' : 'cs.workSave');
  }
  // 離開工房那頁：試聽停掉；放進機台以後下一張就是新的
  close() {
    this.audio?.pause();
    // 改的是機台上那張 → 下次來重畫成「做新的」（按鈕、放進哪台都換回來）
    if (this.edit) {
      this.edit = null;
      this.built = false;
    }
  }
  // 回到工房：機台可能多了、改了種類 → 重列「放進哪台」
  refreshTargets() {
    const sel = this.targetSel;
    if (!sel?.isConnected) return;
    const keep = sel.value;
    sel.textContent = '';
    for (const x of this.d.targets()) sel.append(new Option(x.label, x.uid, false, x.uid === keep || (!keep && x.cur)));
    sel.append(new Option(this.d.t('cs.newMachine'), '__new', false, keep === '__new'));
  }
  saveLocal() {
    try {
      localStorage.setItem('clatter.studio', JSON.stringify({ d: this.ds, m: this.music.k === 'file' ? { k: 'none' } : this.music }));
    } catch {}
  }
  redraw() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const c = drawDesignCard(this.ds, this.art, 590, this.d.lang());
      const pv = this.preview;
      pv.width = c.width;
      pv.height = c.height;
      pv.getContext('2d').drawImage(c, 0, 0);
      this.saveLocal();
      this.sync();
    });
  }
  // 依卡片種類顯示／藏起欄位
  sync() {
    if (this.ds.style === 'monster') return;
    const ty = this.ds.type;
    const st = isST(ty);
    for (const [k, show] of Object.entries({ attr: !st, level: !st && ty !== 'link', arrows: ty === 'link', icon: st, race: !st, stats: !st, def: !st && ty !== 'link' })) {
      this.box.querySelectorAll(`[data-f="${k}"]`).forEach((n) => (n.hidden = !show));
    }
    const lv = this.box.querySelector('[data-f="level"] .cs-label');
    if (lv) lv.textContent = this.d.t(ty === 'xyz' ? 'cs.rank' : 'cs.level') + ` ${this.ds.level}`;
  }

  build() {
    const { t } = this.d;
    const ds = this.ds;
    const box = this.box;
    box.textContent = '';
    const left = el('div', 'cs-left');
    this.preview = el('canvas', 'cs-preview');
    left.append(this.preview);
    const right = el('div', 'cs-right');
    const set = (k, v, re = true) => {
      ds[k] = v;
      if (re) this.redraw();
    };
    const group = (label, f) => {
      const g = el('div', 'cs-group');
      if (f) g.dataset.f = f;
      const l = el('div', 'cs-label', label);
      g.append(l);
      right.append(g);
      return g;
    };
    const chips = (g, keys, cur, label, on) => {
      const row = el('div', 'chips cs-chips');
      for (const k of keys) {
        const b = el('button', 'chip', label(k));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(k === cur()));
        b.onclick = () => {
          on(k);
          row.querySelectorAll('.chip').forEach((x, i) => x.setAttribute('aria-pressed', String(keys[i] === cur())));
        };
        row.append(b);
      }
      g.append(row);
      return row;
    };
    const input = (g, k, opt = {}) => {
      const i = el(opt.area ? 'textarea' : 'input', 'cs-in');
      if (!opt.area) i.type = 'text';
      i.value = ds[k] ?? '';
      if (opt.max) i.maxLength = opt.max;
      if (opt.rows) i.rows = opt.rows;
      if (opt.ph) i.placeholder = opt.ph;
      if (opt.mode) i.inputMode = opt.mode;
      i.oninput = () => set(k, i.value);
      g.append(i);
      return i;
    };
    // 卡牌樣式（使用者 2026-10-28：「再增加不只是遊戲王還有寶可夢卡牌」）：換了整個表單重畫，兩種的欄位都留著
    chips(group(t('cs.style')), STYLES, () => ds.style || 'duel', (k) => t('cs.s.' + k), (k) => {
      if ((ds.style || 'duel') === k) return;
      ds.style = k;
      this.build();
    }).classList.add('cs-styles');
    // 卡圖（遊戲王風＝正方形、寶可夢風＝橫的）
    const artGroup = () => {
    const art = group(t('cs.art'));
    const ab = el('button', 'btn', t('cs.artUpload'));
    ab.type = 'button';
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    ab.onclick = () => {
      file.value = '';
      file.click();
    };
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      let bmp;
      try {
        bmp = await createImageBitmap(f);
      } catch {
        return this.d.toast(t('t.badImage'));
      }
      const c = await this.d.openCrop({ bmp, out: ds.style === 'monster' ? [720, 490] : [600, 600], title: t('cs.artCrop') });
      if (!c) return;
      this.art = c;
      const url = c.toDataURL('image/webp', 0.86);
      ds.art = { b64: url.split(',')[1], mime: url.startsWith('data:image/webp') ? 'image/webp' : 'image/png' };
      this.redraw();
    };
    art.append(ab, file);
    };
    if (ds.style === 'monster') this.buildMonster({ group, chips, input, set, artGroup });
    else {
      // 卡片種類
      chips(group(t('cs.type')), TYPE_KEYS, () => ds.type, (k) => t('cs.t.' + k), (k) => {
        set('type', k);
      }).classList.add('cs-types');
      // 外框、框色
      const fr = group(t('cs.frame'));
      chips(fr, BORDERS, () => ds.border, (k) => t('cs.b.' + k), (k) => set('border', k));
      const frow = el('div', 'cs-row');
      const fc = el('input');
      fc.type = 'color';
      fc.value = /^#[0-9a-f]{6}$/i.test(ds.frame) ? ds.frame : TYPES[ds.type].c[1];
      fc.setAttribute('aria-label', t('cs.frameColor'));
      const fcl = el('label', 'cs-check');
      const fcb = el('input');
      fcb.type = 'checkbox';
      fcb.checked = !!ds.frame;
      fcl.append(fcb, el('span', null, t('cs.frameColor')));
      fcb.onchange = () => set('frame', fcb.checked ? fc.value : '');
      fc.oninput = () => {
        fcb.checked = true;
        set('frame', fc.value);
      };
      frow.append(fcl, fc);
      fr.append(frow);
      // 卡名＋名字顏色
      const nm = group(t('cs.name'));
      input(nm, 'name', { max: 30 });
      chips(nm, NAME_STYLES, () => ds.nameStyle || 'auto', (k) => t('cs.n.' + k), (k) => set('nameStyle', k));
      // 屬性
      chips(group(t('cs.attr'), 'attr'), ATTR_KEYS, () => ds.attr, (k) => ATTRS[k][this.d.lang()] || ATTRS[k].en, (k) => set('attr', k));
      // 等級（超量＝階級）
      const lv = group(t('cs.level'), 'level');
      const r = el('input');
      r.type = 'range';
      r.min = 1;
      r.max = 12;
      r.value = ds.level;
      r.oninput = () => set('level', +r.value);
      lv.append(r);
      // 連結箭頭（3×3，中間是 LINK 數）
      const ar = group(t('cs.arrows'), 'arrows');
      const grid = el('div', 'cs-arrows');
      const order = [0, 1, 2, 3, -1, 4, 5, 6, 7];
      const glyph = ['↖', '↑', '↗', '←', '→', '↙', '↓', '↘'];
      for (const i of order) {
        if (i < 0) {
          grid.append(el('span', 'cs-link', 'LINK'));
          continue;
        }
        const b = el('button', 'chip', glyph[i]);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(!!ds.arrows?.[i]));
        b.onclick = () => {
          const a = [...(ds.arrows || [0, 0, 0, 0, 0, 0, 0, 0])];
          a[i] = a[i] ? 0 : 1;
          set('arrows', a);
          b.setAttribute('aria-pressed', String(!!a[i]));
        };
        grid.append(b);
      }
      ar.append(grid);
      // 魔法陷阱種類
      chips(group(t('cs.icon'), 'icon'), ICONS, () => ds.icon || 'none', (k) => t('cs.i.' + k), (k) => set('icon', k));
      artGroup();
      // 種族／類型、效果
      input(group(t('cs.race'), 'race'), 'race', { max: 40, ph: t('cs.racePh') });
      input(group(t('cs.text')), 'text', { area: true, rows: 5, max: 400 });
      // ATK／DEF
      const sg = group(t('cs.stats'), 'stats');
      const srow = el('div', 'cs-row');
      const atk = el('label', 'cs-stat');
      atk.append('ATK ');
      const ai = input(atk, 'atk', { max: 5, mode: 'numeric' });
      ai.size = 5;
      const def = el('label', 'cs-stat');
      def.dataset.f = 'def';
      def.append('DEF ');
      const di = input(def, 'def', { max: 5, mode: 'numeric' });
      di.size = 5;
      srow.append(atk, def);
      sg.append(srow);
      // 卡號、密碼
      const ids = group(t('cs.ids'));
      const irow = el('div', 'cs-row');
      const si = input(irow, 'set', { max: 14 });
      si.setAttribute('aria-label', t('cs.set'));
      const pi = input(irow, 'pass', { max: 8, mode: 'numeric' });
      pi.setAttribute('aria-label', t('cs.pass'));
      ids.append(irow);
    }
    // 稀有度（機台的稀有度＝閃法、名字顏色）
    chips(group(t('cs.rarity')), [0, 1, 2, 3], () => ds.rarity | 0, (k) => ['N', 'R', 'SR', 'SSR'][k], (k) => set('rarity', k));
    // 音樂
    this.musicGroup(group(t('cs.music')));
    // 加到機台
    const add = group(t('cs.addTo'));
    const trow = el('div', 'cs-row');
    const sel = el('select', 'cs-in');
    this.targetSel = sel;
    for (const x of this.d.targets()) sel.append(new Option(x.label, x.uid, false, this.edit ? x.uid === this.edit.uid : x.cur));
    sel.append(new Option(t('cs.newMachine'), '__new'));
    const qty = el('input', 'cs-in cs-qty');
    qty.type = 'number';
    qty.min = 1;
    qty.max = 999;
    qty.value = this.edit?.qty || 3;
    qty.setAttribute('aria-label', t('qty'));
    trow.append(sel, qty);
    add.append(trow);
    const acts = el('div', 'cs-acts');
    const go = el('button', 'btn primary', t(this.edit ? 'cs.update' : 'cs.add'));
    go.type = 'button';
    go.onclick = async () => {
      if (!ds.name.trim()) return this.d.toast(t('cs.needName'));
      go.disabled = true;
      try {
        await this.saveWork(true); // 放進機台的卡也留在作品冊
        const card = drawDesignCard(ds, this.art, CARD_OUT[0], this.d.lang());
        await this.d.onAdd({ design: { ...ds }, card, music: this.music, target: sel.value, qty: Math.max(1, Math.min(999, +qty.value || 1)), edit: this.edit });
        this.close();
      } finally {
        go.disabled = false;
      }
    };
    const keep = el('button', 'btn sun', '');
    keep.type = 'button';
    this.saveBtn = keep;
    this.paintSaveBtn();
    keep.onclick = async () => {
      if (!ds.name.trim()) return this.d.toast(t('cs.needName'));
      keep.disabled = true;
      await this.saveWork();
      keep.disabled = false;
    };
    const save = el('button', 'btn ghost', t('cs.saveImg'));
    save.type = 'button';
    save.onclick = () => {
      const c = drawDesignCard(ds, this.art, 1180, this.d.lang());
      c.toBlob((b) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `clatter-card-${(ds.name || 'card').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24)}.png`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    };
    const reset = el('button', 'btn ghost', t('cs.reset'));
    reset.type = 'button';
    reset.onclick = () => {
      if (reset.dataset.arm !== '1') {
        reset.dataset.arm = '1';
        reset.textContent = t('cs.resetConfirm');
        return;
      }
      this.ds = defaultDesign(t);
      this.art = null;
      this.music = { k: 'none' };
      this.edit = null;
      this.build();
    };
    acts.append(go, keep, save, reset);
    right.append(acts);
    box.append(left, right);
    this.redraw();
  }

  // 寶可夢風的欄位：屬性、外框、名字、進化、HP、卡圖、特性、招式 ×2、弱點／抵抗力／撤退、圖鑑資料
  buildMonster({ group, chips, input, set, artGroup }) {
    const { t } = this.d;
    const ds = this.ds;
    const typeName = (k) => t('cs.mt.' + k);
    chips(group(t('cs.mtype')), MTYPE_KEYS, () => ds.mtype, typeName, (k) => set('mtype', k)).classList.add('cs-mtypes');
    const fr = group(t('cs.frame'));
    chips(fr, MBORDERS, () => ds.mborder || 'yellow', (k) => t('cs.b.' + k), (k) => set('mborder', k));
    const frow = el('div', 'cs-row');
    const fc = el('input');
    fc.type = 'color';
    fc.value = /^#[0-9a-f]{6}$/i.test(ds.frame) ? ds.frame : MTYPES[ds.mtype]?.g || '#cccccc';
    fc.setAttribute('aria-label', t('cs.frameColor'));
    const fcl = el('label', 'cs-check');
    const fcb = el('input');
    fcb.type = 'checkbox';
    fcb.checked = !!ds.frame;
    fcl.append(fcb, el('span', null, t('cs.frameColor')));
    fcb.onchange = () => set('frame', fcb.checked ? fc.value : '');
    fc.oninput = () => {
      fcb.checked = true;
      set('frame', fc.value);
    };
    frow.append(fcl, fc);
    fr.append(frow);
    const nm = group(t('cs.name'));
    input(nm, 'name', { max: 30 });
    chips(nm, NAME_STYLES, () => ds.nameStyle || 'auto', (k) => t('cs.n.' + k), (k) => set('nameStyle', k));
    // 進化＋HP
    const sg = group(t('cs.stage'));
    chips(sg, STAGES, () => ds.stage || 'basic', (k) => t('cs.st.' + k), (k) => {
      set('stage', k);
      ef.hidden = k === 'basic';
    });
    const ef = el('div', 'cs-row');
    const efi = input(ef, 'efrom', { max: 20, ph: t('cs.efromPh') });
    efi.setAttribute('aria-label', t('cs.efromPh'));
    ef.hidden = (ds.stage || 'basic') === 'basic';
    sg.append(ef);
    const hg = group('HP');
    const hpi = input(hg, 'hp', { max: 4, mode: 'numeric' });
    hpi.classList.add('cs-short');
    artGroup();
    // 特性
    const ag = group(t('cs.ability'));
    const abil = { ...(ds.ability || {}) };
    const al = el('label', 'cs-check');
    const ac = el('input');
    ac.type = 'checkbox';
    ac.checked = !!abil.on;
    al.append(ac, el('span', null, t('cs.abilityOn')));
    const abox = el('div', 'cs-sub');
    abox.hidden = !abil.on;
    const setAbil = () => set('ability', { ...abil });
    ac.onchange = () => {
      abil.on = ac.checked;
      abox.hidden = !ac.checked;
      setAbil();
    };
    const an = el('input', 'cs-in');
    an.value = abil.name || '';
    an.maxLength = 24;
    an.placeholder = t('cs.abilName');
    an.oninput = () => {
      abil.name = an.value;
      setAbil();
    };
    const at = el('textarea', 'cs-in');
    at.rows = 2;
    at.maxLength = 160;
    at.value = abil.text || '';
    at.placeholder = t('cs.abilText');
    at.oninput = () => {
      abil.text = at.value;
      setAbil();
    };
    abox.append(an, at);
    ag.append(al, abox);
    // 招式 ×2：能量（點屬性加、⌫ 刪最後一個）、名字、傷害、說明
    const atks = (ds.attacks || []).map((x) => ({ ...x, cost: [...(x.cost || [])] }));
    while (atks.length < 2) atks.push({ on: false, cost: ['colorless'], name: '', dmg: '', text: '' });
    const setAtks = () => set('attacks', atks.map((x) => ({ ...x, cost: [...x.cost] })));
    atks.forEach((a, i) => {
      const g = group(t('cs.attack', { n: i + 1 }));
      const l = el('label', 'cs-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!a.on;
      l.append(cb, el('span', null, t('cs.attackOn')));
      const box = el('div', 'cs-sub');
      box.hidden = !a.on;
      cb.onchange = () => {
        a.on = cb.checked;
        box.hidden = !cb.checked;
        setAtks();
      };
      // 能量
      const crow = el('div', 'cs-cost');
      const cur = el('span', 'cs-cost-cur');
      const paintCost = () => {
        cur.textContent = '';
        for (const e of a.cost) {
          const cv = el('canvas');
          cv.width = cv.height = 44;
          energy(cv.getContext('2d'), 22, 22, 19, e);
          cur.append(cv);
        }
        if (!a.cost.length) cur.append(el('small', null, t('cs.costNone')));
      };
      paintCost();
      const pick = el('div', 'cs-cost-pick');
      for (const e of MTYPE_KEYS) {
        const b = el('button', 'cs-ebtn');
        b.type = 'button';
        b.title = typeName(e);
        b.setAttribute('aria-label', t('cs.costAdd', { e: typeName(e) }));
        const cv = el('canvas');
        cv.width = cv.height = 40;
        energy(cv.getContext('2d'), 20, 20, 17, e);
        b.append(cv);
        b.onclick = () => {
          if (a.cost.length >= 5) return;
          a.cost.push(e);
          paintCost();
          setAtks();
        };
        pick.append(b);
      }
      const back = el('button', 'chip', '⌫');
      back.type = 'button';
      back.setAttribute('aria-label', t('cs.costDel'));
      back.onclick = () => {
        a.cost.pop();
        paintCost();
        setAtks();
      };
      pick.append(back);
      crow.append(cur, pick);
      const r1 = el('div', 'cs-row');
      const nmi = el('input', 'cs-in');
      nmi.value = a.name || '';
      nmi.maxLength = 24;
      nmi.placeholder = t('cs.atkName');
      nmi.oninput = () => {
        a.name = nmi.value;
        setAtks();
      };
      const dm = el('input', 'cs-in cs-short');
      dm.value = a.dmg || '';
      dm.maxLength = 5;
      dm.placeholder = t('cs.dmg');
      dm.setAttribute('aria-label', t('cs.dmg'));
      dm.oninput = () => {
        a.dmg = dm.value;
        setAtks();
      };
      r1.append(nmi, dm);
      const tx = el('textarea', 'cs-in');
      tx.rows = 2;
      tx.maxLength = 200;
      tx.value = a.text || '';
      tx.placeholder = t('cs.atkText');
      tx.oninput = () => {
        a.text = tx.value;
        setAtks();
      };
      box.append(crow, r1, tx);
      g.append(l, box);
    });
    // 弱點／抵抗力／撤退
    const wg = group(t('cs.wrr'));
    const wrow = el('div', 'cs-row');
    const typeSel = (k, label) => {
      const lab = el('label', 'cs-stat');
      lab.append(label + ' ');
      const sel = el('select', 'cs-in');
      sel.append(new Option(t('cs.none'), ''));
      for (const e of MTYPE_KEYS) sel.append(new Option(typeName(e), e, false, ds[k] === e));
      sel.value = ds[k] || '';
      sel.onchange = () => set(k, sel.value);
      lab.append(sel);
      wrow.append(lab);
    };
    typeSel('weak', t('cs.weak'));
    typeSel('resist', t('cs.resist'));
    const rl = el('label', 'cs-stat');
    const rv = el('span', null, String(ds.retreat | 0));
    const rr3 = el('input');
    rr3.type = 'range';
    rr3.min = 0;
    rr3.max = 4;
    rr3.value = ds.retreat | 0;
    rr3.oninput = () => {
      rv.textContent = rr3.value;
      set('retreat', +rr3.value);
    };
    rl.append(t('cs.retreat') + ' ', rr3, rv);
    wrow.append(rl);
    wg.append(wrow);
    // 圖鑑資料、說明、繪師、編號
    input(group(t('cs.info')), 'info', { max: 60, ph: t('cs.infoPh') });
    input(group(t('cs.flavor')), 'flavor', { area: true, rows: 2, max: 120 });
    const ig = group(t('cs.illusNo'));
    const irow = el('div', 'cs-row');
    const il = input(irow, 'illus', { max: 24 });
    il.setAttribute('aria-label', t('cs.illus'));
    const sn = input(irow, 'setno', { max: 12 });
    sn.setAttribute('aria-label', t('cs.setno'));
    ig.append(irow);
  }

  // 音樂：不要／預設曲（Gemini 做的 6 首）／上傳／網址；可以先聽
  musicGroup(g) {
    const { t } = this.d;
    const row = el('div', 'chips cs-chips');
    // keep＝改機台上的卡時，原本的音樂不動
    const opts = [...(this.music.k === 'keep' ? ['keep'] : []), 'none', 'preset', 'file', 'url'];
    const body = el('div', 'cs-music');
    const paint = () => {
      row.querySelectorAll('.chip').forEach((x, i) => x.setAttribute('aria-pressed', String(opts[i] === this.music.k)));
      body.textContent = '';
      this.audio?.pause();
      const m = this.music;
      if (m.k === 'preset') {
        const sel = el('select', 'cs-in');
        for (const id of BGM_IDS) sel.append(new Option(t('bgm.' + id), id, false, id === m.id));
        sel.onchange = () => {
          m.id = sel.value;
          this.saveLocal();
        };
        if (!m.id) m.id = BGM_IDS[0];
        body.append(sel, this.playBtn(() => this.d.bgmUrl(m.id)));
      } else if (m.k === 'file') {
        const b = el('button', 'btn', m.file ? m.file.name : t('cs.musicPick'));
        b.type = 'button';
        const f = el('input');
        f.type = 'file';
        f.accept = 'audio/*';
        f.hidden = true;
        b.onclick = () => f.click();
        f.onchange = () => {
          if (!f.files[0]) return;
          m.file = f.files[0];
          paint();
        };
        body.append(b, f);
        if (m.file) body.append(this.playBtn(() => URL.createObjectURL(m.file)));
      } else if (m.k === 'url') {
        const i = el('input', 'cs-in');
        i.type = 'url';
        i.placeholder = t('cs.musicUrlPh');
        i.value = m.url || '';
        const ok = el('small', 'cs-ok');
        const check = () => {
          m.url = i.value.trim();
          const p = this.d.parseMediaUrl(m.url);
          ok.textContent = !m.url ? '' : p ? '✓ ' + this.d.mediaLabel(p) : t('cs.musicBadUrl');
          this.saveLocal();
        };
        i.oninput = check;
        check();
        body.append(i, ok);
      }
      this.saveLocal();
    };
    for (const k of opts) {
      const b = el('button', 'chip', t('cs.m.' + k));
      b.type = 'button';
      b.onclick = () => {
        this.music = k === this.music.k ? this.music : { k };
        paint();
      };
      row.append(b);
    }
    g.append(row, body);
    paint();
  }
  playBtn(src) {
    const b = el('button', 'btn ghost cs-play', '▶');
    b.type = 'button';
    b.setAttribute('aria-label', this.d.t('cs.listen'));
    b.onclick = () => {
      if (this.audio && !this.audio.paused) {
        this.audio.pause();
        b.textContent = '▶';
        return;
      }
      this.audio?.pause();
      this.audio = new Audio(src());
      this.audio.volume = 0.7;
      this.audio.play().catch(() => {});
      this.audio.onended = () => (b.textContent = '▶');
      b.textContent = '■';
    };
    return b;
  }
}
