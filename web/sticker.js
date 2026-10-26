// シール（使用者 2026-10-26：「增加貼子的功能 跟貼子簿 … 貼紙製作後可以貼在轉蛋機上或者放進轉蛋裡」）
//   參考（網上查的）：日本的シール帳ブーム——ボンボンドロップシール（ぷっくり立體、像樹脂的ツヤ）、ふわふわ（フロッキー）、
//   オーロラ、ラメ、透明；シール帳可以撕下來重貼、拿去跟朋友交換
//   bakeSticker()：去背的圖 → 白色的割り線（ダイカットの白フチ）＋表面加工，全部畫進一張透明底的圖
//     2D 的シール帳、3D 機台上的貼紙、轉蛋獎品都用同一張
//   シール帳：localStorage 'clatter.stickers'＝{ list: [シール], pages: [{ bg, items: [{ id, x, y, r, s }] }] }；圖存在 IndexedDB

export const STICKER_FINS = ['drop', 'fuwa', 'aurora', 'glitter', 'clear', 'flat'];
export const STICKER_SHAPES = ['cut', 'circle', 'square'];
export const PAPERS = ['dot', 'grid', 'gingham', 'pastel', 'clear', 'night'];
// 手繪素材（使用者 2026-10-26：「用gemin 生成幾個手繪風的貼紙」）：Gemini 畫的一張 12 格素材表 → tools/cut_stickers.py → assets/stickers/sNN.webp
export const PRESETS = ['capsule', 'cat', 'puppy', 'strawberry', 'heart', 'star', 'rainbow', 'onigiri', 'cupcake', 'bunny', 'sakura', 'coin'];
export const presetFile = (i) => `stickers/s${String(i + 1).padStart(2, '0')}.webp`;
const FIN_CODE = { drop: 'd', fuwa: 'f', aurora: 'a', glitter: 'g', clear: 'c', flat: 'p' };
export const finCode = (f) => FIN_CODE[f] || '';
export const finFromCode = (c) => Object.keys(FIN_CODE).find((k) => FIN_CODE[k] === c) || null;

// ---------- 做貼紙 ----------
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
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
// 距離場（倒角 1／√2 兩趟）：每一格到最近的「是」的距離（px）
function distField(on, W, H) {
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = on[i] ? 0 : 1e9;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let m = d[i];
      if (!m) continue;
      if (x > 0) m = Math.min(m, d[i - 1] + a);
      if (y > 0) {
        m = Math.min(m, d[i - W] + a);
        if (x > 0) m = Math.min(m, d[i - W - 1] + b);
        if (x < W - 1) m = Math.min(m, d[i - W + 1] + b);
      }
      d[i] = m;
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let m = d[i];
      if (!m) continue;
      if (x < W - 1) m = Math.min(m, d[i + 1] + a);
      if (y < H - 1) {
        m = Math.min(m, d[i + W] + a);
        if (x < W - 1) m = Math.min(m, d[i + W + 1] + b);
        if (x > 0) m = Math.min(m, d[i + W - 1] + b);
      }
      d[i] = m;
    }
  return d;
}
// 方框模糊（水平＋垂直）
function blur(src, W, H, r) {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const n = r * 2 + 1;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * W + Math.max(0, Math.min(W - 1, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s / n;
      s += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.max(0, Math.min(H - 1, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / n;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

// 圖（canvas／ImageBitmap，可以有透明）＋遮罩（灰階，白＝主體，跟圖一樣比例）→ 正方形的貼紙圖（canvas）
//   shape：cut 沿著主體輪廓（白フチ）、circle 圓、square 圓角方形；沒有遮罩也沒有透明的照片 → 自動用 circle
//   fin：drop ボンドロ（ぷっくり＋ツヤ）、fuwa ふわふわ、aurora オーロラ、glitter ラメ、clear 透明（沒有白フチ）、flat ふつう
export function bakeSticker(src, { mask = null, shape = 'cut', fin = 'drop', size = 256, seed = 7 } = {}) {
  const S = size;
  const W = S;
  const clear = fin === 'clear';
  const border = clear ? 0 : Math.round(S * 0.045);
  const pad = border + Math.round(S * 0.035);
  const inner = S - pad * 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  // 1) 主體的顏色＋透明度
  const cut = shape === 'cut';
  // 沿輪廓：用主體自己的範圍（遮罩或透明）放大到填滿貼紙；圓形／方形：整張照片填滿形狀
  const box = cut ? subjectBox(src, mask) : { x: 0, y: 0, w: src.width, h: src.height };
  const fit = cut ? Math.min(inner / box.w, inner / box.h) : Math.max(inner / src.width, inner / src.height);
  const dw = src.width * fit;
  const dh = src.height * fit;
  const dx = (S - box.w * fit) / 2 - box.x * fit;
  const dy = (S - box.h * fit) / 2 - box.y * fit;
  g.save();
  if (!cut) {
    // 圓形／方形：整個形狀都是貼紙（照片透明的地方補白）
    g.beginPath();
    if (shape === 'circle') g.arc(S / 2, S / 2, inner / 2, 0, Math.PI * 2);
    else g.roundRect(pad, pad, inner, inner, inner * 0.16);
    g.clip();
    g.fillStyle = '#fff';
    g.fillRect(0, 0, S, S);
  }
  g.drawImage(src, dx, dy, dw, dh);
  g.restore();
  const img = g.getImageData(0, 0, S, S);
  const px = img.data;
  const A = new Float32Array(S * S);
  for (let i = 0; i < A.length; i++) A[i] = px[i * 4 + 3] / 255;
  if (cut && mask) {
    const mc = document.createElement('canvas');
    mc.width = mc.height = S;
    const mg = mc.getContext('2d', { willReadFrequently: true });
    mg.drawImage(mask, dx, dy, dw, dh);
    const md = mg.getImageData(0, 0, S, S).data;
    for (let i = 0; i < A.length; i++) A[i] *= md[i * 4] / 255;
  }
  // 2) 輪廓：主體稍微柔化去掉小雜點 → 往外長 border px＝白フチ（沒有洞的割り線）
  const As = blur(A, W, S, 2);
  const on = new Uint8Array(S * S);
  for (let i = 0; i < on.length; i++) on[i] = As[i] > 0.5 ? 1 : 0;
  const dOut = distField(on, W, S);
  let shapeA = new Float32Array(S * S);
  if (clear) shapeA = A;
  else for (let i = 0; i < shapeA.length; i++) shapeA[i] = smooth(border + 0.8, border - 0.8, dOut[i]);
  // 3) 立體：離邊緣越遠越高（ぷっくり的圓頂）→ 法線
  const off = new Uint8Array(S * S);
  for (let i = 0; i < off.length; i++) off[i] = shapeA[i] < 0.5 ? 1 : 0;
  const dIn = distField(off, W, S);
  const R = S * (fin === 'drop' ? 0.2 : 0.05);
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < hgt.length; i++) {
    const t = Math.min(1, dIn[i] / R);
    hgt[i] = Math.sqrt(1 - (1 - t) * (1 - t));
  }
  const H2 = blur(hgt, W, S, fin === 'drop' ? 3 : 1); // ボンドロ：距離場的稜線柔掉
  const L = [-0.42, -0.58, 0.7];
  const ll = Math.hypot(...L);
  const Lx = L[0] / ll;
  const Ly = L[1] / ll;
  const Lz = L[2] / ll;
  const Hx = Lx;
  const Hy = Ly;
  const Hz = Lz + 1;
  const hl = Math.hypot(Hx, Hy, Hz);
  const rand = rng(seed);
  const bump = fin === 'drop' ? 9 : fin === 'flat' ? 0.6 : 1.6;
  const out = g.createImageData(S, S);
  const o = out.data;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const sa = shapeA[i];
      if (sa <= 0.003) continue;
      const a = A[i];
      // 底色：主體疊在白フチ上（透明貼紙沒有白）
      let r = px[i * 4] / 255;
      let gg = px[i * 4 + 1] / 255;
      let b = px[i * 4 + 2] / 255;
      if (!clear) {
        r = r * a + (1 - a);
        gg = gg * a + (1 - a);
        b = b * a + (1 - a);
      }
      const hx = (H2[y * S + Math.min(S - 1, x + 1)] - H2[y * S + Math.max(0, x - 1)]) * bump;
      const hy = (H2[Math.min(S - 1, y + 1) * S + x] - H2[Math.max(0, y - 1) * S + x]) * bump;
      const nl = Math.hypot(hx, hy, 1);
      const nx = -hx / nl;
      const ny = -hy / nl;
      const nz = 1 / nl;
      const diff = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
      const nh = Math.max(0, (nx * Hx + ny * Hy + nz * Hz) / hl);
      let sh = 1;
      let add = 0;
      if (fin === 'drop') {
        sh = 0.62 + 0.5 * diff;
        // 平的地方（nh≈0.92）不加光，只有朝光的斜面亮 → 顏色不會被洗白
        add = Math.pow(nh, 60) * 1.25 + Math.pow(Math.max(0, (nh - 0.93) / 0.07), 2) * 0.3;
        // 樹脂的飽和感
        const m = (r + gg + b) / 3;
        r = m + (r - m) * 1.12;
        gg = m + (gg - m) * 1.12;
        b = m + (b - m) * 1.12;
      } else if (fin === 'fuwa') {
        sh = 0.9 + 0.12 * diff;
        add = Math.pow(1 - nz, 2) * 0.35 + (rand() - 0.5) * 0.09; // 邊緣的絨毛反光＋顆粒
        r = r * 0.94 + 0.06;
        gg = gg * 0.94 + 0.06;
        b = b * 0.94 + 0.06;
      } else if (fin === 'aurora') {
        sh = 0.84 + 0.2 * diff;
        const [rr, rg, rb] = hsl(((x + y) / S) * 520 + nx * 160 + ny * 110 + 200, 0.95, 0.62);
        const k = 0.55;
        r = 1 - (1 - r) * (1 - rr * k);
        gg = 1 - (1 - gg) * (1 - rg * k);
        b = 1 - (1 - b) * (1 - rb * k);
        add = Math.pow(nh, 40) * 0.7;
      } else if (fin === 'glitter') {
        sh = 0.84 + 0.2 * diff;
        add = Math.pow(nh, 30) * 0.45;
      } else if (fin === 'clear') {
        sh = 0.86 + 0.2 * diff;
        add = Math.pow(nh, 60) * 0.9;
      } else sh = 0.97 + 0.04 * diff;
      // 割り線的外緣稍微暗一點（白色機身上也看得到邊）
      if (!clear && dOut[i] > border - 1.6) sh *= 0.86;
      o[i * 4] = Math.min(255, (r * sh + add) * 255);
      o[i * 4 + 1] = Math.min(255, (gg * sh + add) * 255);
      o[i * 4 + 2] = Math.min(255, (b * sh + add) * 255);
      o[i * 4 + 3] = Math.round(255 * (clear ? Math.min(1, a * 0.92 + add * 0.3) : sa));
    }
  g.clearRect(0, 0, S, S);
  g.putImageData(out, 0, 0);
  // ラメ：亮點（大小不一、少數十字星），只畫在貼紙上
  if (fin === 'glitter') {
    g.globalCompositeOperation = 'source-atop';
    const n = Math.round(S * S * 0.012);
    for (let k = 0; k < n; k++) {
      const x = rand() * S;
      const y = rand() * S;
      const big = rand() > 0.93;
      g.fillStyle = `hsla(${Math.floor(rand() * 360)}, 95%, ${big ? 96 : 75 + rand() * 22}%, ${0.7 + rand() * 0.3})`;
      g.beginPath();
      g.arc(x, y, big ? S * 0.006 : S * (0.002 + rand() * 0.003), 0, Math.PI * 2);
      g.fill();
      if (big) {
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.lineWidth = S * 0.003;
        g.beginPath();
        g.moveTo(x - S * 0.02, y);
        g.lineTo(x + S * 0.02, y);
        g.moveTo(x, y - S * 0.02);
        g.lineTo(x, y + S * 0.02);
        g.stroke();
      }
    }
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}

// 主體的範圍（原圖座標）：遮罩（白＝主體）或圖本身的透明；找不到就整張
function subjectBox(src, mask) {
  const N = 128;
  const k = N / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * k));
  const h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(mask || src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if ((mask ? d[i] : d[i + 3]) < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return { x: 0, y: 0, w: src.width, h: src.height };
  return { x: x0 / k, y: y0 / k, w: Math.max(1, x1 - x0 + 1) / k, h: Math.max(1, y1 - y0 + 1) / k };
}

// 照片看起來是不是已經去背了（夠多的透明格）
export function hasAlpha(src) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) n++;
  return n > S * S * 0.05;
}

export function toBlob(c, q = 0.9) {
  return new Promise((res) =>
    c.toBlob((b) => (b && b.type === 'image/webp' ? res(b) : c.toBlob(res, 'image/png')), 'image/webp', q),
  );
}

// ---------- 存放：圖在 IndexedDB、目錄在 localStorage ----------
let dbp = null;
function db() {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('clatter-stickers', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('img');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  return dbp;
}
const memory = new Map(); // IndexedDB 不能用（無痕模式）→ 先放記憶體
const urls = new Map();
async function putImg(id, blob) {
  const d = await db();
  if (!d) return memory.set(id, blob);
  await new Promise((res, rej) => {
    const tx = d.transaction('img', 'readwrite');
    tx.objectStore('img').put(blob, id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }).catch(() => memory.set(id, blob));
}
export async function stickerBlob(id) {
  if (memory.has(id)) return memory.get(id);
  const d = await db();
  if (!d) return null;
  return new Promise((res) => {
    const r = d.transaction('img').objectStore('img').get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => res(null);
  });
}
export async function stickerUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const b = await stickerBlob(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}
async function delImg(id) {
  memory.delete(id);
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
  const d = await db();
  if (d) d.transaction('img', 'readwrite').objectStore('img').delete(id);
}

const KEY = 'clatter.stickers';
export function loadBook() {
  let b = null;
  try {
    b = JSON.parse(localStorage.getItem(KEY));
  } catch (e) {
    b = null;
  }
  if (!b || !Array.isArray(b.list)) b = { list: [], pages: [] };
  if (!Array.isArray(b.pages) || !b.pages.length) b.pages = PAPERS.slice(0, 3).map((bg) => ({ bg, items: [] }));
  for (const p of b.pages) {
    if (!PAPERS.includes(p.bg)) p.bg = 'dot';
    if (!Array.isArray(p.items)) p.items = [];
  }
  return b;
}
export function saveBook(b) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch (e) {
    /* 無痕模式等存不了就算了 */
  }
}
export const placedCount = (b, id) => b.pages.reduce((n, p) => n + p.items.filter((x) => x.id === id).length, 0);
export const available = (b, s) => Math.max(0, (s.n || 1) - placedCount(b, s.id));

// 新增一張（同一台機台的同一個獎品再轉到 → 張數 +1，不重做）
export async function addSticker(canvas, meta) {
  const b = loadBook();
  const same = meta.key && b.list.find((s) => s.key === meta.key);
  if (same) {
    same.n = (same.n || 1) + 1;
    same.ts = Date.now();
    saveBook(b);
    return same;
  }
  const id = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await putImg(id, await toBlob(canvas));
  const s = { id, name: String(meta.name || '').slice(0, 24), fin: STICKER_FINS.includes(meta.fin) ? meta.fin : 'drop', shape: meta.shape || 'cut', n: 1, src: meta.src || 'made', from: meta.from || '', key: meta.key || '', ts: Date.now() };
  const b2 = loadBook(); // 存圖的時候可能有別的改動
  b2.list.unshift(s);
  saveBook(b2);
  return s;
}
// 丟掉一張（沒貼的那幾張才能丟）；全部沒了 → 連圖一起刪
export async function trashOne(id) {
  const b = loadBook();
  const s = b.list.find((x) => x.id === id);
  if (!s || available(b, s) < 1) return false;
  s.n = (s.n || 1) - 1;
  if (s.n <= 0) {
    b.list = b.list.filter((x) => x !== s);
    await delImg(id);
  }
  saveBook(b);
  return true;
}
