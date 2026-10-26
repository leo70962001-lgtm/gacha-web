// Clatter 轉蛋鋪：開店設定 → 產生連結 → 玩家投幣、轉把手、開扭蛋
import { Machine, THEMES } from './machine.js';
import { unlock, setMuted, sfx } from './sfx.js';
import { encodeConfig, decodeConfig, shortId, CURRENCIES, THEME_KEYS, LIMITS, BG_PRESETS } from './codec.js';
import { RARITY, placeholderThumb, priceText, fontsReady, drawPrizeCard, drawCardLayers } from './decor.js';
import { t, lang, setLang, applyDom, LANGS } from './i18n.js';
import { parseMediaUrl, mediaFromLink, mediaToLink, mediaLabel, mediaKind, saveLocal, removeLocal, localUrl, videoFrame, mountPlayer, ytThumb, MAX_FILE } from './media.js';
import { cutout } from './seg.js';
import { Holo } from './holo.js';
import { Binder, renderShelf } from './binder.js';
import { Trade } from './trade.js';
import { cloudReady, saveMachine, loadMachine, uploadMedia, pullCloud, pulledCounts, restockCloud, walletOpen, newWalletCred, isWalletCred, walletSales } from './cloud.js';

// 公開網址（GitHub Pages）：在 claude.ai artifact（iframe）裡看不到外層網址，
// 而且 artifact 要登入才能看 → 分享連結一律指向這裡，任何人都打得開
const PUBLIC_URL = 'https://leo70962001-lgtm.github.io/gacha-web/';

const $ = (id) => document.getElementById(id);
const app = $('app');

// 範例機台（第一次打開時的樣子；標明是範例）。還沒改過就跟著語言換
const SAMPLES = {
  zh: { name: '手作小物轉蛋', shop: '範例小舖', price: { coins: 5, unit: 10, cur: 'NT$' }, items: ['貓咪鑰匙圈', '限定貼紙組', '壓克力小立牌', '刺繡徽章', '簽名明信片'] },
  ja: { name: '手づくり雑貨ガチャ', shop: 'サンプル商店', price: { coins: 3, unit: 100, cur: '¥' }, items: ['ねこのキーホルダー', '限定ステッカー', 'アクリルスタンド', '刺しゅうワッペン', 'サイン入りポストカード'] },
  en: { name: 'Handmade Goodies Gacha', shop: 'Sample Shop', price: { coins: 2, unit: 1, cur: 'US$' }, items: ['Cat keychain', 'Limited sticker set', 'Mini acrylic stand', 'Embroidered patch', 'Signed postcard'] },
};
const SAMPLE = () => {
  const S = SAMPLES[lang];
  const shape = [[1, 8], [0, 12], [0, 9], [2, 3], [3, 1]];
  return {
    sample: true,
    kind: 'capsule',
    name: S.name,
    shop: S.shop,
    theme: 'red',
    bg: { k: 'preset', id: 'shop' },
    price: { ...S.price },
    items: S.items.map((name, i) => ({ name, rarity: shape[i][0], qty: shape[i][1], img: null })),
  };
};

const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      /* 無痕模式等存不了就算了 */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  },
};

// 我的商店：可以開好幾台機台。clatter.shop＝{ cur: 正在編輯的那台, list: [機台 uid…] }，每台的草稿在 clatter.draft.<uid>
//   舊版只有一台（clatter.draft）→ 第一次打開時搬成第一台
function shopIndex() {
  let s = store.get('clatter.shop');
  if (!s || !Array.isArray(s.list) || !s.list.length) {
    const uid = 'm' + newUid();
    const old = store.get('clatter.draft');
    if (old) store.set('clatter.draft.' + uid, old);
    s = { cur: uid, list: [uid] };
    store.set('clatter.shop', s);
  }
  if (!s.list.includes(s.cur)) s.cur = s.list[0];
  return s;
}
let shop = shopIndex();
const draftKey = (uid = shop.cur) => 'clatter.draft.' + uid;
let draft = loadDraft();
let machine = null;
let linkToken = null; // 最近一次產生的連結內容
let play = null; // 玩家模式的狀態

// ---------- 主體遮罩（去背）----------
// 照片 → seg.js 去背 → 120 px 寬的灰階遮罩（白＝主體）存在 item.mask；做不出來記 noMask，不再重試
async function makeMask(it) {
  if (!it.img || it.mask || it.noMask || it.masking) return;
  it.masking = true;
  try {
    const bmp = await createImageBitmap(new Blob([it.img.bytes], { type: it.img.mime }));
    const m = await cutout(bmp);
    if (!m) {
      it.noMask = true;
      return;
    }
    const w = 120;
    const h = Math.round((w * m.height) / m.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(m, 0, 0, w, h);
    let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!draft.items.includes(it) || !it.img) return; // 做的途中被刪了或換了圖
    it.mask = { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
    draftChanged();
  } catch (e) {
    console.warn(e);
  } finally {
    it.masking = false;
  }
}
// 以前上傳、還沒去背的照片：開店頁打開時一張一張補
async function autoMasks() {
  for (const it of draft.items) if (it.img && !it.mask && !it.noMask) await makeMask(it);
}

// ---------- 圖片 ----------
const thumbCache = new WeakMap(); // item.img → { url, bmp }
const maskCache = new WeakMap(); // item.mask → { bmp, ready }
function maskOf(cfg, i) {
  const it = cfg.items[i];
  if (!it.mask) return null;
  let m = maskCache.get(it.mask);
  if (!m) {
    m = { bmp: null };
    m.ready = createImageBitmap(new Blob([it.mask.bytes], { type: it.mask.mime }))
      .then((b) => (m.bmp = b))
      .catch(() => {});
    maskCache.set(it.mask, m);
  }
  return m;
}
function thumbOf(cfg, i) {
  const it = cfg.items[i];
  if (it.img) {
    let th = thumbCache.get(it.img);
    if (!th) {
      const blob = new Blob([it.img.bytes], { type: it.img.mime });
      th = { url: URL.createObjectURL(blob), bmp: null };
      th.ready = createImageBitmap(blob)
        .then((b) => {
          th.bmp = b;
          scheduleDecor();
        })
        .catch(() => {});
      thumbCache.set(it.img, th);
    }
    return th;
  }
  const key = `${i}|${it.name}`;
  let th = placeholderCache.get(key);
  if (!th) {
    const c = placeholderThumb(it.name, i);
    th = { url: c.toDataURL(), bmp: c };
    placeholderCache.set(key, th);
  }
  // 沒有照片但有 YouTube：畫面上用 YouTube 的縮圖（3D 台紙還是用名字字卡）
  if (it.media?.k === 'yt') return { url: ytThumb(it.media), bmp: th.bmp };
  return th;
}
const placeholderCache = new Map();

// 上傳的照片：裁成正方形 96 px、轉 webp（一張約 1.5 KB，連結裡放得下）
// 獎品照片：轉蛋機 128 px 正方形；轉卡機以圖為主 → 直的 240 × 350（卡片比例），卡面整張都是這張圖
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const card = draft?.kind === 'card';
  const SW = card ? 240 : 128;
  const SH = card ? 350 : 128;
  const c = document.createElement('canvas');
  c.width = SW;
  c.height = SH;
  const g = c.getContext('2d');
  const s = Math.max(SW / bmp.width, SH / bmp.height);
  g.drawImage(bmp, (SW - bmp.width * s) / 2, (SH - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.78));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

// ---------- 獎品 id ----------
// 每個獎品一個固定 id（6 字）：雲端用它記「被轉走幾個」，賣家改名字也對得回來
function newUid() {
  const B = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let s = '';
  while (s.length < 6) for (const b of crypto.getRandomValues(new Uint8Array(6))) if (b < 248 && s.length < 6) s += B[b % 62];
  return s;
}
function ensureUids(d) {
  const seen = new Set();
  for (const it of d.items) {
    if (!/^[0-9A-Za-z]{4,12}$/.test(it.uid || '') || seen.has(it.uid)) it.uid = newUid();
    seen.add(it.uid);
  }
}
// 雲端庫存用的 key：新機台都有 id；沒有 id 的舊機台用名稱
const itemKey = (it) => it.uid || ('n:' + it.name).slice(0, 40);
const stockOf = (cfg) => Object.fromEntries(cfg.items.map((it) => [itemKey(it), it.qty]));

// ---------- 草稿（開店表單）存在本機 ----------
function loadDraft(uid = shop.cur) {
  const d = store.get(draftKey(uid));
  if (!d || !Array.isArray(d.items) || !d.items.length) return SAMPLE();
  d.items = d.items.slice(0, LIMITS.items).map((it) => ({
    name: String(it.name || t('defaultPrize')).slice(0, LIMITS.name),
    rarity: Math.min(3, Math.max(0, it.rarity | 0)),
    qty: Math.min(LIMITS.qty, Math.max(1, it.qty | 0)),
    img: it.img ? { bytes: Uint8Array.from(atob(it.img.b64), (ch) => ch.charCodeAt(0)), mime: it.img.mime } : null,
    mask: it.img && it.mask?.b64 ? { bytes: Uint8Array.from(atob(it.mask.b64), (ch) => ch.charCodeAt(0)), mime: it.mask.mime } : null,
    noMask: !!it.noMask,
    media: draftMedia(it.media),
    uid: typeof it.uid === 'string' ? it.uid : null,
  }));
  ensureUids(d);
  if (!THEME_KEYS.includes(d.theme)) d.theme = 'red';
  d.kind = d.kind === 'card' ? 'card' : 'capsule';
  d.bg = draftBg(d.bg);
  if (!d.price || !CURRENCIES.includes(d.price.cur)) d.price = { coins: 5, unit: 10, cur: 'NT$' };
  // 雲端短連結的 id＋修改鑰匙：有的話之後改設定會自動更新到同一條連結
  if (!(d.cloud && /^[0-9A-Za-z]{10}$/.test(d.cloud.id) && /^[A-Za-z0-9_-]{20,64}$/.test(d.cloud.key))) delete d.cloud;
  return d;
}
function draftBg(b) {
  if (b?.k === 'preset' && BG_PRESETS.includes(b.id)) return { k: 'preset', id: b.id };
  if (b?.k === 'color' && /^#[0-9a-f]{6}$/i.test(b.c)) return { k: 'color', c: b.c };
  if (b?.k === 'img' && b.img?.b64) return { k: 'img', img: { bytes: Uint8Array.from(atob(b.img.b64), (ch) => ch.charCodeAt(0)), mime: b.img.mime } };
  return { k: 'preset', id: 'plain' };
}

function draftMedia(m) {
  if (!m) return null;
  if (m.k === 'file') {
    const f = { k: 'file', kind: m.kind === 'video' ? 'video' : 'audio', id: String(m.id).slice(0, 40), name: String(m.name || '').slice(0, 60), mime: String(m.mime || ''), size: m.size | 0 };
    if (typeof m.remote === 'string' && parseMediaUrl(m.remote)) f.remote = m.remote; // 已經上傳到雲端
    return f;
  }
  return mediaFromLink([m.k, m.u]);
}

function saveDraft() {
  const bg = draft.bg?.k === 'img' ? { k: 'img', img: { b64: btoa(String.fromCharCode(...draft.bg.img.bytes)), mime: draft.bg.img.mime } } : draft.bg;
  store.set(draftKey(), {
    ...draft,
    bg,
    items: draft.items.map((it) => ({
      ...it,
      img: it.img ? { b64: btoa(String.fromCharCode(...it.img.bytes)), mime: it.img.mime } : null,
      mask: it.mask ? { b64: btoa(String.fromCharCode(...it.mask.bytes)), mime: it.mask.mime } : null,
    })),
  });
}

// ---------- 開店表單 ----------
function renderItems() {
  const ul = $('items');
  ul.textContent = '';
  const total = draft.items.reduce((a, b) => a + b.qty, 0);
  draft.items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.i = i;
    const th = document.createElement('button');
    th.className = 'thumb';
    th.type = 'button';
    th.setAttribute('aria-label', t('changePhoto', { name: it.name }));
    const img = document.createElement('img');
    img.alt = '';
    img.src = thumbOf(draft, i).url;
    th.append(img);
    const name = document.createElement('input');
    name.className = 'name';
    name.value = it.name;
    name.maxLength = LIMITS.name;
    name.setAttribute('aria-label', t('prizeName'));
    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.textContent = '✕';
    del.setAttribute('aria-label', t('deleteItem', { name: it.name }));
    del.disabled = draft.items.length <= 1;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const sel = document.createElement('select');
    sel.className = 'rarity';
    sel.setAttribute('aria-label', t('rarity'));
    RARITY.forEach((r, k) => sel.append(new Option(`${r.key} ${r.label}`, k, false, k === it.rarity)));
    const qw = document.createElement('label');
    qw.className = 'qty-wrap';
    const qty = document.createElement('input');
    qty.className = 'qty';
    qty.type = 'number';
    qty.min = 1;
    qty.max = LIMITS.qty;
    qty.value = it.qty;
    qty.setAttribute('aria-label', t('qty'));
    qw.append(qty, t('qtyUnit'));
    const odds = document.createElement('span');
    odds.className = 'odds';
    odds.textContent = t('odds', { p: pct(it.qty / total) });
    meta.append(sel, qw, odds);
    if (cloudStats && draft.cloud) {
      const taken = cloudStats[itemKey(it)] || 0;
      const tk = document.createElement('div');
      tk.className = 'taken';
      const b = document.createElement('b');
      b.textContent = taken;
      tk.append(t('stock.takenA'), b, t('stock.takenB', { r: Math.max(0, it.qty - taken) }));
      meta.append(tk);
    }
    const mrow = document.createElement('div');
    mrow.className = 'mrow';
    const mb = document.createElement('button');
    mb.type = 'button';
    if (it.media) {
      mb.className = 'media-chip';
      const lab = document.createElement('span');
      lab.textContent = mediaLabel(it.media);
      mb.append(lab);
      if (it.media.k === 'file') {
        const loc = document.createElement('span');
        loc.className = 'local';
        loc.textContent = '· ' + t('media.local');
        mb.append(loc);
      }
    } else {
      mb.className = 'media-btn';
      mb.textContent = t('media.add');
    }
    mrow.append(mb);
    li.append(th, name, del, meta, mrow);
    ul.append(li);
  });
  $('items-sum').textContent = t('itemsSum', { n: draft.items.length, q: total });
  $('add-item').disabled = draft.items.length >= LIMITS.items;
}

function pct(x) {
  const p = x * 100;
  return (p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2)) + '%';
}

function renderPrice() {
  $('coins').value = draft.price.coins;
  $('unit').value = draft.price.unit;
  $('cur').value = draft.price.cur;
  $('unit').hidden = draft.price.cur === '代幣';
  $('price-out').textContent = priceText(draft.price);
  $('price-coins').textContent = t('coinsN', { n: draft.price.coins });
}

function renderForm() {
  renderItems();
  renderPrice();
  $('m-name').value = draft.name;
  $('m-shop').value = draft.shop || '';
  for (const b of $('swatches').children) b.setAttribute('aria-checked', String(b.dataset.k === draft.theme));
  for (const b of $('kinds').children) b.setAttribute('aria-checked', String(b.dataset.kind === (draft.kind || 'capsule')));
  renderBgs();
}

// ---------- 背景（壁紙） ----------
const asset = (p) => new URL('./assets/' + p, import.meta.url).href;
function renderBgs() {
  const box = $('bgs');
  if (!box.childElementCount) {
    const tile = (k, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bg-tile ' + cls;
      b.dataset.k = k;
      b.setAttribute('role', 'radio');
      b.append(document.createElement('span'));
      box.append(b);
      return b;
    };
    for (const id of BG_PRESETS) {
      const b = tile('preset:' + id, id === 'plain' ? 'plain' : 'preset');
      if (id !== 'plain') b.style.backgroundImage = `url("${asset('tex/bg_' + id + '.webp')}")`;
      b.onclick = () => setBg({ k: 'preset', id });
    }
    const cb = tile('color', 'color');
    const ci = document.createElement('input');
    ci.type = 'color';
    ci.value = '#ffd6e7';
    ci.addEventListener('input', () => setBg({ k: 'color', c: ci.value }));
    ci.addEventListener('click', () => setBg({ k: 'color', c: ci.value }));
    cb.append(ci);
    const ub = tile('img', 'upload');
    ub.onclick = () => {
      $('file-bg').value = '';
      $('file-bg').click();
    };
    $('file-bg').addEventListener('change', async () => {
      const f = $('file-bg').files[0];
      if (!f) return;
      try {
        setBg({ k: 'img', img: await shrinkBg(f) });
      } catch (e) {
        toast(t('t.badImage'));
      }
    });
  }
  const bg = draft.bg || { k: 'preset', id: 'plain' };
  const cur = bg.k === 'preset' ? 'preset:' + bg.id : bg.k;
  for (const b of box.children) {
    const k = b.dataset.k;
    b.setAttribute('aria-checked', String(k === cur));
    const label = k.startsWith('preset:') ? t('bg.' + k.slice(7)) : k === 'color' ? t('bg.color') : bg.k === 'img' ? t('bg.custom') : t('bg.upload');
    b.querySelector('span').textContent = label;
    b.setAttribute('aria-label', label);
    if (k === 'color' && bg.k === 'color') {
      b.style.backgroundImage = 'none';
      b.style.backgroundColor = bg.c;
      b.querySelector('input').value = bg.c;
    }
    if (k === 'img') {
      b.classList.toggle('has', bg.k === 'img');
      b.style.backgroundImage = bg.k === 'img' ? `url("${URL.createObjectURL(new Blob([bg.img.bytes], { type: bg.img.mime }))}")` : 'none';
    }
  }
}

function setBg(bg) {
  draft.bg = bg;
  renderBgs();
  draftChanged();
}

// 自己的背景圖：長邊 200 px、webp（放進連結）；畫面上會再柔焦放大
async function shrinkBg(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.6));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.65));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

// 小圖 → 先縮到 48 px 再放大＝柔焦（每個瀏覽器都能用，不靠 ctx.filter）
function softCanvas(src) {
  const tiny = document.createElement('canvas');
  tiny.width = 48;
  tiny.height = Math.max(1, Math.round((48 * src.height) / src.width));
  const tg = tiny.getContext('2d');
  tg.imageSmoothingQuality = 'high';
  tg.drawImage(src, 0, 0, tiny.width, tiny.height);
  const big = document.createElement('canvas');
  big.width = 960;
  big.height = Math.round((960 * tiny.height) / tiny.width);
  const bgc = big.getContext('2d');
  bgc.imageSmoothingEnabled = true;
  bgc.imageSmoothingQuality = 'high';
  bgc.drawImage(tiny, 0, 0, big.width, big.height);
  return big;
}

let bgKey = '';
async function applyBg(bg) {
  bg = bg || { k: 'preset', id: 'plain' };
  const key = bg.k === 'preset' ? 'p:' + bg.id : bg.k === 'color' ? 'c:' + bg.c : 'i:' + bg.img.bytes.length + ':' + bg.img.bytes[20];
  if (key === bgKey) return;
  bgKey = key;
  let image = null;
  try {
    if (bg.k === 'preset' && bg.id !== 'plain') {
      image = new Image();
      // 用 onload，不用 decode()：頁面在背景時 decode() 可能一直不回來
      await new Promise((res, rej) => {
        image.onload = res;
        image.onerror = rej;
        image.src = asset('tex/bg_' + bg.id + '.webp');
      });
    } else if (bg.k === 'img') {
      image = softCanvas(await createImageBitmap(new Blob([bg.img.bytes], { type: bg.img.mime })));
    }
  } catch (e) {
    image = null;
  }
  if (key === bgKey) machine?.setBackground(bg, image);
}


function draftChanged(redrawItems = false) {
  if (redrawItems) renderItems();
  else {
    const total = draft.items.reduce((a, b) => a + b.qty, 0);
    $('items-sum').textContent = t('itemsSum', { n: draft.items.length, q: total });
    document.querySelectorAll('.item').forEach((li) => {
      const it = draft.items[li.dataset.i];
      li.querySelector('.odds').textContent = t('odds', { p: pct(it.qty / total) });
    });
  }
  draft.sample = false;
  linkToken = null;
  saveDraft();
  if (draft.cloud && cloudReady()) scheduleSync();
  else {
    $('link-out').hidden = true;
    linkState = null;
  }
  if (app.dataset.mode === 'create') showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
}

function bindForm() {
  // 機台種類：轉蛋機／轉卡機
  for (const b of $('kinds').children) {
    b.onclick = () => {
      if (draft.kind === b.dataset.kind) return;
      draft.kind = b.dataset.kind;
      for (const x of $('kinds').children) x.setAttribute('aria-checked', String(x === b));
      draftChanged();
    };
  }
  const sw = $('swatches');
  for (const k of THEME_KEYS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.type = 'button';
    b.dataset.k = k;
    b.setAttribute('role', 'radio');
    b.dataset.i18nAria = 'th.' + k;
    b.setAttribute('aria-label', t('th.' + k));
    b.style.setProperty('--c', THEMES[k].body);
    b.onclick = () => {
      draft.theme = k;
      for (const x of sw.children) x.setAttribute('aria-checked', String(x === b));
      draftChanged();
    };
    sw.append(b);
  }
  for (const c of CURRENCIES) $('cur').append(new Option(c === '代幣' ? t('cur.token') : c, c));

  const items = $('items');
  items.addEventListener('input', (e) => {
    const li = e.target.closest('.item');
    if (!li) return;
    const it = draft.items[li.dataset.i];
    if (e.target.classList.contains('name')) it.name = e.target.value.slice(0, LIMITS.name) || t('defaultPrize');
    if (e.target.classList.contains('qty')) it.qty = Math.min(LIMITS.qty, Math.max(1, parseInt(e.target.value, 10) || 1));
    if (e.target.classList.contains('rarity')) it.rarity = +e.target.value;
    if (e.target.classList.contains('name')) {
      const img = li.querySelector('.thumb img');
      if (!it.img) img.src = thumbOf(draft, +li.dataset.i).url;
    }
    draftChanged();
  });
  items.addEventListener('change', (e) => {
    if (e.target.classList.contains('qty')) e.target.value = draft.items[e.target.closest('.item').dataset.i].qty;
  });
  let fileFor = -1;
  items.addEventListener('click', (e) => {
    const li = e.target.closest('.item');
    if (!li) return;
    if (e.target.closest('.del')) {
      draft.items.splice(+li.dataset.i, 1);
      draftChanged(true);
    } else if (e.target.closest('.thumb')) {
      fileFor = +li.dataset.i;
      $('file').value = '';
      $('file').click();
    } else if (e.target.closest('.media-btn, .media-chip')) {
      openMediaSheet(+li.dataset.i);
    }
  });
  $('file').addEventListener('change', async () => {
    const f = $('file').files[0];
    if (!f || fileFor < 0) return;
    if (/^(audio|video)\//.test(f.type)) return attachFile(fileFor, f);
    try {
      const it = draft.items[fileFor];
      it.img = await shrinkImage(f);
      it.mask = null;
      it.noMask = false;
      draftChanged(true);
      makeMask(it); // 主體去背（背景跑，好了再更新）
    } catch (e) {
      toast(t('t.badImage'));
    }
  });
  bindMediaSheet();
  $('add-item').onclick = () => {
    if (draft.items.length >= LIMITS.items) return;
    draft.items.push({ name: t('newPrize', { n: draft.items.length + 1 }), rarity: 0, qty: 5, img: null, uid: newUid() });
    draftChanged(true);
    const last = items.lastElementChild?.querySelector('.name');
    last?.focus();
    last?.select();
  };
  $('coins').addEventListener('input', () => {
    draft.price.coins = Math.min(LIMITS.coins, Math.max(1, parseInt($('coins').value, 10) || 1));
    $('price-out').textContent = priceText(draft.price);
    $('price-coins').textContent = t('coinsN', { n: draft.price.coins });
    draftChanged();
  });
  $('unit').addEventListener('input', () => {
    draft.price.unit = Math.max(0, parseFloat($('unit').value) || 0);
    $('price-out').textContent = priceText(draft.price);
    draftChanged();
  });
  $('cur').addEventListener('change', () => {
    draft.price.cur = $('cur').value;
    renderPrice();
    draftChanged();
  });
  $('m-name').addEventListener('input', () => {
    draft.name = $('m-name').value.slice(0, LIMITS.title) || t('defaultMachine');
    draftChanged();
  });
  $('m-shop').addEventListener('input', () => {
    draft.shop = $('m-shop').value.slice(0, LIMITS.title);
    draftChanged();
  });

  $('make-link').onclick = () => requestSync(false);
  $('restock').onclick = restock;
  $('new-link').onclick = () => {
    // 舊連結停在目前的內容；之後的修改只會更新新連結
    delete draft.cloud;
    saveDraft();
    requestSync(false).then(() => draft.cloud && toast(t('t.newLink')));
  };
  $('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('link').value);
      toast(t('t.copied'));
    } catch (e) {
      $('link').focus();
      $('link').select();
      toast(t('t.selectCopy'));
    }
  };
  $('try').onclick = async () => {
    if (!linkToken) linkToken = await encodeConfig(draft);
    await enterPlay(linkToken);
  };
}

// ---------- 連結（雲端短連結，改設定自動更新同一條） ----------
let linkState = null; // 最近一次顯示的連結狀態（換語言時重寫說明）
let syncTimer = 0;
let syncing = null;
let syncAgain = false;

// 改設定 → 1.5 秒沒再動就更新（連續改只送最後一次）
function scheduleSync() {
  clearTimeout(syncTimer);
  if (linkState) showLinkStatus({ ...linkState, syncing: true });
  syncTimer = setTimeout(() => requestSync(true), 1500);
}

// 同一時間只跑一個；跑的途中又有修改 → 跑完再跑一次（不會讓舊的內容蓋掉新的）
async function requestSync(auto) {
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = publishLink(auto);
  try {
    await syncing;
  } finally {
    syncing = null;
  }
  if (syncAgain) {
    syncAgain = false;
    return requestSync(true);
  }
}

// 上傳的影音先放上雲端 → 機台存進雲端（有鑰匙就改同一條）→ 短連結；雲端不通就給完整的長連結
async function publishLink(auto) {
  const btn = $('make-link');
  btn.disabled = true;
  let upFail = 0;
  try {
    if (cloudReady()) {
      for (const it of draft.items) {
        if (it.media?.k !== 'file' || it.media.remote) continue;
        btn.textContent = t('link.uploading', { name: it.media.name });
        try {
          const u = await localUrl(it.media);
          if (!u) throw new Error('missing');
          const blob = await (await fetch(u)).blob();
          it.media.remote = await uploadMedia(blob, it.media.name, it.media.kind);
          saveDraft();
        } catch (e) {
          upFail++;
        }
      }
      btn.textContent = t('link.making');
    }
    ensureUids(draft);
    const token = await encodeConfig(draft);
    let failed = false;
    if (cloudReady()) {
      const stock = stockOf(draft);
      const price = draft.price.coins;
      const w = await loadWallet().catch(() => null); // 別人轉這台 → 錢進這個錢包
      try {
        draft.cloud = await saveMachine(token, draft.cloud, stock, price, w);
      } catch (e) {
        if (e.message === 'e.locked') draft.cloud = await saveMachine(token, null, stock, price, w).catch(() => null);
        failed = !draft.cloud || e.message !== 'e.locked';
      }
      if (draft.cloud && !failed) draft.sample = false; // 已經發出去的機台：換語言不再重寫範例內容
      saveDraft();
    }
    linkToken = token;
    const c = draft.cloud;
    showLinkStatus({ url: shareBase() + '#' + (c ? 's.' + c.id : token), short: !!c, failed, upFail, auto, at: Date.now() });
    if (c && !failed) refreshStats();
    if (failed && c) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => requestSync(true), 15000); // 連不上 → 15 秒後再試
    }
  } finally {
    btn.disabled = false;
    btn.textContent = t('makeLink');
  }
}

// ---------- 錢包 ----------
// 每個使用者（瀏覽器）一個，一開始 1000 枚：轉別人的機台扣錢，別人轉你的機台加錢（都在伺服器算）
let wallet = null; // { id, key, balance, ledger }
let walletP = null;
function loadWallet() {
  if (!cloudReady()) return Promise.resolve(null);
  if (walletP) return walletP;
  walletP = (async () => {
    let c = store.get('clatter.wallet');
    if (!isWalletCred(c)) {
      c = newWalletCred();
      store.set('clatter.wallet', c);
    }
    let w;
    try {
      w = await walletOpen(c);
    } catch (e) {
      if (e.message !== 'e.locked') throw e;
      c = newWalletCred(); // 鑰匙對不上（不太會發生）→ 開新錢包
      store.set('clatter.wallet', c);
      w = await walletOpen(c);
    }
    wallet = { id: c.id, key: c.key, ...w };
    renderWalletUi();
    return wallet;
  })().finally(() => (walletP = null));
  return walletP;
}

function renderWalletUi() {
  $('wallet-card').hidden = !wallet;
  if (!wallet) return;
  $('w-bal').textContent = wallet.balance.toLocaleString();
  $('w-bal2').textContent = wallet.balance.toLocaleString();
  const ul = $('w-ledger');
  ul.textContent = '';
  if (!wallet.ledger.length) {
    const li = document.createElement('li');
    li.textContent = t('wallet.empty');
    ul.append(li);
  }
  for (const e of wallet.ledger) {
    const li = document.createElement('li');
    const what = document.createElement('span');
    const name = e.m && e.m === draft.cloud?.id ? draft.name : e.m && e.m === play?.cloud ? play.cfg.name : '';
    what.textContent = t('wallet.k.' + e.k, { n: e.n }) + (name ? `｜${name}` : '');
    const when = document.createElement('small');
    when.textContent = new Date(e.t).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const amt = document.createElement('b');
    amt.className = e.d >= 0 ? 'plus' : 'minus';
    amt.textContent = (e.d >= 0 ? '+' : '−') + Math.abs(e.d).toLocaleString();
    li.append(what, amt, when);
    ul.append(li);
  }
}

async function openWallet() {
  renderWalletUi();
  openSheet('sheet-wallet', $('sheet-wallet').querySelector('[data-close]'));
  await loadWallet().catch(() => {});
}

// 賣家：每個獎品被轉走幾個（開頁、更新連結、回到這個分頁、補貨後重抓）
let cloudStats = null;
async function refreshStats() {
  if (!draft.cloud || !cloudReady()) return;
  try {
    cloudStats = await pulledCounts(draft.cloud.id);
    renderItems();
  } catch (e) {
    /* 抓不到就先不顯示 */
  }
}

// 補貨：按兩下（第一下變成「確定補貨？」）→ 被轉走的紀錄歸零
let restockArmed = 0;
async function restock() {
  const b = $('restock');
  if (!draft.cloud) return;
  if (Date.now() - restockArmed > 3000) {
    restockArmed = Date.now();
    b.textContent = t('stock.confirm');
    setTimeout(() => (b.textContent = t('stock.restock')), 3000);
    return;
  }
  restockArmed = 0;
  b.disabled = true;
  try {
    await restockCloud(draft.cloud);
    toast(t('stock.done'));
    await refreshStats();
  } catch (e) {
    toast(t('t.badLink', { msg: t(e.message) }));
  } finally {
    b.disabled = false;
    b.textContent = t('stock.restock');
  }
}

function showLinkStatus(s) {
  linkState = s;
  $('link').value = s.url;
  $('link-out').hidden = false;
  $('new-link').hidden = !s.short;
  $('restock').hidden = !s.short;
  const meta = $('link-meta');
  const imgs = draft.items.filter((it) => it.img).length;
  const long = !s.short && s.url.length > 8000;
  let text;
  if (s.syncing) text = t('link.syncing');
  else if (s.short && s.failed) text = t('link.syncFail');
  else if (s.short && s.auto) text = t('link.synced', { time: new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  else if (s.short) text = t('linkMetaShort');
  else {
    text = t(imgs ? 'linkMetaPhotos' : 'linkMeta', { n: s.url.length.toLocaleString(), m: imgs });
    if (cloudReady()) text += t('link.cloudDown');
    if (long) text += t('linkWarn');
  }
  if (!s.syncing) {
    const shared = draft.items.filter((it) => it.media?.k === 'file' && mediaToLink(it.media)).length;
    const locals = draft.items.filter((it) => it.media?.k === 'file' && !mediaToLink(it.media)).length;
    if (shared) text += t('media.cloudShared', { n: shared });
    if (locals) text += t('media.localInLink', { n: locals });
  }
  meta.textContent = text;
  meta.classList.toggle('warn', !s.syncing && (long || s.failed || s.upFail > 0));
}

// #g1z.…＝整台機器在連結裡；#s.xxxxxxxxxx＝雲端短連結
function isMachineHash(h) {
  return h.startsWith('g1') || /^s\.[0-9A-Za-z]{10}$/.test(h);
}

function shareBase() {
  const here = location.href.split('#')[0];
  // 本機預覽就用本機網址，方便測試；其他地方（artifact、Pages）都用公開網址
  if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(here)) return here;
  return PUBLIC_URL;
}

// ---------- 3D 機台 ----------
let decorTimer = 0;
let shown = null;
async function showMachine(cfg, capsules, total = capsules) {
  shown = cfg;
  if (!machine?.loaded) return;
  curKind = cfg.kind === 'card' ? 'card' : 'capsule';
  if (machine.kind !== curKind) {
    try {
      await machine.setKind(curKind);
    } catch (e) {
      console.error(e);
      toast(t('loadFail'));
    }
    if (shown !== cfg) return; // 載入途中又換了機台
  }
  machine.setTheme(cfg.theme);
  applyBg(cfg.bg);
  machine.setPile(capsules, total);
  scheduleDecor();
}

// 機台種類不同，提示文字也不同（扭蛋 → 卡片）：有「key.card」就用它
let curKind = 'capsule';
const tk = (key, vars) => (curKind === 'card' && hasKey(key + '.card') ? t(key + '.card', vars) : t(key, vars));
const hasKey = (k) => t(k) !== k;

// 轉卡機：這次抽到的獎品畫成卡片正面（照片第一次用時還在解碼 → 等它好）
async function cardFront(idx) {
  if (curKind !== 'card') return null;
  const it = play.cfg.items[idx];
  const th = thumbOf(play.cfg, idx);
  if (!th.bmp && th.ready) await th.ready;
  const mk = maskOf(play.cfg, idx);
  if (mk && !mk.bmp) await mk.ready;
  return drawCardLayers(it, th.bmp || placeholderThumb(it.name, idx), it.rarity, mk?.bmp || null);
}
function scheduleDecor() {
  clearTimeout(decorTimer);
  decorTimer = setTimeout(() => {
    if (!machine?.loaded || !shown) return;
    const thumbs = shown.items.map((_, i) => {
      const th = thumbOf(shown, i);
      return th.bmp;
    });
    machine.updateDecor(shown, thumbs);
  }, 120);
}

function syncStage() {
  const cs = getComputedStyle(document.documentElement);
  machine?.setStage(cs.getPropertyValue('--stage').trim(), cs.getPropertyValue('--floor').trim());
}

// ---------- 玩家模式 ----------
const STEPS = {
  coin: { no: 1, title: 's.coin', btn: 's.coinBtn' },
  turn: { no: 2, title: 's.turn', text: 's.turnText', btn: 's.turnBtn' },
  busy: { no: 2, title: 's.busy', text: 's.busyText', btn: null },
  take: { no: 3, title: 's.take', text: 's.takeText', btn: 's.takeBtn' },
  open: { no: 4, title: 's.open', text: 's.openText', btn: 's.openBtn' },
  result: { no: 4, title: 's.result', text: null, btn: null },
  soldout: { no: 1, title: 's.soldout', text: 's.soldoutText', btn: 'myCaps' },
  multi: { no: 2, title: 'ten.busy', text: 'ten.busyText', btn: null },
  multiOpen: { no: 4, title: 'ten.open', text: 'ten.openText', btn: 'ten.openBtn' },
  multiBusy: { no: 4, title: 's.result', text: null, btn: null },
};

function playKey() {
  return 'clatter.play.' + play.id;
}

async function enterPlay(token) {
  let cfg;
  const link = token;
  const fromDraft = token === 'draft' ? shop.cur : null; // 開店的人自己試玩：收集簿用固定的 key（設定一改 play id 就會變）
  const sid = token.startsWith('s.') ? token.slice(2) : null;
  let pulled = null;
  let shared = false;
  try {
    // 短連結 → 雲端上最新的機台字串＋每個獎品被轉走幾個（庫存大家共用）
    if (sid) {
      const [m, p] = await Promise.all([loadMachine(sid), pulledCounts(sid)]);
      token = m.data;
      shared = m.shared;
      pulled = p;
    }
    cfg = token === 'draft' ? draft : await decodeConfig(token);
  } catch (e) {
    toast(t('t.badLink', { msg: t(e.message) }));
    return setMode('create');
  }
  if (token === 'draft') token = await encodeConfig(draft);
  machine?.clearCapsules();
  const id = sid ? 's' + sid : shortId(token);
  // cloud：共用庫存的機台 id（第一版短連結沒有共用庫存 → null，照舊用這台裝置的庫存）
  // phase 'loading'：機台（轉卡機第一次要載入模型）準備好、setPhase('coin') 之前不能投幣
  play = { cfg, token, link: sid ? link : token, id, cloud: shared ? sid : null, fromDraft, phase: 'loading', inserted: 0, busy: false };
  const saved = reconcile(store.get('clatter.play.' + id), cfg);
  const totalQ = cfg.items.map((it) => it.qty);
  if (saved) {
    play.remaining = saved.remaining.map((n, i) => Math.min(totalQ[i], Math.max(0, n | 0)));
    play.got = saved.got || {};
    play.coins = Number.isInteger(saved.coins) ? saved.coins : cfg.price.coins * 3;
    play.pulls = saved.pulls | 0;
    // 上次 10 連抽還沒開完就離開 → 沒開的直接放進收藏
    const m = saved.multi;
    if (m && Array.isArray(m.picks)) {
      let k = 0;
      m.picks.forEach((idx, i) => {
        if (m.opened?.[i] || !(idx >= 0 && idx < cfg.items.length)) return;
        play.got[idx] = (play.got[idx] || 0) + 1;
        k++;
      });
      if (k) {
        savePlay();
        toast(t('ten.restored', { n: k }));
      }
    }
  } else {
    play.remaining = totalQ.slice();
    play.got = {};
    play.coins = cfg.price.coins * 3;
    play.pulls = 0;
  }
  if (play.cloud) {
    // 共用庫存：剩下＝店家放的數量 − 被轉走的（不管是誰轉走的）
    play.remaining = cfg.items.map((it) => Math.max(0, it.qty - (pulled[itemKey(it)] || 0)));
    // 上次投好幣（伺服器已經抽了）還沒打開就離開 → 放進收藏
    const idx = saved?.pend;
    if (Number.isInteger(idx) && idx >= 0 && idx < cfg.items.length) {
      play.got[idx] = (play.got[idx] || 0) + 1;
      toast(t('t.pendRestored'));
    }
    savePlay();
  }
  $('c-reset').hidden = !!play.cloud; // 共用庫存只有店家能補貨
  albumSync(); // 以前轉到的也補進收集簿
  // 共用庫存的機台用錢包付錢：硬幣＝錢包餘額，沒有免費的「＋5 枚」
  $('btn-topup').hidden = !!play.cloud;
  document.querySelector('.coin-count small').textContent = t(play.cloud ? 'walletCoins' : 'trialCoins');
  document.querySelector('.coin-count').classList.toggle('tap', !!play.cloud);
  if (play.cloud) {
    const w = await loadWallet().catch(() => null);
    if (w) play.coins = w.balance;
    else toast(t('t.pullFail'));
  }
  setMode('play');
  renderPlate();
  await showMachine(cfg, left(), cfg.items.reduce((a, b) => a + b.qty, 0));
  if (left() === 0) setPhase('soldout');
  else setPhase('coin');
  renderWallet();
}

function renderPlate() {
  const cfg = play.cfg;
  $('p-shop').textContent = cfg.shop || '';
  $('p-shop').hidden = !cfg.shop;
  $('p-name').textContent = cfg.name;
  $('p-kinds').textContent = t('kinds', { n: cfg.items.length });
  $('p-price').textContent = priceText(cfg.price);
  $('p-coins').textContent = t('coinsN', { n: cfg.price.coins });
  $('p-price2').textContent = `${t('oneSpin')} ${priceText(cfg.price)} · ${t('coinsN', { n: cfg.price.coins })}`; // 手機版：價錢收在名牌裡
}

function left() {
  return play.remaining.reduce((a, b) => a + b, 0);
}
function savePlay() {
  const m = play.multi;
  const multi = m?.opened.includes(false) ? { picks: m.picks, opened: m.opened } : null; // 10 連還沒開完的
  // 名稱、數量一起記：賣家改了獎品（增刪、補貨）時用名稱對回來
  const names = play.cfg.items.map((it) => it.name);
  const qtys = play.cfg.items.map((it) => it.qty);
  // 雲端機台：投好幣、伺服器已經抽了但還沒打開的那顆（離開再回來會放進收藏）
  const pend = play.cloud && play.pending != null ? play.pending : null;
  store.set(playKey(), { remaining: play.remaining, got: play.got, coins: play.coins, pulls: play.pulls, multi, names, qtys, pend });
}

// 賣家更新了同一條連結 → 買家的剩餘數量、收藏照獎品名稱對回新的獎品表
//   數量照差額加減（賣家補 5 顆 → 剩的多 5 顆）；新獎品照新數量；被拿掉的獎品就不見了
function reconcile(saved, cfg) {
  if (!saved || !Array.isArray(saved.remaining)) return null;
  const names = cfg.items.map((it) => it.name);
  if (!Array.isArray(saved.names)) return saved.remaining.length === names.length ? saved : null; // 舊紀錄：長度對得上才用
  const map = []; // 舊的第 j 個 → 新的第 i 個
  const used = new Set();
  const remaining = names.map((n, i) => {
    const j = saved.names.findIndex((m, k) => m === n && !used.has(k));
    const q = cfg.items[i].qty;
    if (j < 0) return q;
    used.add(j);
    map[j] = i;
    const oldQ = Number.isInteger(saved.qtys?.[j]) ? saved.qtys[j] : q;
    return Math.min(q, Math.max(0, (saved.remaining[j] | 0) + q - oldQ));
  });
  const got = {};
  for (const [j, n] of Object.entries(saved.got || {})) if (map[j] != null) got[map[j]] = n;
  let multi = null;
  if (saved.multi && Array.isArray(saved.multi.picks)) {
    const keep = saved.multi.picks.map((j, k) => [map[j], saved.multi.opened?.[k]]).filter(([i]) => i != null);
    multi = { picks: keep.map(([i]) => i), opened: keep.map(([, o]) => !!o) };
  }
  const pend = Number.isInteger(saved.pend) ? map[saved.pend] ?? null : null;
  return { ...saved, remaining, got, multi, pend };
}

function setPhase(ph) {
  play.phase = ph;
  const s = STEPS[ph];
  $('h-step').textContent = t('stepNo', { n: s.no });
  $('h-title').textContent = tk(s.title);
  const need = play.cfg.price.coins;
  let text = s.text ? tk(s.text) : '';
  if (ph === 'coin') {
    text =
      play.coins + play.inserted < need
        ? t(play.cloud ? 'wallet.broke' : 's.coinBroke')
        : t('s.coinNeed', { n: need - play.inserted });
  }
  if (ph === 'multiOpen') text = tk('ten.openText', { n: play.multi.opened.filter((o) => !o).length });
  if (ph === 'soldout' && play.cloud) text = t('s.soldoutCloud'); // 共用庫存：只有店家能補貨
  document.querySelectorAll('[data-i18n="myCaps"]').forEach((el) => (el.textContent = tk('myCaps'))); // 我的扭蛋／我的卡片
  $('h-text').textContent = text;
  const b = $('h-btn');
  b.hidden = !s.btn;
  if (s.btn) b.textContent = tk(s.btn);
  b.disabled = ph === 'coin' && play.coins <= 0;
  // 10 連抽：投幣階段、剩 2 顆以上才出現（剩不到 10 顆就抽剩下的）
  const ten = $('h-ten');
  const n = Math.min(10, left());
  ten.hidden = !(ph === 'coin' && n >= 2);
  ten.textContent = t('ten.btn', { n, c: n * need });
  machine?.setSlotHint(ph === 'coin');
  machine?.setHandleEnabled(ph === 'turn');
  machine?.setGridPick(ph === 'multiOpen');
  $('p-left').textContent = t('left', { l: left(), t: play.cfg.items.reduce((a, b) => a + b.qty, 0) });
  $('got-count').textContent = $('got-count2').textContent = Object.keys(play.got).length;
  renderWallet();
}

function renderWallet() {
  if (!play) return;
  $('coin-n').textContent = play.coins;
  $('coin-chip').disabled = play.coins <= 0 || play.phase !== 'coin';
  const pips = $('pips');
  pips.textContent = '';
  const need = play.cfg.price.coins;
  for (let i = 0; i < need; i++) {
    const p = document.createElement('span');
    p.className = 'pip' + (i < play.inserted ? ' on' : '');
    pips.append(p);
  }
  const label = document.createElement('span');
  label.textContent = t('inserted', { a: play.inserted, b: need });
  pips.append(label);
}

async function insertCoin(fromX, fromY) {
  if (!play || play.phase !== 'coin' || play.coins <= 0 || play.inserting >= 1) return;
  if (play.inserted >= play.cfg.price.coins) return;
  play.inserting = (play.inserting || 0) + 1;
  play.coins--;
  renderWallet();
  if (fromX == null) {
    const r = $('coin-chip').getBoundingClientRect();
    fromX = r.left + r.width / 2;
    fromY = r.top + r.height / 2;
  }
  await machine.insertCoin(fromX, fromY);
  play.inserting--;
  play.inserted++;
  savePlay();
  if (play.inserted >= play.cfg.price.coins) {
    if (play.cloud) {
      setPhase('busy');
      const r = await pullFromCloud(1);
      if (!r) return refundCoins(play.inserted);
      play.pending = r[0];
      savePlay();
    } else play.pending = draw();
    machine.setForeshadow(foreshadowLevel([play.cfg.items[play.pending].rarity]));
    setPhase('turn');
  } else setPhase('coin');
}

// 買家回到分頁：店家改了機台 → 重新載入；只是庫存變了 → 更新剩幾顆（投到一半的時候不動）
async function refreshPlay() {
  if (!play?.cloud || play.inserted > 0 || !['coin', 'soldout'].includes(play.phase)) return;
  try {
    const [{ data }, pulled] = await Promise.all([loadMachine(play.cloud), pulledCounts(play.cloud)]);
    if (data !== play.token) {
      await enterPlay(play.link);
      toast(t('t.machineUpdated'));
      return;
    }
    const before = left();
    play.remaining = play.cfg.items.map((it) => Math.max(0, it.qty - (pulled[itemKey(it)] || 0)));
    if (left() !== before) {
      machine.setPile(left(), play.cfg.items.reduce((a, b) => a + b.qty, 0));
      savePlay();
      setPhase(left() === 0 ? 'soldout' : 'coin');
    }
  } catch (e) {
    /* 連不上就維持原樣 */
  }
}

// 雲端機台：跟伺服器抽 n 顆 → 獎品編號（抽不到、連不上 → null；剩下的數量一律用伺服器的）
async function pullFromCloud(n) {
  let res;
  try {
    const w = wallet || (await loadWallet());
    res = await pullCloud(play.cloud, n, w);
  } catch (e) {
    if (e.message === 'e.insufficient') {
      if (wallet && Number.isFinite(e.balance)) wallet.balance = e.balance;
      toast(t('wallet.notEnough', { n: wallet?.balance ?? 0 }));
    } else toast(t('t.pullFail'));
    return null;
  }
  if (res.balance != null && wallet) {
    // 伺服器扣好錢了：錢包餘額＝伺服器的數字（投進去還沒用到的硬幣另外算）
    wallet.balance = res.balance;
    play.coins = res.balance;
    loadWallet().catch(() => {}); // 明細背景更新
  }
  const keys = play.cfg.items.map(itemKey);
  keys.forEach((k, i) => {
    if (Number.isInteger(res.remaining[k])) play.remaining[i] = Math.max(0, res.remaining[k]);
  });
  const picks = res.picks.map((k) => keys.indexOf(k)).filter((i) => i >= 0);
  if (!picks.length) {
    toast(t('t.soldOutNow'));
    return null;
  }
  play.pulls += picks.length;
  return picks;
}

// 沒抽成 → 投進去的硬幣退回（錢包機台：直接用錢包餘額，伺服器沒扣）
function refundCoins(n) {
  play.coins = play.cloud && wallet ? wallet.balance : play.coins + n;
  play.inserted = 0;
  savePlay();
  setPhase(left() === 0 ? 'soldout' : 'coin');
}

// 前兆：SSR 75%、SR 50% 會在轉把手時發光（不是每次都有，保留驚喜）
function foreshadowLevel(rarities) {
  const top = Math.max(...rarities);
  if (top === 3 && Math.random() < 0.75) return 3;
  if (top >= 2 && Math.random() < 0.5) return 2;
  return 0;
}

// 抽獎：照「剩下的顆數」抽（像真的機器，抽一顆少一顆）
function draw() {
  const total = left();
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  let r = u[0] % total;
  for (let i = 0; i < play.remaining.length; i++) {
    if (r < play.remaining[i]) return i;
    r -= play.remaining[i];
  }
  return play.remaining.length - 1;
}

async function onTurned() {
  setPhase('busy');
  play.inserted = 0;
  const idx = play.pending ?? draw();
  play.pending = idx;
  if (!play.cloud) {
    play.remaining[idx]--; // 雲端機台：伺服器抽的時候已經扣了
    play.pulls++;
  }
  savePlay();
  renderWallet();
  await machine.dispense(play.cfg.items[idx].rarity, await cardFront(idx));
  machine.setForeshadow(0);
  setPhase('take');
}

async function take() {
  if (play.phase !== 'take') return;
  play.phase = 'lifting';
  await machine.liftCapsule();
  setPhase('open');
}

async function openIt() {
  if (play.phase !== 'open') return;
  play.phase = 'opening';
  const idx = play.pending;
  const it = play.cfg.items[idx];
  await machine.openCapsule(curKind === 'card' ? null : drawPrizeCard(it, thumbOf(play.cfg, idx).bmp || placeholderThumb(it.name, idx), !play.got[idx]));
  sfx.reveal(it.rarity);
  const first = !play.got[idx];
  play.got[idx] = (play.got[idx] || 0) + 1;
  play.pending = null;
  savePlay();
  albumSync();
  showResult(idx, first);
  setPhase('result');
}

let resultPlayer = null;
let resultView = false;
// view＝從收藏冊打開（只看、重播），不是剛轉到
function showResult(idx, first, view = false) {
  const it = play.cfg.items[idx];
  const r = RARITY[it.rarity];
  resultView = view;
  const fresh = !view || view === 'step'; // 剛開出來的（不是回顧）
  resultPlayer?.stop();
  const kind = mediaKind(it.media);
  $('r-prize').hidden = kind === 'video'; // 影片直接取代獎品圖
  resultPlayer = mountPlayer($('r-media'), it.media, { poster: thumbOf(play.cfg, idx).url, delay: fresh ? 1100 : 0 });
  resultIdx = idx;
  $('r-again').hidden = $('r-col').hidden = !!view;
  $('r-close').hidden = !view;
  $('r-close').textContent = view !== 'step' ? t('close') : play.multi.opened.includes(false) ? t('ten.next') : t('ten.toResults');
  const card = $('result-card');
  card.className = `sheet-card result r${it.rarity}${fresh ? ' fresh' : ''}`;
  card.style.setProperty('--rc', `var(--r-${r.key.toLowerCase()})`);
  $('r-rank').textContent = `${r.key} ${r.label}`;
  // 獎品＝3D 閃卡（寶可夢卡的閃法，holo.js）：轉卡機是卡片、轉蛋機是方形的壓克力牌；有去背的話做好大張的就換上
  const isCard = play.cfg.kind === 'card';
  const hd = { t: thumbOf(play.cfg, idx).url, r: it.rarity, shape: isCard ? 'card' : 'square', name: it.name, tag: isCard };
  resHolo.set(hd);
  if (it.mask) cutLayers(idx, 300, isCard ? 437 : 300).then((L) => resultIdx === idx && L.s && resHolo.set({ ...hd, s: L.s, b: L.b, st: L.st }));
  // 剛轉到：獎品照稀有度登場（N 跳出來、R 翻一圈、SR 剪影→轉一圈上色、SSR 剪影集氣→轉兩圈爆光）＋放射光、光環、星星
  const stage = $('r-prize');
  stage.classList.remove('go');
  void stage.offsetWidth;
  stage.classList.toggle('go', fresh);
  prizeSparks(fresh ? it.rarity : -1);
  $('r-name').textContent = it.name;
  $('r-new').hidden = !fresh || !first;
  const total = play.cfg.items.reduce((a, b) => a + b.qty, 0);
  $('r-sub').textContent = t('resultSub', { n: play.pulls, p: pct(it.qty / total), c: owned(idx) });
  openSheet('sheet-result', view ? $('r-close') : $('r-again'));
  resHolo.start(() => !$('sheet-result').hidden);
}
let viewHolo = null;
let resHolo = null;
let resultIdx = -1;
// 獎品登場時往外噴的星星（亮的那一刻：R 0.35 秒、SR 1 秒、SSR 1.6 秒）
function prizeSparks(r) {
  const box = $('r-sparks');
  box.textContent = '';
  const n = [0, 10, 18, 30][r] || 0;
  if (!n || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const at = [0, 0.35, 1.0, 1.6][r];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 80 + Math.random() * (60 + r * 30);
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    s.style.setProperty('--d', `${at + Math.random() * 0.25}s`);
    s.style.setProperty('--s', `${6 + Math.random() * (6 + r * 3)}px`);
    s.className = 'c' + (i % 4);
    box.append(s);
  }
}

// 爆開那一刻：閃光＋稀有度大字（R 小、SR 中、SSR 一個字一個字跳出來）
const BANNER = ['', 'RARE', 'SUPER RARE', 'SECRET'];
function onBurst(r) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (r >= 2 && !reduced) {
    const f = document.createElement('div');
    f.className = `flash f${r}`;
    $('stage').append(f); // 在舞台裡、壓在稀有度大字底下
    setTimeout(() => f.remove(), r === 3 ? 1100 : 700);
  }
  if (r === 0) return;
  const R = RARITY[r];
  const el = document.createElement('div');
  el.className = `rarity-banner r${r}`;
  el.setAttribute('aria-hidden', 'true');
  const big = document.createElement('strong');
  [...BANNER[r]].forEach((ch, i) => {
    const sp = document.createElement('span');
    sp.textContent = ch === ' ' ? ' ' : ch; // 一個字一個 inline-block，空白要用不換行空格
    sp.style.animationDelay = `${0.05 + i * (r === 3 ? 0.07 : 0.035)}s`;
    big.append(sp);
  });
  const small = document.createElement('em');
  small.textContent = `${R.key} ${R.label}`;
  el.append(big, small);
  $('stage').append(el);
  setTimeout(() => el.remove(), [0, 1100, 1700, 2700][r]);
}

function closeResult() {
  resultPlayer?.stop();
  resultPlayer = null;
  if (resultView === 'step') return closeStep();
  if (resultView === 'grid') return closeSheet('sheet-result');
  if (resultView) {
    closeSheet('sheet-result');
    if (resultView === 'multi') openSheet('sheet-multi', $('x-again'));
    else openCollection();
    return;
  }
  afterResult();
}

function afterResult() {
  resultPlayer?.stop();
  resultPlayer = null;
  machine.setDim(0, 0.8);
  machine.show.endPersist();
  machine.dismissShown(); // 轉卡機：翻開的那張卡收掉
  closeSheet('sheet-result');
  if (left() === 0) setPhase('soldout');
  else setPhase('coin');
}

function hintAction() {
  unlock();
  const ph = play?.phase;
  if (ph === 'coin') insertCoin();
  else if (ph === 'turn') machine.autoTurn();
  else if (ph === 'take') take();
  else if (ph === 'open') openIt();
  else if (ph === 'soldout') openCollection();
  else if (ph === 'multiOpen') openAll();
}

// ---------- 10 連抽 ----------
const wait = (sec) => machine.after(sec);

async function tenPull() {
  if (!play || play.phase !== 'coin' || play.inserting) return;
  let n = Math.min(10, left());
  if (n < 2) return;
  const need = play.cfg.price.coins;
  const cost = n * need - play.inserted; // 已經投進去的也算
  if (play.cloud && play.coins < cost) {
    toast(t('wallet.notEnough', { n: play.coins + play.inserted }));
    return;
  }
  if (play.coins < cost) {
    const add = cost - play.coins;
    play.coins += add; // 體驗版：不夠就自動換試玩硬幣
    toast(t('ten.topup', { n: add }));
  }
  play.coins -= cost;
  play.inserted = 0;
  setPhase('multi');
  renderWallet();
  // 硬幣一口氣丟進去（畫三枚意思一下）
  const r = $('coin-chip').getBoundingClientRect();
  for (let i = 0; i < 3; i++) {
    machine.insertCoin(r.left + r.width / 2, r.top + r.height / 2);
    await wait(0.12);
  }
  await wait(0.5);
  // 先抽好 n 顆（抽一顆少一顆）；雲端機台由伺服器抽，可能被別人先抽走幾顆
  let picks = [];
  if (play.cloud) {
    picks = (await pullFromCloud(n)) || [];
    if (!picks.length) play.coins = wallet ? wallet.balance : play.coins + n * need;
    if (picks.length && picks.length < n) {
      renderWallet(); // 伺服器只扣了抽到的部分，餘額已經是伺服器的數字
      if (picks.length) toast(t('ten.partial', { n: picks.length }));
    }
    if (!picks.length) return refundCoins(0);
    n = picks.length;
  } else {
    for (let i = 0; i < n; i++) {
      const idx = draw();
      play.remaining[idx]--;
      play.pulls++;
      picks.push(idx);
    }
  }
  play.multi = { picks, opened: picks.map(() => false), isNew: [] };
  savePlay();
  machine.setForeshadow(foreshadowLevel(picks.map((i) => play.cfg.items[i].rarity)));
  let last = null;
  for (let i = 0; i < n; i++) {
    await machine.quickTurn();
    last = machine.dispenseToGrid(i, n, play.cfg.items[picks[i]].rarity, await cardFront(picks[i]));
    $('p-left').textContent = t('left', { l: left() + n - 1 - i, t: play.cfg.items.reduce((a, b) => a + b.qty, 0) });
  }
  await last;
  machine.setForeshadow(0);
  setPhase('multiOpen');
}

const multiRar = (i) => play.cfg.items[play.multi.picks[i]].rarity;

// 第 i 顆開了 → 記進收藏（同一個獎品抽到兩次，先開的那顆才算 NEW）
function creditMulti(i) {
  const m = play.multi;
  if (m.opened[i]) return;
  const idx = m.picks[i];
  m.isNew[i] = !play.got[idx];
  play.got[idx] = (play.got[idx] || 0) + 1;
  m.opened[i] = true;
  albumSync();
}

function prizeCard(i) {
  const idx = play.multi.picks[i];
  const it = play.cfg.items[idx];
  return drawPrizeCard(it, thumbOf(play.cfg, idx).bmp || placeholderThumb(it.name, idx), play.multi.isNew[i]);
}

// 點格子裡的一顆：N、R 當場啵開翻出小卡；SR 以上移到中間跑完整演出＋結果卡
async function openOne(i) {
  const m = play?.multi;
  if (play?.phase !== 'multiOpen' || !m || m.opened[i]) return;
  unlock();
  const r = multiRar(i);
  creditMulti(i);
  savePlay();
  if (r < 2) {
    machine.popInGrid(i, prizeCard(i));
    machine.after(0.15).then(() => sfx.reveal(r));
    if (m.opened.includes(false)) setPhase('multiOpen'); // 更新「還有幾顆」
    else finishMulti();
    return;
  }
  setPhase('multiBusy');
  await machine.openFromGrid(i, prizeCard(i));
  sfx.reveal(r);
  showResult(m.picks[i], m.isNew[i], 'step');
}

function closeStep() {
  closeSheet('sheet-result');
  machine.setDim(0, 0.8);
  machine.show.endPersist();
  machine.restoreGrid();
  if (play.multi.opened.includes(false)) setPhase('multiOpen');
  else finishMulti();
}

// 點已經開出來的小卡 → 結果卡回顧（影音可以播）
function viewGridCard(i) {
  if (play?.phase !== 'multiOpen' || !play.multi?.opened[i]) return;
  showResult(play.multi.picks[i], false, 'grid');
}

// 全部打開（原本的方式）：還沒開的依序啵開，其中最稀有的那顆（同等級取最後一顆）最後跑完整演出
async function openAll() {
  if (play.phase !== 'multiOpen') return;
  setPhase('multiBusy');
  const m = play.multi;
  const rest = m.picks.map((_, i) => i).filter((i) => !m.opened[i]);
  if (!rest.length) return finishMulti();
  let best = rest[0];
  for (const i of rest) if (multiRar(i) >= multiRar(best)) best = i;
  for (const i of rest) {
    if (i === best) continue;
    creditMulti(i);
    machine.popInGrid(i, prizeCard(i));
    await wait(multiRar(i) >= 1 ? 0.28 : 0.16);
  }
  creditMulti(best);
  savePlay();
  await wait(0.35);
  await machine.openFromGrid(best, prizeCard(best));
  sfx.reveal(multiRar(best));
  showMulti(m.picks, m.isNew, topOfMulti());
  setPhase('result');
}

// 一顆一顆開完 → 看一眼整排小卡，再出結果表
async function finishMulti() {
  setPhase('multiBusy');
  await wait(0.8);
  showMulti(play.multi.picks, play.multi.isNew, topOfMulti());
  setPhase('result');
}

function topOfMulti() {
  let top = 0;
  play.multi.picks.forEach((_, i) => {
    if (multiRar(i) >= multiRar(top)) top = i;
  });
  return top;
}

function showMulti(picks, isNew, best) {
  const grid = $('x-grid');
  grid.textContent = '';
  picks.forEach((idx, i) => {
    const it = play.cfg.items[idx];
    const R = RARITY[it.rarity];
    const card = document.createElement(it.media ? 'button' : 'div');
    card.className = `mcard r${it.rarity}`;
    card.style.setProperty('--rc', `var(--r-${R.key.toLowerCase()})`);
    card.style.animationDelay = `${i * 0.06 + (i === best ? 0.3 : 0)}s`;
    const img = document.createElement('img');
    img.src = thumbOf(play.cfg, idx).url;
    img.alt = '';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = it.name + (it.media ? (mediaKind(it.media) === 'video' ? ' ▶' : ' ♪') : '');
    const rk = document.createElement('span');
    rk.className = 'rk';
    rk.textContent = R.key;
    card.append(img, nm, rk);
    if (isNew[i]) {
      const nw = document.createElement('span');
      nw.className = 'nw';
      nw.textContent = 'NEW';
      card.append(nw);
    }
    if (it.media) {
      card.type = 'button';
      card.onclick = () => {
        $('sheet-multi').hidden = true;
        showResult(idx, false, 'multi');
      };
    }
    grid.append(card);
  });
  const n = picks.length;
  const bestR = RARITY[play.cfg.items[picks[best]].rarity];
  $('x-title').textContent = t('ten.title', { n });
  $('x-meta').textContent = t('ten.meta', { k: isNew.filter(Boolean).length, r: `${bestR.key} ${bestR.label}` });
  const next = Math.min(10, left());
  $('x-again').hidden = next < 2;
  $('x-again').textContent = t('ten.again', { n: next });
  openSheet('sheet-multi', next >= 2 ? $('x-again') : $('x-one'));
}

function closeMulti() {
  machine.setDim(0, 0.8);
  machine.show.endPersist();
  machine.clearGrid();
  play.multi = null;
  closeSheet('sheet-multi');
  if (left() === 0) setPhase('soldout');
  else setPhase('coin');
}


function nudge() {
  const h = $('hint');
  h.classList.remove('nudge');
  void h.offsetWidth;
  h.classList.add('nudge');
}

// 硬幣拖進投幣口
function bindCoinDrag() {
  const chip = $('coin-chip');
  let ghost = null;
  let start = null;
  chip.addEventListener('pointerdown', (e) => {
    if (chip.disabled) return;
    unlock();
    start = { x: e.clientX, y: e.clientY, moved: false };
    chip.setPointerCapture(e.pointerId);
  });
  chip.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
      start.moved = true;
      ghost = document.createElement('div');
      ghost.className = 'ghost-coin';
      document.body.append(ghost);
    }
    if (ghost) {
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
    }
  });
  const end = (e) => {
    if (!start) return;
    const s = start;
    start = null;
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    if (!s.moved) return insertCoin();
    const slot = machine.slotScreen();
    const stage = $('stage').getBoundingClientRect();
    const onStage = e.clientX > stage.left && e.clientX < stage.right && e.clientY > stage.top && e.clientY < stage.bottom;
    if (onStage && Math.hypot(e.clientX - slot.x, e.clientY - slot.y) < 120) insertCoin(e.clientX, e.clientY);
    else if (onStage) toast(t('t.dropMiss'));
  };
  chip.addEventListener('pointerup', end);
  chip.addEventListener('pointercancel', () => {
    start = null;
    ghost?.remove();
    ghost = null;
  });
}

// ---------- 影音（開店表單） ----------
let mediaFor = -1;
let mediaPreview = null;

async function attachFile(i, f) {
  if (f.size > MAX_FILE) return toast(t('media.tooBig'));
  const it = draft.items[i];
  await removeLocal(it.media);
  it.media = await saveLocal(f);
  // 影片：抓一格畫面當縮圖（縮圖會放進連結）
  if (it.media.kind === 'video' && !it.img) {
    const c = await videoFrame(await localUrl(it.media));
    if (c) it.img = await shrinkImage(c).catch(() => null);
  }
  draftChanged(true);
  toast(t('media.added'));
  if (!$('sheet-media').hidden) openMediaSheet(i);
}

function openMediaSheet(i) {
  mediaFor = i;
  const it = draft.items[i];
  $('m-item').textContent = it.name;
  $('m-url').value = it.media && it.media.k !== 'file' ? it.media.u : '';
  $('m-remove').hidden = !it.media;
  mediaPreview?.stop();
  mediaPreview = mountPlayer($('m-preview'), it.media, { poster: thumbOf(draft, i).url });
  if ($('sheet-media').hidden) openSheet('sheet-media', $('m-url'));
}

function bindMediaSheet() {
  $('m-add').onclick = async () => {
    const m = parseMediaUrl($('m-url').value);
    if (!m) return toast(t('media.bad'));
    const it = draft.items[mediaFor];
    await removeLocal(it.media);
    it.media = m;
    draftChanged(true);
    openMediaSheet(mediaFor);
    toast(t('media.added'));
    // YouTube：沒有照片的話，試著把 YouTube 縮圖縮小放進連結
    if (m.k === 'yt' && !it.img) {
      try {
        const r = await fetch(ytThumb(m));
        if (r.ok) {
          it.img = await shrinkImage(await r.blob());
          draftChanged(true);
        }
      } catch (e) {
        /* 拿不到就用 YouTube 網址上的縮圖顯示 */
      }
    }
  };
  $('m-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('m-add').click();
  });
  $('m-upload').onclick = () => {
    $('file-media').value = '';
    $('file-media').click();
  };
  $('file-media').addEventListener('change', () => {
    const f = $('file-media').files[0];
    if (f && mediaFor >= 0) attachFile(mediaFor, f);
  });
  $('m-remove').onclick = async () => {
    const it = draft.items[mediaFor];
    await removeLocal(it.media);
    it.media = null;
    draftChanged(true);
    closeSheet('sheet-media');
  };
}

// ---------- 對話框 ----------
let lastFocus = null;
function openSheet(id, focusEl) {
  lastFocus = document.activeElement;
  $(id).hidden = false;
  (focusEl || $(id).querySelector('button'))?.focus();
}
function closeSheet(id) {
  if (id === 'sheet-media') mediaPreview?.stop();
  $(id).hidden = true;
  lastFocus?.focus?.();
}

function openLineup() {
  const cfg = play.cfg;
  const total = cfg.items.reduce((a, b) => a + b.qty, 0);
  $('l-meta').textContent = t('lineupMeta', { price: priceText(cfg.price), c: cfg.price.coins, t: total, l: left() });
  const ul = $('l-list');
  ul.textContent = '';
  cfg.items.forEach((it, i) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = thumbOf(cfg, i).url;
    img.alt = '';
    const mid = document.createElement('div');
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = it.name;
    if (it.media) {
      const mb = document.createElement('span');
      mb.className = 'mbadge';
      mb.textContent = mediaKind(it.media) === 'video' ? '▶' : '♪';
      nm.append(mb);
    }
    const rk = document.createElement('span');
    rk.className = 'rk';
    rk.style.setProperty('--rc', `var(--r-${RARITY[it.rarity].key.toLowerCase()})`);
    rk.textContent = `${RARITY[it.rarity].key} ${RARITY[it.rarity].label}`;
    mid.append(nm, rk);
    const num = document.createElement('div');
    num.className = 'num-col';
    num.innerHTML = '';
    const a = document.createElement('div');
    a.textContent = pct(it.qty / total);
    const b = document.createElement('div');
    b.textContent = t('remain', { l: play.remaining[i], q: it.qty });
    num.append(a, b);
    li.append(img, mid, num);
    ul.append(li);
  });
  openSheet('sheet-lineup');
}

function openCollection() {
  const cfg = play.cfg;
  const grid = $('c-grid');
  grid.textContent = '';
  let kinds = 0;
  cfg.items.forEach((it, i) => {
    const n = owned(i);
    if (n) kinds++;
    const cell = document.createElement(n ? 'button' : 'div');
    cell.className = 'cell' + (n ? '' : ' miss') + (n && it.media ? ' can-play' : '');
    if (n) {
      cell.type = 'button';
      cell.onclick = () => {
        closeSheet('sheet-collection');
        showResult(i, false, true);
      };
    }
    const img = document.createElement('img');
    img.src = thumbOf(cfg, i).url;
    img.alt = n ? it.name : t('notYet');
    const nm = document.createElement('div');
    nm.textContent = n ? it.name : '？？？';
    const c = document.createElement('div');
    c.className = 'cnt';
    c.textContent = n ? `× ${n}` : RARITY[it.rarity].key;
    cell.append(img, nm, c);
    grid.append(cell);
  });
  $('c-meta').textContent = t('collectionMeta', { k: kinds, n: cfg.items.length, p: play.pulls });
  openSheet('sheet-collection');
}

// ---------- 模式切換 ----------
// 玩家模式：上方名牌、下方錢包＋提示會蓋住畫面 → 告訴鏡頭可用的空間
function updateInsets() {
  if (!machine) return;
  if (app.dataset.mode !== 'play') return machine.setInsets(0, 0);
  const st = $('stage').getBoundingClientRect();
  const narrow = st.width < 640;
  const plate = $('hud').querySelector('.plate').getBoundingClientRect();
  const tr = $('hud').querySelector('.top-right').getBoundingClientRect();
  const top = narrow ? plate.bottom - st.top + 4 : 0;
  const bottom = st.bottom - $('hud').querySelector('.bottom').getBoundingClientRect().top + 4;
  // 10 連的格子連左上名牌、右上價錢章都要避開（寬螢幕的機台不用，它們在兩側）
  const gridTop = Math.max(plate.bottom, tr.height ? tr.bottom : 0) - st.top + 6;
  machine.setInsets(Math.max(0, top), Math.max(0, bottom), Math.max(0, gridTop));
}

function setMode(mode) {
  app.dataset.mode = mode;
  $('tab-create').setAttribute('aria-selected', String(mode === 'create'));
  $('tab-play').setAttribute('aria-selected', String(mode === 'play'));
  $('tab-shop').setAttribute('aria-selected', String(mode === 'shop'));
  $('tab-album').setAttribute('aria-selected', String(mode === 'album'));
  $('page-shop').hidden = mode !== 'shop'; // 樣式表有 [hidden]{display:none} → 用屬性切換
  $('page-album').hidden = mode !== 'album';
  if (mode === 'shop') renderShop();
  if (mode === 'album') renderAlbum();
  requestAnimationFrame(updateInsets);
  if (mode === 'create') {
    machine?.clearCapsules();
    machine?.setSlotHint(false);
    machine?.setHandleEnabled(false);
    showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
  }
}

// ---------- 我的商店 ----------
// 換到另一台：先把這台還沒送出去的修改送完、存好，再載入那台
async function switchMachine(uid) {
  if (uid === shop.cur) return;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = 0;
    if (draft.cloud && cloudReady()) await requestSync(true).catch(() => {});
  }
  saveDraft();
  shop.cur = uid;
  store.set('clatter.shop', shop);
  draft = loadDraft();
  afterSwitch();
}

function afterSwitch() {
  linkToken = null;
  linkState = null;
  cloudStats = null;
  $('link-out').hidden = true;
  renderForm();
  if (draft.cloud && cloudReady()) {
    showLinkStatus({ url: shareBase() + '#s.' + draft.cloud.id, short: true });
    refreshStats();
  }
  if (app.dataset.mode === 'create') showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
  autoMasks();
}

async function newMachine() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = 0;
    if (draft.cloud && cloudReady()) await requestSync(true).catch(() => {});
  }
  saveDraft();
  const uid = 'm' + newUid();
  shop.list.push(uid);
  shop.cur = uid;
  store.set('clatter.shop', shop);
  draft = SAMPLE();
  saveDraft();
  afterSwitch();
  setMode('create');
  toast(t('shop.made'));
}

// 從我的商店拿掉（只刪這台裝置上的草稿；發出去的連結還在）
async function removeMachine(uid) {
  shop.list = shop.list.filter((u) => u !== uid);
  store.del(draftKey(uid));
  if (!shop.list.length) {
    const nu = 'm' + newUid();
    shop.list = [nu];
    shop.cur = nu;
    store.set('clatter.shop', shop);
    draft = SAMPLE();
    saveDraft();
    afterSwitch();
  } else if (shop.cur === uid) {
    shop.cur = shop.list[0];
    store.set('clatter.shop', shop);
    draft = loadDraft();
    afterSwitch();
  } else store.set('clatter.shop', shop);
  renderShop();
}

const KIND_ICON = {
  capsule: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="#fff" stroke="#1c2340" stroke-width="2.5"/><path d="M4 16a12 12 0 0 0 24 0z" fill="#e8423b" stroke="#1c2340" stroke-width="2.5"/></svg>',
  card: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="4" width="15" height="22" rx="2.5" fill="#5aa0ff" stroke="#1c2340" stroke-width="2.5" transform="rotate(12 16 15)"/><rect x="7" y="6" width="15" height="22" rx="2.5" fill="#ffd23f" stroke="#1c2340" stroke-width="2.5"/></svg>',
};

let noSalesRpc = false; // wallet_sales 還沒裝（404）→ 這次開頁面就不再問
function salesFromLedger(w) {
  const out = {};
  for (const e of w.ledger || []) {
    if (e.k !== 'sell' || !e.m) continue;
    const o = (out[e.m] = out[e.m] || { coins: 0, n: 0 });
    o.coins += e.d;
    o.n += e.n;
  }
  return out;
}

let shopDelArm = null;
async function renderShop() {
  const list = $('shop-list');
  list.textContent = '';
  saveDraft();
  const w = await loadWallet().catch(() => null);
  // 每台賣了多少：wallet_sales（supabase/05_sales.sql）；還沒裝好就用錢包明細（最近 30 筆）加總
  let sales = {};
  if (w && !noSalesRpc) sales = await walletSales(w).catch(() => ((noSalesRpc = true), salesFromLedger(w)));
  else if (w) sales = salesFromLedger(w);
  let sold = 0;
  for (const v of Object.values(sales)) sold += v.coins;
  const sum = $('shop-sum');
  sum.textContent = '';
  const stat = (label, value) => {
    const d = document.createElement('div');
    d.className = 'stat card-box';
    const s = document.createElement('small');
    s.textContent = label;
    const b = document.createElement('strong');
    b.textContent = value;
    d.append(s, b);
    sum.append(d);
  };
  stat(t('shop.sumMachines'), shop.list.length.toLocaleString());
  stat(t('shop.sumSales'), sold.toLocaleString());
  if (w) stat(t('wallet.title'), w.balance.toLocaleString());
  for (const uid of shop.list) {
    const d = uid === shop.cur ? draft : store.get(draftKey(uid));
    if (!d || !Array.isArray(d.items)) continue;
    const kind = d.kind === 'card' ? 'card' : 'capsule';
    const total = d.items.reduce((a, b) => a + (b.qty | 0), 0);
    const box = document.createElement('article');
    box.className = 'mach card-box' + (uid === shop.cur ? ' cur' : '');
    const top = document.createElement('div');
    top.className = 'mach-top';
    const ico = document.createElement('div');
    ico.className = 'mach-ico';
    ico.style.setProperty('--c', (THEMES[d.theme] || THEMES.red).body);
    ico.innerHTML = KIND_ICON[kind];
    const tt = document.createElement('div');
    const h = document.createElement('h2');
    h.textContent = d.name || t('defaultMachine');
    const sub = document.createElement('p');
    sub.textContent = `${t('kind.' + kind)} · ${t('kinds', { n: d.items.length })} · ${priceText(d.price || { coins: 1, unit: 0, cur: 'NT$' })}` + (uid === shop.cur ? ' · ' + t('shop.editing') : '');
    tt.append(h, sub);
    top.append(ico, tt);
    const stats = document.createElement('div');
    stats.className = 'mach-stats';
    const cell = (label, value) => {
      const c = document.createElement('div');
      const s = document.createElement('small');
      s.textContent = label;
      const b = document.createElement('b');
      b.textContent = value;
      c.append(s, b);
      stats.append(c);
      return b;
    };
    const id = d.cloud?.id;
    const sv = id ? sales[id] : null;
    const leftB = cell(t('shop.left'), id ? '…' : total.toLocaleString());
    const pullB = cell(t('shop.pulled'), id ? '…' : '–');
    cell(t('shop.sales'), sv ? sv.coins.toLocaleString() : '0');
    if (id && cloudReady()) {
      pulledCounts(id)
        .then((pc) => {
          const n = Object.values(pc).reduce((a, b) => a + b, 0);
          pullB.textContent = n.toLocaleString();
          leftB.textContent = Math.max(0, total - n).toLocaleString();
        })
        .catch(() => (leftB.textContent = pullB.textContent = '?'));
    }
    const link = document.createElement('div');
    link.className = 'mach-link';
    link.textContent = id ? shareBase() + '#s.' + id : t('shop.noLink');
    const acts = document.createElement('div');
    acts.className = 'mach-acts';
    const btn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.onclick = fn;
      acts.append(b);
      return b;
    };
    btn(t('shop.edit'), 'primary', async () => {
      await switchMachine(uid);
      setMode('create');
    });
    btn(t('shop.play'), 'sun', async () => {
      if (id) return enterPlay('s.' + id);
      await switchMachine(uid);
      enterPlay('draft');
    });
    if (id)
      btn(t('copy'), '', async () => {
        try {
          await navigator.clipboard.writeText(shareBase() + '#s.' + id);
          toast(t('t.copied'));
        } catch (e) {
          toast(shareBase() + '#s.' + id);
        }
      });
    const del = btn(t('shop.del'), 'ghost', () => {
      // 按兩下才刪（第一下變成「確定拿掉？」）
      if (shopDelArm !== uid) {
        shopDelArm = uid;
        del.textContent = t('shop.delConfirm');
        setTimeout(() => {
          if (shopDelArm === uid) shopDelArm = null;
          del.textContent = t('shop.del');
        }, 3000);
        return;
      }
      shopDelArm = null;
      removeMachine(uid);
    });
    box.append(top, stats, link, acts);
    list.append(box);
  }
}

// ---------- 收集簿 ----------
// clatter.album＝{ [機台的 play id]: { name, kind, link, ts, order:[獎品名…], items:{ 名: { r, t（縮圖） } }, got:{ 名: 個數 } } }
//   用獎品名稱記（店家改了獎品也對得上）；店家拿掉的獎品，收過的還留在收集簿裡
const albumThumbs = new Map(); // play id＋名稱 → 縮圖（同一台只做一次）
function albumThumb(idx) {
  const card = play.cfg.kind === 'card';
  return cutLayers(idx, card ? 180 : 112, card ? 262 : 112);
}
// 一個獎品畫成 W×H：整張圖 t；有遮罩再加 去背主體 s、背景 b、主體頭頂 st（收集簿存小張，結果卡用大張）
async function cutLayers(idx, W, H) {
  const it = play.cfg.items[idx];
  const key = play.id + '|' + it.name + '|' + W;
  if (albumThumbs.has(key)) return albumThumbs.get(key);
  const th = thumbOf(play.cfg, idx);
  if (!th.bmp && th.ready) await th.ready;
  const src = th.bmp || placeholderThumb(it.name, idx);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const s = Math.max(W / (src.width || 1), H / (src.height || 1));
  g.drawImage(src, (W - src.width * s) / 2, (H - src.height * s) / 2, src.width * s, src.height * s);
  let url = c.toDataURL('image/webp', 0.72);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.75);
  // 有主體遮罩：多做兩張給 3D 大卡用 — 主體去背圖（透明背景）、背景圖（主體那塊模糊掉，前後分開時不會看到兩隻）
  let subj = null;
  let back = null;
  let top = null;
  const mk = maskOf(play.cfg, idx);
  if (mk && !mk.bmp) await mk.ready;
  if (mk?.bmp) {
    const cover = (cg, im) => cg.drawImage(im, (W - im.width * s2(im)) / 2, (H - im.height * s2(im)) / 2, im.width * s2(im), im.height * s2(im));
    const s2 = (im) => Math.max(W / (im.width || 1), H / (im.height || 1));
    const mc = document.createElement('canvas'); // 遮罩 → alpha
    mc.width = W;
    mc.height = H;
    const mg = mc.getContext('2d');
    cover(mg, mk.bmp);
    const md = mg.getImageData(0, 0, W, H);
    for (let p = 0; p < md.data.length; p += 4) md.data[p + 3] = md.data[p];
    mg.putImageData(md, 0, 0);
    // 主體最上緣在哪（大卡用來決定照片窗開多低，讓頭剛好衝出窗）
    top = 0;
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) if (md.data[(y * W + x) * 4 + 3] > 128) n++;
      if (n > W * 0.03) {
        top = y / H;
        break;
      }
    }
    const sc = document.createElement('canvas');
    sc.width = W;
    sc.height = H;
    const sg = sc.getContext('2d');
    sg.drawImage(c, 0, 0);
    sg.globalCompositeOperation = 'destination-in';
    sg.drawImage(mc, 0, 0);
    subj = sc.toDataURL('image/webp', 0.8);
    if (!subj.startsWith('data:image/webp')) subj = sc.toDataURL('image/png');
    const bc = document.createElement('canvas');
    bc.width = W;
    bc.height = H;
    const bg = bc.getContext('2d');
    bg.drawImage(c, 0, 0);
    const blur = document.createElement('canvas');
    blur.width = W;
    blur.height = H;
    const bl = blur.getContext('2d');
    bl.filter = 'blur(10px) brightness(0.85)';
    bl.drawImage(c, 0, 0);
    bl.filter = 'none';
    bl.globalCompositeOperation = 'destination-in';
    bl.filter = 'blur(6px)'; // 遮罩放寬一點再套，主體邊緣不會留一圈
    bl.drawImage(mc, 0, 0);
    bg.drawImage(blur, 0, 0);
    back = bc.toDataURL('image/webp', 0.72);
    if (!back.startsWith('data:image/webp')) back = bc.toDataURL('image/jpeg', 0.75);
  }
  const res = { t: url, s: subj, b: back, st: top };
  albumThumbs.set(key, res);
  return res;
}

// 收集簿跟著這台機台的紀錄更新（轉到東西、進機台時）
// 這台機台在收集簿裡的 key（開店的人自己試玩用 draft.<uid>，設定一改 play id 就會變）
const albumKey = () => (play.fromDraft ? 'draft.' + play.fromDraft : play.id);
// 手上有幾個：轉到的（這次 play 跟收集簿記的取大的）＋好友交換進出（使用者 2026-10-26：「卡片交換出去要扣掉」）
function owned(i) {
  const n = play.cfg.items[i].name;
  const e = (store.get('clatter.album') || {})[albumKey()];
  return Math.max(0, Math.max(play.got[i] || 0, e?.base?.[n] || 0) + (e?.tr?.[n] || 0));
}

// 收集簿的數量：base＝從機台轉到的（取大的）、tr＝好友交換進出（收到 +1、送出 −1）、got＝base＋tr
//   以前直接 got＝max(轉到的, got) → 交換出去的下次同步又會跑回來
async function albumSync() {
  if (!play?.cfg) return;
  const key = albumKey();
  // 縮圖先做（要等）；做好再讀最新的收集簿來改 —— 等的時候好友交換可能剛改過
  const old = (store.get('clatter.album') || {})[key];
  const thumbs = [];
  for (let i = 0; i < play.cfg.items.length; i++) {
    const it = play.cfg.items[i];
    const prev = old?.items[it.name];
    const need = !prev?.t || (it.mask && (!prev.s || prev.st == null)); // 還沒有縮圖，或後來才去背 → 重做
    thumbs.push(need ? await albumThumb(i) : prev);
  }
  if (!play?.cfg || albumKey() !== key) return; // 等的時候換了機台
  const a = store.get('clatter.album') || {};
  // 舊版用 play id 記的自己機台（設定每改一次就多一筆）：同名、不是短連結、獎品一半以上一樣的全部併過來
  if (play.fromDraft) {
    const names = new Set(play.cfg.items.map((it) => it.name));
    const olds = Object.entries(a)
      .filter(([k, v]) => !k.startsWith('draft.') && v.name === play.cfg.name && !/^s\./.test(v.link || ''))
      .filter(([, v]) => Object.keys(v.items || {}).filter((n) => names.has(n)).length * 2 >= names.size)
      .sort((x, y) => (x[1].ts || 0) - (y[1].ts || 0));
    if (olds.length) {
      const m = { items: {}, got: {}, order: [], base: {}, tr: {} };
      if (a[key]) olds.push([key, a[key]]); // 現在的也一起（放最後，縮圖用最新的）
      for (const [k, v] of olds) {
        Object.assign(m.items, v.items);
        for (const [n, c] of Object.entries(v.got || {})) m.got[n] = Math.max(c, m.got[n] || 0);
        for (const [n, c] of Object.entries(v.base || {})) m.base[n] = Math.max(c, m.base[n] || 0);
        for (const [n, c] of Object.entries(v.tr || {})) m.tr[n] = (m.tr[n] || 0) + c;
        m.order = [...m.order, ...(v.order || []).filter((n) => !m.order.includes(n))];
        m.ts = v.ts;
        delete a[k];
      }
      a[key] = m;
    }
  }
  const e = a[key] || { items: {}, got: {}, order: [] };
  e.name = play.cfg.name;
  e.kind = play.cfg.kind === 'card' ? 'card' : 'capsule';
  e.link = play.link;
  const names = play.cfg.items.map((it) => it.name);
  e.order = [...names, ...e.order.filter((n) => !names.includes(n))];
  e.base = e.base || {};
  e.tr = e.tr || {};
  let any = false;
  for (let i = 0; i < play.cfg.items.length; i++) {
    const it = play.cfg.items[i];
    const nm = it.name;
    const th = thumbs[i];
    e.items[nm] = { r: it.rarity, t: th.t, s: th.s || null, b: th.b || null, st: th.st ?? null };
    const n = play.got[i] || 0;
    const base = Math.max(n, e.base[nm] ?? Math.max(0, (e.got[nm] || 0) - (e.tr[nm] || 0))); // 舊資料沒有 base：got 扣掉交換的
    if (base) e.base[nm] = base;
    const g = base + (e.tr[nm] || 0);
    if (g > 0) e.got[nm] = g;
    else delete e.got[nm];
    if (n) any = true;
  }
  if (!any && !Object.keys(e.got).length && !Object.keys(e.tr).length) return; // 還沒轉到東西 → 先不放進收集簿
  e.ts = Date.now();
  a[key] = e;
  store.set('clatter.album', a);
}

// 收集簿：分「卡片冊」（轉卡機，像真的卡冊）跟「轉蛋收藏」（轉蛋機，木頭展示櫃）兩個分頁（binder.js）
let albumTab = store.get('clatter.albumTab') || null;
let binder = null;
function renderAlbum() {
  const a = store.get('clatter.album') || {};
  const entries = Object.entries(a).sort((x, y) => (y[1].ts || 0) - (x[1].ts || 0));
  for (const [k, e] of entries) e.key = k; // 大卡「拿去交換」要知道是哪一筆
  const cards = entries.filter(([, e]) => e.kind === 'card');
  const caps = entries.filter(([, e]) => e.kind !== 'card');
  // 第一次打開：有卡片就先看卡片冊
  if (!albumTab) albumTab = cards.length || !caps.length ? 'card' : 'capsule';
  const tabs = $('album-tabs');
  tabs.textContent = '';
  for (const [k, list] of [['card', cards], ['capsule', caps], ['friends', null], ['trade', null]]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(albumTab === k));
    b.textContent =
      k === 'trade' ? t('album.trade') + (trade?.list.in.length ? ` (${trade.list.in.length})` : '')
      : k === 'friends' ? `${t('album.friends')} (${trade?.friends.length || 0})`
      : `${t(k === 'card' ? 'album.binder' : 'album.shelf')} (${list.length})`;
    b.onclick = () => {
      albumTab = k;
      store.set('clatter.albumTab', k);
      renderAlbum();
    };
    tabs.append(b);
  }
  // 好友名單／交換（trade.js）
  const social = albumTab === 'friends' || albumTab === 'trade';
  $('album-trade').hidden = !social;
  if (social) {
    $('album-empty').hidden = $('album-binder').hidden = $('album-shelf').hidden = true;
    const sum = () =>
      ($('album-sum').textContent =
        albumTab === 'friends'
          ? t('album.sumFriends', { f: trade.friends.length })
          : t('album.sumTrade', { n: trade.list.in.length, o: trade.list.out.filter((o) => o.status === 'open').length }));
    sum();
    trade.render($('album-trade'), albumTab === 'friends' ? 'friends' : 'trades').then(sum);
    return;
  }
  const list = albumTab === 'card' ? cards : caps;
  let kinds = 0;
  let pieces = 0;
  for (const [, e] of list) {
    kinds += Object.keys(e.got).length;
    pieces += Object.values(e.got).reduce((s, n) => s + n, 0);
  }
  $('album-sum').textContent = t(albumTab === 'card' ? 'album.sumCard' : 'album.sumCap', { m: list.length, k: kinds, n: pieces });
  const empty = $('album-empty');
  empty.hidden = !!list.length;
  empty.textContent = t(albumTab === 'card' ? 'album.emptyCard' : 'album.emptyCap');
  $('album-binder').hidden = albumTab !== 'card' || !list.length;
  $('album-shelf').hidden = albumTab !== 'capsule' || !list.length;
  const opts = { onCard: openCardView, onPlay: (link) => enterPlay(link) };
  if (albumTab === 'card' && list.length) {
    binder = binder || new Binder($('album-binder'), opts);
    binder.set(list);
  }
  if (albumTab === 'capsule' && list.length) renderShelf($('album-shelf'), list, opts);
}

// 收集簿的大卡：跟著游標（手機是陀螺儀）傾斜的 3D 卡，SR 金光、SSR 彩虹光
function openCardView(e, name) {
  const it = e.items[name];
  const R = RARITY[it.r] || RARITY[0];
  $('v-name').textContent = name;
  $('v-meta').textContent = `${R.key} ${R.label} · ×${e.got[name]} · ${e.name}`;
  openSheet('sheet-card', $('sheet-card').querySelector('[data-close]'));
  // 有去背：背景層用「主體柔化掉」的圖、主體自己一層浮到最前面；沒有就整張一層（holo.js）
  viewHolo.set({ t: it.t, s: it.s, b: it.b, st: it.st, r: it.r, shape: e.kind === 'card' ? 'card' : 'round', name });
  viewHolo.start(() => !$('sheet-card').hidden);
  // 好友交換：收集簿裡的獎品可以直接拿去交換
  $('v-acts').hidden = !(e.key && e.got[name] > 0 && cloudReady());
  for (const [id, mode] of [['v-trade', 'swap'], ['v-gift', 'gift']])
    $(id).onclick = () => {
      closeSheet('sheet-card');
      trade.sendFlow({ item: { key: e.key, n: name }, mode });
    };
}
let trade = null;
// 邀請連結 #f.<好友碼> → 加好友、打開收集簿的「好友交換」
async function openInvite(code) {
  history.replaceState(null, '', location.pathname + location.search);
  albumTab = 'friends';
  setMode('album');
  try {
    await trade.addFriend(code);
  } catch (e) {
    toast(t(e.message));
  }
  renderAlbum();
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- 啟動 ----------
// 換語言：介面字、還沒改過的範例機台、機台上的貼紙字全部重畫
async function changeLang(k) {
  setLang(k);
  if (draft.sample && !draft.cloud) {
    draft = SAMPLE();
    saveDraft();
    if (app.dataset.mode === 'create') showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
  }
  const cur = $('cur');
  for (const o of cur.options) o.textContent = o.value === '代幣' ? t('cur.token') : o.value;
  renderForm();
  if (linkState?.short) showLinkStatus(linkState);
  else if (!$('link-out').hidden && linkToken) requestSync(false);
  if (play) {
    renderPlate();
    if (STEPS[play.phase]) setPhase(play.phase);
    if (!$('sheet-lineup').hidden) openLineup();
    if (!$('sheet-collection').hidden) openCollection();
  }
  if (app.dataset.mode === 'album') renderAlbum();
  await fontsReady();
  machine?.refreshLabels();
  scheduleDecor();
}

async function boot() {
  // 從連結進來的玩家：一開始就是玩家畫面，不會先閃過開店表單
  if (location.hash.startsWith('#g1')) app.dataset.mode = 'play';
  applyDom();
  const ls = $('lang');
  for (const l of LANGS) ls.append(new Option(l.label, l.key, false, l.key === lang));
  ls.addEventListener('change', () => changeLang(ls.value));
  bindForm();
  renderForm();
  if (draft.cloud && cloudReady()) {
    showLinkStatus({ url: shareBase() + '#s.' + draft.cloud.id, short: true });
    refreshStats();
  }
  loadWallet().catch(() => {}); // 一開始就有 1000 枚
  autoMasks(); // 以前上傳、還沒去背的照片
  $('wallet-card').onclick = openWallet;
  document.querySelector('.coin-count').onclick = () => play?.cloud && openWallet();
  // 回到這個分頁：賣家重抓被轉走的數量；買家重抓庫存（店家可能補貨或改了機台）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    loadWallet().catch(() => {});
    if (app.dataset.mode === 'create') refreshStats();
    else refreshPlay();
  });
  bindCoinDrag();

  $('tab-create').onclick = () => setMode('create');
  $('tab-shop').onclick = () => setMode('shop');
  $('tab-album').onclick = () => setMode('album');
  $('shop-new').onclick = newMachine;
  // 收集簿的大卡、結果卡：3D 閃卡（滑鼠移動／手機傾斜 → 跟著斜，holo.js）
  viewHolo = new Holo($('v-tilt'), $('sheet-card'));
  trade = new Trade({
    store, toast, loadWallet, openSheet, closeSheet, openCardView, shareBase,
    cloudOk: cloudReady,
    albumChanged: () => app.dataset.mode === 'album' && albumTab !== 'trade' && albumTab !== 'friends' && renderAlbum(),
    goFriends: () => {
      albumTab = 'friends';
      store.set('clatter.albumTab', 'friends');
      setMode('album');
      renderAlbum();
    },
    badge: (n) => {
      $('album-badge').hidden = !n;
      $('album-badge').textContent = n;
    },
  });
  trade.poll();
  resHolo = new Holo($('r-tilt'), $('result-card'));
  // 從連結進來的玩家 → 回到那台機器；賣家 → 用目前的表單內容試玩
  $('tab-play').onclick = () => {
    unlock();
    const h = location.hash.slice(1);
    enterPlay(isMachineHash(h) ? h : 'draft');
  };
  $('btn-sound').onclick = () => {
    const on = $('btn-sound').getAttribute('aria-pressed') !== 'true';
    $('btn-sound').setAttribute('aria-pressed', String(on));
    setMuted(!on);
    if (on) unlock();
  };
  $('h-btn').onclick = hintAction;
  $('h-ten').onclick = () => {
    unlock();
    tenPull();
  };
  $('x-again').onclick = () => {
    closeMulti();
    tenPull();
  };
  $('x-one').onclick = closeMulti;
  $('btn-topup').onclick = () => {
    play.coins += 5;
    savePlay();
    // 扭蛋飛行中、開蛋中這類過場狀態沒有提示卡內容 → 只更新錢包
    if (STEPS[play.phase]) setPhase(play.phase);
    else renderWallet();
    toast(t('t.topup'));
  };
  $('btn-lineup').onclick = openLineup;
  $('p-odds').onclick = openLineup;
  $('btn-collection').onclick = openCollection;
  $('p-col').onclick = openCollection;
  $('r-again').onclick = afterResult;
  $('r-close').onclick = closeResult;
  $('r-col').onclick = () => {
    afterResult();
    openCollection();
  };
  $('c-reset').onclick = () => {
    store.del(playKey());
    closeSheet('sheet-collection');
    enterPlay(play.link);
    toast(t('t.restocked'));
  };
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => closeSheet(b.closest('.sheet').id)));
  document.querySelectorAll('.sheet').forEach((s) =>
    s.addEventListener('click', (e) => {
      if (e.target === s) s.id === 'sheet-result' ? closeResult() : s.id === 'sheet-multi' ? closeMulti() : closeSheet(s.id);
    }),
  );
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.sheet')].find((s) => !s.hidden);
    if (open) open.id === 'sheet-result' ? closeResult() : open.id === 'sheet-multi' ? closeMulti() : closeSheet(open.id);
  });
  addEventListener('pointerdown', () => unlock(), { once: true });

  machine = new Machine($('stage'), {
    onSlot: (x, y) => {
      unlock();
      if (play?.phase === 'coin') insertCoin();
    },
    onHandleLocked: () => {
      if (app.dataset.mode !== 'play') return;
      nudge();
      if (play?.phase === 'coin') toast(t('t.locked', { n: play.cfg.price.coins }));
    },
    onTurned: () => onTurned(),
    onExitCapsule: () => take(),
    onOpenCapsule: () => openIt(),
    onBurst: (r) => onBurst(r),
    onGridCapsule: (i) => openOne(i),
    onGridCard: (i) => viewGridCard(i),
  });
  window.__gacha = { machine, showResult, get play() { return play; }, get draft() { return draft; } }; // 除錯用
  const ro = new ResizeObserver(() => updateInsets());
  ro.observe($('stage'));
  ro.observe($('hud').querySelector('.bottom'));
  ro.observe($('hud').querySelector('.plate'));
  ro.observe($('hud').querySelector('.top-right'));
  syncStage();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncStage);
  new MutationObserver(syncStage).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  try {
    await Promise.all([machine.load(new URL('./assets/', import.meta.url).href), fontsReady()]);
  } catch (e) {
    $('loading-text').textContent = t('loadFail');
    console.error(e);
    return;
  }
  const h = location.hash.slice(1);
  if (h.startsWith('f.')) openInvite(h.slice(2));
  else if (isMachineHash(h)) await enterPlay(h);
  else showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
  // 等台紙、貼紙畫好再拿掉載入畫面
  await new Promise((r) => setTimeout(r, 200));
  $('loading').hidden = true;
  addEventListener('hashchange', () => {
    const tok = location.hash.slice(1);
    if (tok.startsWith('f.')) openInvite(tok.slice(2));
    else if (isMachineHash(tok)) enterPlay(tok);
  });
}

boot();
