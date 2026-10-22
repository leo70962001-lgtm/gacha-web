// Clatter 轉蛋鋪：開店設定 → 產生連結 → 玩家投幣、轉把手、開扭蛋
import { Machine, THEMES } from './machine.js';
import { unlock, setMuted, sfx } from './sfx.js';
import { encodeConfig, decodeConfig, shortId, CURRENCIES, THEME_KEYS, LIMITS, BG_PRESETS } from './codec.js';
import { RARITY, placeholderThumb, priceText, fontsReady, drawPrizeCard } from './decor.js';
import { t, lang, setLang, applyDom, LANGS } from './i18n.js';
import { parseMediaUrl, mediaFromLink, mediaToLink, mediaLabel, mediaKind, saveLocal, removeLocal, localUrl, videoFrame, mountPlayer, ytThumb, MAX_FILE } from './media.js';
import { cloudReady, saveMachine, loadMachine, uploadMedia, pullCloud, pulledCounts, restockCloud, walletOpen, newWalletCred, isWalletCred } from './cloud.js';

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

let draft = loadDraft();
let machine = null;
let linkToken = null; // 最近一次產生的連結內容
let play = null; // 玩家模式的狀態

// ---------- 圖片 ----------
const thumbCache = new WeakMap(); // item.img → { url, bmp }
function thumbOf(cfg, i) {
  const it = cfg.items[i];
  if (it.img) {
    let th = thumbCache.get(it.img);
    if (!th) {
      const blob = new Blob([it.img.bytes], { type: it.img.mime });
      th = { url: URL.createObjectURL(blob), bmp: null };
      createImageBitmap(blob)
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
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const s = Math.max(S / bmp.width, S / bmp.height);
  g.drawImage(bmp, (S - bmp.width * s) / 2, (S - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
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
function loadDraft() {
  const d = store.get('clatter.draft');
  if (!d || !Array.isArray(d.items) || !d.items.length) return SAMPLE();
  d.items = d.items.slice(0, LIMITS.items).map((it) => ({
    name: String(it.name || t('defaultPrize')).slice(0, LIMITS.name),
    rarity: Math.min(3, Math.max(0, it.rarity | 0)),
    qty: Math.min(LIMITS.qty, Math.max(1, it.qty | 0)),
    img: it.img ? { bytes: Uint8Array.from(atob(it.img.b64), (ch) => ch.charCodeAt(0)), mime: it.img.mime } : null,
    media: draftMedia(it.media),
    uid: typeof it.uid === 'string' ? it.uid : null,
  }));
  ensureUids(d);
  if (!THEME_KEYS.includes(d.theme)) d.theme = 'red';
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
  store.set('clatter.draft', {
    ...draft,
    bg,
    items: draft.items.map((it) => ({
      ...it,
      img: it.img ? { b64: btoa(String.fromCharCode(...it.img.bytes)), mime: it.img.mime } : null,
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
      draft.items[fileFor].img = await shrinkImage(f);
      draftChanged(true);
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
function showMachine(cfg, capsules, total = capsules) {
  shown = cfg;
  if (!machine?.loaded) return;
  machine.setTheme(cfg.theme);
  applyBg(cfg.bg);
  machine.setPile(capsules, total);
  scheduleDecor();
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
  play = { cfg, token, link: sid ? link : token, id, cloud: shared ? sid : null, phase: 'coin', inserted: 0, busy: false };
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
  showMachine(cfg, left(), cfg.items.reduce((a, b) => a + b.qty, 0));
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
  $('h-title').textContent = t(s.title);
  const need = play.cfg.price.coins;
  let text = s.text ? t(s.text) : '';
  if (ph === 'coin') {
    text =
      play.coins + play.inserted < need
        ? t(play.cloud ? 'wallet.broke' : 's.coinBroke')
        : t('s.coinNeed', { n: need - play.inserted });
  }
  if (ph === 'multiOpen') text = t('ten.openText', { n: play.multi.opened.filter((o) => !o).length });
  $('h-text').textContent = text;
  const b = $('h-btn');
  b.hidden = !s.btn;
  if (s.btn) b.textContent = t(s.btn);
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
  await machine.dispense(play.cfg.items[idx].rarity);
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
  await machine.openCapsule();
  sfx.reveal(it.rarity);
  const first = !play.got[idx];
  play.got[idx] = (play.got[idx] || 0) + 1;
  play.pending = null;
  savePlay();
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
  $('r-again').hidden = $('r-col').hidden = !!view;
  $('r-close').hidden = !view;
  $('r-close').textContent = view !== 'step' ? t('close') : play.multi.opened.includes(false) ? t('ten.next') : t('ten.toResults');
  const card = $('result-card');
  card.className = `sheet-card result r${it.rarity}`;
  card.style.setProperty('--rc', `var(--r-${r.key.toLowerCase()})`);
  $('r-rank').textContent = `${r.key} ${r.label}`;
  $('r-img').src = thumbOf(play.cfg, idx).url;
  $('r-name').textContent = it.name;
  $('r-new').hidden = !fresh || !first;
  const total = play.cfg.items.reduce((a, b) => a + b.qty, 0);
  $('r-sub').textContent = t('resultSub', { n: play.pulls, p: pct(it.qty / total), c: play.got[idx] });
  openSheet('sheet-result', view ? $('r-close') : $('r-again'));
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
    last = machine.dispenseToGrid(i, n, play.cfg.items[picks[i]].rarity);
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
    const n = play.got[i] || 0;
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
  requestAnimationFrame(updateInsets);
  if (mode === 'create') {
    machine?.clearCapsules();
    machine?.setSlotHint(false);
    machine?.setHandleEnabled(false);
    showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
  }
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
  if (isMachineHash(h)) await enterPlay(h);
  else showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
  // 等台紙、貼紙畫好再拿掉載入畫面
  await new Promise((r) => setTimeout(r, 200));
  $('loading').hidden = true;
  addEventListener('hashchange', () => {
    const tok = location.hash.slice(1);
    if (isMachineHash(tok)) enterPlay(tok);
  });
}

boot();
