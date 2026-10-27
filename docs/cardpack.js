// 卡帶出去（使用者 2026-10-28：「嘗試加入這個」— 主題卡可以落地的地方）
//   App 內主題：顏色跟著卡走、開場動畫＋音效、分頁圖示（網頁 App 全部自己控制得到）
//   其他的網頁沒辦法直接改（換桌布、iMessage 貼圖包、.watchface、聯絡人海報、別人家的頭像都要使用者自己按）
//     → 照每個地方的尺寸畫好圖，手機用分享選單「存到照片」，電腦直接下載；一次很多張的打包成 zip
//   素材：鎖定畫面／主畫面桌布（照這台手機的解析度）、全部的卡做成一組桌布（照片隨機顯示）、聯絡人海報、
//         Apple Watch 照片錶面、頭像、小紅書分享圖、Discord 橫幅、貼圖（透明 PNG）、App 圖示
import { drawArtwork, drawFace, loadImg, avgColor, cover, rrect, star, rng, hashStr, canvas, mix, rgb, drawPrimaryLogo, appIcon, drawQr, fmtNo, nf, memberStats } from './member.js';
import { bakeSticker } from './sticker.js';

// ---------- 尺寸 ----------
// 桌布：這台手機的實際像素（直的）；電腦上用 iPhone 16 的 1179×2556
export function phoneSize() {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (!touch) return [1179, 2556];
  const d = Math.min(3, devicePixelRatio || 1);
  const a = Math.round(Math.min(screen.width, screen.height) * d);
  const b = Math.round(Math.max(screen.width, screen.height) * d);
  return a > 300 && b > a ? [a, b] : [1179, 2556];
}

// 主題色（照片平均色 → 色相）
async function baseColor(face) {
  const im = face && (await loadImg(face.b || face.t));
  return im ? avgColor(im) : [70, 80, 130];
}
function hsl(c) {
  const [r, g, b] = c.map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
const H = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

// 去背圖四周的透明切掉（收集簿的主體圖跟卡一樣大，主體只佔一部分）
const trimmed = new Map();
function trim(im) {
  if (trimmed.has(im)) return trimmed.get(im);
  const W = im.width;
  const Hh = im.height;
  const c = canvas(W, Hh);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, W, Hh).data;
  let x0 = W;
  let y0 = Hh;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  let out = im;
  if (x1 > x0 && y1 > y0) {
    out = canvas(x1 - x0 + 1, y1 - y0 + 1);
    out.getContext('2d').drawImage(im, -x0, -y0);
  }
  trimmed.set(im, out);
  return out;
}

// 去背主體描一圈白邊（像貼紙）再畫上去：底部對齊 (cx, bottom)，高 h（太寬就縮到 maxW）
async function drawSubject(g, face, cx, bottom, h, outline = true, maxW = Infinity) {
  const s0 = await loadImg(face.s);
  if (!s0) return false;
  const s = trim(s0);
  let w = (s.width / s.height) * h;
  if (w > maxW) {
    w = maxW;
    h = (w * s.height) / s.width;
  }
  const x = cx - w / 2;
  const y = bottom - h;
  if (outline) {
    const r = Math.max(2, h * 0.012);
    const c = canvas(Math.ceil(w + r * 4), Math.ceil(h + r * 4));
    const cg = c.getContext('2d');
    for (let a = 0; a < 16; a++) cg.drawImage(s, r * 2 + Math.cos((a / 16) * Math.PI * 2) * r, r * 2 + Math.sin((a / 16) * Math.PI * 2) * r, w, h);
    cg.globalCompositeOperation = 'source-in';
    cg.fillStyle = '#fff';
    cg.fillRect(0, 0, c.width, c.height);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = h * 0.03;
    g.shadowOffsetY = h * 0.012;
    g.drawImage(c, x - r * 2, y - r * 2);
    g.restore();
  }
  g.drawImage(s, x, y, w, h);
  return true;
}

// 平的色底＋網點（聯絡人海報、頭像）
function flatBg(g, W, Hh, base, dark = 0.35) {
  const [h, s] = hsl(base);
  const gr = g.createLinearGradient(0, 0, W * 0.4, Hh);
  gr.addColorStop(0, H(h, Math.max(0.45, s), 0.62 - dark * 0.2));
  gr.addColorStop(1, H(h + 25, Math.max(0.45, s), 0.42 - dark * 0.2));
  g.fillStyle = gr;
  g.fillRect(0, 0, W, Hh);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  const step = Math.max(W, Hh) / 40;
  for (let y = 0; y < Hh; y += step)
    for (let x = ((y / step) % 2) * (step / 2); x < W; x += step) {
      g.beginPath();
      g.arc(x, y, step * 0.16 * (0.4 + (y / Hh) * 0.9), 0, Math.PI * 2);
      g.fill();
    }
}

// ---------- 每一種素材 ----------
// draw(face, info, W, H) → canvas；info＝{ name, stats, faces, invite, id, t }
export const PACK = [
  {
    id: 'lock',
    size: () => phoneSize(),
    type: 'image/jpeg',
    // 時鐘在上面 → 卡放低一點；有去背的卡 iOS 可能會自己做景深（主體蓋到時鐘）
    draw: (face, info, W, Hh) => drawArtwork(face, W, Hh, { cy: 0.62, cw: face?.kind === 'card' ? 0.6 : 0.66 }),
  },
  {
    id: 'home',
    size: () => phoneSize(),
    type: 'image/jpeg',
    // 主畫面上面有一堆圖示 → 安靜一點：模糊的照片＋主題色＋小星星，不放卡
    async draw(face, info, W, Hh) {
      const c = canvas(W, Hh);
      const g = c.getContext('2d');
      const base = await baseColor(face);
      const gr = g.createLinearGradient(0, 0, 0, Hh);
      gr.addColorStop(0, rgb(mix(base, [255, 255, 255], 0.15)));
      gr.addColorStop(1, rgb(mix(base, [10, 12, 24], 0.55)));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, Hh);
      const im = face && (await loadImg(face.b || face.t));
      if (im) {
        g.save();
        g.globalAlpha = 0.55;
        g.filter = `blur(${Math.round(W * 0.06)}px) saturate(1.4)`;
        cover(g, im, -W * 0.2, -Hh * 0.1, W * 1.4, Hh * 1.2);
        g.restore();
      }
      const rand = rng(hashStr((face?.id || 'x') + 'home'));
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(255,255,255,${0.12 + rand() * 0.3})`;
        star(g, rand() * W, rand() * Hh, W * (0.006 + rand() * 0.016));
      }
      return c;
    },
  },
  {
    id: 'shuffle',
    many: true, // 全部的卡各一張 → zip／一次分享
    size: () => phoneSize(),
    type: 'image/jpeg',
    draw: (face, info, W, Hh) => drawArtwork(face, W, Hh, { cy: 0.62, cw: face?.kind === 'card' ? 0.6 : 0.66 }),
  },
  {
    id: 'poster',
    size: () => phoneSize(),
    type: 'image/jpeg',
    // 聯絡人海報：上面是名字 → 主體放大從底部長上來；沒有去背就放一張大卡
    async draw(face, info, W, Hh) {
      const c = canvas(W, Hh);
      const g = c.getContext('2d');
      flatBg(g, W, Hh, await baseColor(face));
      if (!face || !(await drawSubject(g, face, W / 2, Hh * 0.96, Hh * 0.66, true, W * 0.96))) if (face) await drawFace(g, face, W / 2, Hh * 0.6, W * 0.7);
      return c;
    },
  },
  {
    id: 'watch',
    size: () => [410, 502], // Apple Watch 46 mm 照片錶面
    type: 'image/jpeg',
    async draw(face, info, W, Hh) {
      const c = canvas(W, Hh);
      const g = c.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, Hh);
      const base = await baseColor(face);
      const glow = g.createRadialGradient(W / 2, Hh * 0.6, 0, W / 2, Hh * 0.6, W * 0.75);
      glow.addColorStop(0, rgb(mix(base, [255, 255, 255], 0.2)) );
      glow.addColorStop(0.5, rgb(mix(base, [0, 0, 0], 0.6)));
      glow.addColorStop(1, '#000');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, Hh);
      // 時間在上面 → 卡放在下半
      if (face) await drawFace(g, face, W / 2, Hh * 0.62, face.kind === 'card' ? W * 0.46 : W * 0.56);
      return c;
    },
  },
  {
    id: 'avatar',
    size: () => [640, 640],
    type: 'image/jpeg',
    // 頭像會被裁成圓的 → 東西放中間
    async draw(face, info, W, Hh) {
      const c = canvas(W, Hh);
      const g = c.getContext('2d');
      flatBg(g, W, Hh, await baseColor(face), 0.1);
      if (!face) return c;
      if (!(await drawSubject(g, face, W / 2, Hh * 0.95, Hh * 0.8, true, W * 0.8))) {
        const t = await loadImg(face.t);
        g.save();
        g.beginPath();
        g.arc(W / 2, Hh / 2, W * 0.42, 0, Math.PI * 2);
        g.clip();
        if (t) cover(g, t, W * 0.08, Hh * 0.08, W * 0.84, Hh * 0.84);
        g.restore();
        g.lineWidth = W * 0.025;
        g.strokeStyle = '#fff';
        g.beginPath();
        g.arc(W / 2, Hh / 2, W * 0.42, 0, Math.PI * 2);
        g.stroke();
      }
      return c;
    },
  },
  {
    id: 'xhs',
    size: () => [1080, 1440], // 小紅書 3:4
    type: 'image/jpeg',
    async draw(face, info, W, Hh) {
      const c = canvas(W, Hh);
      const g = c.getContext('2d');
      const top = Math.round(Hh * 0.74);
      g.drawImage(await drawArtwork(face, W, top, { cy: 0.5, cw: face?.kind === 'card' ? 0.46 : 0.5 }), 0, 0);
      const base = await baseColor(face);
      g.fillStyle = rgb(mix(base, [10, 12, 24], 0.78));
      g.fillRect(0, top, W, Hh - top);
      const k = W / 1080;
      g.drawImage(await drawPrimaryLogo(Math.round(64 * k)), 48 * k, 44 * k);
      const body = '"Huninn", "Noto Sans TC", system-ui, sans-serif';
      const num = '"Dela Gothic One", "Huninn", system-ui, sans-serif';
      const { t, stats } = info;
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#ffd678';
      g.font = `700 ${30 * k}px ${body}`;
      g.fillText(`${t('mb.member')} · ${t('mb.tier' + stats.tier)}`, 56 * k, top + 70 * k);
      g.fillStyle = '#fff';
      g.font = `${64 * k}px ${num}`;
      g.fillText(info.name || t('mb.member'), 56 * k, top + 150 * k, W - 420 * k);
      g.font = `${40 * k}px ${num}`;
      g.fillText(`${nf(stats.points)} ${t('mb.points')}`, 56 * k, top + 230 * k);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.font = `700 ${30 * k}px ${body}`;
      g.fillText(`${t('mb.col')} ${t('mb.pieces', { k: stats.kinds, n: stats.pieces })}`, 56 * k, top + 290 * k);
      if (info.invite) {
        const q = await drawQr(canvas(1, 1), info.invite, 260 * k).catch(() => null);
        if (q) {
          const s = 240 * k;
          const x = W - 56 * k - s;
          const y = top + (Hh - top - s - 40 * k) / 2;
          g.fillStyle = '#fff';
          rrect(g, x - 12 * k, y - 12 * k, s + 24 * k, s + 64 * k, 20 * k);
          g.fill();
          g.drawImage(q, x, y, s, s);
          g.fillStyle = '#333';
          g.textAlign = 'center';
          g.font = `700 ${22 * k}px ${body}`;
          g.fillText(t('pk.scanMe'), x + s / 2, y + s + 36 * k);
          g.textAlign = 'left';
        }
      }
      return c;
    },
  },
  {
    id: 'discord',
    size: () => [1360, 480], // Discord 個人橫幅 17:6（680×240 的兩倍）
    type: 'image/jpeg',
    async draw(face, info, W, Hh) {
      const c = canvas(W, Hh);
      const g = c.getContext('2d');
      const base = await baseColor(face);
      const gr = g.createLinearGradient(0, 0, W, Hh);
      gr.addColorStop(0, rgb(mix(base, [10, 12, 24], 0.35)));
      gr.addColorStop(1, rgb(mix(base, [10, 12, 24], 0.8)));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, Hh);
      const rand = rng(hashStr((face?.id || 'x') + 'dc'));
      for (let i = 0; i < 50; i++) {
        g.fillStyle = `rgba(255,255,255,${0.1 + rand() * 0.35})`;
        star(g, rand() * W, rand() * Hh, Hh * (0.008 + rand() * 0.02));
      }
      // 收藏最好的 5 張排成扇形（主題卡在中間）
      const list = [face, ...info.faces.filter((f) => f.id !== face?.id)].filter(Boolean).slice(0, 5);
      const order = [3, 1, 0, 2, 4].filter((i) => i < list.length);
      const n = order.length;
      for (let k = 0; k < n; k++) {
        const i = order[k];
        const f = list[i];
        const off = k - (n - 1) / 2;
        g.save();
        g.translate(W * 0.64 + off * Hh * 0.42, Hh * 0.55 + Math.abs(off) * Hh * 0.05);
        g.rotate(off * 0.12);
        await drawFace(g, f, 0, 0, Hh * (f.kind === 'card' ? 0.44 : 0.52) * (i === 0 ? 1.12 : 1), { plain: true });
        g.restore();
      }
      g.drawImage(await drawPrimaryLogo(Math.round(Hh * 0.13)), Hh * 0.1, Hh * 0.1);
      const num = '"Dela Gothic One", "Huninn", system-ui, sans-serif';
      g.fillStyle = '#ffd678';
      g.font = `${Hh * 0.075}px ${num}`;
      g.fillText(info.t('mb.tier' + info.stats.tier), Hh * 0.1, Hh * 0.72);
      g.fillStyle = '#fff';
      g.font = `${Hh * 0.11}px ${num}`;
      g.fillText(`${nf(info.stats.points)}`, Hh * 0.1, Hh * 0.86);
      return c;
    },
  },
  {
    id: 'sticker',
    size: () => [512, 512],
    type: 'image/png',
    // 透明 PNG：有去背沿輪廓、沒有就圓的（卡：方的）；白フチ＋ぷっくり
    async draw(face, info, W) {
      if (!face) return canvas(W, W);
      const subj = await loadImg(face.s);
      let src = subj;
      if (!src) {
        const c = canvas(400, 400);
        await drawFace(c.getContext('2d'), face, 200, 200, face.kind === 'card' ? 260 : 380, { plain: true });
        src = c;
      }
      return bakeSticker(src, { shape: subj ? 'cut' : 'square', fin: ['drop', 'drop', 'aurora', 'glitter'][face.r] || 'drop', size: W, seed: hashStr(face.id) % 97 });
    },
  },
  {
    id: 'icon',
    size: () => [1024, 1024],
    type: 'image/png',
    draw: (face, info, W) => drawIcon(face, W),
  },
];

// App 圖示：主題色底＋卡（主體）放中間；iOS 會自己切圓角，所以畫滿
export async function drawIcon(face, S) {
  const c = canvas(S, S);
  const g = c.getContext('2d');
  flatBg(g, S, S, await baseColor(face), 0.1);
  if (!face) return c;
  if (!(await drawSubject(g, face, S / 2, S * 0.92, S * 0.78, S >= 96, S * 0.8))) await drawFace(g, face, S / 2, S / 2, face.kind === 'card' ? S * 0.55 : S * 0.78, { plain: true });
  return c;
}

// ---------- 存檔 ----------
const toBlob = (c, type) => new Promise((res) => c.toBlob(res, type, 0.9));
const ext = (type) => (type === 'image/png' ? 'png' : 'jpg');
const safe = (s) => (s || 'card').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
// 手機：分享選單（可以「儲存 N 張影像」到照片）；不行就下載（很多張打成 zip）
export const canShareFiles = (files) => !!(navigator.canShare && matchMedia('(pointer: coarse)').matches && navigator.canShare({ files }));
export async function shareFiles(files) {
  await navigator.share({ files });
}
export async function downloadFiles(files, zipName) {
  if (files.length === 1) return dl(files[0], files[0].name);
  const { zipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm');
  const z = {};
  for (const f of files) z[f.name] = [new Uint8Array(await f.arrayBuffer()), { level: 0 }];
  dl(new Blob([zipSync(z)], { type: 'application/zip' }), zipName);
}
function dl(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// 做好一種素材的檔案（many＝全部的卡各一張，progress(i, n)）
export async function makeFiles(spec, face, info, progress) {
  const [W, Hh] = spec.size();
  const list = spec.many ? info.faces.slice(0, 24) : [face];
  const files = [];
  for (let i = 0; i < list.length; i++) {
    progress?.(i, list.length);
    const c = await spec.draw(list[i], info, W, Hh);
    const b = await toBlob(c, spec.type);
    files.push(new File([b], `clatter-${spec.id}-${list.length > 1 ? String(i + 1).padStart(2, '0') + '-' : ''}${safe(list[i]?.name)}.${ext(spec.type)}`, { type: spec.type }));
  }
  return files;
}

// ---------- App 內主題 ----------
// 卡的色相 → 主色、底色（亮／暗兩套），開場動畫，分頁圖示
// 主色上面是白字（按鈕）→ 調暗到跟原本的紅一樣看得清楚（亮度 ≤ 0.19；黃色系會變成土黃／橄欖）
function lum(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}
function fitL(h, s, l, max) {
  while (l > 0.2 && lum(h, s, l) > max) l -= 0.01;
  return l;
}
export async function themeVars(face) {
  const [h, s] = hsl(await baseColor(face));
  const sat = Math.min(0.85, Math.max(0.5, s + 0.15));
  return {
    light: { '--accent': H(h, sat, fitL(h, sat, 0.46, 0.19)), '--bg': H(h, 0.35, 0.93), '--stage': H(h, 0.32, 0.89), '--floor': H(h, 0.28, 0.85) },
    dark: { '--accent': H(h, sat, fitL(h, sat, 0.62, 0.3)), '--bg': H(h, 0.3, 0.09), '--stage': H(h, 0.3, 0.13), '--floor': H(h, 0.26, 0.15) },
  };
}
export async function applyAppTheme(face, on) {
  let el = document.getElementById('card-theme');
  if (!on || !face) {
    el?.remove();
    setIcons(null);
    return;
  }
  const v = await themeVars(face);
  const decl = (o) => Object.entries(o).map(([k, x]) => `${k}: ${x};`).join(' ');
  if (!el) {
    el = document.createElement('style');
    el.id = 'card-theme';
  }
  // 頁面的樣式在 body 裡（artifact 格式）→ 主題要放在它後面才蓋得過去
  if (el !== document.body.lastElementChild) {
    document.body.append(el);
  }
  el.textContent = `:root { ${decl(v.light)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${decl(v.dark)} } }
:root[data-theme="dark"] { ${decl(v.dark)} }`;
  setIcons(face);
}

// 分頁圖示＋「加入主畫面」用的圖示（已經裝好的 App 圖示改不了）
const origIcons = new Map();
async function setIcons(face) {
  for (const [rel, S] of [['icon', 64], ['apple-touch-icon', 180]]) {
    let l = document.querySelector(`link[rel="${rel}"]`);
    if (!l) {
      if (!face) continue;
      l = document.createElement('link');
      l.rel = rel;
      document.head.append(l);
    }
    if (!origIcons.has(rel)) origIcons.set(rel, l.getAttribute('href'));
    if (face) {
      l.type = 'image/png';
      l.removeAttribute('sizes');
      l.href = (await drawIcon(face, S)).toDataURL('image/png');
    } else if (origIcons.get(rel)) l.href = origIcons.get(rel);
  }
}

// 開場動畫：卡轉進來 →「點一下開始」→ 點了才有聲音（瀏覽器要先點一下才能出聲）→ 光一閃收掉；5 秒沒點就安靜地淡出
export async function cardSplash(face, { t, sfx, unlock }) {
  if (!face) return;
  const ov = document.createElement('div');
  ov.className = 'card-splash';
  const [h] = hsl(await baseColor(face));
  ov.style.setProperty('--sh', Math.round(h));
  const c = canvas(520, 700);
  await drawFace(c.getContext('2d'), face, 260, 350, face.kind === 'card' ? 360 : 440);
  const card = document.createElement('img');
  card.className = 'cs-card';
  card.src = c.toDataURL('image/png');
  card.alt = face.name;
  const rays = document.createElement('div');
  rays.className = 'cs-rays r' + face.r;
  const name = document.createElement('p');
  name.className = 'cs-name';
  name.textContent = face.name;
  const tap = document.createElement('p');
  tap.className = 'cs-tap';
  tap.textContent = t('pk.tapStart');
  ov.append(rays, card, name, tap);
  document.body.append(ov);
  let done = false;
  const close = (loud) => {
    if (done) return;
    done = true;
    if (loud) {
      unlock?.();
      sfx?.flip?.();
      setTimeout(() => sfx?.reveal?.(face.r | 0), 120);
      ov.classList.add('burst');
    }
    ov.classList.add('out');
    setTimeout(() => ov.remove(), loud ? 900 : 600);
  };
  ov.addEventListener('pointerdown', () => close(true), { once: true });
  setTimeout(() => close(false), 5000);
}

// 素材包分頁要的資料
export function packInfo(album, faces, d) {
  const w = d.wallet();
  return { t: d.t, name: d.myName(), stats: memberStats(album), faces, invite: w ? d.inviteUrl(w.id) : null, id: w?.id ? fmtNo(w.id) : '' };
}
export { appIcon };
