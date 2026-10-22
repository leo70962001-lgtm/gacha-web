// 雲端（Supabase）：短連結＋上傳的影音
// 機台設定照舊編成 g1z.… 字串，存進資料表 machines → 分享連結只要 #s.<10 字 id>
// 同一條連結可以更新：第一次存的時候隨機產生 id＋修改鑰匙（只存在開店的人自己的草稿裡），
//   之後帶同一把鑰匙呼叫 save_machine() 就會改到同一條連結；資料庫只存鑰匙的雜湊（supabase/02_editable.sql）
// 上傳的音樂／影片放進公開的 media 桶 → 變成一般的 https 音樂／影片網址（跟貼網址一樣進連結）
// 連不上（離線、claude.ai artifact 的 CSP 擋掉）→ 呼叫的地方退回原本的長連結
// 專案 clatter-gacha（Supabase 組織 Clatter，東京），設定見 supabase/setup.sql
export const CLOUD = {
  url: 'https://mtiqeosgpmjlhznhixpr.supabase.co',
  key: 'sb_publishable_IH8ygYOX8cIYjFa-ETiOyA_iFAqgQDH', // 公開用的 publishable key（本來就是給網頁用的，權限靠 RLS 管）
};

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const te = new TextEncoder();

export const cloudReady = () => !!(CLOUD.url && CLOUD.key);

function headers(extra) {
  const h = { apikey: CLOUD.key, ...extra };
  if (!CLOUD.key.startsWith('sb_')) h.Authorization = `Bearer ${CLOUD.key}`; // 舊式 anon key 是 JWT，兩個標頭都要
  return h;
}

async function req(path, opt = {}, ms = 12000) {
  if (!cloudReady()) throw new Error('e.network');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(CLOUD.url + path, { ...opt, headers: headers(opt.headers), signal: ac.signal });
  } catch (e) {
    throw new Error('e.network');
  } finally {
    clearTimeout(timer);
  }
}

// 內容 → 10 字 id（SHA-256 前 8 bytes 轉 base62）
async function hashId(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let n = 0n;
  for (const b of h.subarray(0, 8)) n = (n << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < 10; i++) {
    s += B62[Number(n % 62n)];
    n /= 62n;
  }
  return s;
}

export const isShortId = (id) => /^[0-9A-Za-z]{10}$/.test(id || '');
const isKey = (k) => /^[A-Za-z0-9_-]{20,64}$/.test(k || '');

// 不偏的隨機 base62（248＝62×4，超過就丟掉重抽）
function randB62(n) {
  let s = '';
  while (s.length < n) for (const b of crypto.getRandomValues(new Uint8Array(n))) if (b < 248 && s.length < n) s += B62[b % 62];
  return s;
}

// 存機台：cred＝{ id, key }（上次的）→ 更新同一條；沒有就開新的。回傳要記下來的 cred
// 鑰匙對不上（或撞到別人的 id）→ 丟 e.locked，呼叫的地方改開新連結
// stock＝{ 獎品 key: 放進機台的數量 }（伺服器照這個算剩下幾個）
export async function saveMachine(token, cred, stock) {
  const c = cred && isShortId(cred.id) && isKey(cred.key) ? cred : { id: randB62(10), key: randB62(24) };
  const r = await req('/rest/v1/rpc/save_machine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: c.id, p_key: c.key, p_data: token, p_stock: stock }),
  });
  if (r.ok) return { id: c.id, key: c.key };
  const err = await r.json().catch(() => ({}));
  throw new Error(err.code === '42501' ? 'e.locked' : 'e.network');
}

// 短 id → { data: 機台字串, shared: 有沒有共用庫存 }（每次都拿最新的，不用快取）
// 第一版的短連結（共用庫存之前存的）stock 是空的 → shared＝false，庫存照舊記在各自的裝置
export async function loadMachine(id) {
  if (!isShortId(id)) throw new Error('e.format');
  const r = await req(`/rest/v1/machines?id=eq.${id}&select=data,stock`, { cache: 'no-store' });
  if (!r.ok) throw new Error('e.network');
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (typeof row?.data !== 'string') throw new Error('e.notFound');
  return { data: row.data, shared: !!row.stock && Object.keys(row.stock).length > 0 };
}

// ---------- 共用庫存 ----------
// 買家投完幣 → 伺服器照「剩下的數量」抽 n 顆並記下來 → { picks: [獎品 key], remaining: { key: 剩幾個 } }
export async function pullCloud(id, n) {
  const r = await req('/rest/v1/rpc/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id, p_n: n }),
  });
  if (!r.ok) throw new Error(r.status === 404 ? 'e.notFound' : 'e.network');
  const j = await r.json().catch(() => null);
  if (!j || !Array.isArray(j.picks)) throw new Error('e.network');
  return { picks: j.picks.map(String), remaining: j.remaining && typeof j.remaining === 'object' ? j.remaining : {} };
}

// 每個獎品被轉走幾個：{ key: n }
export async function pulledCounts(id) {
  if (!isShortId(id)) throw new Error('e.format');
  const r = await req(`/rest/v1/pulls?machine_id=eq.${id}&select=item,n`, { cache: 'no-store' });
  if (!r.ok) throw new Error('e.network');
  const rows = await r.json().catch(() => []);
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) if (typeof row.item === 'string') out[row.item] = row.n | 0;
  return out;
}

// 補貨（只有開店的人有鑰匙）：被轉走的紀錄歸零
export async function restockCloud(cred) {
  const r = await req('/rest/v1/rpc/restock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: cred.id, p_key: cred.key }),
  });
  if (!r.ok) throw new Error(r.status === 401 ? 'e.locked' : 'e.network');
}

// 副檔名要對得上 media.js 認得的音樂／影片網址
const EXT = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v',
};

// 上傳影音 → 公開網址。路徑＝內容 id／英數檔名，同一個檔案傳兩次也只有一份
export async function uploadMedia(blob, name, kind) {
  const id = await hashId(await blob.arrayBuffer());
  const m = /\.([a-z0-9]{2,4})$/i.exec(name || '');
  const ext = EXT[blob.type] || (m && m[1].toLowerCase()) || (kind === 'video' ? 'mp4' : 'mp3');
  const base = (name || '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || kind;
  const path = `${id}/${base}.${ext}`;
  const r = await req(`/storage/v1/object/media/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'false' },
    body: blob,
  }, 120000);
  // 已經有同一個檔案（400／409 "already exists"）也算成功
  if (!r.ok && r.status !== 409) {
    const msg = await r.text().catch(() => '');
    if (!/exist/i.test(msg)) throw new Error('e.network');
  }
  return `${CLOUD.url}/storage/v1/object/public/media/${path}`;
}
