// 雲端（Supabase）：短連結＋上傳的影音
// 機台設定照舊編成 g1z.… 字串，存進資料表 machines，id＝內容雜湊的前 10 字（base62）
//   → 分享連結只要 #s.<id>；同樣的內容永遠是同一個 id，存過的不會被改（資料表只開放新增、讀取）
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

// 存機台 → 短 id
export async function saveMachine(token) {
  const id = await hashId(te.encode(token));
  const r = await req('/rest/v1/machines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ id, data: token }),
  });
  if (r.ok || r.status === 409) return id; // 409＝一模一樣的機台已經存過
  throw new Error('e.network');
}

// 短 id → 機台字串（對一下雜湊，不是這個 id 的內容就不收）
export async function loadMachine(id) {
  if (!isShortId(id)) throw new Error('e.format');
  const r = await req(`/rest/v1/machines?id=eq.${id}&select=data`);
  if (!r.ok) throw new Error('e.network');
  const rows = await r.json().catch(() => null);
  const data = Array.isArray(rows) && typeof rows[0]?.data === 'string' ? rows[0].data : null;
  if (!data) throw new Error('e.notFound');
  if ((await hashId(te.encode(data))) !== id) throw new Error('e.notFound');
  return data;
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
