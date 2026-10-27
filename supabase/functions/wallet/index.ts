// Clatter 收藏者會員卡 → Apple Wallet（Supabase Edge Function `wallet`，部署時關掉 JWT 驗證：iPhone 帶的是 ApplePass 標頭）
// 使用者 2026-10-28：每人一張會員卡、選一張收集到的卡面當主題 → 簽 .pkpass → 更新同一張 Wallet 卡；卡上有會員號、QR、積分
//   iOS 27：posterGeneric（大張卡面 artwork）；舊版 iOS 看 generic（同一份 pass.json 兩種都放）
//
// 網頁用：
//   GET  /status                → { enabled }（Apple 憑證設好了沒）
//   POST /card   { id, key, lang, data, img, files? } → 存會員卡內容（files＝卡面 PNG base64，換主題時才送）；有裝卡的 iPhone 會收到推播
//   POST /ticket { id, key }    → { url }：Safari 打開這個網址 → 「加入 Apple Wallet」
//   GET  /get/<票>              → .pkpass
// Apple Wallet 的更新服務（webServiceURL＝<這個 function>/）：
//   POST/DELETE /v1/devices/<裝置>/registrations/<passType>/<卡號>   登記／取消（推播 token）
//   GET  /v1/devices/<裝置>/registrations/<passType>?passesUpdatedSince=<tag>  哪些卡有新版
//   GET  /v1/passes/<passType>/<卡號>                                 拿新版
//   POST /v1/log                                                      iPhone 回報的錯誤
//
// 秘密（Supabase → Edge Functions → Secrets；tools/wallet-cert.mjs 會做好一份貼上用的）：
//   PASS_TYPE_ID、PASS_TEAM_ID、PASS_CERT、PASS_KEY（PEM 或 PEM 的 base64）
//   推播另外可以用 APNs 金鑰：APNS_KEY_ID ＋ APNS_P8（沒有就用 Pass 憑證走 mTLS）
import forge from 'npm:node-forge@1.3.1';
import { zipSync, strToU8 } from 'npm:fflate@0.8.2';

const env = (k: string): string => ((globalThis as any).Deno ? (globalThis as any).Deno.env.get(k) : (globalThis as any).process?.env?.[k]) || '';
const pem = (v: string) => (!v ? '' : v.includes('-----BEGIN') ? v : atob(v.replace(/\s+/g, '')));

const SB = env('SUPABASE_URL');
const SR = env('SUPABASE_SERVICE_ROLE_KEY');
const PASS_TYPE = env('PASS_TYPE_ID');
const TEAM = env('PASS_TEAM_ID');
const CERT = pem(env('PASS_CERT'));
const KEY = pem(env('PASS_KEY'));
const APP_URL = 'https://leo70962001-lgtm.github.io/gacha-web/';
const FN_URL = (env('WALLET_FN_URL') || SB + '/functions/v1/wallet').replace(/\/$/, '');
const enabled = () => !!(PASS_TYPE && TEAM && CERT && KEY);

// 網頁送上來的卡面圖：只收這幾個檔名
const FILES = ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo@2x.png', 'thumbnail@2x.png', 'artwork@2x.png', 'background@2x.png', 'primaryLogo@2x.png'];
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const isId = (s: unknown) => typeof s === 'string' && /^[0-9A-Za-z]{10}$/.test(s);
const isKey = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(s);

function rand(n: number) {
  let s = '';
  while (s.length < n) for (const b of crypto.getRandomValues(new Uint8Array(n))) if (b < 248 && s.length < n) s += B62[b % 62];
  return s;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });
const empty = (status: number) => new Response(null, { status, headers: CORS });

// ---------- 資料庫（service role 走 PostgREST） ----------
function sbHeaders(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: SR, ...extra };
  if (!SR.startsWith('sb_')) h.Authorization = 'Bearer ' + SR;
  return h;
}
async function db(path: string, opt: RequestInit = {}) {
  const r = await fetch(SB + '/rest/v1/' + path, { ...opt, headers: sbHeaders({ 'Content-Type': 'application/json', ...(opt.headers as Record<string, string>) }) });
  if (!r.ok) throw new Error(`db ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const one = async (path: string) => (await db(path))?.[0] ?? null;
async function keyOk(id: string, key: string) {
  if (!isId(id) || !isKey(key)) return false;
  return (await db('rpc/wallet_key_ok', { method: 'POST', body: JSON.stringify({ p_id: id, p_key: key }) })) === true;
}
async function log(msg: string) {
  console.log(msg);
  await db('pass_log', { method: 'POST', body: JSON.stringify({ msg: msg.slice(0, 2000) }) }).catch(() => {});
}
async function storagePut(path: string, bytes: Uint8Array) {
  const r = await fetch(`${SB}/storage/v1/object/passes/${path}`, { method: 'POST', headers: sbHeaders({ 'Content-Type': 'image/png', 'x-upsert': 'true' }), body: bytes });
  if (!r.ok) throw new Error(`storage ${r.status} ${await r.text()}`);
}
async function storageGet(path: string) {
  const r = await fetch(`${SB}/storage/v1/object/passes/${path}`, { headers: sbHeaders() });
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

// ---------- 卡上的字（照會員卡存的語言） ----------
const L: Record<string, Record<string, string>> = {
  zh: {
    desc: 'Clatter 收藏者會員卡', points: '積分', member: '收藏者', tier: '等級', coins: '金幣', col: '收集', theme: '主題卡',
    no: '會員號', tiers: '青銅,白銀,黃金,彩虹', pieces: '{k} 種・{n} 個',
    ptsMsg: '積分變成 %@', tierMsg: '升級了！現在是 %@ 會員', themeMsg: '主題卡換成「%@」',
    howL: '積分怎麼算', how: '收集簿裡每個獎品：N 10 分、R 30 分、SR 100 分、SSR 300 分。300 分白銀、1000 分黃金、3000 分彩虹。',
    qrL: 'QR 碼', qr: '用手機掃這張卡的 QR 碼＝加你當好友，可以跟你交換卡片、轉蛋。',
    appL: '打開 Clatter', updL: '更新', upd: '在 App 的收集簿 → 會員卡 換主題卡，這張卡會自己更新。', contactL: '聯絡',
  },
  ja: {
    desc: 'Clatter コレクター会員証', points: 'ポイント', member: 'コレクター', tier: 'ランク', coins: 'コイン', col: 'コレクション', theme: 'テーマカード',
    no: '会員番号', tiers: 'ブロンズ,シルバー,ゴールド,レインボー', pieces: '{k} 種・{n} 個',
    ptsMsg: 'ポイントが %@ になりました', tierMsg: 'ランクアップ！%@ 会員になりました', themeMsg: 'テーマカードを「%@」に変更しました',
    howL: 'ポイントのしくみ', how: 'コレクションの景品 1 個ごとに N 10・R 30・SR 100・SSR 300 ポイント。300 でシルバー、1000 でゴールド、3000 でレインボー。',
    qrL: 'QR コード', qr: 'このカードの QR コードを読み取るとフレンド追加。カードやガチャを交換できます。',
    appL: 'Clatter を開く', updL: '更新', upd: 'アプリのコレクション → 会員証でテーマカードを変えると、このカードも自動で更新されます。', contactL: 'お問い合わせ',
  },
  en: {
    desc: 'Clatter collector card', points: 'POINTS', member: 'Collector', tier: 'Tier', coins: 'Coins', col: 'Collection', theme: 'Theme card',
    no: 'Member no.', tiers: 'Bronze,Silver,Gold,Rainbow', pieces: '{k} kinds · {n} pcs',
    ptsMsg: 'Your points are now %@', tierMsg: 'Tier up! You are now %@', themeMsg: 'Theme card changed to "%@"',
    howL: 'How points work', how: 'Every prize in your collection: N 10, R 30, SR 100, SSR 300 points. Silver at 300, Gold at 1000, Rainbow at 3000.',
    qrL: 'QR code', qr: 'Scan this card\'s QR code to add me as a friend and trade cards and capsules.',
    appL: 'Open Clatter', updL: 'Updates', upd: 'Change the theme card in the app (Collection → Member card) and this card updates itself.', contactL: 'Contact',
  },
};
const fmtNo = (id: string) => id.slice(0, 5) + ' ' + id.slice(5);
const RGB = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;
const str = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
const int = (x: unknown, max = 1e9) => (Number.isFinite(x as number) ? Math.max(0, Math.min(max, Math.round(x as number))) : 0);

// 網頁送來的卡片內容 → 只留認得的、長度有限的
function cleanData(d: any) {
  d = d && typeof d === 'object' ? d : {};
  return {
    lang: ['zh', 'ja', 'en'].includes(d.lang) ? d.lang : 'en',
    name: str(d.name, 24),
    points: int(d.points),
    tier: int(d.tier, 3),
    kinds: int(d.kinds),
    pieces: int(d.pieces),
    coins: d.coins == null ? null : int(d.coins), // 只是讓金幣變了也算「有新版」；卡上的金幣用伺服器的錢包餘額
    theme: str(d.theme, 40),
    from: str(d.from, 40),
    bg: RGB.test(d.bg) ? d.bg : 'rgb(28, 35, 64)',
    fg: RGB.test(d.fg) ? d.fg : 'rgb(255, 255, 255)',
    label: RGB.test(d.label) ? d.label : 'rgb(255, 214, 120)',
  };
}

function passJson(card: any, balance: number | null) {
  const d = cleanData(card.data);
  const l = L[d.lang] || L.en;
  const tierName = l.tiers.split(',')[d.tier] || '';
  const id = card.wallet;
  const nf = (n: number) => n.toLocaleString('en-US');
  const header = [{ key: 'points', label: l.points, value: nf(d.points), changeMessage: l.ptsMsg, textAlignment: 'PKTextAlignmentRight' }];
  const nameF = { key: 'name', label: tierName ? `${l.member} · ${tierName}` : l.member, value: d.name || l.member };
  const tierF = { key: 'tier', label: l.tier, value: tierName, changeMessage: l.tierMsg };
  const coinF = { key: 'coins', label: l.coins, value: (balance ?? d.coins) == null ? '—' : nf((balance ?? d.coins) as number) };
  const colF = { key: 'col', label: l.col, value: l.pieces.replace('{k}', String(d.kinds)).replace('{n}', String(d.pieces)) };
  const themeF = { key: 'theme', label: l.theme, value: d.theme || '—', changeMessage: l.themeMsg };
  const back = [
    { key: 'no', label: l.no, value: fmtNo(id) },
    { key: 'how', label: l.howL, value: l.how },
    { key: 'qr', label: l.qrL, value: l.qr },
    { key: 'upd', label: l.updL, value: l.upd },
    { key: 'app', label: l.appL, value: APP_URL, attributedValue: `<a href="${APP_URL}#album">${APP_URL}</a>` },
    { key: 'contact', label: l.contactL, value: 'Clatter 轉蛋鋪 · ' + APP_URL },
  ];
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE,
    serialNumber: id,
    teamIdentifier: TEAM,
    organizationName: 'Clatter',
    description: l.desc,
    logoText: 'Clatter',
    foregroundColor: d.fg,
    backgroundColor: d.bg,
    labelColor: d.label,
    webServiceURL: FN_URL + '/',
    authenticationToken: card.auth_token,
    sharingProhibited: true,
    barcodes: [{ format: 'PKBarcodeFormatQR', message: `${APP_URL}#f.${id}`, messageEncoding: 'iso-8859-1', altText: fmtNo(id) }],
    posterGeneric: {
      headerFields: header,
      primaryFields: [nameF, themeF],
      footerFields: [coinF, colF],
      backFields: back,
    },
    generic: {
      headerFields: header,
      primaryFields: [nameF],
      secondaryFields: [tierF, coinF],
      auxiliaryFields: [colF, themeF],
      backFields: back,
    },
  };
}

// ---------- 簽名 ----------
let wwdrPem = '';
async function wwdr() {
  if (wwdrPem) return wwdrPem;
  const own = pem(env('WWDR_CERT'));
  if (own) return (wwdrPem = own);
  // Apple WWDR 中繼憑證 G4（公開的）：開機第一次用的時候去 apple.com 拿
  const r = await fetch('https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer');
  if (!r.ok) throw new Error('wwdr ' + r.status);
  const der = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  wwdrPem = forge.pki.certificateToPem(forge.pki.certificateFromAsn1(forge.asn1.fromDer(bin)));
  return wwdrPem;
}

let signer: { cert: any; key: any; keyPem: string } | null = null;
function loadSigner() {
  if (signer) return signer;
  const cert = forge.pki.certificateFromPem(CERT);
  const pass = env('PASS_KEY_PASS');
  const key = pass ? forge.pki.decryptRsaPrivateKey(KEY, pass) : forge.pki.privateKeyFromPem(KEY);
  if (!key) throw new Error('PASS_KEY: wrong password or format');
  signer = { cert, key, keyPem: forge.pki.privateKeyToPem(key) };
  return signer;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const bin = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
  return s;
};
const fromBin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// files＝{ 檔名: bytes }（含 pass.json）→ manifest.json（SHA-1）＋ signature（PKCS#7 detached、SHA-256、帶 WWDR）→ zip
export async function buildPkpass(files: Record<string, Uint8Array>, s = loadSigner(), wwdrCert?: string) {
  const manifest: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) manifest[name] = hex(await crypto.subtle.digest('SHA-1', bytes));
  const mBytes = strToU8(JSON.stringify(manifest));
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(bin(mBytes));
  p7.addCertificate(s.cert);
  p7.addCertificate(forge.pki.certificateFromPem(wwdrCert || (await wwdr())));
  p7.addSigner({
    key: s.key,
    certificate: s.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  const sig = fromBin(forge.asn1.toDer(p7.toAsn1()).getBytes());
  return zipSync({ ...files, 'manifest.json': mBytes, signature: sig });
}

async function passFor(card: any) {
  const w = await one(`wallets?id=eq.${card.wallet}&select=balance`).catch(() => null);
  const files: Record<string, Uint8Array> = { 'pass.json': strToU8(JSON.stringify(passJson(card, w ? w.balance : null))) };
  if (card.img) {
    const got = await Promise.all(FILES.map((f) => storageGet(`${card.wallet}/${card.img}/${f}`)));
    FILES.forEach((f, i) => got[i] && (files[f] = got[i]!));
  }
  return buildPkpass(files);
}
const pkpassResponse = (bytes: Uint8Array, updated: string) =>
  new Response(bytes, {
    headers: {
      ...CORS,
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'inline; filename="clatter-member.pkpass"',
      'Last-Modified': new Date(updated).toUTCString(),
      'Cache-Control': 'no-store',
    },
  });

// ---------- 推播（有新版 → 叫 iPhone 來拿） ----------
// APNs 金鑰（.p8，ES256 JWT）優先；沒有就用 Pass 憑證走 mTLS（Deno.createHttpClient）
let jwtCache: { t: string; at: number } | null = null;
async function apnsJwt() {
  const kid = env('APNS_KEY_ID');
  const p8 = pem(env('APNS_P8'));
  if (!kid || !p8) return null;
  if (jwtCache && Date.now() - jwtCache.at < 40 * 60 * 1000) return jwtCache.t;
  const b64u = (u8: Uint8Array) => btoa(bin(u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const der = Uint8Array.from(atob(p8.replace(/-----[^-]+-----|\s+/g, '')), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(strToU8(JSON.stringify({ alg: 'ES256', kid })));
  const body = b64u(strToU8(JSON.stringify({ iss: TEAM, iat: Math.floor(Date.now() / 1000) })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, strToU8(head + '.' + body)));
  jwtCache = { t: `${head}.${body}.${b64u(sig)}`, at: Date.now() };
  return jwtCache.t;
}
let mtls: any = null;
async function pushAll(serial: string) {
  const regs = await db(`pass_regs?serial=eq.${serial}&select=device,pass_devices(push_token)`).catch(() => []);
  if (!regs?.length || !enabled()) return;
  const jwt = await apnsJwt().catch(() => null);
  const D = (globalThis as any).Deno;
  if (!jwt && !mtls && D?.createHttpClient) mtls = D.createHttpClient({ cert: CERT, key: loadSigner().keyPem, http2: true, http1: false });
  for (const r of regs) {
    const token = r.pass_devices?.push_token;
    if (!token) continue;
    try {
      const res = await fetch(`https://api.push.apple.com/3/device/${token}`, {
        method: 'POST',
        headers: { 'apns-topic': PASS_TYPE, ...(jwt ? { authorization: 'bearer ' + jwt } : {}) },
        body: '{}',
        ...(jwt ? {} : { client: mtls }),
      } as RequestInit);
      if (res.status === 410 || res.status === 400) {
        const why = await res.text();
        if (/BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(why) || res.status === 410) await db(`pass_devices?id=eq.${encodeURIComponent(r.device)}`, { method: 'DELETE' });
        await log(`push ${serial} → ${res.status} ${why}`);
      } else if (!res.ok) await log(`push ${serial} → ${res.status} ${await res.text()}`);
    } catch (e) {
      await log(`push ${serial} failed: ${e}`);
    }
  }
}
function later(p: Promise<unknown>) {
  const ER = (globalThis as any).EdgeRuntime;
  if (ER?.waitUntil) ER.waitUntil(p);
  else p.catch(() => {});
}

// ---------- 路由 ----------
const b64png = (s: unknown) => {
  if (typeof s !== 'string' || s.length > 2_000_000) return null;
  try {
    const u8 = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47 ? u8 : null; // PNG
  } catch {
    return null;
  }
};
const applePass = (req: Request) => (req.headers.get('authorization') || '').replace(/^ApplePass\s+/i, '');

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return empty(204);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/wallet(?=\/|$)/, '').replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (req.method === 'GET' && path === '/status') return json({ enabled: enabled(), passType: PASS_TYPE || null });

    // 網頁：存會員卡
    if (req.method === 'POST' && path === '/card') {
      const b = await req.json().catch(() => null);
      if (!b || !(await keyOk(b.id, b.key))) return json({ error: 'locked' }, 401);
      const data = cleanData({ ...(b.data || {}), lang: b.lang });
      const img = typeof b.img === 'string' && /^[0-9a-f]{16,64}$/.test(b.img) ? b.img : null;
      let card = await one(`member_cards?wallet=eq.${b.id}&select=*`);
      if (!card) card = (await db('member_cards', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ wallet: b.id, auth_token: rand(32), data }) }))[0];
      const files = b.files && typeof b.files === 'object' ? b.files : null;
      if (img && img !== card.img) {
        if (!files) return json({ needFiles: true });
        for (const f of FILES) {
          if (!(f in files)) continue;
          const u8 = b64png(files[f]);
          if (!u8) return json({ error: 'bad image ' + f }, 400);
          await storagePut(`${b.id}/${img}/${f}`, u8);
        }
      }
      const same = JSON.stringify(card.data) === JSON.stringify(data) && (!img || img === card.img);
      if (!same) {
        const patch: Record<string, unknown> = { data, updated_at: new Date().toISOString() };
        if (img) patch.img = img;
        await db(`member_cards?wallet=eq.${b.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
        later(pushAll(b.id));
      }
      return json({ ok: true, enabled: enabled(), changed: !same });
    }

    // 網頁：換一張下載票
    if (req.method === 'POST' && path === '/ticket') {
      const b = await req.json().catch(() => null);
      if (!b || !(await keyOk(b.id, b.key))) return json({ error: 'locked' }, 401);
      if (!enabled()) return json({ error: 'not configured' }, 503);
      if (!(await one(`member_cards?wallet=eq.${b.id}&select=wallet`))) return json({ error: 'no card' }, 404);
      const id = rand(24);
      await db('pass_tickets', { method: 'POST', body: JSON.stringify({ id, wallet: b.id, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }) });
      db(`pass_tickets?expires_at=lt.${new Date().toISOString()}`, { method: 'DELETE' }).catch(() => {});
      return json({ url: `${FN_URL}/get/${id}` });
    }

    // Safari 打開：下載 .pkpass
    if (req.method === 'GET' && seg[0] === 'get' && seg.length === 2) {
      if (!enabled()) return json({ error: 'not configured' }, 503);
      const tk = /^[0-9A-Za-z]{24}$/.test(seg[1]) ? await one(`pass_tickets?id=eq.${seg[1]}&select=wallet,expires_at`) : null;
      if (!tk || new Date(tk.expires_at).getTime() < Date.now()) return json({ error: 'expired' }, 410);
      const card = await one(`member_cards?wallet=eq.${tk.wallet}&select=*`);
      if (!card) return json({ error: 'no card' }, 404);
      return pkpassResponse(await passFor(card), card.updated_at);
    }

    // ---------- Apple Wallet 更新服務 ----------
    if (seg[0] === 'v1') {
      // 登記／取消：/v1/devices/<dev>/registrations/<type>/<serial>
      if (seg[1] === 'devices' && seg[3] === 'registrations' && seg.length === 6) {
        const [, , dev, , type, serial] = seg;
        if (type !== PASS_TYPE || !isId(serial)) return empty(404);
        const card = await one(`member_cards?wallet=eq.${serial}&select=auth_token`);
        if (!card || applePass(req) !== card.auth_token) return empty(401);
        if (req.method === 'POST') {
          const b = await req.json().catch(() => ({}));
          if (typeof b.pushToken !== 'string' || !/^[0-9a-fA-F]{32,200}$/.test(b.pushToken)) return empty(400);
          await db('pass_devices?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: dev.slice(0, 128), push_token: b.pushToken, updated_at: new Date().toISOString() }) });
          const had = await one(`pass_regs?device=eq.${encodeURIComponent(dev)}&serial=eq.${serial}&select=serial`);
          if (had) return empty(200);
          await db('pass_regs', { method: 'POST', body: JSON.stringify({ device: dev.slice(0, 128), serial }) });
          return empty(201);
        }
        if (req.method === 'DELETE') {
          await db(`pass_regs?device=eq.${encodeURIComponent(dev)}&serial=eq.${serial}`, { method: 'DELETE' });
          const left = await one(`pass_regs?device=eq.${encodeURIComponent(dev)}&select=serial&limit=1`);
          if (!left) await db(`pass_devices?id=eq.${encodeURIComponent(dev)}`, { method: 'DELETE' });
          return empty(200);
        }
      }
      // 哪些卡有新版：/v1/devices/<dev>/registrations/<type>?passesUpdatedSince=<tag>
      if (req.method === 'GET' && seg[1] === 'devices' && seg[3] === 'registrations' && seg.length === 5) {
        if (seg[4] !== PASS_TYPE) return empty(404);
        const regs = await db(`pass_regs?device=eq.${encodeURIComponent(seg[2])}&select=serial,member_cards(updated_at)`);
        const since = Number(url.searchParams.get('passesUpdatedSince')) || 0;
        let last = since;
        const serials: string[] = [];
        for (const r of regs || []) {
          const t = new Date(r.member_cards?.updated_at || 0).getTime();
          if (t > since) serials.push(r.serial);
          last = Math.max(last, t);
        }
        return serials.length ? json({ serialNumbers: serials, lastUpdated: String(last) }) : empty(204);
      }
      // 拿新版：/v1/passes/<type>/<serial>
      if (req.method === 'GET' && seg[1] === 'passes' && seg.length === 4) {
        const [, , type, serial] = seg;
        if (type !== PASS_TYPE || !isId(serial)) return empty(404);
        const card = await one(`member_cards?wallet=eq.${serial}&select=*`);
        if (!card || applePass(req) !== card.auth_token) return empty(401);
        const ims = req.headers.get('if-modified-since');
        if (ims && Math.floor(new Date(card.updated_at).getTime() / 1000) <= Math.floor(new Date(ims).getTime() / 1000)) return empty(304);
        return pkpassResponse(await passFor(card), card.updated_at);
      }
      if (req.method === 'POST' && seg[1] === 'log') {
        const b = await req.json().catch(() => ({}));
        for (const m of (Array.isArray(b.logs) ? b.logs : []).slice(0, 20)) await log('device: ' + String(m));
        return empty(200);
      }
    }
    return json({ error: 'not found' }, 404);
  } catch (e) {
    await log(`${req.method} ${path} error: ${(e as any)?.stack || e}`);
    return json({ error: 'server' }, 500);
  }
}

if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(handle);
