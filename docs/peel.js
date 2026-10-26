// シールをはがす（使用者 2026-10-27：CapLog 的影片「指ではがす楽しさそのまま」→「這樣的撥下來的方式」「可以慢慢撕下來」）
//   全螢幕的一層，畫在一張 canvas 上：
//   ① 鋁箔包：從左邊的切口沿著上面的封口往右慢慢劃 → 封口跟著手指一點一點撕開（撕下的那條往上翹）→ 撕到底，貼紙噴出來
//   ② 台紙：按住貼紙拉 → 沿著「折線」慢慢翻起來（折起來的是貼紙白色的背面，越靠折線越暗，底下有影子），
//      翻開的地方露出台紙上灰色的剪影；放手時翻不到一半 → 彈回去，超過一半 → 整張撕下來飛到上面（存起來）
//   折線＝按下的點 A 跟手指現在的點 P 的垂直平分線；A 那一邊的貼紙對折線鏡射過去（畫背面）

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => 1 - Math.pow(1 - t, 3);
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 貼紙的剪影（同樣的透明度、填一個顏色）
function silhouette(img, color) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
// 半平面（直線過 M、法線 n；side＝-1 是 A 那邊）的大四邊形
function halfPlane(g, M, n, side, L) {
  const tx = -n.y;
  const ty = n.x;
  g.beginPath();
  g.moveTo(M.x + tx * L, M.y + ty * L);
  g.lineTo(M.x - tx * L, M.y - ty * L);
  g.lineTo(M.x - tx * L + n.x * L * side, M.y - ty * L + n.y * L * side);
  g.lineTo(M.x + tx * L + n.x * L * side, M.y + ty * L + n.y * L * side);
  g.closePath();
}

// ---------- 撕一張貼紙（台紙、シール帳的頁面共用） ----------
// s＝{ img, back（白色背面）, x, y（中心，CSS px）, k（圖 px → CSS px）, rot（弧度） }；A、P 是貼紙自己的座標（圖的像素，原點在中心）
export function toLocal(s, px, py) {
  const dx = px - s.x;
  const dy = py - s.y;
  const c = Math.cos(-s.rot);
  const sn = Math.sin(-s.rot);
  return { x: (dx * c - dy * sn) / s.k, y: (dx * sn + dy * c) / s.k };
}
const toScreen = (s) => [s.k * Math.cos(s.rot), s.k * Math.sin(s.rot), -s.k * Math.sin(s.rot), s.k * Math.cos(s.rot), s.x, s.y];
// 折線：A＝按下的點、P＝手指現在的點 → 兩點的垂直平分線
function fold(A, P) {
  const dx = P.x - A.x;
  const dy = P.y - A.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return null;
  return { M: { x: (A.x + P.x) / 2, y: (A.y + P.y) / 2 }, n: { x: dx / d, y: dy / d }, d };
}
// 撕了多少（0–1）：折線在貼紙範圍裡走到哪
export function peelProgress(s, A, P) {
  const f = fold(A, P);
  if (!f) return 0;
  const w = s.img.width / 2;
  const h = s.img.height / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [cx, cy] of [[-w, -h], [w, -h], [w, h], [-w, h]]) {
    const v = (cx - A.x) * f.n.x + (cy - A.y) * f.n.y;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return clamp((f.d / 2 - lo) / Math.max(1, hi - lo), 0, 1);
}
function paintSticker(g, dpr, s) {
  const w = s.img.width;
  const h = s.img.height;
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.transform(...toScreen(s));
  g.shadowColor = 'rgba(0,0,0,.18)';
  g.shadowBlur = 3 / s.k;
  g.shadowOffsetY = 1.5 / s.k;
  g.drawImage(s.img, -w / 2, -h / 2);
  g.restore();
}
// 平的那半照畫；A 那一邊對折線鏡射畫成白色背面（折線附近暗、尖端亮），底下有影子
function paintPeel(g, fg, flap, dpr, s, A, P) {
  const f = fold(A, P);
  if (!f) return paintSticker(g, dpr, s);
  const w = s.img.width;
  const h = s.img.height;
  const L = (w + h) * 4;
  const base = toScreen(s);
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.transform(...base);
  halfPlane(g, f.M, f.n, 1, L);
  g.clip();
  g.shadowColor = 'rgba(0,0,0,.18)';
  g.shadowBlur = 3 / s.k;
  g.shadowOffsetY = 1.5 / s.k;
  g.drawImage(s.img, -w / 2, -h / 2);
  g.restore();
  fg.setTransform(1, 0, 0, 1, 0, 0);
  fg.clearRect(0, 0, flap.width, flap.height);
  fg.save();
  fg.setTransform(dpr, 0, 0, dpr, 0, 0);
  fg.transform(...base);
  const { n, M } = f;
  const mn = M.x * n.x + M.y * n.y;
  fg.transform(1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.y, 1 - 2 * n.y * n.y, 2 * mn * n.x, 2 * mn * n.y);
  halfPlane(fg, M, n, -1, L);
  fg.clip();
  fg.drawImage(s.back, -w / 2, -h / 2);
  fg.globalCompositeOperation = 'source-atop';
  const span = Math.max(20, f.d * 0.6);
  const gr = fg.createLinearGradient(M.x, M.y, M.x - n.x * span, M.y - n.y * span);
  gr.addColorStop(0, 'rgba(90,100,120,.38)');
  gr.addColorStop(0.18, 'rgba(255,255,255,.0)');
  gr.addColorStop(0.55, 'rgba(255,255,255,.55)');
  gr.addColorStop(1, 'rgba(200,205,215,.25)');
  fg.fillStyle = gr;
  fg.fillRect(-L, -L, L * 2, L * 2);
  fg.restore();
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const sx = n.x * Math.cos(s.rot) - n.y * Math.sin(s.rot);
  const sy = n.x * Math.sin(s.rot) + n.y * Math.cos(s.rot);
  g.shadowColor = 'rgba(0,0,0,.28)';
  g.shadowBlur = 12 * dpr;
  g.shadowOffsetX = sx * 5 * dpr;
  g.shadowOffsetY = (sy * 5 + 3) * dpr;
  g.drawImage(flap, 0, 0);
  g.restore();
}

// シール帳的頁面上撕：在 host（頁面）上蓋一張透明 canvas，只畫正在撕的那張
//   begin(img, 中心 x y, 寬, 角度) → move(手指)／animate(到哪) → end()
export class PeelLayer {
  constructor(host) {
    this.host = host;
    this.cv = document.createElement('canvas');
    this.cv.className = 'peel-layer';
    this.g = this.cv.getContext('2d');
    this.flap = document.createElement('canvas');
    this.fg = this.flap.getContext('2d');
  }
  begin(img, x, y, size, rot) {
    const r = this.host.getBoundingClientRect();
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.cv.width = this.flap.width = Math.round(r.width * this.dpr);
    this.cv.height = this.flap.height = Math.round(r.height * this.dpr);
    this.host.append(this.cv);
    // <img> 的 width 是畫面上的大小 → 先畫成原圖大小的 canvas（撕的座標用圖的像素）
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    this.s = { img: c, back: silhouette(c, '#fbfaf7'), x, y, k: size / Math.max(c.width, c.height), rot };
  }
  local(px, py) {
    return toLocal(this.s, px, py);
  }
  progress(A, P) {
    return peelProgress(this.s, A, P);
  }
  draw(A, P, alpha = 1) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.globalAlpha = alpha;
    paintPeel(g, this.fg, this.flap, this.dpr, this.s, A, P);
    g.globalAlpha = 1;
  }
  // P 從 from 動到 to（dur 秒），fade＝最後淡出
  animate(A, from, to, dur, fade = false) {
    return new Promise((res) => {
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / (dur * 1000));
        const e = ease(k);
        this.draw(A, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }, fade ? 1 - Math.max(0, k - 0.6) / 0.4 : 1);
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
  }
  // 撕完／放棄：從右上角到左下角那種「自己撕下來」的終點
  far(A, P) {
    const f = fold(A, P) || { n: { x: -0.7, y: 0.7 } };
    const d = Math.max(this.s.img.width, this.s.img.height) * 2.2;
    return { x: A.x + f.n.x * d, y: A.y + f.n.y * d };
  }
  end() {
    this.cv.remove();
  }
}

// 鋁箔包的圖：Gemini 畫的（使用者 2026-10-27：「Gemini 額度恢復後，用 Gemini 重畫鋁箔貼紙包換上去」）
//   tools/cut_pack.py 去背＋量：seal＝左邊 V 形切口的高度（從這裡橫著撕開）、labelAt＝白色圓標籤（圓心、半徑／寬）
export const FOIL = { file: 'tex/foil_pack.webp', seal: 0.245, labelAt: { x: 0.4975, y: 0.4962, r: 0.2242 } };
// 載不到圖的時候用程式畫的（drawFoilPack）
//   枕頭型的袋子：銀色鋁箔＋粉彩虹光、皺褶反光、上下鋸齒封口（直條壓紋）、左上 V 形切口、中間白色圓標籤
export const FOIL_DRAWN = { seal: 0.11, labelAt: { x: 0.5, y: 0.5, r: 0.22 } };
export function drawFoilPack(W = 600, H = 820, seed = 5) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rand = rng(seed);
  const sealH = H * FOIL_DRAWN.seal;
  const bulge = W * 0.025;
  // 袋子外形：上下封口是直的，中間兩側微微鼓起；上下邊是鋸齒
  const outline = () => {
    g.beginPath();
    const zig = (y0, dir) => {
      const n = 30;
      for (let i = 0; i <= n; i++) g.lineTo(dir > 0 ? (W * i) / n : W - (W * i) / n, y0 + (i % 2 ? 0 : 7 * dir));
    };
    g.moveTo(0, 7);
    zig(0, 1);
    g.lineTo(W, sealH);
    g.quadraticCurveTo(W + bulge, H / 2, W, H - sealH);
    g.lineTo(W, H - 7);
    zig(H, -1);
    g.lineTo(0, H - sealH);
    g.quadraticCurveTo(-bulge, H / 2, 0, sealH);
    g.closePath();
  };
  g.save();
  g.translate(bulge, 0);
  g.scale((W - bulge * 2) / W, 1);
  outline();
  g.restore();
  g.save();
  g.clip();
  // 銀色底
  let gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, '#d9dde4');
  gr.addColorStop(0.3, '#f7f8fb');
  gr.addColorStop(0.55, '#c9ced8');
  gr.addColorStop(0.8, '#eef0f5');
  gr.addColorStop(1, '#bfc5d0');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // 粉彩虹光
  g.globalCompositeOperation = 'soft-light';
  gr = g.createLinearGradient(0, H, W, 0);
  for (const [k, col] of [[0, '#ff9ad5'], [0.25, '#a7f3e4'], [0.5, '#c9b6ff'], [0.75, '#fff1a6'], [1, '#ff9ad5']]) gr.addColorStop(k, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  // 皺褶：斜的亮線、暗線
  for (let i = 0; i < 26; i++) {
    const x = rand() * W;
    const y = sealH + rand() * (H - sealH * 2);
    const len = 60 + rand() * 180;
    const a = -0.9 + rand() * 0.5;
    g.strokeStyle = rand() > 0.5 ? `rgba(255,255,255,${0.35 + rand() * 0.4})` : `rgba(120,130,150,${0.12 + rand() * 0.15})`;
    g.lineWidth = 1 + rand() * 4;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (rand() - 0.5) * 30, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // 兩側鼓起的陰影
  gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, 'rgba(60,70,90,.28)');
  gr.addColorStop(0.12, 'rgba(60,70,90,0)');
  gr.addColorStop(0.88, 'rgba(60,70,90,0)');
  gr.addColorStop(1, 'rgba(60,70,90,.3)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // 封口：深一點＋直條壓紋
  for (const y0 of [0, H - sealH]) {
    g.fillStyle = 'rgba(90,100,125,.16)';
    g.fillRect(0, y0, W, sealH);
    for (let x = 4; x < W; x += 9) {
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.fillRect(x, y0 + 8, 2, sealH - 16);
      g.fillStyle = 'rgba(80,90,110,.22)';
      g.fillRect(x + 3, y0 + 8, 2, sealH - 16);
    }
    g.fillStyle = 'rgba(70,80,100,.35)';
    g.fillRect(0, y0 === 0 ? sealH - 2 : y0, W, 2);
  }
  g.restore();
  // 左上的 V 形切口（挖掉）
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.moveTo(bulge - 1, sealH - 12);
  g.lineTo(bulge + 18, sealH - 1);
  g.lineTo(bulge - 1, sealH + 10);
  g.closePath();
  g.fill();
  g.globalCompositeOperation = 'source-over';
  // 中間的圓標籤
  const L = FOIL_DRAWN.labelAt;
  g.save();
  g.shadowColor = 'rgba(60,70,90,.25)';
  g.shadowBlur = 10;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(W * L.x, H * L.y, W * L.r, 0, TAU);
  g.fill();
  g.restore();
  g.lineWidth = 6;
  g.strokeStyle = '#ffc2dc';
  g.beginPath();
  g.arc(W * L.x, H * L.y, W * L.r - 6, 0, TAU);
  g.stroke();
  g.setLineDash([3, 7]);
  g.lineWidth = 2;
  g.strokeStyle = '#9ad7ff';
  g.beginPath();
  g.arc(W * L.x, H * L.y, W * L.r - 14, 0, TAU);
  g.stroke();
  return c;
}

// items：[{ img（貼紙圖：canvas／ImageBitmap，透明底）, name }]
// o：{ t, sfx, title, pack: { img（鋁箔包圖）, label: 'シール ×N' } | null, onOpened(), onSave(i) → Promise, onClose() }
export function openPeel(items, o) {
  const { t } = o;
  const ov = document.createElement('div');
  ov.className = 'peel-ov';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="peel-top"><b class="peel-title"></b><span class="peel-count"></span><button type="button" class="icon-btn peel-x">✕</button></div>
<div class="peel-stage"><canvas class="peel-cv"></canvas></div>
<div class="peel-bottom"><p class="peel-hint"></p><div class="row"><button type="button" class="btn ghost peel-open"></button><button type="button" class="btn ghost peel-all"></button><button type="button" class="btn primary peel-done"></button></div></div>`;
  document.body.append(ov);
  const $ = (s) => ov.querySelector(s);
  $('.peel-title').textContent = o.title || '';
  $('.peel-x').setAttribute('aria-label', t('close'));
  $('.peel-open').textContent = t('peel.openBtn');
  $('.peel-all').textContent = t('peel.all');
  $('.peel-done').textContent = t('peel.done');
  const cv = $('.peel-cv');
  const g = cv.getContext('2d');
  const flap = document.createElement('canvas'); // 折起來那片（先畫在這裡再加影子貼回去）
  const fg = flap.getContext('2d');
  const rand = rng(items.length * 97 + 13);
  const st = {
    phase: o.pack ? 'pack' : 'sheet',
    tear: 0, // 封口撕開多少（0–1）
    tearing: false,
    burstT: 0,
    saved: 0,
    active: null, // 正在撕的 { it, A, P, anim }
    fly: [], // 撕下來飛走的
    confetti: [],
    hintT: 0,
  };
  // 每張貼紙：版面位置（台紙的比例座標）、角度、背面、剪影
  const S = items.map((it, i) => ({
    ...it,
    i,
    rot: (rand() - 0.5) * 0.35,
    jx: (rand() - 0.5) * 0.06,
    jy: (rand() - 0.5) * 0.06,
    back: silhouette(it.img, '#fbfaf7'),
    ghost: silhouette(it.img, '#d5d9e0'),
    gone: false,
  }));
  let W = 0;
  let H = 0;
  let dpr = 1;
  let sheet = null; // 台紙的矩形
  let packR = null; // 鋁箔包的矩形
  function layout() {
    const r = $('.peel-stage').getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    cv.width = flap.width = Math.round(W * dpr);
    cv.height = flap.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    // 台紙：3:4，放得下
    const sh = Math.min(H * 0.94, (W * 0.94) / 0.75);
    sheet = { w: sh * 0.75, h: sh, x: (W - sh * 0.75) / 2, y: (H - sh) / 2 };
    const n = S.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const cw = sheet.w / cols;
    const ch = (sheet.h * 0.92) / rows;
    const size = Math.min(cw, ch) * (n <= 1 ? 0.7 : 0.8);
    S.forEach((s, i) => {
      const c = i % cols;
      const rr = Math.floor(i / cols);
      const lastRow = rr === rows - 1 ? n - rr * cols : cols; // 最後一列置中
      const off = ((cols - lastRow) * cw) / 2;
      s.x = sheet.x + off + cw * (c + 0.5) + s.jx * cw;
      s.y = sheet.y + sheet.h * 0.04 + ch * (rr + 0.5) + s.jy * ch;
      s.k = size / Math.max(s.img.width, s.img.height);
    });
    if (o.pack?.img) {
      const im = o.pack.img;
      const ph = Math.min(H * 0.82, (W * 0.78 * im.height) / im.width);
      const pw = (ph * im.width) / im.height;
      packR = { x: (W - pw) / 2, y: (H - ph) / 2, w: pw, h: ph };
    }
  }

  // ---------- 畫 ----------
  function drawPaper() {
    const { x, y, w, h } = sheet;
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0); // 高解析度螢幕（手機）
    g.shadowColor = 'rgba(20,24,40,.25)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 6;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(x, y, w, h, 18);
    g.fill();
    g.restore();
    // 台紙上淡淡的格線（剝離紙的感覺）
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.beginPath();
    g.roundRect(x, y, w, h, 18);
    g.clip();
    g.strokeStyle = 'rgba(120,140,170,.10)';
    g.lineWidth = 1;
    for (let gx = x + 14; gx < x + w; gx += 14) {
      g.beginPath();
      g.moveTo(gx, y);
      g.lineTo(gx, y + h);
      g.stroke();
    }
    g.restore();
  }
  const local = toLocal;
  const drawSticker = (s) => paintSticker(g, dpr, s);
  const progress = peelProgress;
  const drawPeeling = (s, A, P) => paintPeel(g, fg, flap, dpr, s, A, P);
  function drawGhosts() {
    for (const s of S) {
      const w = s.img.width;
      const h = s.img.height;
      g.save();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.transform(...toScreen(s));
      g.drawImage(s.ghost, -w / 2, -h / 2);
      g.restore();
    }
  }
  // 鋁箔包：封口那條（上面 TOP 比例）從左邊撕開
  const TOP = o.pack?.seal ?? 0.12;
  function drawPack(tt) {
    const { x, y, w, h } = packR;
    const im = o.pack.img;
    const ty = y + h * TOP; // 撕的線
    const ux = x + w * st.tear;
    const jag = (k) => ty + Math.sin(k * 1.7) * 2.2 + Math.sin(k * 4.3) * 1.2; // 撕口的鋸齒
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 下面（本體）：撕過的地方用鋸齒線切
    // 本體＝撕過的地方切在鋸齒線下面；還沒撕到的那段封口照樣連著
    g.save();
    g.beginPath();
    g.moveTo(x - 2, y + h + 2);
    g.lineTo(x - 2, jag(x));
    for (let px = x; px <= ux; px += 3) g.lineTo(px, jag(px));
    g.lineTo(ux, jag(ux));
    g.lineTo(ux, y - 2);
    g.lineTo(x + w + 2, y - 2);
    g.lineTo(x + w + 2, y + h + 2);
    g.closePath();
    g.clip();
    g.drawImage(im, x, y, w, h);
    g.restore();
    // 撕下來的那條：繞著撕到的點往上翹（越撕越翹）
    if (st.tear > 0 && st.tear < 1) {
      g.save();
      g.translate(ux, ty);
      g.rotate((0.08 + 0.5 * st.tear) * Math.min(1, (ux - x) / (w * 0.3)));
      g.translate(-ux, -ty);
      g.beginPath();
      g.moveTo(x - 2, y - 2);
      g.lineTo(ux, y - 2);
      g.lineTo(ux, ty);
      for (let px = ux; px >= x; px -= 3) g.lineTo(px, jag(px));
      g.closePath();
      g.clip();
      g.shadowColor = 'rgba(0,0,0,.25)';
      g.shadowBlur = 6;
      g.drawImage(im, x, y, w, h);
      g.restore();
    }
    // 標籤：第一張貼紙＋「シール ×N」
    const lc = o.pack.labelAt || { x: 0.5, y: 0.5, r: 0.2 };
    const R = w * lc.r; // 圓標籤的半徑（px）
    const cx = x + w * lc.x;
    const cy = y + h * lc.y;
    const s0 = S[0];
    if (s0) {
      const k = (R * 1.25) / Math.max(s0.img.width, s0.img.height);
      g.drawImage(s0.img, cx - (s0.img.width * k) / 2, cy - R * 0.14 - (s0.img.height * k) / 2, s0.img.width * k, s0.img.height * k);
    }
    g.fillStyle = '#3a3f66';
    g.font = `900 ${Math.round(R * 0.24)}px ${getComputedStyle(document.body).fontFamily}`;
    g.textAlign = 'center';
    g.fillText(o.pack.label || '', cx, cy + R * 0.74);
    // 提示：沿著封口的箭頭（還沒開始撕的時候一閃一閃）
    if (st.tear < 0.05) {
      const a = 0.35 + 0.35 * Math.sin(tt * 4);
      g.strokeStyle = `rgba(255,90,140,${a})`;
      g.lineWidth = 3;
      g.setLineDash([7, 7]);
      g.lineDashOffset = -tt * 30;
      g.beginPath();
      g.moveTo(x + w * 0.06, ty - h * 0.035);
      g.lineTo(x + w * 0.92, ty - h * 0.035);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = `rgba(255,90,140,${a + 0.2})`;
      g.beginPath();
      g.moveTo(x + w * 0.95, ty - h * 0.035);
      g.lineTo(x + w * 0.9, ty - h * 0.06);
      g.lineTo(x + w * 0.9, ty - h * 0.01);
      g.fill();
    }
    g.restore();
  }

  let raf = 0;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    st.hintT += dt;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    if (st.phase === 'pack') drawPack(st.hintT);
    else {
      drawPaper();
      const burst = st.phase === 'burst' ? ease(clamp(st.burstT / 0.9, 0, 1)) : 1;
      g.globalAlpha = burst * burst;
      drawGhosts();
      g.globalAlpha = 1;
      for (const s of S) {
        if (s.gone || s === st.active?.s) continue;
        if (burst < 1) {
          // 從包包口飛出來
          const ox = W / 2;
          const oy = packR ? packR.y + packR.h * 0.2 : H / 2;
          const sx = s.x;
          const sy = s.y;
          const lift = Math.sin(burst * Math.PI) * H * 0.18;
          s.x = ox + (sx - ox) * burst;
          s.y = oy + (sy - oy) * burst - lift;
          const kk = s.k;
          s.k = kk * (0.4 + 0.6 * burst);
          drawSticker(s);
          s.x = sx;
          s.y = sy;
          s.k = kk;
        } else drawSticker(s);
      }
      if (st.phase === 'burst') {
        st.burstT += dt;
        // 包包往下滑走
        if (packR) {
          g.save();
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.globalAlpha = 1 - burst;
          g.drawImage(o.pack.img, packR.x, packR.y + burst * H * 0.6, packR.w, packR.h);
          g.restore();
        }
        if (st.burstT > 0.9) {
          st.phase = 'sheet';
          renderUi();
        }
      }
      const a = st.active;
      if (a) {
        if (a.anim) {
          a.anim.t = Math.min(1, a.anim.t + dt / a.anim.dur);
          const e = ease(a.anim.t);
          a.P = { x: a.anim.from.x + (a.anim.to.x - a.anim.from.x) * e, y: a.anim.from.y + (a.anim.to.y - a.anim.from.y) * e };
          if (a.anim.t >= 1) {
            const done = a.anim.done;
            a.anim = null;
            done();
          }
        }
        if (st.active) drawPeeling(a.s, a.A, a.P);
      }
      // 撕下來的：縮小、轉一圈飛到上面的計數
      for (const f of st.fly) {
        f.t += dt / 0.55;
        const e = ease(Math.min(1, f.t));
        const s = f.s;
        const sx = s.x;
        const sy = s.y;
        const kk = s.k;
        const rr = s.rot;
        s.x = f.x0 + (W / 2 - f.x0) * e;
        s.y = f.y0 + (-30 - f.y0) * e - Math.sin(e * Math.PI) * 60;
        s.k = kk * (1 + 0.25 * Math.sin(e * Math.PI) - 0.6 * e);
        s.rot = rr + e * TAU * 0.5;
        g.save();
        g.globalAlpha = 1 - e * 0.6;
        drawSticker(s);
        g.restore();
        s.x = sx;
        s.y = sy;
        s.k = kk;
        s.rot = rr;
      }
      st.fly = st.fly.filter((f) => f.t < 1);
    }
    // 紙花
    for (const c of st.confetti) {
      c.vy += 600 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.r += c.vr * dt;
      g.save();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.translate(c.x, c.y);
      g.rotate(c.r);
      g.fillStyle = c.c;
      g.fillRect(-4, -2, 8, 4);
      g.restore();
    }
    st.confetti = st.confetti.filter((c) => c.y < H + 20);
    raf = requestAnimationFrame(frame);
  }

  function renderUi() {
    const left = S.filter((s) => !s.gone).length;
    $('.peel-count').textContent = t('peel.count', { n: st.saved, m: S.length });
    $('.peel-hint').textContent = st.phase === 'pack' ? t('peel.tearHint') : left ? t('peel.hint') : t('peel.allDone');
    $('.peel-open').hidden = st.phase !== 'pack';
    $('.peel-all').hidden = st.phase === 'pack' || !left;
    $('.peel-done').hidden = st.phase === 'pack';
  }

  function openPack() {
    if (st.phase !== 'pack') return;
    st.tear = 1;
    o.sfx?.pop?.();
    for (let i = 0; i < 60; i++) {
      st.confetti.push({ x: W / 2 + (Math.random() - 0.5) * 80, y: packR.y + packR.h * 0.12, vx: (Math.random() - 0.5) * 520, vy: -200 - Math.random() * 420, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 12, c: `hsl(${Math.floor(Math.random() * 360)},85%,70%)` });
    }
    st.phase = 'burst';
    st.burstT = 0;
    o.onOpened?.();
    renderUi();
  }
  // 撕下來 → 存
  function complete(a) {
    const s = a.s;
    s.gone = true;
    st.active = null;
    st.fly.push({ s, t: 0, x0: s.x, y0: s.y });
    st.saved++;
    o.sfx?.peel?.();
    renderUi();
    Promise.resolve(o.onSave?.(s.i)).catch(() => {});
  }
  // 自動撕（まとめて保存）：從右上角往左下拉
  function autoPeel(s) {
    return new Promise((res) => {
      const w = s.img.width / 2;
      const h = s.img.height / 2;
      const A = { x: w * 0.85, y: -h * 0.85 };
      st.active = { s, A, P: { ...A }, anim: { t: 0, dur: 0.38, from: { ...A }, to: { x: -w * 2.2, y: h * 2.2 }, done: () => (complete(st.active), res()) } };
    });
  }

  // ---------- 手指 ----------
  let pid = null;
  let tearX0 = 0;
  const capture = (id) => {
    try {
      cv.setPointerCapture(id);
    } catch (e) {
      /* 不是真的指標（測試）就算了 */
    }
  };
  let lastTick = 0;
  cv.addEventListener('pointerdown', (e) => {
    if (pid != null) return;
    const r = cv.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (st.phase === 'pack') {
      const { x, y, w, h } = packR;
      // 從封口左半邊開始劃
      if (px > x - 20 && px < x + w * (st.tear + 0.35) && py > y - 24 && py < y + h * (TOP + 0.1)) {
        pid = e.pointerId;
        capture(pid);
        st.tearing = true;
        tearX0 = px;
      }
      return;
    }
    if (st.phase !== 'sheet' || st.active) return;
    // 最上面那張（後面畫的在上面）
    for (let i = S.length - 1; i >= 0; i--) {
      const s = S[i];
      if (s.gone) continue;
      const L = local(s, px, py);
      if (Math.abs(L.x) > s.img.width / 2 || Math.abs(L.y) > s.img.height / 2) continue;
      // 只在貼紙上（看透明度）
      if (!s.hit) {
        const c = document.createElement('canvas');
        c.width = s.img.width;
        c.height = s.img.height;
        const cg = c.getContext('2d', { willReadFrequently: true });
        cg.drawImage(s.img, 0, 0);
        s.hit = cg.getImageData(0, 0, c.width, c.height).data;
      }
      const ix = Math.floor(L.x + s.img.width / 2);
      const iy = Math.floor(L.y + s.img.height / 2);
      if (s.hit[(iy * s.img.width + ix) * 4 + 3] < 40) continue;
      pid = e.pointerId;
      capture(pid);
      st.active = { s, A: L, P: { ...L } };
      o.sfx?.tap?.();
      return;
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const r = cv.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (st.tearing) {
      const { x, w } = packR;
      const u = clamp((px - x) / w, 0, 1);
      if (u > st.tear && px >= tearX0 - 10) {
        // 撕口一段一段發出聲音
        if (u - lastTick > 0.04) {
          lastTick = u;
          o.sfx?.tear?.();
        }
        st.tear = u;
      }
      if (st.tear > 0.96) {
        st.tearing = false;
        pid = null;
        openPack();
      }
      return;
    }
    const a = st.active;
    if (!a || a.anim) return;
    a.P = local(a.s, px, py);
    const p = progress(a.s, a.A, a.P);
    if (Math.abs(p - (a.tick || 0)) > 0.08) {
      a.tick = p;
      o.sfx?.peelTick?.();
    }
  });
  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    if (st.tearing) {
      st.tearing = false;
      return; // 撕到一半放手：停在那裡，下次接著撕
    }
    const a = st.active;
    if (!a || a.anim) return;
    const p = progress(a.s, a.A, a.P);
    if (p > 0.5) {
      // 超過一半 → 繼續撕下來
      const f = fold(a.A, a.P);
      const far = Math.max(a.s.img.width, a.s.img.height) * 2.2;
      a.anim = { t: 0, dur: 0.28, from: { ...a.P }, to: { x: a.A.x + f.n.x * far, y: a.A.y + f.n.y * far }, done: () => complete(a) };
    } else {
      // 彈回去
      a.anim = { t: 0, dur: 0.22, from: { ...a.P }, to: { ...a.A }, done: () => (st.active = null) };
    }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', onResize);
    removeEventListener('keydown', onKey);
    ov.remove();
    o.onClose?.(st.saved);
  }
  const onResize = () => layout();
  const onKey = (e) => e.key === 'Escape' && close();
  addEventListener('resize', onResize);
  addEventListener('keydown', onKey);
  $('.peel-x').onclick = close;
  $('.peel-done').onclick = close;
  $('.peel-open').onclick = openPack;
  $('.peel-all').onclick = async () => {
    $('.peel-all').disabled = true;
    for (const s of S) if (!s.gone && !closed) await autoPeel(s);
    $('.peel-all').disabled = false;
  };
  layout();
  renderUi();
  raf = requestAnimationFrame(frame);
  ov.peel = { S, st }; // 測試用：貼紙在畫面上的位置
  return { close };
}
