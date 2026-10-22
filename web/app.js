// Clatter 轉蛋鋪：開店設定 → 產生連結 → 玩家投幣、轉把手、開扭蛋
import { Machine, THEMES } from './machine.js';
import { unlock, setMuted, sfx } from './sfx.js';
import { encodeConfig, decodeConfig, shortId, CURRENCIES, THEME_KEYS, LIMITS, BG_PRESETS } from './codec.js';
import { RARITY, placeholderThumb, priceText, fontsReady, drawPrizeCard } from './decor.js';
import { t, lang, setLang, applyDom, LANGS } from './i18n.js';
import { parseMediaUrl, mediaFromLink, mediaLabel, mediaKind, saveLocal, removeLocal, localUrl, videoFrame, mountPlayer, ytThumb, MAX_FILE } from './media.js';

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
  const S = 96;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const s = Math.max(S / bmp.width, S / bmp.height);
  g.drawImage(bmp, (S - bmp.width * s) / 2, (S - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.7));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.75));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

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
  }));
  if (!THEME_KEYS.includes(d.theme)) d.theme = 'red';
  d.bg = draftBg(d.bg);
  if (!d.price || !CURRENCIES.includes(d.price.cur)) d.price = { coins: 5, unit: 10, cur: 'NT$' };
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
  if (m.k === 'file')
    return { k: 'file', kind: m.kind === 'video' ? 'video' : 'audio', id: String(m.id).slice(0, 40), name: String(m.name || '').slice(0, 60), mime: String(m.mime || ''), size: m.size | 0 };
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
  $('link-out').hidden = true;
  saveDraft();
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
    draft.items.push({ name: t('newPrize', { n: draft.items.length + 1 }), rarity: 0, qty: 5, img: null });
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

  $('make-link').onclick = async () => {
    linkToken = await encodeConfig(draft);
    const url = shareBase() + '#' + linkToken;
    $('link').value = url;
    $('link-out').hidden = false;
    const imgs = draft.items.filter((it) => it.img).length;
    const meta = $('link-meta');
    meta.textContent = t(imgs ? 'linkMetaPhotos' : 'linkMeta', { n: url.length.toLocaleString(), m: imgs });
    meta.classList.toggle('warn', url.length > 8000);
    if (url.length > 8000) meta.textContent += t('linkWarn');
    const locals = draft.items.filter((it) => it.media?.k === 'file').length;
    if (locals) meta.textContent += t('media.localInLink', { n: locals });
    $('link').scrollTop = 0;
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
    if (!linkToken) return;
    await enterPlay(linkToken);
  };
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
  try {
    cfg = token === 'draft' ? draft : await decodeConfig(token);
  } catch (e) {
    toast(t('t.badLink', { msg: t(e.message) }));
    return setMode('create');
  }
  if (token === 'draft') token = await encodeConfig(draft);
  machine?.clearCapsules();
  const id = shortId(token);
  play = { cfg, token, id, phase: 'coin', inserted: 0, busy: false };
  const saved = store.get('clatter.play.' + id);
  const totalQ = cfg.items.map((it) => it.qty);
  if (saved && Array.isArray(saved.remaining) && saved.remaining.length === cfg.items.length) {
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
}

function left() {
  return play.remaining.reduce((a, b) => a + b, 0);
}
function savePlay() {
  const m = play.multi;
  const multi = m?.opened.includes(false) ? { picks: m.picks, opened: m.opened } : null; // 10 連還沒開完的
  store.set(playKey(), { remaining: play.remaining, got: play.got, coins: play.coins, pulls: play.pulls, multi });
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
        ? t('s.coinBroke')
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
    play.pending = draw();
    machine.setForeshadow(foreshadowLevel([play.cfg.items[play.pending].rarity]));
    setPhase('turn');
  } else setPhase('coin');
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
  play.remaining[idx]--;
  play.pulls++;
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
  const n = Math.min(10, left());
  if (n < 2) return;
  const need = play.cfg.price.coins;
  const cost = n * need - play.inserted; // 已經投進去的也算
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
  // 先抽好 n 顆（抽一顆少一顆）
  const picks = [];
  for (let i = 0; i < n; i++) {
    const idx = draw();
    play.remaining[idx]--;
    play.pulls++;
    picks.push(idx);
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
  const top = narrow ? $('hud').querySelector('.plate').getBoundingClientRect().bottom - st.top + 4 : 0;
  const bottom = st.bottom - $('hud').querySelector('.bottom').getBoundingClientRect().top + 4;
  machine.setInsets(Math.max(0, top), Math.max(0, bottom));
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
  if (draft.sample) {
    draft = SAMPLE();
    saveDraft();
    if (app.dataset.mode === 'create') showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
  }
  const cur = $('cur');
  for (const o of cur.options) o.textContent = o.value === '代幣' ? t('cur.token') : o.value;
  renderForm();
  if (!$('link-out').hidden && linkToken) $('make-link').click();
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
  bindCoinDrag();

  $('tab-create').onclick = () => setMode('create');
  // 從連結進來的玩家 → 回到那台機器；賣家 → 用目前的表單內容試玩
  $('tab-play').onclick = () => {
    unlock();
    const h = location.hash.slice(1);
    enterPlay(h.startsWith('g1') ? h : 'draft');
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
    enterPlay(play.token);
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
  if (h.startsWith('g1')) await enterPlay(h);
  else showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
  // 等台紙、貼紙畫好再拿掉載入畫面
  await new Promise((r) => setTimeout(r, 200));
  $('loading').hidden = true;
  addEventListener('hashchange', () => {
    const tok = location.hash.slice(1);
    if (tok.startsWith('g1')) enterPlay(tok);
  });
}

boot();
