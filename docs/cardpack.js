// 卡帶出去（使用者 2026-10-28：「嘗試加入這個」— 主題卡可以落地的地方）
//   App 內主題：顏色跟著卡走、開場動畫＋音效、分頁圖示（網頁 App 全部自己控制得到）
//   其他的網頁沒辦法直接改（換桌布、iMessage 貼圖包、.watchface、聯絡人海報、別人家的頭像都要使用者自己按）
//     → 照每個地方的尺寸畫好圖，手機用分享選單「存到照片」，電腦直接下載；一次很多張的打包成 zip
//   素材：鎖定畫面／主畫面桌布（照這台手機的解析度）、全部的卡做成一組桌布（照片隨機顯示）、聯絡人海報、
//         Apple Watch 照片錶面、頭像、小紅書分享圖、Discord 橫幅、貼圖（透明 PNG）、App 圖示
//   分享到朋友圈的平台（使用者 2026-10-30：「增加分享到朋友圈的平台」）：照各家動態牆的比例各做一張
//     1:1 微信朋友圈・LINE VOOM・微博、4:5 IG・Threads・FB、9:16 限時動態、16:9 X；有網頁發文連結的直接帶文字＋連結過去（圖要自己附）
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

// ---------- 分享圖共用 ----------
const BODY = '"Huninn", "Noto Sans TC", system-ui, sans-serif';
const NUM = '"Dela Gothic One", "Huninn", system-ui, sans-serif';
// 會員資料四行：會員・等級／名字／積分／收集數（(x, y)＝左上角，k＝字的倍率，高約 260k）
function drawStats(g, info, x, y, k, maxW) {
  const { t, stats } = info;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = '#ffd678';
  g.font = `700 ${30 * k}px ${BODY}`;
  g.fillText(`${t('mb.member')} · ${t('mb.tier' + stats.tier)}`, x, y + 30 * k);
  g.fillStyle = '#fff';
  g.font = `${64 * k}px ${NUM}`;
  g.fillText(info.name || t('mb.member'), x, y + 110 * k, maxW);
  g.font = `${40 * k}px ${NUM}`;
  g.fillText(`${nf(stats.points)} ${t('mb.points')}`, x, y + 190 * k);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.font = `700 ${30 * k}px ${BODY}`;
  g.fillText(`${t('mb.col')} ${t('mb.pieces', { k: stats.kinds, n: stats.pieces })}`, x, y + 250 * k);
}
// 加好友 QR：白底＋「掃碼加我好友」（(x, y)＝QR 左上角，邊長 s；整塊高 s＋52k）；沒有會員號就不畫
async function drawInviteQr(g, info, x, y, s, k) {
  if (!info.invite) return;
  const q = await drawQr(canvas(1, 1), info.invite, s * 1.08).catch(() => null);
  if (!q) return;
  g.fillStyle = '#fff';
  rrect(g, x - 12 * k, y - 12 * k, s + 24 * k, s + 64 * k, 20 * k);
  g.fill();
  g.drawImage(q, x, y, s, s);
  g.fillStyle = '#333';
  g.textAlign = 'center';
  g.font = `700 ${22 * k}px ${BODY}`;
  g.fillText(info.t('pk.scanMe'), x + s / 2, y + s + 36 * k, s + 8 * k); // QR 小的時候字縮進白底裡
  g.textAlign = 'left';
}
// 直的、方的動態牆分享圖（小紅書、朋友圈、IG…）：上面是卡，下面一條深色的會員資料＋加好友 QR
async function feedCard(face, info, W, Hh) {
  const c = canvas(W, Hh);
  const g = c.getContext('2d');
  const k = W / 1080;
  const top = Math.round(Hh - 374 * k);
  // 卡照平常的大小；正方形這種矮的，縮到上下各留 8%
  const card = face?.kind === 'card';
  const cw = Math.min(card ? 0.46 : 0.5, (top * 0.84) / (W * (card ? 350 / 240 : 1)));
  g.drawImage(await drawArtwork(face, W, top, { cy: 0.5, cw }), 0, 0);
  g.fillStyle = rgb(mix(await baseColor(face), [10, 12, 24], 0.78));
  g.fillRect(0, top, W, Hh - top);
  g.drawImage(await drawPrimaryLogo(Math.round(64 * k)), 48 * k, 44 * k);
  drawStats(g, info, 56 * k, top + 40 * k, k, W - 420 * k);
  const s = 240 * k;
  await drawInviteQr(g, info, W - 56 * k - s, top + (Hh - top - s - 40 * k) / 2, s, k);
  return c;
}

// 發文連結：網頁沒辦法把圖塞進別人的 App → 只帶文字＋連結，圖（先存到照片）發文時自己加
//   微信、IG、小紅書沒有網頁發文連結；FB 的分享連結會把 # 後面（好友碼）弄掉 → 這幾個用「複製貼文文字」
const enc = encodeURIComponent;
export const POST = {
  x: (text, url) => `https://x.com/intent/post?text=${enc(`${text} ${url} #Clatter`)}`,
  threads: (text, url) => `https://www.threads.com/intent/post?text=${enc(`${text} ${url} #Clatter`)}`,
  line: (text, url) => `https://social-plugins.line.me/lineit/share?url=${enc(url)}&text=${enc(text)}`,
  weibo: (text, url) => `https://service.weibo.com/share/share.php?url=${enc(url)}&title=${enc(text)}`,
};
// 貼文文字（「一起來轉 👉」後面接連結：加好友的邀請連結，沒有會員號就是網站）
export const postText = (face, info) => info.t('pk.caption', { k: info.stats.kinds, name: face?.name || '' });
export const caption = (face, info) => `${postText(face, info)} ${info.url} #Clatter`;

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
  // 動態牆的分享圖（feed＝有「複製貼文文字」，post＝有網頁發文連結的平台）
  { id: 'xhs', size: () => [1080, 1440], type: 'image/jpeg', feed: true, draw: feedCard }, // 小紅書 3:4
  { id: 'moments', size: () => [1080, 1080], type: 'image/jpeg', feed: true, post: ['line', 'weibo'], draw: feedCard }, // 朋友圈九宮格是正方形
  { id: 'ig', size: () => [1080, 1350], type: 'image/jpeg', feed: true, post: ['threads'], draw: feedCard }, // IG／Threads／FB 動態最大 4:5
  {
    id: 'story',
    size: () => [1080, 1920], // 限時動態 9:16
    type: 'image/jpeg',
    feed: true,
    // 上面約 14%（進度條、頭像）、下面約 18%（回覆欄）是 App 的按鈕 → logo、卡、資料都放在中間那段
    async draw(face, info, W, Hh) {
      const c = canvas(W, Hh);
      const g = c.getContext('2d');
      const k = W / 1080;
      g.drawImage(await drawArtwork(face, W, Hh, { cy: 0.44, cw: face?.kind === 'card' ? 0.48 : 0.56 }), 0, 0);
      const logo = await drawPrimaryLogo(Math.round(60 * k));
      g.drawImage(logo, (W - logo.width) / 2, Hh * 0.125);
      const y0 = Hh * 0.655;
      const ph = 330 * k;
      g.fillStyle = `rgba(${mix(await baseColor(face), [10, 12, 24], 0.78).join(',')}, 0.86)`;
      rrect(g, 48 * k, y0, W - 96 * k, ph, 36 * k);
      g.fill();
      const s = 220 * k;
      drawStats(g, info, 88 * k, y0 + 36 * k, k, W - 96 * k - s - 130 * k);
      await drawInviteQr(g, info, W - 88 * k - s, y0 + (ph - s - 64 * k) / 2 + 12 * k, s, k);
      return c;
    },
  },
  {
    id: 'x',
    size: () => [1600, 900], // X 時間軸 16:9
    type: 'image/jpeg',
    feed: true,
    post: ['x'],
    // 卡放右邊，左邊壓暗放 logo、會員資料、加好友 QR
    async draw(face, info, W, Hh) {
      const c = canvas(W, Hh);
      const g = c.getContext('2d');
      const k = Hh / 900;
      g.drawImage(await drawArtwork(face, W, Hh, { cx: 0.72, cy: 0.5, cw: face?.kind === 'card' ? 0.3 : 0.38 }), 0, 0);
      const sh = g.createLinearGradient(0, 0, W * 0.62, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0.55)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh;
      g.fillRect(0, 0, W, Hh);
      g.drawImage(await drawPrimaryLogo(Math.round(64 * k)), 70 * k, 60 * k);
      drawStats(g, info, 80 * k, 190 * k, k * 1.15, W * 0.5);
      await drawInviteQr(g, info, 92 * k, 560 * k, 200 * k, k);
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
  const invite = w ? d.inviteUrl(w.id) : null;
  return { t: d.t, name: d.myName(), stats: memberStats(album), faces, invite, url: invite || d.siteUrl(), id: w?.id ? fmtNo(w.id) : '' };
}
export { appIcon };
