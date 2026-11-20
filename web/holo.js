// 3D 閃卡（CSS 版）：收集簿大卡、轉到時的結果卡共用 — 跟 cardkit.js 的 shader 同一套寶可夢卡做法
//   使用者 2026-10-25：「卡片把卡片的效果強化 參考寶可夢卡的作法」— 照 pokemon-cards-css（simeydotme）的分層：
//   影子 → 背景（照片＋虹色上色 tint＋雷射 shine）→ 框（＋框的雷射）→ 主體（＋主體的虹色、亮粉）→ 反光 glare → 名字牌
//   稀有度：N 只有反光、R ホロ（只有圖片背景閃，主體不閃）、SR フルアート（整張斜格紋理＋虹光）、SSR レインボー＋金框＋亮粉
//   CSS 變數：--mx/--my＝光點（%，跟著傾斜走）、--bx/--by＝雷射的位置（37–63%）、--fc＝斜多少（0–1，越斜越亮）
//   v3（使用者 2026-11-20：「3d卡的效果參考這個 強化」＋寶可夢 SAR 全息閃卡的 3D 懸浮動圖）：
//   分區 — 暗部背景上隨角度流動的虹彩光柵（z-irid）、亮部燙金（z-foil）、線稿邊緣跟著光走的微浮雕（z-ex/z-ey），原圖顏色留著不整張染色；
//   實體 — 卡的厚度（t-edge 六層）、金屬亮邊（t-rim）、跟傾斜反方向的影子、背後呼吸的光暈（t-aura）；
//   演出 — 斜掃過的玻璃亮帶（t-sweep）、亮點上的四芒星（t-stars，亮帶掃過時最亮）、前後漂浮的光粒（t-pb／t-pf）
const ZL = '<div class="z-irid"></div><div class="z-pale"></div><div class="z-foil"></div><div class="z-ex"></div><div class="z-ey"></div>';
const MARKUP = `<div class="t-aura"></div>
<div class="t-parts t-pb"></div>
<div class="t-shadow"></div>
${'<div class="t-edge"></div>'.repeat(6)}
<div class="t-back"><div class="t-photo"></div><div class="t-tint"></div><div class="t-shine"></div>${ZL}</div>
<div class="t-face"><div class="t-frame"></div><div class="t-fshine"></div>${ZL}</div>
<div class="t-subj"><div class="t-simg"></div><div class="t-stint"></div><div class="t-sshine"></div>${ZL}</div>
<div class="t-sweep"></div>
<div class="t-rim"></div>
<div class="t-stars"></div>
<div class="t-glare"></div>
<div class="t-tag"></div>
<div class="t-parts t-pf"></div>`;

// 亮粉貼圖（黑底＋大小不一的亮點、少數十字星）：color-dodge 疊上去，黑的地方不變
let glitterSet = false;
function setGlitter() {
  if (glitterSet) return;
  glitterSet = true;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1100; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const v = Math.random();
    const b = v > 0.94 ? 1 : 0.15 + v * 0.45;
    g.fillStyle = `hsla(${Math.random() * 360}, 60%, ${Math.round(55 + b * 45)}%, ${b})`;
    g.beginPath();
    g.arc(x, y, v > 0.94 ? 1.3 : 0.5 + Math.random() * 0.7, 0, Math.PI * 2);
    g.fill();
    if (v > 0.985) {
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x - 4, y);
      g.lineTo(x + 4, y);
      g.moveTo(x, y - 4);
      g.lineTo(x, y + 4);
      g.stroke();
    }
  }
  document.documentElement.style.setProperty('--glitter', `url("${c.toDataURL('image/png')}")`);
}

// カード工房的卡＋立體加工：「往裡面做」的框（使用者 2026-11-01：「立體感往裡面做 參考寶可夢的立體卡效果」）
//   卡面挖掉卡圖那一格（＋窗邊的內陰影）＝最前面的一層；卡圖背景在最後面、主體在中間 → 斜的時候卡圖在窗裡面動，什麼都不會跑出框
//   位置照 cardstudio.js 的卡面（590×860）：遊戲王風正方形窗、寶可夢風橫的窗、全圖卡＝整張
//   全圖卡有 ui（字那層的遮罩：徽章、戰力、標籤、效果欄、名字帶的真正形狀）→ 照它留在最前面；舊卡沒有 → 只留效果欄、名字帶兩塊
const WIN = { duel: [70, 158, 450, 450], monster: [48, 108, 494, 336], full: [11, 11, 568, 838], star: [16, 16, 558, 828] };
const KEEP = { full: [[24, 532, 542, 212], [16, 742, 558, 106]] };
const frames = new Map(); // style|卡面網址|ui（背景層：b|網址|ui）→ Promise<data URL>（分區遮罩：z|網址 → Promise<{ 遮罩們 }>）
const loadIm = (url) =>
  new Promise((res) => {
    if (!url) return res(null);
    const im = new Image();
    im.onload = () => res(im); // decode() 在背景分頁不會 resolve → 用 onload
    im.onerror = () => res(null);
    im.src = url;
  });
function frameOverlay(url, style, uiUrl = null) {
  const key = style + '|' + url + '|' + (uiUrl || '');
  if (frames.has(key)) return frames.get(key);
  const p = Promise.all([loadIm(url), loadIm(uiUrl)]).then(async ([im, ui]) => {
    if (!im) return null;
    const W = 360;
    const H = Math.round((W * 860) / 590);
    const kx = W / 590;
    const ky = H / 860;
    const R = ([x, y, w, h]) => [x * kx, y * ky, w * kx, h * ky];
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0, W, H);
    const win = R(WIN[style] || WIN.duel);
    g.globalCompositeOperation = 'destination-out'; // 挖掉卡圖那格
    g.fillRect(...win);
    g.globalCompositeOperation = 'source-over';
    if (ui) {
      // 字那層：卡面照 ui 遮罩（白＝留）剪出來放回窗裡
      const u = document.createElement('canvas');
      u.width = W;
      u.height = H;
      const ug = u.getContext('2d', { willReadFrequently: true });
      ug.drawImage(ui, 0, 0, W, H);
      const ud = ug.getImageData(0, 0, W, H);
      for (let i = 0; i < ud.data.length; i += 4) ud.data[i + 3] = ud.data[i];
      ug.putImageData(ud, 0, 0);
      ug.globalCompositeOperation = 'source-in';
      ug.drawImage(im, 0, 0, W, H);
      g.drawImage(u, 0, 0);
    } else
      for (const q of KEEP[style] || []) {
        g.save();
        g.beginPath();
        g.rect(...R(q));
        g.clip();
        g.drawImage(im, 0, 0, W, H); // 字的那幾塊放回來
        g.restore();
      }
    // 窗邊的內陰影：框的影子落進窗裡（只留窗裡那一圈），放在框的後面
    const s = document.createElement('canvas');
    s.width = W;
    s.height = H;
    const sg = s.getContext('2d');
    sg.shadowColor = 'rgba(0, 0, 0, 0.6)';
    sg.shadowBlur = 16 * kx;
    sg.beginPath();
    sg.rect(-60, -60, W + 120, H + 120);
    sg.rect(...win);
    sg.fillStyle = '#000';
    sg.fill('evenodd');
    sg.shadowColor = 'transparent';
    sg.globalCompositeOperation = 'destination-in';
    sg.fillRect(...win);
    g.globalCompositeOperation = 'destination-over';
    g.drawImage(s, 0, 0);
    return c.toDataURL('image/png'); // 不用 toBlob：有動畫的頁面要等快 1 秒（見 zoneMaps）
  });
  return keep(key, p);
}
// 工房預覽一直換圖 → 只留最近 30 個（一張卡最多 5 個：框、背景、三組分區遮罩）
function keep(key, p) {
  frames.set(key, p);
  if (frames.size > 30) {
    const [k0, p0] = frames.entries().next().value;
    frames.delete(k0);
    p0.then((u) => {
      const urls = typeof u === 'string' ? [u] : u ? Object.values(u).filter((v) => typeof v === 'string' && v.startsWith('blob:')) : [];
      setTimeout(() => urls.forEach((x) => URL.revokeObjectURL(x)), 5000);
    });
  }
  return p;
}

// 分區遮罩（參考寶可夢 SAR 閃卡的做法：照圖本身的亮度、邊緣分區，原圖不重畫）：
//   dark＝暗的地方（背景、深色衣服）→ 虹彩光柵；bright＝亮的地方（金線、白色）→ 燙金反光；pale＝淺又不鮮豔（淺色背景）→ 淡淡的全息；
//   xp／xn／yp／yn＝亮度的 Sobel 梯度（四個方向各一張）→ 光從哪邊來就亮哪一張（線稿邊緣的微浮雕）；
//   stars＝最亮、彼此分開的幾個點（四芒星）；hue＝主色（光暈、光粒、亮邊的顏色）
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function zoneMaps(url) {
  const key = 'z|' + url;
  if (frames.has(key)) return frames.get(key);
  const p = loadIm(url).then(async (im) => {
    if (!im || !im.width) return null;
    const W = 300;
    const H = Math.max(8, Math.round((W * im.height) / im.width));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const n = W * H;
    const L = new Float32Array(n);
    const A = new Float32Array(n);
    const S = new Float32Array(n);
    const hues = new Float32Array(36);
    for (let i = 0; i < n; i++) {
      const r = px[i * 4] / 255;
      const gg = px[i * 4 + 1] / 255;
      const b = px[i * 4 + 2] / 255;
      const a = px[i * 4 + 3] / 255;
      L[i] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      A[i] = a;
      const mx = Math.max(r, gg, b);
      const mn = Math.min(r, gg, b);
      const s = mx ? (mx - mn) / mx : 0;
      S[i] = s;
      if (a > 0.5 && s > 0.25 && mx > 0.2) {
        let h = mx === r ? (gg - b) / (mx - mn) : mx === gg ? 2 + (b - r) / (mx - mn) : 4 + (r - gg) / (mx - mn);
        h = ((h * 60) % 360 + 360) % 360;
        hues[Math.floor(h / 10)] += s * Math.min(1, mx * 1.4);
      }
    }
    // 先糊一點（JPEG 的雜點不要變成浮雕）
    const Lb = new Float32Array(n);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let k = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            s += L[yy * W + xx];
            k++;
          }
        Lb[y * W + x] = s / k;
      }
    const GX = new Float32Array(n);
    const GY = new Float32Array(n);
    const hist = new Uint32Array(64);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = Lb[i - W + 1] + 2 * Lb[i + 1] + Lb[i + W + 1] - Lb[i - W - 1] - 2 * Lb[i - 1] - Lb[i + W - 1];
        const gy = Lb[i + W - 1] + 2 * Lb[i + W] + Lb[i + W + 1] - Lb[i - W - 1] - 2 * Lb[i - W] - Lb[i - W + 1];
        const a = A[i] * A[i - 1] * A[i + 1]; // 去背圖的外緣不算線
        GX[i] = gx * a;
        GY[i] = gy * a;
        hist[Math.min(63, Math.floor(Math.hypot(gx, gy) * a * 16))]++;
      }
    // 強度照這張圖自己的分佈（第 96 百分位＝滿）：淡的圖、濃的圖浮雕一樣明顯
    let acc = 0;
    let p96 = 63;
    const want = n * 0.96;
    for (let b = 0; b < 64; b++) {
      acc += hist[b];
      if (acc >= want) {
        p96 = b;
        break;
      }
    }
    const k = 16 / Math.max(1, p96 + 1);
    const mk = () => new ImageData(W, H);
    const D = mk();
    const B = mk();
    const P = mk();
    const XP = mk();
    const XN = mk();
    const YP = mk();
    const YN = mk();
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      for (const im2 of [D, B, P, XP, XN, YP, YN]) im2.data[o] = im2.data[o + 1] = im2.data[o + 2] = 255;
      D.data[o + 3] = 255 * A[i] * smooth(0.74, 0.16, L[i]); // 暗的最強、中間調淡淡的、很亮的（皮膚、白）不上
      B.data[o + 3] = 255 * A[i] * smooth(0.6, 0.9, L[i]);
      P.data[o + 3] = 255 * A[i] * smooth(0.55, 0.75, L[i]) * (1 - smooth(0.9, 0.97, L[i])) * (1 - smooth(0.1, 0.32, S[i])); // 淺又不鮮豔（淺色背景）：皮膚、金線、純白的衣服不算
      const gx = Math.min(1, Math.abs(GX[i]) * k);
      const gy = Math.min(1, Math.abs(GY[i]) * k);
      XP.data[o + 3] = GX[i] > 0 ? 255 * gx : 0;
      XN.data[o + 3] = GX[i] < 0 ? 255 * gx : 0;
      YP.data[o + 3] = GY[i] > 0 ? 255 * gy : 0;
      YN.data[o + 3] = GY[i] < 0 ? 255 * gy : 0;
    }
    // 四芒星：16 px 一格取最亮的點，挑亮又分得開的幾個
    const cell = 16;
    const cand = [];
    for (let cy = 0; cy < H; cy += cell)
      for (let cx = 0; cx < W; cx += cell) {
        let best = -1;
        let bx = 0;
        let by = 0;
        for (let y = cy; y < Math.min(H, cy + cell); y++)
          for (let x = cx; x < Math.min(W, cx + cell); x++) {
            const i = y * W + x;
            const v = L[i] * A[i];
            if (v > best) {
              best = v;
              bx = x;
              by = y;
            }
          }
        // 周圍要暗一點才像亮點（整片白的不算）
        let ring = 0;
        let rk = 0;
        for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6], [-4, -4], [4, 4], [-4, 4], [4, -4]]) {
          const xx = bx + dx;
          const yy = by + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          ring += L[yy * W + xx];
          rk++;
        }
        const pop = best - (rk ? ring / rk : best);
        if (best > 0.72) cand.push({ x: bx / W, y: by / H, v: best + pop * 1.5 });
      }
    cand.sort((a, b) => b.v - a.v);
    const stars = [];
    for (const s of cand) {
      if (stars.length >= 7) break;
      if (s.x < 0.06 || s.x > 0.94 || s.y < 0.04 || s.y > 0.96) continue;
      if (stars.every((t) => Math.hypot((t.x - s.x) * W, (t.y - s.y) * H) > W * 0.16)) stars.push(s);
    }
    let hi = 0;
    for (let i = 1; i < 36; i++) if (hues[i] > hues[hi]) hi = i;
    const sum = hues.reduce((a, b) => a + b, 0);
    // toDataURL（同步、7 張十幾 ms）：toBlob 在一直有動畫的頁面要等瀏覽器有空才編碼，一張要等快 1 秒
    const toUrl = (d) => {
      g.clearRect(0, 0, W, H);
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png');
    };
    const out = { ar: W / H, stars, hue: sum > n * 0.002 ? hi * 10 + 5 : null };
    for (const [name, d] of [['dark', D], ['bright', B], ['pale', P], ['xp', XP], ['xn', XN], ['yp', YP], ['yn', YN]]) out[name] = toUrl(d);
    return out;
  });
  return keep(key, p);
}
// 全圖卡的背景層：字那層（ui 白）挖掉，用四周的顏色由粗到細補回去（模糊的自己一層層墊在下面）
//   背景層在後面、斜的時候會錯開 → 沒挖掉的話徽章、戰力的字後面會再看到一份（使用者 2026-11-01：「去背的部分」）
function backFill(url, uiUrl) {
  const key = 'b|' + url + '|' + uiUrl;
  if (frames.has(key)) return frames.get(key);
  const p = Promise.all([loadIm(url), loadIm(uiUrl)]).then(async ([im, ui]) => {
    if (!im || !ui) return null;
    const W = 360;
    const H = Math.round((W * 860) / 590);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0, W, H);
    const u = document.createElement('canvas');
    u.width = W;
    u.height = H;
    const ug = u.getContext('2d', { willReadFrequently: true });
    ug.filter = 'blur(2px)'; // 放寬一點，字的毛邊也挖掉
    ug.drawImage(ui, 0, 0, W, H);
    const ud = ug.getImageData(0, 0, W, H);
    for (let i = 0; i < ud.data.length; i += 4) ud.data[i + 3] = Math.min(255, ud.data[i] * 3);
    ug.putImageData(ud, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(u, 0, 0);
    const hole = document.createElement('canvas');
    hole.width = W;
    hole.height = H;
    hole.getContext('2d').drawImage(c, 0, 0);
    g.globalCompositeOperation = 'destination-over';
    for (const r of [2, 4, 8, 16, 32, 64]) {
      g.filter = `blur(${r}px)`;
      g.drawImage(hole, 0, 0);
    }
    g.filter = 'none';
    g.fillStyle = '#20202a'; // 還補不到的（離字很遠的中間）
    g.fillRect(0, 0, W, H);
    return c.toDataURL('image/jpeg', 0.88);
  });
  return keep(key, p);
}

const live = new Set();
addEventListener('deviceorientation', (e) => {
  if (e.gamma == null) return;
  for (const h of live) h.tilt(Math.max(-1, Math.min(1, e.gamma / 25)), Math.max(-1, Math.min(1, -(e.beta - 50) / 25)), true);
});

export class Holo {
  // el＝.tilt 的那個 div；area＝滑鼠在哪個範圍移動會讓卡片跟著斜（預設 el 自己）
  constructor(el, area = el) {
    setGlitter();
    this.el = el;
    el.classList.add('tilt');
    el.innerHTML = MARKUP;
    this.$ = (c) => el.querySelector(c);
    this.moved = 0;
    this.sign = { x: 0, y: 0 };
    this.groups = []; // [{ el, maps, fit }]：有分區遮罩的那幾層（背景、框、主體）
    el.querySelectorAll('.t-edge').forEach((e, i) => {
      e.style.setProperty('--i', i + 1);
      e.style.setProperty('--ec', i % 2 ? 'var(--e2)' : 'var(--e1)'); // 深淺交錯＝拉絲金屬的側面
    });
    // 光粒：後面多一點、前面少一點；位置、大小、速度、方向都隨機，CSS 動畫自己跑（首尾接得起來）
    for (const [box, n] of [[this.$('.t-pb'), 14], [this.$('.t-pf'), 7]])
      for (let i = 0; i < n; i++) {
        const p = document.createElement('i');
        const s = p.style;
        s.setProperty('--x', `${(Math.random() * 100).toFixed(1)}%`);
        s.setProperty('--y', `${(10 + Math.random() * 85).toFixed(1)}%`);
        s.setProperty('--z', `${(1.5 + Math.random() * (box.classList.contains('t-pf') ? 3 : 2.5)).toFixed(1)}px`);
        s.setProperty('--d', `${(3.2 + Math.random() * 3.5).toFixed(2)}s`);
        s.setProperty('--dl', `${(-Math.random() * 6).toFixed(2)}s`);
        s.setProperty('--dx', `${((Math.random() - 0.5) * 30).toFixed(0)}px`);
        s.setProperty('--dy', `${(-25 - Math.random() * 45).toFixed(0)}px`);
        s.setProperty('--o', (0.45 + Math.random() * 0.55).toFixed(2));
        box.append(p);
      }
    area.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.tilt(Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1))), true);
    });
  }

  // d＝{ t 整張圖、s 去背主體、b 背景（主體柔化）、st 主體頭頂（0–1）、r 稀有度、shape 'card'|'round'|'square'、name、tag 要不要名字牌、
  //   framed カード工房的卡（duel／monster／full）、ui 全圖卡字那層的遮罩（白＝徽章、戰力、效果欄…，立體時留在最前面）}
  set(d) {
    const el = this.el;
    this.d = d;
    const R = ['n', 'r', 'sr', 'ssr'][d.r] || 'n';
    // 閃法：d.fin（店家選的表面加工）沒給就照稀有度（R ホロ、SR 紋理、SSR 金框）
    const fx = d.fin || ['none', 'holo', 'texture', 'gold'][d.r] || 'none';
    el.className = `tilt r${d.r} fx-${fx} ${d.shape === 'card' ? '' : d.shape}`;
    el.classList.toggle('pop', !!d.s);
    el.classList.toggle('no-tag', d.tag === false || !!d.framed);
    el.classList.toggle('framed', !!d.framed); // カード工房的卡：圖本身就有框
    el.classList.toggle('fm', d.framed === 'monster'); // 寶可夢風：卡圖是橫的（閃的範圍不一樣）
    el.classList.toggle('ff', d.framed === 'full' || d.framed === 'star'); // 全圖卡風、明星卡風：整張都是卡圖
    el.style.setProperty('--rc', `var(--r-${R})`);
    const back = d.s ? d.b || d.t : d.t;
    this.$('.t-photo').style.backgroundImage = `url("${back}")`;
    if (d.framed && d.s && d.ui)
      backFill(back, d.ui).then((u) => {
        if (u && this.d === d) this.$('.t-photo').style.backgroundImage = `url("${u}")`;
      });
    this.$('.t-simg').style.backgroundImage = d.s ? `url("${d.s}")` : 'none';
    el.style.setProperty('--smask', d.s ? `url("${d.s}")` : 'none');
    this.$('.t-subj').hidden = !d.s;
    this.$('.t-tag').textContent = d.name || '';
    // カード工房的卡＋立體加工 → 最前面的框（卡面挖掉卡圖那格），做好才換上
    el.style.removeProperty('--frame');
    // 分區遮罩：背景那層、主體那層、（工房的卡＋立體）最前面的框；做好才開（.zon），還沒好就跟以前一樣
    const fit = d.framed ? '0 0 / 100% 100% no-repeat' : 'center / cover no-repeat';
    this.groups = [];
    for (const g of [this.$('.t-back'), this.$('.t-face'), this.$('.t-subj')]) g.classList.remove('zon');
    el.classList.remove('zon');
    el.classList.add('zpend'); // 遮罩算好之前：先不要整張染色（算不出來才回到舊的閃法）
    el.style.removeProperty('--hue');
    this.$('.t-stars').textContent = '';
    this.stars = [];
    const zone = (g, url, opt = {}) =>
      url &&
      zoneMaps(url).then((m) => {
        if (!m || this.d !== d) return;
        const z = { el: g, maps: m, fit };
        g.style.setProperty('--zd', `url("${m.dark}") ${fit}`);
        g.style.setProperty('--zb', `url("${m.bright}") ${fit}`);
        g.style.setProperty('--zp', `url("${m.pale}") ${fit}`);
        g.classList.add('zon');
        g.classList.toggle('no-irid', !!opt.noIrid);
        this.groups.push(z);
        el.classList.add('zon');
        this.sign = { x: 0, y: 0 }; // 浮雕那兩張下次 tilt 重新挑
        this.tilt(this.x || 0, this.y || 0);
      });
    const bz = zone(this.$('.t-back'), back);
    Promise.resolve(bz).finally(() => this.d === d && el.classList.remove('zpend'));
    if (d.s) zone(this.$('.t-subj'), d.s, { noIrid: true }); // 主體保留原本的顏色：只有燙金、浮雕
    if (d.framed && d.s && d.t)
      frameOverlay(d.t, d.framed, d.ui || null).then((u) => {
        if (!u || this.d !== d) return;
        el.style.setProperty('--frame', `url("${u}")`);
        zone(this.$('.t-face'), u, { noIrid: true }); // 框、字那層：只燙金＋浮雕（不上虹彩，字才看得清楚）
      });
    // 主色＋四芒星的位置：用整張圖（d.t）算；星星那層對齊照片那層（工房的卡＝整張、照片獎品＝內縮 5% 的窗）
    if (d.t)
      zoneMaps(d.t).then((m) => {
        if (!m || this.d !== d) return;
        if (m.hue != null) el.style.setProperty('--hue', m.hue);
        this.placeStars(m, !!d.framed);
      });
    el.style.transform = '';
    this.tilt(0, 0);
    requestAnimationFrame(() => this.layout());
  }

  // 四芒星：圖上的座標（0–1）換到星星那層（cover 裁切要算進去）
  placeStars(m, framed) {
    const box = this.$('.t-stars');
    box.textContent = '';
    box.style.inset = framed ? '0' : '5%';
    const ba = this.d.shape === 'card' ? 0.686 : 1;
    const ra = m.ar;
    const n = { 0: 0, 1: 2, 2: 4, 3: 7 }[this.d.r] ?? 0;
    this.stars = [];
    for (const s of m.stars.slice(0, n)) {
      let x = s.x;
      let y = s.y;
      if (!framed) {
        if (ra > ba) x = 0.5 + (x - 0.5) * (ra / ba);
        else y = 0.5 + (y - 0.5) * (ba / ra);
      }
      if (x < 0.04 || x > 0.96 || y < 0.03 || y > 0.97) continue;
      const e = document.createElement('i');
      e.style.left = `${(x * 100).toFixed(1)}%`;
      e.style.top = `${(y * 100).toFixed(1)}%`;
      e.style.setProperty('--s', `${Math.round(28 + Math.random() * 18)}px`);
      box.append(e);
      // 亮帶（115° 的線、背景 300% 大、x y 一起移）掃到這顆星的時候 u 是多少（u 的定義在 start()）
      const wy = 0.423 / ba;
      const q = (0.906 * x + wy * y) / (0.906 + wy);
      this.stars.push({ e, u: (q + 0.22) / 1.24, ph: Math.random() * 6.28 });
    }
  }

  // 照片窗的上緣：比主體頭頂低一截（主體從窗的下緣放大 1.07 倍，算進去），最多壓到卡高的 22%
  layout() {
    const d = this.d;
    if (!d) return;
    const h = this.el.offsetHeight;
    this.el.classList.toggle('tiny', this.el.offsetWidth < 150); // 開店頁的小預覽：不放光粒、星星
    const subjTop = h * (0.96 - (0.96 - (0.05 + 0.9 * (d.st ?? 0.3))) * 1.07);
    const bt = d.shape === 'card' && d.s ? Math.max(0, Math.min(h * 0.22 - 25, subjTop + h * 0.08 - 25)) : 0;
    this.el.style.setProperty('--bt', `${Math.round(bt)}px`);
  }

  // x、y：−1..1（右、上）；fy＝上下浮（px）、rz＝Z 軸微晃（度），自己晃的時候才有
  tilt(x, y, moved = false, fy = 0, rz = 0) {
    if (moved) this.moved = performance.now();
    this.x = x;
    this.y = y;
    const s = this.el.style;
    s.transform = `translateY(${fy.toFixed(1)}px) rotateY(${x * 22}deg) rotateX(${-y * 16}deg) rotateZ(${rz.toFixed(2)}deg)`;
    s.setProperty('--mx', `${50 + x * 45}%`);
    s.setProperty('--my', `${50 - y * 45}%`);
    s.setProperty('--bx', `${50 + x * 13}%`);
    s.setProperty('--by', `${50 - y * 13}%`);
    s.setProperty('--fc', Math.min(1, Math.hypot(x, y)).toFixed(3));
    s.setProperty('--tx', x.toFixed(3));
    s.setProperty('--ty', y.toFixed(3));
    // 光從亮點那邊來：亮邊最亮的地方、浮雕亮哪一邊都跟著它
    s.setProperty('--ra', `${((Math.atan2(-y, x) * 180) / Math.PI + 90).toFixed(1)}deg`);
    s.setProperty('--ex', Math.min(1, Math.abs(x) * 1.4).toFixed(3));
    s.setProperty('--ey', Math.min(1, Math.abs(y) * 1.4).toFixed(3));
    // 浮雕：亮度當高度，面朝光的那一側亮 → 光在右（x>0）用梯度往左降的那張（xn），光在上用 yn
    const sx = x >= 0 ? 1 : -1;
    const sy = y >= 0 ? 1 : -1;
    if (this.groups.length && (sx !== this.sign.x || sy !== this.sign.y)) {
      this.sign = { x: sx, y: sy };
      for (const z of this.groups) {
        z.el.style.setProperty('--zx', `url("${sx > 0 ? z.maps.xn : z.maps.xp}") ${z.fit}`);
        z.el.style.setProperty('--zy', `url("${sy > 0 ? z.maps.yn : z.maps.yp}") ${z.fit}`);
      }
    }
  }

  // 沒在動滑鼠／手機 → 自己繞著晃（參考：Y ±17.5°、X ±10.5°、Z 輕晃、上下浮）；亮帶、星星一直跑；isOpen() 變 false 就停
  start(isOpen) {
    live.add(this);
    this.moved = 0;
    const loop = (now) => {
      if (!isOpen()) {
        live.delete(this);
        return;
      }
      if (now - this.moved > 1200) {
        const a = (now / 5200) * Math.PI * 2;
        this.tilt(Math.sin(a) * 0.8, Math.cos(a) * 0.66, false, Math.sin(a * 2) * 4, Math.sin(a + 0.8) * 1.2);
      }
      // 斜的亮帶：3.4 秒掃一次（中間停一下），斜的時候往同一邊推
      const ph = (now / 3400) % 1;
      const u = -0.35 + ph * 1.9 + (this.x || 0) * 0.12;
      this.el.style.setProperty('--sw', (0.86 - u * 0.62).toFixed(3));
      for (const s of this.stars || []) {
        const hit = Math.exp(-(((s.u - u) / 0.09) ** 2));
        s.e.style.opacity = Math.min(1, 0.18 + 0.22 * Math.sin(now / 340 + s.ph) ** 2 + hit * 1.1).toFixed(2);
        s.e.style.scale = (0.55 + hit * 0.7 + 0.1 * Math.sin(now / 260 + s.ph)).toFixed(2);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
