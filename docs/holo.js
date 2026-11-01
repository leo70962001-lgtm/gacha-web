// 3D 閃卡（CSS 版）：收集簿大卡、轉到時的結果卡共用 — 跟 cardkit.js 的 shader 同一套寶可夢卡做法
//   使用者 2026-10-25：「卡片把卡片的效果強化 參考寶可夢卡的作法」— 照 pokemon-cards-css（simeydotme）的分層：
//   影子 → 背景（照片＋虹色上色 tint＋雷射 shine）→ 框（＋框的雷射）→ 主體（＋主體的虹色、亮粉）→ 反光 glare → 名字牌
//   稀有度：N 只有反光、R ホロ（只有圖片背景閃，主體不閃）、SR フルアート（整張斜格紋理＋虹光）、SSR レインボー＋金框＋亮粉
//   CSS 變數：--mx/--my＝光點（%，跟著傾斜走）、--bx/--by＝雷射的位置（37–63%）、--fc＝斜多少（0–1，越斜越亮）
const MARKUP = `<div class="t-shadow"></div>
<div class="t-back"><div class="t-photo"></div><div class="t-tint"></div><div class="t-shine"></div></div>
<div class="t-face"><div class="t-frame"></div><div class="t-fshine"></div></div>
<div class="t-subj"><div class="t-simg"></div><div class="t-stint"></div><div class="t-sshine"></div></div>
<div class="t-glare"></div>
<div class="t-tag"></div>`;

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
//   位置照 cardstudio.js 的卡面（590×860）：遊戲王風正方形窗、寶可夢風橫的窗、全圖卡＝整張（效果欄、名字帶、戰力、徽章、角色標籤留在框上）
const WIN = { duel: [70, 158, 450, 450], monster: [48, 108, 494, 336], full: [11, 11, 568, 838] };
const KEEP = { full: [[24, 532, 542, 212], [16, 742, 558, 106], [250, 26, 330, 92], [4, 32, 220, 120], [534, 170, 46, 232]] };
const frames = new Map(); // style|卡面網址 → Promise<objectURL>（工房預覽一直換圖 → 只留最近 12 張）
function frameOverlay(url, style) {
  const key = style + '|' + url;
  if (frames.has(key)) return frames.get(key);
  const p = new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im); // decode() 在背景分頁不會 resolve → 用 onload
    im.onerror = () => res(null);
    im.src = url;
  }).then(async (im) => {
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
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
  });
  frames.set(key, p);
  if (frames.size > 12) {
    const [k0, p0] = frames.entries().next().value;
    frames.delete(k0);
    p0.then((u) => u && setTimeout(() => URL.revokeObjectURL(u), 5000));
  }
  return p;
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
    area.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.tilt(Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1))), true);
    });
  }

  // d＝{ t 整張圖、s 去背主體、b 背景（主體柔化）、st 主體頭頂（0–1）、r 稀有度、shape 'card'|'round'|'square'、name、tag 要不要名字牌 }
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
    el.classList.toggle('ff', d.framed === 'full'); // 全圖卡風：整張都是卡圖
    el.style.setProperty('--rc', `var(--r-${R})`);
    this.$('.t-photo').style.backgroundImage = `url("${d.s ? d.b || d.t : d.t}")`;
    this.$('.t-simg').style.backgroundImage = d.s ? `url("${d.s}")` : 'none';
    el.style.setProperty('--smask', d.s ? `url("${d.s}")` : 'none');
    this.$('.t-subj').hidden = !d.s;
    this.$('.t-tag').textContent = d.name || '';
    // カード工房的卡＋立體加工 → 最前面的框（卡面挖掉卡圖那格），做好才換上
    el.style.removeProperty('--frame');
    if (d.framed && d.s && d.t)
      frameOverlay(d.t, d.framed).then((u) => {
        if (u && this.d === d) el.style.setProperty('--frame', `url("${u}")`);
      });
    el.style.transform = '';
    this.tilt(0, 0);
    requestAnimationFrame(() => this.layout());
  }

  // 照片窗的上緣：比主體頭頂低一截（主體從窗的下緣放大 1.07 倍，算進去），最多壓到卡高的 22%
  layout() {
    const d = this.d;
    if (!d) return;
    const h = this.el.offsetHeight;
    const subjTop = h * (0.96 - (0.96 - (0.05 + 0.9 * (d.st ?? 0.3))) * 1.07);
    const bt = d.shape === 'card' && d.s ? Math.max(0, Math.min(h * 0.22 - 25, subjTop + h * 0.08 - 25)) : 0;
    this.el.style.setProperty('--bt', `${Math.round(bt)}px`);
  }

  // x、y：−1..1（右、上）
  tilt(x, y, moved = false) {
    if (moved) this.moved = performance.now();
    const s = this.el.style;
    s.transform = `rotateY(${x * 22}deg) rotateX(${-y * 16}deg)`;
    s.setProperty('--mx', `${50 + x * 45}%`);
    s.setProperty('--my', `${50 - y * 45}%`);
    s.setProperty('--bx', `${50 + x * 13}%`);
    s.setProperty('--by', `${50 - y * 13}%`);
    s.setProperty('--fc', Math.min(1, Math.hypot(x, y)).toFixed(3));
  }

  // 沒在動滑鼠／手機 → 自己慢慢晃（看得出前後層跟閃光）；isOpen() 變 false 就停
  start(isOpen) {
    live.add(this);
    this.moved = 0;
    const loop = (now) => {
      if (!isOpen()) {
        live.delete(this);
        return;
      }
      if (now - this.moved > 1200) this.tilt(Math.sin(now / 900) * 0.6, Math.sin(now / 1300 + 1) * 0.45);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
