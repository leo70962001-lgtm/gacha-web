// 機台設定 ⇄ 連結
// 連結格式：#g1z.<base64url>（g1 = 第 1 版；z = deflate-raw 壓縮，n = 沒壓縮）
// 內容：4 bytes 的 JSON 長度 + JSON（UTF-8）+ 各張圖片的原始位元組（JSON 裡記長度與格式）
// 只用英數字和 . _ - ：claude.ai 的 artifact 連結只會把這類字元的 #錨點 傳進頁面
import { mediaToLink, mediaFromLink } from './media.js';

const te = new TextEncoder();
const td = new TextDecoder();

export const CURRENCIES = ['NT$', '¥', 'HK$', 'US$', '代幣'];
export const THEME_KEYS = ['red', 'white', 'yellow', 'blue', 'mint', 'pink', 'black'];
export const LIMITS = { items: 16, name: 24, title: 24, qty: 999, coins: 20 };
export const BG_PRESETS = ['plain', 'shop', 'night', 'sakura', 'stars', 'cats', 'dogs', 'galaxy'];
export const BACK_PRESETS = ['shop', 'night', 'sakura', 'stars', 'cats', 'dogs', 'galaxy', 'candy']; // 卡背樣式（Gemini 畫的，assets/tex/back_<id>.webp）
export const FINISHES = ['gold', 'silver', 'rainbow', 'holo', 'none']; // SR／SSR 卡背的加工
const FIN_CODE = { gold: 'g', silver: 's', rainbow: 'r', holo: 'h', none: 'n' };
// SR／SSR 卡面（表面）的加工（使用者 2026-10-26：「SSR 跟SR 表面加工也追加進去」）
//   holo ホロ、texture 紋理（フルアート）、rainbow 彩虹亮粉、gold 彩虹＋金框、silver 銀箔、none 不加工；預設 SR 紋理、SSR 金框
export const FRONT_FINISHES = ['holo', 'texture', 'rainbow', 'gold', 'silver', 'none'];
const FRONT_CODE = { holo: 'h', texture: 't', rainbow: 'r', gold: 'g', silver: 's', none: 'n' };
export function finOf(fin, r) {
  if (r === 2) return FRONT_FINISHES.includes(fin?.sr) ? fin.sr : 'texture';
  if (r === 3) return FRONT_FINISHES.includes(fin?.ssr) ? fin.ssr : 'gold';
  return r === 1 ? 'holo' : 'none';
}

export async function encodeConfig(cfg) {
  const imgs = [];
  const json = {
    v: 1,
    n: cfg.name,
    s: cfg.shop,
    t: cfg.theme,
    p: [cfg.price.coins, cfg.price.unit, cfg.price.cur],
    // 每列：[名稱, 稀有度, 數量, 圖片長度, 圖片格式, 影音連結, 獎品 id, 遮罩長度, 遮罩格式]（後面沒有就省略）
    //   遮罩＝主體去背（seg.js），位元組接在同一個獎品的照片後面
    i: cfg.items.map((it) => {
      const row = [it.name, it.rarity, it.qty];
      if (it.img) {
        imgs.push(it.img.bytes);
        row.push(it.img.bytes.length, it.img.mime === 'image/webp' ? 'w' : 'j');
      }
      const media = mediaToLink(it.media); // 本機上傳的檔案不放進連結
      if (media) {
        if (row.length === 3) row.push(0, '');
        row.push(media);
      }
      if (it.uid || it.mask) {
        if (row.length === 3) row.push(0, '');
        if (row.length === 5) row.push(0);
        row.push(it.uid || '');
      }
      if (it.mask && it.img) {
        imgs.push(it.mask.bytes);
        row.push(it.mask.bytes.length, it.mask.mime === 'image/webp' ? 'w' : 'p');
      }
      return row;
    }),
  };
  // 背景：預設場景、純色、或自己的圖（小圖，接在獎品圖片後面）
  const bg = cfg.bg;
  if (bg?.k === 'preset' && bg.id !== 'plain') json.b = ['p', bg.id];
  else if (bg?.k === 'color') json.b = ['c', bg.c];
  else if (bg?.k === 'img' && bg.img) {
    imgs.push(bg.img.bytes);
    json.b = ['i', bg.img.bytes.length, bg.img.mime === 'image/webp' ? 'w' : 'j'];
  }
  if (cfg.kind === 'card') json.k = 'c'; // 機台種類：沒寫＝轉蛋機
  if (cfg.fin && (finOf(cfg.fin, 2) !== 'texture' || finOf(cfg.fin, 3) !== 'gold')) json.cf = [FRONT_CODE[finOf(cfg.fin, 2)], FRONT_CODE[finOf(cfg.fin, 3)]]; // 表面加工
  // 卡背：[圖片長度, 格式, 文字, 邊框色, 種類（i 圖／p 樣式／c 顏色）, 樣式 id 或顏色, SR 加工, SSR 加工]（圖片接在背景圖後面）
  const back = cfg.back;
  if (cfg.kind === 'card' && back) {
    const img = back.k === 'img' && back.img;
    if (img) imgs.push(back.img.bytes);
    json.cb = [
      img ? back.img.bytes.length : 0, img && back.img.mime === 'image/webp' ? 'w' : 'j', back.text || '', back.color || '',
      img ? 'i' : back.k === 'preset' ? 'p' : back.k === 'color' ? 'c' : '', back.k === 'preset' ? back.id : back.k === 'color' ? back.c : '',
      FIN_CODE[back.sr] || '', FIN_CODE[back.ssr] || '',
    ];
  }
  const jb = te.encode(JSON.stringify(json));
  const size = 4 + jb.length + imgs.reduce((a, b) => a + b.length, 0);
  const buf = new Uint8Array(size);
  new DataView(buf.buffer).setUint32(0, jb.length);
  buf.set(jb, 4);
  let off = 4 + jb.length;
  for (const b of imgs) {
    buf.set(b, off);
    off += b.length;
  }
  if ('CompressionStream' in window) {
    return 'g1z.' + toB64url(await pipe(buf, new CompressionStream('deflate-raw')));
  }
  return 'g1n.' + toB64url(buf);
}

// 連結內容是別人給的 → 每個欄位都檢查、限制長度與範圍
export async function decodeConfig(token) {
  const m = /^g1([zn])\.([A-Za-z0-9_-]+)$/.exec(token || '');
  if (!m) throw new Error('e.format');
  let buf;
  let j;
  try {
    buf = fromB64url(m[2]);
    if (m[1] === 'z') buf = await pipe(buf, new DecompressionStream('deflate-raw'));
    const jl = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
    if (jl > buf.length - 4) throw new Error();
    j = JSON.parse(td.decode(buf.subarray(4, 4 + jl)));
    j.__off = 4 + jl;
  } catch (e) {
    throw new Error('e.truncated');
  }
  let off = j.__off;
  const items = (Array.isArray(j.i) ? j.i : []).slice(0, LIMITS.items).map((r) => {
    const [name, rarity, qty, len, fmt, media, uid, mlen, mfmt] = Array.isArray(r) ? r : [];
    let img = null;
    let mask = null;
    if (Number.isInteger(len) && len > 0 && off + len <= buf.length) {
      img = { bytes: buf.slice(off, off + len), mime: fmt === 'w' ? 'image/webp' : 'image/jpeg' };
      off += len;
      if (Number.isInteger(mlen) && mlen > 0 && mlen < 60000 && off + mlen <= buf.length) {
        mask = { bytes: buf.slice(off, off + mlen), mime: mfmt === 'w' ? 'image/webp' : 'image/png' };
        off += mlen;
      }
    }
    return {
      name: str(name, LIMITS.name) || '?',
      rarity: clampInt(rarity, 0, 3, 0),
      qty: clampInt(qty, 1, LIMITS.qty, 1),
      img,
      media: mediaFromLink(media),
      uid: typeof uid === 'string' && /^[0-9A-Za-z]{4,12}$/.test(uid) ? uid : null,
      mask,
    };
  });
  if (!items.length) throw new Error('e.empty');
  let bg = { k: 'preset', id: 'plain' };
  const b = Array.isArray(j.b) ? j.b : [];
  if (b[0] === 'p' && BG_PRESETS.includes(b[1])) bg = { k: 'preset', id: b[1] };
  else if (b[0] === 'c' && /^#[0-9a-f]{6}$/i.test(b[1])) bg = { k: 'color', c: b[1] };
  else if (b[0] === 'i' && Number.isInteger(b[1]) && b[1] > 0 && b[1] < 60000 && off + b[1] <= buf.length) {
    bg = { k: 'img', img: { bytes: buf.slice(off, off + b[1]), mime: b[2] === 'w' ? 'image/webp' : 'image/jpeg' } };
    off += b[1];
  }
  let back = null;
  const cb = Array.isArray(j.cb) ? j.cb : null;
  if (cb) {
    const fin = (c) => Object.keys(FIN_CODE).find((k) => FIN_CODE[k] === c) || '';
    back = { k: 'default', text: str(cb[2], 16), color: /^#[0-9a-f]{6}$/i.test(cb[3]) ? cb[3] : '', sr: fin(cb[6]), ssr: fin(cb[7]) };
    if (Number.isInteger(cb[0]) && cb[0] > 0 && cb[0] < 120000 && off + cb[0] <= buf.length) {
      back.k = 'img';
      back.img = { bytes: buf.slice(off, off + cb[0]), mime: cb[1] === 'w' ? 'image/webp' : 'image/jpeg' };
      off += cb[0];
    } else if (cb[4] === 'p' && BACK_PRESETS.includes(cb[5])) Object.assign(back, { k: 'preset', id: cb[5] });
    else if (cb[4] === 'c' && /^#[0-9a-f]{6}$/i.test(cb[5])) Object.assign(back, { k: 'color', c: cb[5] });
  }
  const p = Array.isArray(j.p) ? j.p : [];
  return {
    name: str(j.n, LIMITS.title) || 'Gacha',
    shop: str(j.s, LIMITS.title),
    theme: THEME_KEYS.includes(j.t) ? j.t : 'red',
    price: {
      coins: clampInt(p[0], 1, LIMITS.coins, 1),
      unit: clampNum(p[1], 0, 100000, 10),
      cur: CURRENCIES.includes(p[2]) ? p[2] : 'NT$',
    },
    items,
    bg,
    kind: j.k === 'c' ? 'card' : 'capsule',
    back,
    fin: Array.isArray(j.cf) ? { sr: Object.keys(FRONT_CODE).find((k) => FRONT_CODE[k] === j.cf[0]), ssr: Object.keys(FRONT_CODE).find((k) => FRONT_CODE[k] === j.cf[1]) } : null,
  };
}

// 同一台機器 → 同一個短 id（用來分開每台機器的本機紀錄）
export function shortId(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function str(v, max) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '';
}
function clampInt(v, lo, hi, d) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
}
function clampNum(v, lo, hi, d) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}
async function pipe(u8, stream) {
  const out = new Blob([u8]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
function toB64url(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
