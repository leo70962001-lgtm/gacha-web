// 機台設定 ⇄ 連結
// 連結格式：#g1z.<base64url>（g1 = 第 1 版；z = deflate-raw 壓縮，n = 沒壓縮）
// 內容：4 bytes 的 JSON 長度 + JSON（UTF-8）+ 各張圖片的原始位元組（JSON 裡記長度與格式）
// 只用英數字和 . _ - ：claude.ai 的 artifact 連結只會把這類字元的 #錨點 傳進頁面
const te = new TextEncoder();
const td = new TextDecoder();

export const CURRENCIES = ['NT$', '¥', 'HK$', 'US$', '代幣'];
export const THEME_KEYS = ['red', 'white', 'yellow', 'blue', 'mint', 'pink', 'black'];
export const LIMITS = { items: 16, name: 24, title: 24, qty: 999, coins: 20 };

export async function encodeConfig(cfg) {
  const imgs = [];
  const json = {
    v: 1,
    n: cfg.name,
    s: cfg.shop,
    t: cfg.theme,
    p: [cfg.price.coins, cfg.price.unit, cfg.price.cur],
    i: cfg.items.map((it) => {
      const row = [it.name, it.rarity, it.qty];
      if (it.img) {
        imgs.push(it.img.bytes);
        row.push(it.img.bytes.length, it.img.mime === 'image/webp' ? 'w' : 'j');
      }
      return row;
    }),
  };
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
  if (!m) throw new Error('連結格式不對');
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
    throw new Error('連結不完整，可能複製時被截斷了');
  }
  let off = j.__off;
  const items = (Array.isArray(j.i) ? j.i : []).slice(0, LIMITS.items).map((r) => {
    const [name, rarity, qty, len, fmt] = Array.isArray(r) ? r : [];
    let img = null;
    if (Number.isInteger(len) && len > 0 && off + len <= buf.length) {
      img = { bytes: buf.slice(off, off + len), mime: fmt === 'w' ? 'image/webp' : 'image/jpeg' };
      off += len;
    }
    return {
      name: str(name, LIMITS.name) || '獎品',
      rarity: clampInt(rarity, 0, 3, 0),
      qty: clampInt(qty, 1, LIMITS.qty, 1),
      img,
    };
  });
  if (!items.length) throw new Error('這台機器裡沒有獎品');
  const p = Array.isArray(j.p) ? j.p : [];
  return {
    name: str(j.n, LIMITS.title) || '轉蛋機',
    shop: str(j.s, LIMITS.title),
    theme: THEME_KEYS.includes(j.t) ? j.t : 'red',
    price: {
      coins: clampInt(p[0], 1, LIMITS.coins, 1),
      unit: clampNum(p[1], 0, 100000, 10),
      cur: CURRENCIES.includes(p[2]) ? p[2] : 'NT$',
    },
    items,
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
