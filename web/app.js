// Clatter 轉蛋鋪：開店設定 → 產生連結 → 玩家投幣、轉把手、開扭蛋
import { Machine, THEMES } from './machine.js';
import { unlock, setMuted, setSfxVolume, sfx } from './sfx.js';
import { bgm } from './bgm.js';
import { encodeConfig, decodeConfig, shortId, CURRENCIES, THEME_KEYS, LIMITS, BG_PRESETS, BACK_PRESETS, FINISHES, FRONT_FINISHES, BGM_PRESETS, BGM_DEFAULT, finOf } from './codec.js';
import { RARITY, placeholderThumb, priceText, fontsReady, drawPrizeCard, drawCardLayers, drawCardBack } from './decor.js';
import { t, lang, setLang, applyDom, LANGS } from './i18n.js';
import { parseMediaUrl, mediaFromLink, mediaToLink, mediaLabel, mediaKind, saveLocal, removeLocal, localUrl, videoFrame, ytThumb, MAX_FILE } from './media.js';
import { cutout } from './seg.js';
import { Holo } from './holo.js';
import { addSticker, bakeSticker, hasAlpha, loadBook, saveBook, stickerBlob, stickerUrl, createPack, addToPack, markPackOpened, claimPackItem, STICKER_FINS, STICKER_SHAPES, PRESETS, presetFile } from './sticker.js';
import { openPeel, drawFoilPack, FOIL, FOIL_DRAWN, PACK_DESIGNS } from './peel.js';
import { StickerBook } from './stickerbook.js';
import { Binder, renderShelf } from './binder.js';
import { Trade } from './trade.js';
import { AlbumEdit, recount, ensureBase, titleOf } from './albumedit.js';
import { copyText } from './copy.js';
import { mountNowPlaying } from './nowplaying.js';
import { MemberCard } from './member.js';
import { CardStudio, BGM_IDS, listWorks, drawDesignCard, studioFonts, CARD_OUT } from './cardstudio.js';
import { applyAppTheme, cardSplash } from './cardpack.js';
// 獎品的影音在播 → 背景音樂先停：<audio>／<video> bgm.js 自己會發現；YouTube、SoundCloud、Spotify 是 iframe → 這裡停，關掉才回來
function nowPlaying(box, m, o) {
  const p = mountNowPlaying(box, m, o);
  if (!['yt', 'sc', 'sp'].includes(m?.k)) return p;
  const key = {};
  bgm.hush(key);
  const stop = p.stop.bind(p);
  p.stop = () => {
    stop();
    bgm.unhush(key);
  };
  return p;
}
import { tradeMe, setListed, browseMachines, cloudReady, saveMachine, loadMachine, uploadMedia, pullCloud, pulledCounts, restockCloud, walletOpen, newWalletCred, isWalletCred, walletSales } from './cloud.js';

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

// 獎品照片：轉蛋機 128 px 正方形；轉卡機以圖為主 → 直的 240 × 350（卡片比例），卡面整張都是這張圖；轉 webp（連結裡放得下）
//   上傳的照片會先開裁切對話框（openCrop）；影片截圖、YouTube 縮圖直接取中間（shrinkImage）
const prizeSize = () => (draft?.kind === 'card' ? [240, 350] : [128, 128]);
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const [SW, SH] = prizeSize();
  const c = document.createElement('canvas');
  c.width = SW;
  c.height = SH;
  const g = c.getContext('2d');
  const s = Math.max(SW / bmp.width, SH / bmp.height);
  g.drawImage(bmp, (SW - bmp.width * s) / 2, (SH - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  return encodeImg(c);
}
async function encodeImg(c, alpha = false) {
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.78));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => (alpha ? c.toBlob(r, 'image/png') : c.toBlob(r, 'image/jpeg', 0.8)));
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
    sticker: it.sticker && STICKER_FINS.includes(it.sticker.fin) ? { fin: it.sticker.fin, baked: !!it.sticker.baked } : null,
    framed: it.framed && it.img ? (it.framed === 'monster' ? 'monster' : 'duel') : false, // 舊草稿 true＝遊戲王風
    design: it.framed && it.design && typeof it.design === 'object' ? it.design : null,
  }));
  ensureUids(d);
  if (!THEME_KEYS.includes(d.theme)) d.theme = 'red';
  d.kind = d.kind === 'card' ? 'card' : 'capsule';
  d.bg = draftBg(d.bg);
  d.back = draftBack(d.back);
  d.bgm = draftBgm(d.bgm);
  d.stickers = draftStickers(d.stickers);
  d.fin = d.fin && (FRONT_FINISHES.includes(d.fin.sr) || FRONT_FINISHES.includes(d.fin.ssr)) ? { sr: FRONT_FINISHES.includes(d.fin.sr) ? d.fin.sr : 'texture', ssr: FRONT_FINISHES.includes(d.fin.ssr) ? d.fin.ssr : 'gold' } : null;
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

// 卡背（轉卡機）：{ img, text, color }，什麼都沒有＝用預設的卡背
function draftBack(b) {
  if (!b) return null;
  const img = b.img?.b64 ? { bytes: Uint8Array.from(atob(b.img.b64), (ch) => ch.charCodeAt(0)), mime: b.img.mime } : null;
  const back = {
    k: img ? 'img' : b.k === 'preset' && BACK_PRESETS.includes(b.id) ? 'preset' : b.k === 'color' && /^#[0-9a-f]{6}$/i.test(b.c || '') ? 'color' : 'default',
    id: BACK_PRESETS.includes(b.id) ? b.id : undefined,
    c: /^#[0-9a-f]{6}$/i.test(b.c || '') ? b.c : undefined,
    img,
    text: String(b.text || '').slice(0, 16),
    color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '',
    sr: FINISHES.includes(b.sr) ? b.sr : undefined,
    ssr: FINISHES.includes(b.ssr) ? b.ssr : undefined,
  };
  return backIsDefault(back) ? null : back;
}

// 機台上的貼紙：[{ id, img { bytes, mime }, fin, k 機台種類, m 零件編號, p, n, s 大小, r 角度 }]（最多 8 張）
function draftStickers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x?.img?.b64 && Array.isArray(x.p) && Array.isArray(x.n))
    .slice(0, 8)
    .map((x) => ({ id: String(x.id || 'm' + newUid()), img: { bytes: Uint8Array.from(atob(x.img.b64), (ch) => ch.charCodeAt(0)), mime: x.img.mime }, fin: STICKER_FINS.includes(x.fin) ? x.fin : 'flat', k: x.k === 'card' ? 'card' : 'capsule', m: x.m | 0, p: x.p.map(Number), n: x.n.map(Number), s: +x.s || 0.14, r: +x.r || 0 }));
}

// 背景音樂：{ k: 'preset', id }、{ k: 'none' }、{ k: 'media', media }（上傳的本機檔案或 mp3 網址）；null＝預設曲
function draftBgm(b) {
  if (b?.k === 'none') return { k: 'none' };
  if (b?.k === 'preset' && BGM_PRESETS.includes(b.id)) return b.id === BGM_DEFAULT ? null : { k: 'preset', id: b.id };
  if (b?.k === 'media') {
    const m = draftMedia(b.media);
    if (m && (m.k === 'au' || (m.k === 'file' && m.kind === 'audio'))) return { k: 'media', media: m };
  }
  return null;
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
  const back = draft.back ? { ...draft.back, img: draft.back.img ? { b64: btoa(String.fromCharCode(...draft.back.img.bytes)), mime: draft.back.img.mime } : null } : null;
  const b64 = (im) => ({ b64: btoa(String.fromCharCode(...im.bytes)), mime: im.mime });
  store.set(draftKey(), {
    ...draft,
    bg,
    back,
    stickers: (draft.stickers || []).map((x) => ({ id: x.id, img: b64(x.img), fin: x.fin, k: x.k, m: x.m, p: x.p, n: x.n, s: x.s, r: x.r })),
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
    if (it.framed) th.classList.add('framed');
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
    // 轉到就變成貼紙（放進買家的シール帳）
    const ss = document.createElement('select');
    ss.className = 'stk-sel' + (it.sticker ? ' on' : '');
    ss.setAttribute('aria-label', t('stk.prizeLabel'));
    ss.append(new Option(t('stk.notSticker'), ''));
    for (const f of STICKER_FINS) ss.append(new Option(t('stk.asSticker', { f: t('stk.f.' + f) }), f));
    ss.value = it.sticker?.fin || '';
    mrow.append(ss);
    if (it.framed && it.design) {
      const eb = document.createElement('button');
      eb.type = 'button';
      eb.className = 'media-btn studio-edit';
      eb.textContent = t('cs.editCard');
      mrow.append(eb);
    }
    li.append(th, name, del, meta, mrow);
    ul.append(li);
  });
  $('items-sum').textContent = t('itemsSum', { n: draft.items.length, q: total });
  $('add-item').disabled = draft.items.length >= LIMITS.items;
  $('pick-work').hidden = draft.kind !== 'card';
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
  renderBgm();
  renderMachineStickers();
  renderBack();
  renderFront();
  renderSwitch();
}

// ---------- 背景音樂（使用者 2026-10-26：「可以設定背景音樂」） ----------
//   店家選：預設曲（Gemini 做的）、不要音樂、上傳自己的曲子；選了馬上播（開店頁、試玩、買家轉都聽得到）
const NOTE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.6" fill="currentColor"/><circle cx="17.5" cy="16" r="2.6" fill="currentColor"/></svg>';
function renderBgm() {
  const box = $('bgm-tiles');
  if (!box.childElementCount) {
    const tile = (k, cls, svg = NOTE_SVG) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bgm-tile ' + cls;
      b.dataset.k = k;
      b.setAttribute('role', 'radio');
      b.innerHTML = svg;
      b.append(document.createElement('span'));
      box.append(b);
      return b;
    };
    for (const id of BGM_PRESETS) tile('preset:' + id, 'bgm-' + id).onclick = () => setBgm(id === BGM_DEFAULT ? null : { k: 'preset', id });
    tile('none', 'bgm-none', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" opacity=".45"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>').onclick = () => setBgm({ k: 'none' });
    tile('media', 'bgm-up', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M7 10l5-5 5 5M5 19h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>').onclick = () => {
      $('file-bgm').value = '';
      $('file-bgm').click();
    };
    $('file-bgm').addEventListener('change', async () => {
      const f = $('file-bgm').files[0];
      if (!f) return;
      if (f.size > MAX_FILE) return toast(t('media.tooBig'));
      if (!f.type.startsWith('audio')) return toast(t('bgm.notAudio'));
      const old = draft.bgm?.k === 'media' ? draft.bgm.media : null;
      setBgm({ k: 'media', media: await saveLocal(f) });
      if (old?.k === 'file') removeLocal(old);
    });
  }
  const b = draft.bgm;
  const cur = !b ? 'preset:' + BGM_DEFAULT : b.k === 'preset' ? 'preset:' + b.id : b.k;
  for (const el of box.children) {
    const k = el.dataset.k;
    el.setAttribute('aria-checked', String(k === cur));
    const label = k.startsWith('preset:') ? t('bgm.p.' + k.slice(7)) : k === 'none' ? t('bgm.none') : b?.k === 'media' ? b.media.name || t('bgm.custom') : t('bgm.upload');
    el.querySelector('span').textContent = label;
    el.setAttribute('aria-label', label);
    el.title = label;
  }
}
function setBgm(b) {
  unlock();
  draft.bgm = b;
  renderBgm();
  draftChanged();
  playBgm(draft.bgm);
}
// 要播哪個檔案：預設曲／自己的檔案（本機的先用、沒有就用雲端的）／mp3 網址
async function bgmUrl(b) {
  if (!b || b.k === 'preset') return asset('bgm/' + (BGM_PRESETS.includes(b?.id) ? b.id : BGM_DEFAULT) + '.mp3');
  const m = b.k === 'media' ? b.media : null;
  if (m?.k === 'file') return (await localUrl(m).catch(() => null)) || (m.remote && parseMediaUrl(m.remote)?.u) || null;
  return m?.k === 'au' ? m.u : null;
}
let bgmTok = null;
let bgmName = '';
function playBgm(b) {
  const tok = (bgmTok = {});
  bgmName = !b ? t('bgm.p.' + BGM_DEFAULT) : b.k === 'preset' ? t('bgm.p.' + b.id) : b.k === 'none' ? '' : b.media?.k === 'file' ? b.media.name : mediaLabel(b.media).replace(/^♪ /, '');
  bgmUrl(b)
    .then((u) => tok === bgmTok && bgm.play(u))
    .catch(() => {});
  if (!$('snd-pop').hidden) renderSoundPop();
}

// ---------- 音量（右上角的喇叭）：效果音、背景音樂分開調，存在這台裝置 ----------
const audioPref = Object.assign({ sfx: 0.8, bgm: 0.5, mute: false }, store.get('clatter.audio') || {});
function applyAudio() {
  setSfxVolume(audioPref.sfx);
  setMuted(audioPref.mute);
  bgm.setVolume(audioPref.bgm);
  bgm.setMuted(audioPref.mute);
  $('btn-sound').setAttribute('aria-pressed', String(!audioPref.mute && (audioPref.sfx > 0 || audioPref.bgm > 0)));
  store.set('clatter.audio', audioPref);
}
function renderSoundPop() {
  $('vol-sfx').value = audioPref.sfx;
  $('vol-bgm').value = audioPref.bgm;
  $('snd-mute').checked = audioPref.mute;
  $('snd-now').textContent = bgmName ? t('snd.now', { name: bgmName }) : t('snd.none');
}
function toggleSoundPop(open = $('snd-pop').hidden) {
  const pop = $('snd-pop');
  pop.hidden = !open;
  $('btn-sound').setAttribute('aria-expanded', String(open));
  if (!open) return;
  unlock();
  renderSoundPop();
  const r = $('btn-sound').getBoundingClientRect();
  pop.style.top = Math.round(r.bottom + 8) + 'px';
  pop.style.right = Math.max(8, Math.round(innerWidth - r.right)) + 'px';
}
function bindSound() {
  $('btn-sound').setAttribute('aria-haspopup', 'dialog');
  $('btn-sound').onclick = () => toggleSoundPop();
  $('vol-sfx').addEventListener('input', () => {
    audioPref.sfx = +$('vol-sfx').value;
    audioPref.mute = false;
    applyAudio();
    renderSoundPop();
  });
  $('vol-sfx').addEventListener('change', () => sfx.tap()); // 放開滑桿 → 聽一下現在多大聲
  $('vol-bgm').addEventListener('input', () => {
    audioPref.bgm = +$('vol-bgm').value;
    audioPref.mute = false;
    applyAudio();
    renderSoundPop();
  });
  $('snd-mute').addEventListener('change', () => {
    audioPref.mute = $('snd-mute').checked;
    applyAudio();
  });
  // 點外面、按 Esc → 關
  addEventListener('pointerdown', (e) => !$('snd-pop').hidden && !e.target.closest('#snd-pop, #btn-sound') && toggleSoundPop(false));
  addEventListener('keydown', (e) => e.key === 'Escape' && !$('snd-pop').hidden && (toggleSoundPop(false), $('btn-sound').focus()));
  addEventListener('resize', () => !$('snd-pop').hidden && toggleSoundPop(true));
  applyAudio();
}

// ---------- SR／SSR 表面加工（使用者 2026-10-26：「SSR 跟SR 表面加工也追加進去」） ----------
//   兩列選項＋預覽兩張會晃的 3D 閃卡（用第一個有照片的獎品）；draft.fin＝{ sr, ssr }，都是預設＝null
let frontHolos = null;
function renderFront() {
  const field = $('front-field');
  const fin = draft.fin || {};
  for (const [box, key] of [[$('front-sr'), 'sr'], [$('front-ssr'), 'ssr']]) {
    if (!box.childElementCount)
      for (const f of FRONT_FINISHES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip fin-chip ffin-' + f;
        b.dataset.f = f;
        b.setAttribute('role', 'radio');
        b.onclick = () => {
          draft.fin = { sr: finOf(draft.fin, 2), ssr: finOf(draft.fin, 3), [key]: f };
          if (draft.fin.sr === 'texture' && draft.fin.ssr === 'gold') draft.fin = null;
          renderFront();
          draftChanged();
        };
        box.append(b);
      }
    for (const b of box.children) {
      b.textContent = t('ffin.' + b.dataset.f);
      b.setAttribute('aria-checked', String(b.dataset.f === finOf(fin, key === 'sr' ? 2 : 3)));
    }
  }
  // 預覽
  const i = Math.max(0, draft.items.findIndex((it) => it.img));
  const art = thumbOf(draft, i).url;
  const shape = draft.kind === 'card' ? 'card' : 'square';
  if (!frontHolos) {
    frontHolos = [2, 3].map((r) => {
      const fig = document.createElement('figure');
      const wrap = document.createElement('div');
      wrap.className = 'tilt-wrap';
      const el = document.createElement('div');
      wrap.append(el);
      const cap = document.createElement('figcaption');
      cap.textContent = r === 2 ? 'SR' : 'SSR';
      fig.append(wrap, cap);
      $('front-prev').append(fig);
      const h = new Holo(el, wrap); // 會晃：下面每次 renderFront 檢查，停了（離開開店頁）就再開始
      return { h, r };
    });
  }
  for (const { h, r } of frontHolos) {
    h.set({ t: art, r, fin: finOf(draft.fin, r), shape, tag: false, name: '' });
    if (!h.running) {
      h.running = true;
      h.start(() => (h.running = h.el.isConnected && app.dataset.mode === 'create'));
    }
  }
  field.hidden = false;
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

// ---------- 卡背（轉卡機，使用者 2026-10-26：「增加卡面的背面也可以編輯」「跟背景一樣做給用戶選擇」「ssr sr 也給玩家有加工的選項」） ----------
//   跟背景一樣一排格子：預設（Gemini 的卡背）、8 種樣式（Gemini 畫的 back_<id>.webp）、選顏色、上傳自己的圖
//   再加一行字（店名之類）、邊框顏色；SR／SSR 翻開前的卡背「加工」：金箔、銀箔、彩虹、雷射、不加工
//   上面預覽一般、SR、SSR 三張；draft.back＝{ k: default|preset|color|img, id, c, img, text, color, sr, ssr }，全部預設＝null
const presetBacks = new Map(); // id → Promise<HTMLImageElement>
function presetBack(id) {
  if (!presetBacks.has(id))
    presetBacks.set(
      id,
      new Promise((res) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = asset('tex/back_' + id + '.webp');
      }),
    );
  return presetBacks.get(id);
}
// 選顏色的卡背：那個顏色的漸層＋白點點＋中間一顆星
function colorBack(c) {
  const W = 300;
  const H = 437;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H / 2, H * 0.75);
  grd.addColorStop(0, `color-mix(in srgb, ${c} 55%, #fff)`);
  grd.addColorStop(1, c);
  g.fillStyle = grd;
  try {
    g.fillRect(0, 0, W, H);
  } catch (e) {
    g.fillStyle = c;
    g.fillRect(0, 0, W, H);
  }
  if (g.fillStyle === '#000000' && c !== '#000000') {
    g.fillStyle = c; // 不支援 color-mix 的瀏覽器
    g.fillRect(0, 0, W, H);
  }
  g.fillStyle = 'rgba(255,255,255,.28)';
  for (let y = 18; y < H; y += 36) for (let x = (y / 36) % 2 ? 18 : 0; x < W; x += 36) {
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(28,35,64,.85)';
  g.lineWidth = 6;
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 34 : 78;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    g.lineTo(W / 2 + Math.cos(a) * r, H * 0.45 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  g.stroke();
  return cv;
}
let backBmp = null; // { bytes, bmp }：解碼過的上傳卡背圖
async function backArt(back) {
  if (!back) return null;
  let img = null;
  let key = 'd';
  if (back.k === 'img' && back.img) {
    if (backBmp?.bytes !== back.img.bytes) backBmp = { bytes: back.img.bytes, bmp: await createImageBitmap(new Blob([back.img.bytes], { type: back.img.mime })).catch(() => null) };
    img = backBmp.bmp;
    key = 'i' + back.img.bytes.length + ':' + back.img.bytes[30];
  } else if (back.k === 'preset' && BACK_PRESETS.includes(back.id)) {
    img = await presetBack(back.id);
    key = 'p' + back.id;
  } else if (back.k === 'color' && back.c) {
    img = colorBack(back.c);
    key = 'c' + back.c;
  }
  return { img, text: back.text, color: back.color, sr: back.sr || 'gold', ssr: back.ssr || 'rainbow', key };
}
// 全部都是預設的卡背（function 宣告：開頁讀草稿時就會用到，不能是之後才宣告的 const）
function backIsDefault(b) {
  return !b || ((b.k || 'default') === 'default' && !b.text && (!b.color || b.color === '#1c2340') && (b.sr || 'gold') === 'gold' && (b.ssr || 'rainbow') === 'rainbow');
}
let backRender = 0;
async function renderBack() {
  const field = $('back-field');
  field.hidden = draft.kind !== 'card';
  if (field.hidden) return;
  const back = draft.back || { k: 'default' };
  const tiles = $('back-tiles');
  if (!tiles.childElementCount) {
    const tile = (k, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bg-tile back-tile ' + cls;
      b.dataset.k = k;
      b.setAttribute('role', 'radio');
      b.append(document.createElement('span'));
      tiles.append(b);
      return b;
    };
    tile('default', 'preset').onclick = () => setBack({ k: 'default', img: null });
    for (const id of BACK_PRESETS) {
      const b = tile('preset:' + id, 'preset');
      b.style.backgroundImage = `url("${asset('tex/back_' + id + '.webp')}")`;
      b.onclick = () => setBack({ k: 'preset', id, img: null });
    }
    const cb = tile('color', 'color');
    const ci = document.createElement('input');
    ci.type = 'color';
    ci.value = '#ff8fb8';
    ci.addEventListener('input', () => setBack({ k: 'color', c: ci.value, img: null }, true));
    ci.addEventListener('click', () => setBack({ k: 'color', c: ci.value, img: null }));
    cb.append(ci);
    tile('img', 'upload').onclick = () => {
      $('file-back').value = '';
      $('file-back').click();
    };
    $('file-back').addEventListener('change', async () => {
      const f = $('file-back').files[0];
      if (!f) return;
      try {
        setBack({ k: 'img', img: await shrinkBack(f) });
      } catch (e) {
        toast(t('t.badImage'));
      }
    });
    $('back-text').addEventListener('input', () => setBack({ text: $('back-text').value.slice(0, 16) }, true));
    $('back-color').addEventListener('input', () => setBack({ color: $('back-color').value }, true));
    $('back-reset').onclick = () => {
      draft.back = null;
      renderBack();
      draftChanged();
    };
    // SR／SSR 的加工
    for (const [box, key] of [[$('back-sr'), 'sr'], [$('back-ssr'), 'ssr']])
      for (const f of FINISHES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip fin-chip fin-' + f;
        b.dataset.f = f;
        b.setAttribute('role', 'radio');
        b.onclick = () => setBack({ [key]: f });
        box.append(b);
      }
  }
  const cur = back.k === 'preset' ? 'preset:' + back.id : back.k || 'default';
  for (const b of tiles.children) {
    const k = b.dataset.k;
    b.setAttribute('aria-checked', String(k === cur));
    const label = k === 'default' ? t('back.default') : k.startsWith('preset:') ? t('back.p.' + k.slice(7)) : k === 'color' ? t('bg.color') : back.k === 'img' ? t('back.custom') : t('back.upload');
    b.querySelector('span').textContent = label;
    b.setAttribute('aria-label', label);
    if (k === 'default') b.style.backgroundImage = `url("${asset('tex/cardback.webp')}")`;
    if (k === 'color' && back.k === 'color') {
      b.style.backgroundImage = 'none';
      b.style.backgroundColor = back.c;
      b.querySelector('input').value = back.c;
    }
    if (k === 'img') {
      b.classList.toggle('has', back.k === 'img');
      b.style.backgroundImage = back.k === 'img' && back.img ? `url("${URL.createObjectURL(new Blob([back.img.bytes], { type: back.img.mime }))}")` : 'none';
    }
  }
  for (const [box, key, def] of [[$('back-sr'), 'sr', 'gold'], [$('back-ssr'), 'ssr', 'rainbow']])
    for (const b of box.children) {
      b.textContent = t('fin.' + b.dataset.f);
      b.setAttribute('aria-checked', String(b.dataset.f === (back[key] || def)));
    }
  if (document.activeElement !== $('back-text')) $('back-text').value = back.text || '';
  $('back-text').placeholder = t('back.textPh');
  if (document.activeElement !== $('back-color')) $('back-color').value = back.color || '#1c2340';
  $('back-reset').hidden = !draft.back;
  // 預覽：一般、SR、SSR
  const my = ++backRender;
  const art = (await backArt(draft.back)) || { sr: 'gold', ssr: 'rainbow' };
  if (my !== backRender) return;
  const prev = $('back-prev');
  prev.textContent = '';
  for (const tier of [0, 2, 3]) {
    const fig = document.createElement('figure');
    const c = drawCardBack(machine?.art?.cardback || null, tier, art);
    c.className = 'back-card';
    const cap = document.createElement('figcaption');
    cap.textContent = tier === 0 ? 'N・R' : tier === 2 ? 'SR' : 'SSR';
    fig.append(c, cap);
    prev.append(fig);
  }
}
function setBack(patch, typing = false) {
  draft.back = { k: 'default', ...(draft.back || {}), ...patch };
  if (backIsDefault(draft.back)) draft.back = null;
  if (typing) {
    clearTimeout(setBack.t);
    setBack.t = setTimeout(renderBack, 120);
  } else renderBack();
  draftChanged();
}
// 自己的卡背圖：裁成卡片比例 300×437、webp（放進連結）
async function shrinkBack(file) {
  const bmp = await createImageBitmap(file);
  const W = 300;
  const H = 437;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const s = Math.max(W / bmp.width, H / bmp.height);
  g.drawImage(bmp, (W - bmp.width * s) / 2, (H - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.72));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.75));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
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
  $('pick-work').hidden = draft.kind !== 'card'; // 換機台種類也要跟著藏／出現
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
  relabelSwitch();
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
      renderBack(); // 轉卡機才有卡背
      renderFront(); // 預覽換成卡片／方形
      renderMachineStickers(); // 貼在另一種機台上的貼紙變淡
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
    if (e.target.classList.contains('stk-sel')) {
      it.sticker = e.target.value ? { fin: e.target.value, baked: !!it.sticker?.baked } : null;
      e.target.classList.toggle('on', !!it.sticker);
    }
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
    } else if (e.target.closest('.studio-edit') || (e.target.closest('.thumb') && draft.items[+li.dataset.i].design)) {
      openStudio(+li.dataset.i);
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
    const it = draft.items[fileFor];
    let bmp;
    try {
      bmp = await createImageBitmap(f);
    } catch (e) {
      return toast(t('t.badImage'));
    }
    const c = await openCrop({ bmp, out: prizeSize(), title: t('crop.title', { name: it.name }) });
    if (!c || !draft.items.includes(it)) return; // 取消了
    try {
      it.img = await encodeImg(c);
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
    if (draft.listed && draft.cloud && cloudReady()) setListed(draft.cloud, false).catch(() => {}); // 公開搬到新連結
    delete draft.cloud;
    saveDraft();
    requestSync(false).then(() => draft.cloud && toast(t('t.newLink')));
  };
  $('copy').onclick = async () => {
    if (await copyText($('link').value)) return toast(t('t.copied'));
    $('link').focus();
    $('link').select();
    toast(t('t.selectCopy'));
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
      const bm = draft.bgm?.k === 'media' ? draft.bgm.media : null;
      if (bm?.k === 'file' && !bm.remote) {
        btn.textContent = t('link.uploading', { name: bm.name });
        try {
          const u = await localUrl(bm);
          if (!u) throw new Error('missing');
          bm.remote = await uploadMedia(await (await fetch(u)).blob(), bm.name, 'audio');
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
    if (c && !failed) pushListing();
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
  memberCard().touch();
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
  $('list-wrap').hidden = !(s.short && draft.cloud);
  $('list-on').checked = !!draft.listed;
  renderCover();
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
    if (curKind === 'card' && app.dataset.mode === 'create') renderBack(); // 預設卡背圖載好了 → 預覽重畫
  }
  machine.setTheme(cfg.theme);
  applyBg(cfg.bg);
  if (curKind === 'card') backArt(cfg.back).then((art) => shown === cfg && machine.setCardBack(art));
  machine.setFrontFinish(cfg.fin);
  machine.setPile(capsules, total);
  applyStickers(cfg);
  playBgm(cfg.bgm);
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
        gotOne(idx);
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
      gotOne(idx);
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
  gotOne(idx);
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
  // 獎品＝3D 閃卡（寶可夢卡的閃法，holo.js）：轉卡機是卡片、轉蛋機是方形的壓克力牌；有去背的話做好大張的就換上
  const isCard = play.cfg.kind === 'card';
  const hd = { t: thumbOf(play.cfg, idx).url, r: it.rarity, fin: finOf(play.cfg.fin, it.rarity), shape: isCard ? 'card' : 'square', name: it.name, tag: isCard, framed: it.framed || false };
  // 有音樂／影片：獎品改成「正在播放」卡（使用者 2026-10-26：「有音樂或動畫的設計改成這樣的設計」，nowplaying.js），封面還是 3D 閃卡（「立體的功能要留著」）
  const hasMedia = !!it.media;
  $('r-prize').hidden = $('r-name').hidden = hasMedia;
  const mediaHolo = hasMedia ? npHolo({ ...hd, tag: false }) : null;
  resultPlayer = nowPlaying($('r-media'), it.media, { art: hd.t, artNode: mediaHolo?.node, title: it.name, artist: play.cfg.name, rarity: it.rarity, delay: fresh ? 600 : 0 });
  resultIdx = idx;
  $('r-again').hidden = $('r-col').hidden = !!view;
  $('r-close').hidden = !view;
  $('r-close').textContent = view !== 'step' ? t('close') : play.multi.opened.includes(false) ? t('ten.next') : t('ten.toResults');
  const card = $('result-card');
  card.className = `sheet-card result r${it.rarity}${fresh ? ' fresh' : ''}`;
  card.style.setProperty('--rc', `var(--r-${r.key.toLowerCase()})`);
  $('r-rank').textContent = `${r.key} ${r.label}`;
  resHolo.set(hd);
  if (it.mask)
    cutLayers(idx, 300, isCard ? 437 : 300).then((L) => {
      if (resultIdx !== idx || !L.s) return;
      resHolo.set({ ...hd, s: L.s, b: L.b, st: L.st });
      mediaHolo?.holo.set({ ...hd, tag: false, s: L.s, b: L.b, st: L.st });
    });
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
let cardPlayer = null; // 收集簿大卡的「正在播放」
// 「正在播放」卡封面用的 3D 閃卡（使用者 2026-10-26：「立體的功能要留著」）：跟著游標／陀螺儀斜、去背主體浮出來、稀有度的閃
//   卡片從畫面拿掉（換獎品、關掉）就自己停
function npHolo(hd) {
  const node = document.createElement('div');
  node.className = 'tilt-wrap';
  const el = document.createElement('div');
  node.append(el);
  const holo = new Holo(el, node);
  holo.set(hd);
  holo.start(() => node.isConnected);
  return { node, holo };
}
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
  gotOne(idx);
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
  const art = thumbOf(draft, i).url;
  const artNode = it.media ? npHolo({ t: art, r: it.rarity, shape: draft.kind === 'card' ? 'card' : 'square', name: it.name, tag: false }).node : null;
  mediaPreview = nowPlaying($('m-preview'), it.media, { art, artNode, title: it.name, artist: draft.name || '', rarity: it.rarity });
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
  if ($(id).hidden) sfx.open();
  $(id).hidden = false;
  (focusEl || $(id).querySelector('button'))?.focus();
}
function closeSheet(id) {
  if (id === 'sheet-cover') cv.done?.(null);
  if (id === 'sheet-media') mediaPreview?.stop();
  if (id === 'sheet-card') {
    cardPlayer?.stop();
    cardPlayer = null;
  }
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
  if (mode !== 'create') cancelStick();
  app.dataset.mode = mode;
  $('tab-create').setAttribute('aria-selected', String(mode === 'create'));
  $('tab-play').setAttribute('aria-selected', String(mode === 'play'));
  $('tab-shop').setAttribute('aria-selected', String(mode === 'shop'));
  $('tab-album').setAttribute('aria-selected', String(mode === 'album'));
  $('tab-browse').setAttribute('aria-selected', String(mode === 'browse'));
  $('tab-studio').setAttribute('aria-selected', String(mode === 'studio'));
  $('tab-stickers').setAttribute('aria-selected', String(mode === 'stickers'));
  $('page-stickers').hidden = mode !== 'stickers';
  if (mode === 'stickers') {
    renderMaker();
    renderMyStickers();
  }
  $('page-browse').hidden = mode !== 'browse';
  // カード工房（cardstudio.js）：第一次來才畫，之後保留做到一半的；離開時試聽停掉
  $('page-studio').hidden = mode !== 'studio';
  if (mode === 'studio') {
    if (!studio?.built) cardStudio().open();
    else studio.refreshTargets();
  } else studio?.close();
  if (mode === 'browse') renderBrowse();
  $('page-shop').hidden = mode !== 'shop'; // 樣式表有 [hidden]{display:none} → 用屬性切換
  $('page-album').hidden = mode !== 'album';
  if (mode === 'shop') renderShop();
  if (mode === 'album') renderAlbum();
  requestAnimationFrame(updateInsets);
  if (mode === 'create') {
    if (frontHolos) renderFront(); // 表面加工的預覽重新開始晃
    machine?.clearCapsules();
    machine?.setSlotHint(false);
    machine?.setHandleEnabled(false);
    showMachine(draft, draft.items.reduce((a, b) => a + b.qty, 0));
  }
}

// ---------- 我的商店 ----------
// 換到另一台：先把這台還沒送出去的修改送完、存好，再載入那台
async function flushSync() {
  if (!syncTimer) return;
  clearTimeout(syncTimer);
  syncTimer = 0;
  if (draft.cloud && cloudReady()) await requestSync(true).catch(() => {});
}
async function switchMachine(uid) {
  if (uid === shop.cur) return;
  await flushSync();
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
  await flushSync();
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

// 複製一台（使用者 2026-10-26：「追加可以做多台的機器」）：獎品、外觀、價錢都一樣，但還沒有連結（做連結會是另一條）
async function dupMachine(uid) {
  await flushSync();
  saveDraft();
  const src = store.get(draftKey(uid));
  if (!src) return;
  const copy = { ...src, sample: false, name: t('shop.copyName', { name: src.name || t('defaultMachine') }).slice(0, LIMITS.title) };
  delete copy.cloud;
  delete copy.listed;
  delete copy.listedCover;
  const nu = 'm' + newUid();
  store.set(draftKey(nu), copy);
  if (!localStorage.getItem(draftKey(nu))) return toast(t('shop.dupFail')); // 這台裝置的空間滿了
  shop.list.splice(shop.list.indexOf(uid) + 1, 0, nu);
  shop.cur = nu;
  store.set('clatter.shop', shop);
  draft = loadDraft();
  afterSwitch();
  if (app.dataset.mode === 'shop') renderShop();
  toast(t('shop.duped'));
}

// 開店頁最上面的機台切換：每台一個選項（名稱＋種類）
const switchLabel = (i, d) => `${i + 1}. ${d?.name || t('defaultMachine')} · ${t('kind.' + (d?.kind === 'card' ? 'card' : 'capsule'))}`;
function renderSwitch() {
  const sel = $('mach-sel');
  sel.textContent = '';
  shop.list.forEach((uid, i) => sel.append(new Option(switchLabel(i, uid === shop.cur ? draft : store.get(draftKey(uid))), uid, false, uid === shop.cur)));
  $('mach-count').textContent = t('sw.label', { n: shop.list.length });
}
function relabelSwitch() {
  const o = [...$('mach-sel').options].find((x) => x.value === shop.cur);
  if (o) o.textContent = switchLabel(shop.list.indexOf(shop.cur), draft);
}

// 從我的商店拿掉（只刪這台裝置上的草稿；發出去的連結還在）
async function removeMachine(uid) {
  // 鑰匙會跟著草稿刪掉 → 公開中的先取消公開，免得留下改不了也收不回來的公開機台
  const d0 = uid === shop.cur ? draft : store.get(draftKey(uid));
  if (d0?.listed && d0.cloud && cloudReady()) await setListed(d0.cloud, false).catch(() => {});
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
    const cov = d.cover || d.listedCover;
    if (cov) {
      const im = document.createElement('img');
      im.src = cov;
      im.alt = '';
      ico.append(im);
    } else ico.innerHTML = KIND_ICON[kind];
    const tt = document.createElement('div');
    const h = document.createElement('h2');
    h.textContent = d.name || t('defaultMachine');
    if (d.listed && d.cloud) {
      const pub = document.createElement('span');
      pub.className = 'mach-pub';
      pub.textContent = t('browse.listed');
      h.append(pub);
    }
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
        const url = shareBase() + '#s.' + id;
        toast((await copyText(url)) ? t('t.copied') : url);
      });
    btn(t('shop.dup'), '', () => dupMachine(uid));
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
  return Math.max(0, Math.max(play.got[i] || 0, e?.base?.[n] || 0) + (e?.tr?.[n] || 0) - (e?.cut?.[n] || 0));
}

// 轉到一個：機台的紀錄＋1、收集簿的 base 也直接＋1
//   （以前只靠 albumSync 取「這次 play 轉到的」跟收集簿的大的 → 刪掉的機台、換過設定的試玩，新轉到的不會算進去）
function gotOne(idx) {
  play.got[idx] = (play.got[idx] || 0) + 1;
  if (play.cfg.items[idx].sticker) grantSticker(play.cfg, idx).catch((e) => console.warn(e));
  const a = store.get('clatter.album') || {};
  const key = albumKey();
  const nm = play.cfg.items[idx].name;
  const e = a[key] || { name: play.cfg.name, kind: play.cfg.kind === 'card' ? 'card' : 'capsule', link: play.link, items: {}, got: {}, order: [] };
  ensureBase(e, nm);
  e.base[nm] += 1;
  recount(e, nm);
  if (!e.order.includes(nm)) e.order.push(nm);
  e.ts = Date.now();
  a[key] = e;
  store.set('clatter.album', a);
  memberCard().touch();
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
        for (const [n, c] of Object.entries(v.cut || {})) m.cut = { ...m.cut, [n]: ((m.cut || {})[n] || 0) + c };
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
  e.fin = play.cfg.fin || null; // 表面加工（卡冊、大卡的閃法）
  e.link = play.link;
  const names = play.cfg.items.map((it) => it.name);
  e.order = [...names, ...e.order.filter((n) => !names.includes(n))];
  e.base = e.base || {};
  e.tr = e.tr || {};
  e.cut = e.cut || {};
  let any = false;
  for (let i = 0; i < play.cfg.items.length; i++) {
    const it = play.cfg.items[i];
    const nm = it.name;
    const th = thumbs[i];
    e.items[nm] = { r: it.rarity, t: th.t, s: th.s || null, b: th.b || null, st: th.st ?? null, md: mediaToLink(it.media) || null, ...(it.framed ? { y: it.framed === 'monster' ? 'm' : 1 } : {}) };
    const n = play.got[i] || 0;
    const base = Math.max(n, e.base[nm] ?? Math.max(0, (e.got[nm] || 0) - (e.tr[nm] || 0) + (e.cut[nm] || 0))); // 舊資料沒有 base：用 got 推回去
    if (base) e.base[nm] = base;
    recount(e, nm); // got＝base＋tr−cut；刪掉的機台（hidden）有新轉到的才會再出現
    if (n) any = true;
  }
  if (!any && !Object.keys(e.got).length && !Object.keys(e.tr).length) return; // 還沒轉到東西 → 先不放進收集簿
  e.ts = Date.now();
  a[key] = e;
  store.set('clatter.album', a);
  memberCard().touch();
}

// ---------- カード工房（使用者 2026-10-28：「追加一個卡片 編輯 以遊戲王的卡牌型式為主…做完後可以追加到抽卡機裡」，cardstudio.js） ----------
let studio = null;
function cardStudio() {
  studio =
    studio ||
    new CardStudio($('page-studio'), {
      t, toast, sfx, openCrop, parseMediaUrl, mediaLabel,
      lang: () => lang,
      bgmUrl: (id) => asset(`bgm/${id}.mp3`),
      // 可以放進去的機台：轉卡機（目前的用記憶體裡的草稿）
      targets: () =>
        shop.list
          .map((uid, i) => ({ uid, i, d: uid === shop.cur ? draft : store.get(draftKey(uid)) }))
          .filter((x) => x.d?.kind === 'card')
          .map((x) => ({ uid: x.uid, label: switchLabel(x.i, x.d), cur: x.uid === shop.cur })),
      onAdd: addStudioCard,
    });
  return studio;
}
// i＝改機台上的第幾張（沒給＝做新的／接著上次的）
function openStudio(i = -1) {
  const it = draft.items[i];
  setMode('studio');
  if (it?.design) cardStudio().open(it.design, { uid: shop.cur, itemUid: it.uid, qty: it.qty, music: it.media ? { k: 'keep' } : { k: 'none' } });
  else if (studio?.edit) cardStudio().open();
}
// 做好的卡放進轉卡機：整張卡面＝獎品照片（framed），設計留在草稿裡可以再改；音樂＝獎品的影音
async function addStudioCard({ design, card, music, target, qty, edit }) {
  if (target === '__new') {
    await newMachine();
    draft.items = []; // 新機台的範例獎品不要
  } else if (target !== shop.cur) await switchMachine(target);
  const blob = await new Promise((r) => card.toBlob(r, 'image/webp', 0.88));
  const bytes = new Uint8Array(await (blob || (await new Promise((r) => card.toBlob(r, 'image/jpeg', 0.9)))).arrayBuffer());
  const img = { bytes, mime: blob?.type === 'image/webp' ? 'image/webp' : 'image/jpeg' };
  let idx = edit ? draft.items.findIndex((x) => x.uid === edit.itemUid) : -1;
  if (idx < 0 && draft.items.length >= LIMITS.items) return toast(t('cs.full'));
  const old = idx >= 0 ? draft.items[idx] : null;
  const it = { name: (design.name || t('defaultPrize')).slice(0, LIMITS.name), rarity: design.rarity | 0, qty, img, mask: null, noMask: true, media: old?.media || null, uid: old?.uid || newUid(), sticker: old?.sticker || null, framed: design.style === 'monster' ? 'monster' : 'duel', design };
  if (music.k === 'none') it.media = null;
  else if (music.k === 'preset') it.media = parseMediaUrl(`${PUBLIC_URL}assets/bgm/${BGM_IDS.includes(music.id) ? music.id : BGM_IDS[0]}.mp3`);
  else if (music.k === 'url') it.media = parseMediaUrl(music.url) || it.media;
  if (old) {
    if (music.k !== 'keep' && music.k !== 'file' && old.media?.k === 'file' && old.media !== it.media) await removeLocal(old.media);
    draft.items[idx] = it;
  } else {
    draft.items.push(it);
    idx = draft.items.length - 1;
  }
  setMode('create');
  draftChanged(true);
  // 新開的機台是轉蛋機 → 換成轉卡機（跟按「カードガチャ」一樣：卡背、預覽、機台模型都換）
  if (draft.kind !== 'card') [...$('kinds').children].find((b) => b.dataset.kind === 'card')?.click();
  if (music.k === 'file' && music.file) await attachFile(idx, music.file);
  sfx.stick?.();
  toast(t(old ? 'cs.updated' : 'cs.added', { name: it.name, m: draft.name || t('defaultMachine') }));
}

// ---------- 收藏者會員卡（使用者 2026-10-28：Apple Wallet 會員卡，member.js＋supabase/functions/wallet） ----------
let member = null;
const isApple = () => /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
function memberCard() {
  member =
    member ||
    new MemberCard($('album-member'), {
      t, toast, store, sfx,
      lang: () => lang,
      loadWallet,
      wallet: () => wallet,
      myName: () => trade?.me?.name || '',
      setName: async (v) => {
        await trade.ensure();
        trade.me = await tradeMe(trade.w, v);
      },
      inviteUrl: (code) => `${shareBase()}#f.${code}`,
      isIos: isApple,
      // App 主題跟著主題卡（顏色、分頁圖示）；preview＝順便播一次開場動畫
      onTheme: (face, on, preview) => {
        applyAppTheme(face, on);
        if (preview && face) cardSplash(face, { t, sfx, unlock });
      },
    });
  return member;
}
// 開 App：主題有開 → 套顏色；一般打開（不是轉蛋／邀請連結）每個分頁階段播一次開場動畫
function bootCardTheme() {
  const st = store.get('clatter.member') || {};
  if (!st.appTheme) return;
  const face = memberCard().face();
  if (!face) return;
  applyAppTheme(face, true);
  if (/^#(g1|s\.|f\.)/.test(location.hash)) return;
  try {
    if (sessionStorage.getItem('clatter.splash')) return;
    sessionStorage.setItem('clatter.splash', '1');
  } catch {
    return;
  }
  cardSplash(face, { t, sfx, unlock });
}

// ---------- シール（使用者 2026-10-26：「增加貼子的功能 跟貼子簿 … 貼紙製作後可以貼在轉蛋機上或者放進轉蛋裡」） ----------
//   做貼紙：選照片 → 裁切 → 自動去背（seg.js）→ 形狀、加工、名字 → 放進シール帳（sticker.js 的 bakeSticker 把白フチ、加工畫進圖裡）
//   シール帳：收集簿的分頁（stickerbook.js）；貼到機台（machine.setStickers）；放進轉蛋（獎品的 sticker）；轉到貼紙獎品 → 進シール帳
let sb = null;
function stickerBook() {
  sb = sb || new StickerBook($('album-stickers'), { t, toast, sfx, foilUrl: asset(FOIL.file), packUrl, onPack: (id) => openPack(id), onMake: () => openStickerMaker(), onMachine: (x) => stickToMachine(x), onGacha: (x) => stickerToGacha(x), changed: () => app.dataset.mode === 'album' && albumTab === 'sticker' && renderAlbumTabsOnly() });
  return sb;
}
// 分頁上的張數跟著變（不重畫整本）
function renderAlbumTabsOnly() {
  const b = loadBook();
  const n = b.list.reduce((m, x) => m + (x.n || 1), 0);
  const tab = [...$('album-tabs').children].find((x) => x.textContent.startsWith(t('album.stickers')));
  if (tab) tab.textContent = `${t('album.stickers')} (${n})`;
  $('album-sum').textContent = t('stk.sum', { k: b.list.length, n, p: b.pages.length });
}

// 做貼紙（可以一次做好幾張，使用者 2026-10-27：CapLog「複数のステッカーつくれる」）：
//   手繪素材點一下＝選／取消（可以選好幾個）、「用照片做」＝裁切＋自動去背，一張一張加進來；形狀、加工整批一樣
//   「シートにする」→ 做成一張台紙 → 馬上打開（peel.js）：一張一張用手指慢慢撕下來才會放進シール帳
const mk = { srcs: [], shape: 'cut', fin: 'drop', pack: store.get('clatter.stkPack') || 'sheet', po: { design: 'holo', hue: 0, label: '', ...(store.get('clatter.stkPackOpts') || {}) }, then: null };
// 做好的貼紙的包裝（使用者 2026-10-28：「做好的貼紙可以選包裝」）：鋁箔袋（撕開）／台紙（直接撕貼紙）／不包裝（直接進貼紙簿）
const STK_PACKS = ['foil', 'sheet', 'none'];
function openStickerMaker(then) {
  mk.then = then || null;
  mk.srcs = [];
  mk.shape = 'cut';
  $('sk-name').value = '';
  setMode('stickers');
  $('sk-pick').focus();
}
// 手繪素材 → 做貼紙的原圖（已經去背 → 沿輪廓）
const presetImgs = new Map();
function presetImg(i) {
  if (!presetImgs.has(i)) presetImgs.set(i, fetch(asset(presetFile(i))).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('preset ' + r.status)))).then((b) => createImageBitmap(b)));
  return presetImgs.get(i);
}
async function usePreset(i) {
  const had = mk.srcs.findIndex((x) => x.preset === i);
  if (had >= 0) {
    mk.srcs.splice(had, 1);
    return renderMaker();
  }
  if (mk.srcs.length >= 12) return toast(t('stk.max12'));
  let bmp;
  try {
    bmp = await presetImg(i);
  } catch (e) {
    return toast(t('loadFail'));
  }
  mk.srcs.push({ src: bmp, mask: null, preset: i, name: t('stk.n.' + PRESETS[i]), alpha: true });
  renderMaker();
}
// 鋁箔包的圖：Gemini 畫的（assets/tex/foil_pack.webp；FOIL 有撕口、標籤的位置）；載不到就用程式畫的
// design＝PACK_DESIGNS 的 id、hue＝色相轉幾度（玩家自己調的顏色）
const packArtCache = new Map();
const packDesign = (id) => PACK_DESIGNS.find((x) => x.id === id) || PACK_DESIGNS[0];
let drawnPackUrl = null;
function packUrl(p) {
  const d = packDesign(p?.design);
  if (!d.drawn) return asset(d.file);
  drawnPackUrl = drawnPackUrl || drawFoilPack(300, 410).toDataURL('image/webp', 0.85);
  return drawnPackUrl;
}
function foilArt(design = 'holo', hue = 0) {
  const d = packDesign(design);
  const key = d.id + '|' + ((hue | 0) % 360);
  if (!packArtCache.has(key))
    packArtCache.set(
      key,
      (async () => {
        let img;
        try {
          img = d.drawn ? drawFoilPack() : await fetch(asset(d.file)).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('pack ' + r.status)))).then((b) => createImageBitmap(b));
        } catch {
          return { img: drawFoilPack(), ...FOIL_DRAWN };
        }
        if ((hue | 0) % 360) {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext('2d');
          g.filter = `hue-rotate(${hue | 0}deg)`;
          g.drawImage(img, 0, 0);
          img = c;
        }
        return { img, seal: d.seal, labelAt: d.labelAt };
      })(),
    );
  return packArtCache.get(key);
}
// 打開一包／一張台紙：還沒撕下來的貼紙放上去，撕一張存一張
async function openPack(packId, onDone) {
  const b = loadBook();
  const p = b.packs.find((x) => x.id === packId);
  if (!p) return;
  const todo = p.items.map((x, i) => ({ x, i })).filter(({ x }) => !x.saved);
  const items = [];
  for (const { x, i } of todo) {
    const bl = await stickerBlob(x.id);
    const img = bl ? await createImageBitmap(bl).catch(() => null) : null;
    if (img) items.push({ img, name: x.name, at: i });
  }
  if (!items.length) return;
  const saved = [];
  const art = p.kind === 'foil' && !p.open ? await foilArt(p.design, p.hue) : null;
  openPeel(items, {
    t,
    sfx,
    title: p.title || t('peel.sheetTitle'),
    pack: art ? { img: art.img, seal: art.seal, labelAt: art.labelAt, label: p.label?.trim() || t('peel.packLabel', { n: items.length }) } : null,
    onOpened: () => markPackOpened(p.id),
    onSave: async (k) => {
      const st = await claimPackItem(p.id, items[k].at);
      if (st) saved.push(st);
      refreshStickerBook();
    },
    onClose: () => {
      refreshStickerBook();
      onDone?.(saved);
    },
  });
}
function refreshStickerBook() {
  if (app.dataset.mode === 'album' && albumTab === 'sticker') renderAlbum();
}
// シール帳第一次打開（還沒有貼紙）→ 送一包 4 張手繪貼紙，直接打開
async function welcomeStickers() {
  const b = loadBook();
  if (b.welcomed || b.list.length || b.packs.length) return false;
  b.welcomed = true;
  saveBook(b);
  const pk = await createPack({ kind: 'foil', title: t('stk.welcomePack'), src: 'gift' });
  for (const [i, fin] of [[1, 'drop'], [5, 'glitter'], [4, 'aurora'], [10, 'fuwa']]) {
    try {
      await addToPack(pk.id, bakeSticker(await presetImg(i), { shape: 'cut', fin, size: 384, seed: i + 1 }), { name: t('stk.n.' + PRESETS[i]), fin, shape: 'cut' });
    } catch (e) {
      console.warn(e);
    }
  }
  toast(t('stk.welcome'));
  openPack(pk.id);
  return true;
}
async function onStickerFiles(files) {
  for (const f of files) {
    if (mk.srcs.length >= 12) return toast(t('stk.max12'));
    let bmp;
    try {
      bmp = await createImageBitmap(f);
    } catch (e) {
      toast(t('t.badImage'));
      continue;
    }
    const c = await openCrop({ bmp, out: [512, 512], title: t('stk.cropTitle') });
    if (!c) continue;
    const s = { src: c, mask: null, preset: -1, name: f.name.replace(/\.[^.]+$/, '').slice(0, 24) || t('stk.defaultName'), alpha: hasAlpha(c) };
    mk.srcs.push(s);
    if (app.dataset.mode !== 'stickers') setMode('stickers');
    renderMaker();
    if (s.alpha) continue; // 已經去背的圖（PNG）→ 直接用它的透明
    s.cutting = true;
    renderMaker();
    s.mask = await cutout(c).catch(() => null);
    s.cutting = false;
    renderMaker();
  }
}
const canCut = (s) => s.alpha || !!s.mask;
const shapeOf = (s) => (mk.shape === 'cut' && !canCut(s) ? 'circle' : mk.shape);
function renderMaker() {
  const pb = $('sk-packs');
  if (!pb.childElementCount)
    for (const v of STK_PACKS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.v = v;
      b.setAttribute('role', 'radio');
      b.onclick = () => {
        mk.pack = v;
        store.set('clatter.stkPack', v);
        renderMaker();
      };
      pb.append(b);
    }
  for (const b of pb.children) {
    b.textContent = t('stk.pk.' + b.dataset.v);
    b.setAttribute('aria-checked', String(b.dataset.v === mk.pack));
  }
  renderPackOpts();
  const box = $('sk-shapes');
  if (!box.childElementCount) {
    for (const v of STICKER_SHAPES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.v = v;
      b.setAttribute('role', 'radio');
      b.onclick = () => {
        mk.shape = v;
        renderMaker();
      };
      box.append(b);
    }
    for (const v of STICKER_FINS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip fin-chip stkfin-' + v;
      b.dataset.v = v;
      b.setAttribute('role', 'radio');
      b.onclick = () => {
        mk.fin = v;
        renderMaker();
      };
      $('sk-fins').append(b);
    }
  }
  const pg = $('sk-presets');
  if (!pg.childElementCount)
    PRESETS.forEach((k, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sk-pre';
      b.dataset.i = i;
      const im = document.createElement('img');
      im.src = asset(presetFile(i));
      im.alt = '';
      b.append(im);
      b.onclick = () => usePreset(i);
      pg.append(b);
    });
  for (const b of pg.children) {
    b.setAttribute('aria-pressed', String(mk.srcs.some((x) => x.preset === +b.dataset.i)));
    b.setAttribute('aria-label', t('stk.n.' + PRESETS[b.dataset.i]));
    b.title = t('stk.n.' + PRESETS[b.dataset.i]);
  }
  const n = mk.srcs.length;
  const cutting = mk.srcs.some((x) => x.cutting);
  $('sk-pick').textContent = t('stk.fromPhoto');
  $('sk-empty').hidden = !!n;
  for (const b of box.children) {
    b.textContent = t('stk.sh.' + b.dataset.v);
    b.setAttribute('aria-checked', String(b.dataset.v === mk.shape));
  }
  for (const b of $('sk-fins').children) {
    b.textContent = t('stk.f.' + b.dataset.v);
    b.setAttribute('aria-checked', String(b.dataset.v === mk.fin));
  }
  $('sk-busy').hidden = !cutting;
  // 名字：只有一張的時候可以改
  $('sk-name').closest('.field').hidden = n !== 1;
  if (n === 1 && !$('sk-name').value) $('sk-name').value = mk.srcs[0].name;
  $('sk-save').disabled = !n || cutting;
  $('sk-save').textContent = n > 1 ? t('stk.makeSheet', { n }) : t('stk.save');
  // 預覽：一張＝大張；好幾張＝小格子
  const stage = $('sk-stage');
  stage.querySelector('canvas')?.remove();
  if (!n) return;
  const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const cell = n === 1 ? 512 : 160;
  const c = document.createElement('canvas');
  c.width = c.height = cell * cols;
  const g = c.getContext('2d');
  mk.srcs.forEach((s, i) => {
    const b = bakeSticker(s.src, { mask: s.mask, shape: shapeOf(s), fin: mk.fin, size: cell, seed: i + 1 });
    g.drawImage(b, (i % cols) * cell, Math.floor(i / cols) * cell);
  });
  c.className = 'sk-prev';
  stage.prepend(c);
}
function bindMaker() {
  $('file-sticker').multiple = true;
  $('file-sticker').addEventListener('change', () => {
    const fs = [...$('file-sticker').files];
    if (fs.length) onStickerFiles(fs);
  });
  $('sk-pick').onclick = () => {
    $('file-sticker').value = '';
    $('file-sticker').click();
  };
  $('sk-save').onclick = async () => {
    const list = mk.srcs.slice();
    if (!list.length) return;
    $('sk-save').disabled = true;
    const kind = STK_PACKS.includes(mk.pack) ? mk.pack : 'sheet';
    const then = mk.then;
    mk.then = null;
    // 不包裝：直接放進貼紙簿
    if (kind === 'none') {
      let first = null;
      for (const [i, s] of list.entries()) {
        const name = list.length === 1 ? $('sk-name').value.trim() || s.name : s.name;
        const st = await addSticker(bakeSticker(s.src, { mask: s.mask, shape: shapeOf(s), fin: mk.fin, size: 512, seed: i + 1 }), { name, fin: mk.fin, shape: shapeOf(s) });
        first = first || st;
      }
      mk.srcs = [];
      $('sk-save').disabled = false;
      sfx.stick?.();
      renderMaker();
      refreshStickerBook();
      renderMyStickers();
      toast(t('stk.savedDirect', { n: list.length }));
      if (first) then?.(first);
      return;
    }
    const pk = await createPack({ kind, title: t(kind === 'foil' ? 'peel.foilTitle' : 'peel.sheetTitle'), src: 'made', ...(kind === 'foil' ? mk.po : {}) });
    for (const [i, s] of list.entries()) {
      const name = list.length === 1 ? $('sk-name').value.trim() || s.name : s.name;
      await addToPack(pk.id, bakeSticker(s.src, { mask: s.mask, shape: shapeOf(s), fin: mk.fin, size: 512, seed: i + 1 }), { name, fin: mk.fin, shape: shapeOf(s) });
    }
    mk.srcs = [];
    renderMaker();
    sfx.pop();
    refreshStickerBook();
    // 做好的包裝直接打開：鋁箔袋先撕開、台紙一張一張撕下來
    openPack(pk.id, (saved) => {
      renderMyStickers();
      if (saved.length) then?.(saved[0]);
    });
  };
}

// 貼紙圖縮小（機台、連結用）：長邊 size px，透明底 webp
async function shrinkSticker(blob, size = 160) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const k = Math.min(size / bmp.width, size / bmp.height);
  c.getContext('2d').drawImage(bmp, (size - bmp.width * k) / 2, (size - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  let b = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
  if (!b || b.type !== 'image/webp') b = await new Promise((r) => c.toBlob(r, 'image/png'));
  return { bytes: new Uint8Array(await b.arrayBuffer()), mime: b.type };
}

// 貼到機台：選好貼紙 → 點機台想貼的地方（machine.startStick）
async function stickToMachine(st) {
  if ((draft.stickers || []).length >= 8) return toast(t('stk.machineFull'));
  const blob = await stickerBlob(st.id);
  if (!blob) return;
  const img = await shrinkSticker(blob);
  setMode('create');
  $('stick-hint').hidden = false;
  machine?.startStick((at) => {
    $('stick-hint').hidden = true;
    const x = { id: 'm' + newUid(), img, fin: st.fin, ...at, s: 0.14, r: 0 };
    draft.stickers = [...(draft.stickers || []), x];
    mstkSel = draft.stickers.length - 1;
    sfx.stick();
    draftChanged();
    renderMachineStickers();
    applyStickers(draft);
    toast(t('stk.machineStuck'));
  });
}
function cancelStick() {
  machine?.stopStick();
  if ($('stick-hint')) $('stick-hint').hidden = true;
}
// 機台上的貼紙：圖 → ImageBitmap（machine.js 做貼圖）
const stkBmp = new WeakMap();
async function applyStickers(cfg) {
  const list = cfg.stickers || [];
  for (const x of list) {
    if (x.bmp || !x.img) continue;
    let b = stkBmp.get(x.img);
    if (!b) {
      b = await createImageBitmap(new Blob([x.img.bytes], { type: x.img.mime })).catch(() => null);
      if (b) stkBmp.set(x.img, b);
    }
    x.bmp = b;
  }
  if (shown === cfg) machine?.setStickers(list);
}
const stkThumb = new WeakMap();
const thumbUrlOf = (im) => {
  let u = stkThumb.get(im);
  if (!u) stkThumb.set(im, (u = URL.createObjectURL(new Blob([im.bytes], { type: im.mime }))));
  return u;
};
let mstkSel = -1;
function renderMachineStickers() {
  const box = $('mstk-list');
  box.textContent = '';
  const arr = draft.stickers || [];
  if (mstkSel >= arr.length) mstkSel = arr.length - 1;
  const kind = draft.kind === 'card' ? 'card' : 'capsule';
  arr.forEach((x, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mstk' + (i === mstkSel ? ' on' : '') + (x.k !== kind ? ' other' : '');
    b.title = x.k !== kind ? t('stk.otherKind') : '';
    const im = document.createElement('img');
    im.src = thumbUrlOf(x.img);
    im.alt = '';
    const del = document.createElement('span');
    del.className = 'mstk-del';
    del.textContent = '✕';
    del.dataset.del = '1';
    del.setAttribute('aria-label', t('stk.peel'));
    b.append(im, del);
    b.onclick = (e) => {
      if (e.target.closest('[data-del]')) {
        draft.stickers = arr.filter((_, k) => k !== i);
        mstkSel = -1;
        sfx.peel();
        draftChanged();
        applyStickers(draft);
      } else mstkSel = mstkSel === i ? -1 : i;
      renderMachineStickers();
    };
    box.append(b);
  });
  $('mstk-add').disabled = arr.length >= 8;
  const sel = arr[mstkSel];
  $('mstk-adj').hidden = !sel;
  if (sel) {
    $('mstk-size').value = sel.s;
    $('mstk-rot').value = sel.r || 0;
  }
}
// 改了貼紙的位置、大小、角度 → 下一格畫面重貼一次（拖的時候不要每個事件都重算）
let stkRaf = 0;
function stkLive() {
  cancelAnimationFrame(stkRaf);
  stkRaf = requestAnimationFrame(() => applyStickers(draft));
}
function bindMachineStickers() {
  const live = stkLive;
  $('mstk-size').addEventListener('input', () => {
    const x = draft.stickers?.[mstkSel];
    if (!x) return;
    x.s = +$('mstk-size').value;
    live();
  });
  $('mstk-rot').addEventListener('input', () => {
    const x = draft.stickers?.[mstkSel];
    if (!x) return;
    x.r = +$('mstk-rot').value;
    live();
  });
  for (const id of ['mstk-size', 'mstk-rot']) $(id).addEventListener('change', () => draftChanged());
  $('mstk-add').onclick = () => openStickerPicker();
  // 換位置：點了以後再點機台上新的地方（手機上貼紙小、不好拖的時候用）
  $('mstk-move').onclick = () => {
    const x = draft.stickers?.[mstkSel];
    if (!x) return;
    $('stick-hint').hidden = false;
    machine?.startStick((at) => {
      $('stick-hint').hidden = true;
      Object.assign(x, at);
      sfx.stick();
      draftChanged();
      applyStickers(draft);
    });
  };
  $('stick-cancel').onclick = cancelStick;
  $('sp-make').onclick = () => {
    closeSheet('sheet-stkpick');
    openStickerMaker((st) => stickToMachine(st));
  };
}
// 鋁箔袋的設定（選了鋁箔袋才出現）：款式（縮圖）、顏色（色相）、標籤上的字
function renderPackOpts() {
  const box = $('sk-packopts');
  box.hidden = mk.pack !== 'foil';
  if (box.hidden) return;
  const po = mk.po;
  const save = () => store.set('clatter.stkPackOpts', po);
  if (!box.childElementCount) {
    const row = document.createElement('div');
    row.className = 'sk-designs';
    for (const d of PACK_DESIGNS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sk-design';
      b.dataset.v = d.id;
      const im = document.createElement('img');
      im.src = packUrl({ design: d.id });
      im.alt = '';
      b.append(im);
      b.onclick = () => {
        po.design = d.id;
        save();
        renderPackOpts();
      };
      row.append(b);
    }
    const hue = document.createElement('label');
    hue.className = 'snd-row';
    const hs = document.createElement('span');
    const hr = document.createElement('input');
    hr.type = 'range';
    hr.min = 0;
    hr.max = 359;
    hr.id = 'sk-hue';
    hr.oninput = () => {
      po.hue = +hr.value;
      save();
      renderPackOpts();
    };
    hue.append(hs, hr);
    const lab = document.createElement('label');
    lab.className = 'snd-row';
    const ls = document.createElement('span');
    const li = document.createElement('input');
    li.id = 'sk-plabel';
    li.maxLength = 16;
    li.oninput = () => {
      po.label = li.value;
      save();
    };
    lab.append(ls, li);
    box.append(row, hue, lab);
  }
  for (const b of box.querySelectorAll('.sk-design')) {
    b.setAttribute('aria-pressed', String(b.dataset.v === po.design));
    b.setAttribute('aria-label', t('stk.pd.' + b.dataset.v));
    b.title = t('stk.pd.' + b.dataset.v);
    b.querySelector('img').style.filter = po.hue ? `hue-rotate(${po.hue}deg)` : '';
  }
  const [hs, ls] = box.querySelectorAll('.snd-row > span');
  hs.textContent = t('stk.packHue');
  ls.textContent = t('stk.packLabel');
  $('sk-hue').value = po.hue | 0;
  const li = $('sk-plabel');
  if (document.activeElement !== li) li.value = po.label || '';
  li.placeholder = t('peel.packLabel', { n: Math.max(1, mk.srcs.length) });
}

// 貼紙工房上面那一格：貼紙簿裡做好的貼紙，每張可以放進轉蛋、貼到機台
async function renderMyStickers() {
  const box = $('my-stickers');
  const b = loadBook();
  box.textContent = '';
  const head = document.createElement('div');
  head.className = 'works-head';
  const h = document.createElement('h2');
  h.textContent = t('stk.mine');
  const n = document.createElement('small');
  n.textContent = t('stk.mineN', { n: b.list.length, p: b.packs.filter((x) => x.items.some((i) => !i.saved)).length });
  head.append(h, n);
  box.append(head);
  const grid = document.createElement('div');
  grid.className = 'my-stk-grid';
  for (const x of b.list.slice().sort((p, q) => (q.ts || 0) - (p.ts || 0))) {
    const cell = document.createElement('div');
    cell.className = 'my-stk';
    const im = document.createElement('img');
    im.alt = x.name;
    im.src = (await stickerUrl(x.id)) || '';
    const nm = document.createElement('b');
    nm.textContent = x.name + (x.n > 1 ? ` ×${x.n}` : '');
    const acts = document.createElement('div');
    acts.className = 'work-acts';
    const g = document.createElement('button');
    g.type = 'button';
    g.className = 'btn sun';
    g.textContent = t('stk.toGacha');
    g.onclick = () => stickerToGacha(x);
    const m = document.createElement('button');
    m.type = 'button';
    m.className = 'btn';
    m.textContent = t('stk.toMachine');
    m.onclick = () => stickToMachine(x);
    acts.append(g, m);
    cell.append(im, nm, acts);
    grid.append(cell);
  }
  if (!b.list.length) {
    const e = document.createElement('p');
    e.className = 'hint-text';
    e.textContent = t('stk.pickEmpty');
    box.append(e);
  } else box.append(grid);
}
// 從作品冊挑卡片放進目前這台轉卡機（使用者 2026-10-28：「所以卡片的景品去製作的卡片簿選」）
async function openWorkPicker() {
  const grid = $('wp-grid');
  grid.textContent = '';
  let works = [];
  try {
    works = await listWorks();
  } catch {}
  $('wp-empty').hidden = !!works.length;
  for (const w of works) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sp-tile';
    btn.title = w.d?.name || '';
    const im = document.createElement('img');
    im.src = w.thumb;
    im.alt = w.d?.name || '';
    btn.append(im);
    btn.onclick = async () => {
      closeSheet('sheet-workpick');
      const art = w.d?.art?.b64 ? await createImageBitmap(new Blob([Uint8Array.from(atob(w.d.art.b64), (c) => c.charCodeAt(0))], { type: w.d.art.mime })).catch(() => null) : null;
      await studioFonts();
      await addStudioCard({ design: { ...w.d, wid: w.id }, card: drawDesignCard(w.d, art, CARD_OUT[0], lang), music: w.m || { k: 'none' }, target: shop.cur, qty: 3, edit: null });
    };
    grid.append(btn);
  }
  openSheet('sheet-workpick', grid.querySelector('button') || $('wp-make'));
}
// 挑貼紙：預設＝貼到機台；onPick 換掉＝放進轉蛋當獎品
async function openStickerPicker(onPick = stickToMachine, title = t('stk.pickTitle')) {
  $('sp-title').textContent = title;
  const grid = $('sp-grid');
  grid.textContent = '';
  const b = loadBook();
  $('sp-empty').hidden = !!b.list.length;
  for (const x of b.list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sp-tile';
    btn.title = x.name;
    const im = document.createElement('img');
    im.src = (await stickerUrl(x.id)) || '';
    im.alt = x.name;
    btn.append(im);
    btn.onclick = () => {
      closeSheet('sheet-stkpick');
      onPick(x);
    };
    grid.append(btn);
  }
  openSheet('sheet-stkpick', grid.querySelector('button') || $('sp-make'));
}

// 放進轉蛋：做好的貼紙變成現在這台的獎品（圖已經是貼紙 → baked）
async function stickerToGacha(st) {
  if (draft.items.length >= LIMITS.items) return toast(t('stk.full'));
  const blob = await stickerBlob(st.id);
  if (!blob) return;
  const bmp = await createImageBitmap(blob);
  const [W, H] = prizeSize();
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const k = Math.min(W / bmp.width, H / bmp.height) * 0.96;
  c.getContext('2d').drawImage(bmp, (W - bmp.width * k) / 2, (H - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  draft.items.push({ name: (st.name || t('stk.defaultName')).slice(0, LIMITS.name), rarity: 0, qty: 5, img: await encodeImg(c, true), mask: null, noMask: true, uid: newUid(), sticker: { fin: st.fin, baked: true } });
  draftChanged(true);
  setMode('create');
  toast(t('stk.toGachaDone', { m: draft.name }));
}

// 轉到貼紙獎品 → 做成貼紙放進シール帳（同一台的同一個獎品再轉到 → 張數 +1）
async function grantSticker(cfg, idx) {
  const it = cfg.items[idx];
  const key = albumKey() + '|' + it.name;
  const card = cfg.kind === 'card';
  const src = it.img ? await createImageBitmap(new Blob([it.img.bytes], { type: it.img.mime })) : placeholderThumb(it.name, idx);
  let c;
  let shape = 'cut';
  if (it.sticker.baked) {
    c = document.createElement('canvas');
    c.width = c.height = 256;
    const k = Math.min(256 / src.width, 256 / src.height);
    c.getContext('2d').drawImage(src, (256 - src.width * k) / 2, (256 - src.height * k) / 2, src.width * k, src.height * k);
  } else {
    const mask = it.mask ? await createImageBitmap(new Blob([it.mask.bytes], { type: it.mask.mime })).catch(() => null) : null;
    shape = mask ? 'cut' : card ? 'square' : 'circle';
    c = bakeSticker(src, { mask, shape, fin: it.sticker.fin, size: 256, seed: idx + 3 });
  }
  const pk = await createPack({ kind: 'foil', title: cfg.name, key: 'g|' + albumKey(), src: 'gacha' });
  await addToPack(pk.id, c, { name: it.name, fin: it.sticker.fin, shape, key, from: cfg.name });
  toast(t('stk.gotPack', { name: it.name }));
}

// 收集簿：分「卡片冊」（轉卡機，像真的卡冊）跟「轉蛋收藏」（轉蛋機，木頭展示櫃）兩個分頁（binder.js）
let albumTab = store.get('clatter.albumTab') || null;
let albumEditing = false;
let albumEdit = null;
let binder = null;
function renderAlbum() {
  const a = store.get('clatter.album') || {};
  const entries = Object.entries(a)
    .filter(([, e]) => !e.hidden) // 刪掉的機台
    .sort((x, y) => (y[1].ts || 0) - (x[1].ts || 0));
  for (const [k, e] of entries) e.key = k; // 大卡「拿去交換」、編輯要知道是哪一筆
  const cards = entries.filter(([, e]) => e.kind === 'card');
  const caps = entries.filter(([, e]) => e.kind !== 'card');
  // 第一次打開：有卡片就先看卡片冊
  if (!albumTab) albumTab = cards.length || !caps.length ? 'card' : 'capsule';
  const tabs = $('album-tabs');
  tabs.textContent = '';
  const book = loadBook();
  const stkN = book.list.reduce((n, x) => n + (x.n || 1), 0);
  for (const [k, list] of [['card', cards], ['capsule', caps], ['sticker', null], ['member', null], ['pack', null], ['friends', null], ['trade', null]]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(albumTab === k));
    b.textContent =
      k === 'trade' ? t('album.trade') + (trade?.list.in.length ? ` (${trade.list.in.length})` : '')
      : k === 'friends' ? `${t('album.friends')} (${trade?.friends.length || 0})`
      : k === 'sticker' ? `${t('album.stickers')} (${stkN})`
      : k === 'member' ? t('album.member')
      : k === 'pack' ? t('album.pack')
      : `${t(k === 'card' ? 'album.binder' : 'album.shelf')} (${list.length})`;
    b.onclick = () => {
      albumTab = k;
      store.set('clatter.albumTab', k);
      renderAlbum();
    };
    tabs.append(b);
  }
  // 會員卡（member.js）、帶出去（同一張主題卡，cardpack.js 的素材）
  $('album-member').hidden = albumTab !== 'member';
  $('album-pack').hidden = albumTab !== 'pack';
  if (albumTab === 'pack') {
    albumEditing = false;
    $('album-edit').hidden = $('album-edit-hint').hidden = true;
    $('album-empty').hidden = $('album-binder').hidden = $('album-shelf').hidden = $('album-trade').hidden = $('album-stickers').hidden = true;
    $('album-sum').textContent = memberCard().packSummary();
    memberCard().renderPack($('album-pack'));
    return;
  }
  if (albumTab === 'member') {
    albumEditing = false;
    $('album-edit').hidden = $('album-edit-hint').hidden = true;
    $('album-empty').hidden = $('album-binder').hidden = $('album-shelf').hidden = $('album-trade').hidden = $('album-stickers').hidden = true;
    $('album-sum').textContent = memberCard().summary();
    memberCard().render();
    // 名字在好友那邊存著：還沒拿到就拿一次再畫
    if (!trade?.me && cloudReady())
      trade
        ?.ensure()
        .then(() => albumTab === 'member' && app.dataset.mode === 'album' && memberCard().render())
        .catch(() => {});
    return;
  }
  // シール帳（stickerbook.js）
  $('album-stickers').hidden = albumTab !== 'sticker';
  if (albumTab === 'sticker') {
    albumEditing = false;
    $('album-edit').hidden = $('album-edit-hint').hidden = true;
    $('album-empty').hidden = $('album-binder').hidden = $('album-shelf').hidden = $('album-trade').hidden = true;
    $('album-sum').textContent = t('stk.sum', { k: book.list.length, n: stkN, p: book.pages.length });
    stickerBook().render();
    if (!book.welcomed && !book.list.length && !book.packs.length) welcomeStickers().then((ok) => ok && refreshStickerBook());
    return;
  }
  // 好友名單／交換（trade.js）
  const social = albumTab === 'friends' || albumTab === 'trade';
  $('album-trade').hidden = !social;
  if (social) {
    albumEditing = false;
    $('album-edit').hidden = $('album-edit-hint').hidden = true;
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
  // 編輯（使用者 2026-10-26：「收集相簿 可以編輯或刪除」）：點獎品調數量、目錄／櫃子上改名或刪掉整台
  const eb = $('album-edit');
  eb.hidden = !list.length;
  eb.textContent = t(albumEditing ? 'album.done' : 'album.edit');
  eb.setAttribute('aria-pressed', String(albumEditing));
  eb.onclick = () => {
    albumEditing = !albumEditing;
    renderAlbum();
  };
  $('album-edit-hint').hidden = !(albumEditing && list.length);
  $('album-edit-hint').textContent = t(albumTab === 'card' ? 'album.editHintCard' : 'album.editHintCap');
  const opts = {
    onCard: openCardView, onPlay: (link) => enterPlay(link),
    editing: albumEditing,
    onEditItem: (e, n) => albumEdit.item(e, n),
    onRename: (e) => albumEdit.rename(e),
    onDelete: (e) => albumEdit.remove(e),
  };
  if (albumTab === 'card' && list.length) {
    binder = binder || new Binder($('album-binder'), opts);
    binder.opts = opts;
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
  // 有音樂／影片 → 「正在播放」卡；沒有 → 3D 閃卡
  cardPlayer?.stop();
  const md = it.md && mediaFromLink(it.md);
  $('v-tilt').parentElement.hidden = $('v-name').hidden = !!md;
  const hdv = { t: it.t, s: it.s, b: it.b, st: it.st, r: it.r, fin: finOf(e.fin, it.r), shape: e.kind === 'card' ? 'card' : 'round', name, framed: it.y === 'm' ? 'monster' : it.y ? 'duel' : false };
  cardPlayer = md ? nowPlaying($('v-media'), md, { art: it.t, artNode: npHolo({ ...hdv, tag: false }).node, title: name, artist: titleOf(e), rarity: it.r }) : null;
  if (!md) $('v-media').textContent = '';
  // 有去背：背景層用「主體柔化掉」的圖、主體自己一層浮到最前面；沒有就整張一層（holo.js）
  viewHolo.set(hdv);
  viewHolo.start(() => !$('sheet-card').hidden);
  // 好友交換（要連得上雲端）、貼到シール帳：收集簿裡有的獎品才行
  $('v-acts').hidden = !(e.key && e.got[name] > 0);
  $('v-trade').hidden = $('v-gift').hidden = !cloudReady();
  for (const [id, mode] of [['v-trade', 'swap'], ['v-gift', 'gift']])
    $(id).onclick = () => {
      closeSheet('sheet-card');
      trade.sendFlow({ item: { key: e.key, n: name }, mode });
    };
  // 按兩下才做（會從收藏扣一個）
  const vs = $('v-stick');
  vs.textContent = t('stk.toBook');
  vs.onclick = () => {
    if (vs.dataset.arm !== '1') {
      vs.dataset.arm = '1';
      vs.textContent = t('stk.toBookConfirm');
      return;
    }
    vs.dataset.arm = '';
    prizeToSticker(e, name);
  };
  vs.dataset.arm = '';
}

// 收集簿的獎品 → 貼紙（使用者 2026-10-27：「轉蛋的貼紙可以貼到貼紙簿」）
//   收藏少一個（跟送人一樣記在 cut）→ 做成一張台紙 → 馬上打開，用手指撕下來放進シール帳
//   有去背的主體 → 沿輪廓；沒有 → 圓形（轉卡機：方形）；加工照稀有度：N、R ボンドロ、SR オーロラ、SSR ラメ
//   key＝收集簿的那台＋獎品名：跟轉到的貼紙獎品同一張（張數累加）
async function prizeToSticker(e, name) {
  const it = e.items[name];
  const load = (u) => (u ? fetch(u).then((r) => r.blob()).then((b) => createImageBitmap(b)).catch(() => null) : null);
  const subj = await load(it.s);
  const src = subj || (await load(it.t));
  if (!src) return toast(t('t.badImage'));
  const a = store.get('clatter.album') || {};
  const ent = a[e.key];
  if (!ent || !(ent.got[name] > 0)) return;
  ensureBase(ent, name);
  ent.cut[name] = (ent.cut[name] || 0) + 1;
  recount(ent, name);
  store.set('clatter.album', a);
  const fin = ['drop', 'drop', 'aurora', 'glitter'][it.r] || 'drop';
  const shape = subj ? 'cut' : e.kind === 'card' ? 'square' : 'circle';
  const c = bakeSticker(src, { shape, fin, size: 384, seed: name.length + 3 });
  const pk = await createPack({ kind: 'sheet', title: name, src: 'gacha' });
  await addToPack(pk.id, c, { name, fin, shape, key: e.key + '|' + name, from: titleOf(e) });
  closeSheet('sheet-card');
  if (app.dataset.mode === 'album') renderAlbum();
  toast(t('stk.toBookDone', { name }));
  openPack(pk.id);
}
let trade = null;

// ---------- 逛機台（使用者 2026-10-26：「追加用戶做好的機器的瀏覽頁面」，supabase/07_browse.sql） ----------
//   店家在開店頁的連結區勾「公開到逛機台」（要先有短連結）→ 送一份小摘要上去；逛機台頁列出大家公開的機台
//   摘要＝名稱、店名、種類、主題色、價錢、獎品數、機台封面（3D 機台正方形入鏡拍一張）、前 4 個獎品小圖
function machineShot() {
  if (!machine?.loaded || app.dataset.mode !== 'create') return null;
  const c = machine.snapshot(240);
  const u = c.toDataURL('image/webp', 0.75);
  return u.startsWith('data:image/webp') ? u : c.toDataURL('image/jpeg', 0.8);
}
async function listingMeta() {
  const th = [];
  for (let i = 0; i < Math.min(4, draft.items.length); i++) {
    const t0 = thumbOf(draft, i);
    if (!t0.bmp && t0.ready) await t0.ready;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const src = t0.bmp || placeholderThumb(draft.items[i].name, i);
    const s = Math.max(64 / src.width, 64 / src.height);
    g.drawImage(src, (64 - src.width * s) / 2, (64 - src.height * s) / 2, src.width * s, src.height * s);
    th.push(c.toDataURL('image/webp', 0.7));
  }
  const meta = { n: draft.name || '', s: draft.shop || '', k: draft.kind === 'card' ? 'card' : 'capsule', th: draft.theme, p: [draft.price.coins, draft.price.unit, draft.price.cur], i: draft.items.length, t: th };
  if (!draft.cover) {
    const shot = machineShot();
    if (shot) draft.listedCover = shot; // 不在開店頁拍不到 → 用上次的
  }
  const cover = draft.cover || draft.listedCover;
  if (cover) meta.c = cover;
  return meta;
}
// 公開中 → 摘要（含封面）馬上更新
function pushListing() {
  const c = draft.cloud;
  if (!c || !draft.listed || !cloudReady()) return;
  listingMeta()
    .then((meta) => {
      saveDraft();
      return setListed(c, true, meta);
    })
    .catch(() => {});
}

// ---------- 逛機台的封面（使用者 2026-10-26：「公開的機器的圖片可以自己設置」） ----------
//   draft.cover＝店家自己的圖（320 px 正方形，裁切對話框做的）；沒有就用 3D 機台拍的（draft.listedCover，每次同步重拍）
function renderCover() {
  const show = !$('list-wrap').hidden;
  $('cover-wrap').hidden = !show;
  if (!show) return;
  if (!draft.cover && !draft.listedCover) {
    const shot = machineShot();
    if (shot) {
      draft.listedCover = shot;
      saveDraft();
    }
  }
  const u = draft.cover || draft.listedCover;
  if (u) $('cover-img').src = u;
  else $('cover-img').removeAttribute('src');
  $('cover-state').textContent = t(draft.cover ? 'cover.custom' : 'cover.auto');
  $('cover-3d').hidden = !draft.cover;
}
// ---------- 裁切對話框（逛機台封面、獎品照片共用） ----------
//   使用者 2026-10-26：「增加上傳扭蛋圖片時的裁剪功能」→ 獎品照片上傳時先裁（轉蛋機正方形、轉卡機直的卡片比例）
//   openCrop({ bmp, out: [寬, 高], title }) → 裁好的 canvas（輸出大小）；取消＝null
//   預覽畫布：比例跟輸出一樣、長邊 480 px；cv.x／y＝圖的左上角在預覽畫布上的位置
const cv = { bmp: null, zoom: 1, x: 0, y: 0, W: 480, H: 480, out: [320, 320], done: null };
const cvScale = () => Math.max(cv.W / cv.bmp.width, cv.H / cv.bmp.height) * cv.zoom;
function drawCrop() {
  const s = cvScale();
  const w = cv.bmp.width * s;
  const h = cv.bmp.height * s;
  cv.x = Math.min(0, Math.max(cv.W - w, cv.x)); // 不留空白
  cv.y = Math.min(0, Math.max(cv.H - h, cv.y));
  const g = $('cv-canvas').getContext('2d');
  g.clearRect(0, 0, cv.W, cv.H);
  g.drawImage(cv.bmp, cv.x, cv.y, w, h);
}
// 放大縮小時畫面正中間那一點不動
function zoomCrop(z) {
  const s0 = cvScale();
  const cx = (cv.W / 2 - cv.x) / s0;
  const cy = (cv.H / 2 - cv.y) / s0;
  cv.zoom = Math.min(4, Math.max(1, z));
  const s1 = cvScale();
  cv.x = cv.W / 2 - cx * s1;
  cv.y = cv.H / 2 - cy * s1;
  $('cv-zoom').value = cv.zoom;
  drawCrop();
}
function openCrop({ bmp, out, title }) {
  cv.done?.(null); // 上一個還開著 → 當作取消
  const k = 480 / Math.max(out[0], out[1]);
  Object.assign(cv, { bmp, out, zoom: 1, W: Math.round(out[0] * k), H: Math.round(out[1] * k) });
  const c = $('cv-canvas');
  c.width = cv.W;
  c.height = cv.H;
  // 舞台：正方形最寬 320 px；直的卡片高度最多 380 px
  c.parentElement.style.aspectRatio = `${cv.W} / ${cv.H}`;
  c.parentElement.style.width = `min(100%, ${Math.round(Math.min(320, (380 * cv.W) / cv.H))}px)`;
  const s = cvScale();
  cv.x = (cv.W - bmp.width * s) / 2;
  cv.y = (cv.H - bmp.height * s) / 2;
  $('cv-zoom').value = 1;
  $('cv-title').textContent = title;
  drawCrop();
  openSheet('sheet-cover', $('cv-ok'));
  return new Promise((res) => {
    cv.done = (r) => {
      cv.done = null;
      res(r);
    };
  });
}
// 同樣的取景畫到輸出大小（從原圖直接縮，不經過預覽畫布）
function cropCanvas() {
  const [ow, oh] = cv.out;
  const k = ow / cv.W;
  const c = document.createElement('canvas');
  c.width = ow;
  c.height = oh;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const s = cvScale() * k;
  g.drawImage(cv.bmp, cv.x * k, cv.y * k, cv.bmp.width * s, cv.bmp.height * s);
  return c;
}
// 逛機台的封面：webp 壓到 55 KB 以下（逛機台只收 60 KB 以內的圖）；不支援 webp 的瀏覽器用 jpeg
function coverUrl(c) {
  let u = '';
  out: for (const type of ['image/webp', 'image/jpeg'])
    for (const q of [0.85, 0.75, 0.62, 0.5, 0.4]) {
      const v = c.toDataURL(type, q);
      if (!v.startsWith('data:' + type)) continue out;
      u = v;
      if (v.length < 55000) break out;
    }
  return u && u.length < 60000 ? u : null;
}
function bindCover() {
  $('cover-pick').onclick = () => {
    $('file-cover').value = '';
    $('file-cover').click();
  };
  $('file-cover').addEventListener('change', async () => {
    const f = $('file-cover').files[0];
    if (!f) return;
    let bmp;
    try {
      bmp = await createImageBitmap(f);
    } catch (e) {
      return toast(t('t.badImage'));
    }
    const c = await openCrop({ bmp, out: [320, 320], title: t('cover.title') });
    if (!c) return;
    const u = coverUrl(c);
    if (!u) return toast(t('t.badImage'));
    draft.cover = u;
    saveDraft();
    renderCover();
    pushListing();
    toast(t('cover.saved'));
  });
  $('cover-3d').onclick = () => {
    draft.cover = null;
    draft.listedCover = machineShot() || draft.listedCover;
    saveDraft();
    renderCover();
    pushListing();
    toast(t('cover.saved'));
  };
  const cvs = $('cv-canvas');
  let drag = null;
  cvs.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    cvs.setPointerCapture(e.pointerId);
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || !cv.bmp) return;
    const k = cv.W / cvs.clientWidth;
    cv.x += (e.clientX - drag.x) * k;
    cv.y += (e.clientY - drag.y) * k;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drawCrop();
  });
  const end = () => (drag = null);
  cvs.addEventListener('pointerup', end);
  cvs.addEventListener('pointercancel', end);
  cvs.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (cv.bmp) zoomCrop(cv.zoom * Math.exp(-e.deltaY / 500));
    },
    { passive: false },
  );
  $('cv-zoom').addEventListener('input', () => cv.bmp && zoomCrop(+$('cv-zoom').value));
  $('cv-ok').onclick = () => {
    cv.done?.(cropCanvas());
    closeSheet('sheet-cover');
  };
}
async function toggleListed(on) {
  const c = draft.cloud;
  if (!c) return;
  $('list-on').disabled = true;
  try {
    const meta = on ? await listingMeta() : null;
    await setListed(c, on, meta);
    draft.listed = on;
    saveDraft();
    toast(t(on ? 'browse.on' : 'browse.off'));
  } catch (e) {
    $('list-on').checked = !!draft.listed;
    toast(t(e.message));
  } finally {
    $('list-on').disabled = false;
  }
}

const browse = { sort: 'new', items: [], done: false, loading: false };
function renderBrowse(load = true) {
  const sort = $('browse-sort');
  if (!sort.childElementCount)
    for (const k of ['new', 'hot']) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.setAttribute('role', 'tab');
      b.dataset.k = k;
      b.onclick = () => {
        browse.sort = k;
        loadBrowse(true);
      };
      sort.append(b);
    }
  for (const b of sort.children) {
    b.textContent = t('browse.' + b.dataset.k);
    b.setAttribute('aria-selected', String(b.dataset.k === browse.sort));
  }
  $('browse-q').placeholder = t('browse.search');
  if (load) loadBrowse(true);
  else drawBrowse();
}
async function loadBrowse(reset) {
  if (browse.loading) return;
  if (!cloudReady()) {
    $('browse-empty').hidden = false;
    $('browse-empty').textContent = t('browse.offline');
    return;
  }
  browse.loading = true;
  if (reset) {
    browse.items = [];
    browse.done = false;
    for (const b of $('browse-sort').children) b.setAttribute('aria-selected', String(b.dataset.k === browse.sort));
  }
  try {
    const rows = await browseMachines(browse.sort, browse.items.length);
    browse.items.push(...(Array.isArray(rows) ? rows : []));
    browse.done = !Array.isArray(rows) || rows.length < 24;
    drawBrowse();
  } catch (e) {
    $('browse-empty').hidden = false;
    $('browse-empty').textContent = t('browse.offline');
  } finally {
    browse.loading = false;
  }
}
// 別人的摘要：字截長度、圖只收 data:image 的 base64
const okImg = (u) => (typeof u === 'string' && u.length < 60000 && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : null);
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
function drawBrowse() {
  const grid = $('browse-grid');
  grid.textContent = '';
  const q = $('browse-q').value.trim().toLowerCase();
  const list = browse.items.filter((r) => r && /^[0-9A-Za-z]{10}$/.test(r.id) && r.meta && (!q || (str(r.meta.n, 40) + ' ' + str(r.meta.s, 40)).toLowerCase().includes(q)));
  $('browse-empty').hidden = list.length > 0;
  $('browse-empty').textContent = t(q ? 'browse.noMatch' : 'browse.empty');
  $('browse-more').hidden = browse.done || !!q;
  for (const r of list) {
    const m = r.meta;
    const kind = m.k === 'card' ? 'card' : 'capsule';
    const art = document.createElement('article');
    art.className = 'bcard card-box';
    const cover = document.createElement('div');
    cover.className = 'bcard-cover';
    cover.style.setProperty('--c', (THEMES[m.th] || THEMES.red).body);
    const c = okImg(m.c);
    if (c) {
      const img = document.createElement('img');
      img.src = c;
      img.alt = '';
      img.loading = 'lazy';
      cover.append(img);
    }
    const kd = document.createElement('span');
    kd.className = 'bcard-kind';
    kd.textContent = t('kind.' + kind);
    const p = Array.isArray(m.p) ? m.p : [];
    const price = { coins: Math.max(1, Math.min(20, p[0] | 0)), unit: Number.isFinite(p[1]) ? p[1] : 0, cur: CURRENCIES.includes(p[2]) ? p[2] : 'NT$' };
    const pr = document.createElement('span');
    pr.className = 'bcard-price';
    pr.textContent = priceText(price);
    cover.append(kd, pr);
    const body = document.createElement('div');
    body.className = 'bcard-body';
    const h = document.createElement('h3');
    h.textContent = str(m.n, 40) || t('defaultMachine');
    body.append(h);
    if (m.s) {
      const sh = document.createElement('small');
      sh.textContent = str(m.s, 40);
      body.append(sh);
    }
    const prizes = document.createElement('div');
    prizes.className = 'bcard-prizes';
    for (const u of (Array.isArray(m.t) ? m.t : []).slice(0, 4)) {
      const sp = document.createElement('span');
      if (okImg(u)) sp.style.backgroundImage = `url("${okImg(u)}")`;
      prizes.append(sp);
    }
    const meta = document.createElement('div');
    meta.className = 'bcard-meta';
    const left = Math.max(0, (r.total | 0) - (r.pulls | 0));
    for (const txt of [t('browse.kinds', { n: Math.max(0, m.i | 0) }), t('browse.pulls', { n: r.pulls | 0 }), t('browse.left', { n: left })]) {
      const sp = document.createElement('span');
      sp.textContent = txt;
      meta.append(sp);
    }
    const go = document.createElement('button');
    go.className = 'btn primary';
    go.textContent = t('browse.play');
    go.onclick = () => {
      // 跟打開分享連結一樣：網址換成這台（重新整理、切回「轉轉看」都還是這台）
      history.replaceState(null, '', location.pathname + location.search + '#s.' + r.id);
      setMode('play');
      enterPlay('s.' + r.id);
    };
    body.append(prizes, meta, go);
    art.append(cover, body);
    grid.append(art);
  }
}

// 頂列放不下 → 有圖示的分頁（逛機台、我的商店、收集簿）只留圖示；換語言、裝 App 按鈕出現、視窗變寬窄都會重量
function fitBar() {
  const bar = document.querySelector('.bar');
  const fit = () => {
    bar.classList.remove('tight');
    if (bar.scrollWidth > bar.clientWidth + 1) bar.classList.add('tight');
  };
  const ro = new ResizeObserver(fit);
  ro.observe(bar);
  for (const el of bar.children) ro.observe(el);
  fit();
}

// 可以安裝的網路 App（PWA，使用者 2026-10-26：「追加成可以下載的網路app」）
//   發佈的網站（GitHub Pages）跟本機預覽才有 manifest：註冊 sw.js（離線也能開）、出現「下載 App」
//   Chrome／Edge／Android：用瀏覽器的安裝提示；iPhone／iPad 的 Safari 沒有 → 打開教學；已經裝好（獨立視窗）就不顯示
function setupPwa() {
  if (!document.querySelector('link[rel="manifest"]') || window.top !== window) return; // claude.ai artifact 裡不行
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const b = $('btn-install');
  b.setAttribute('aria-label', t('pwa.install')); // 窄的畫面只有圖示
  let prompt = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    b.hidden = installed();
  });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) b.hidden = installed();
  b.onclick = async () => {
    if (!prompt) return openSheet('sheet-install');
    prompt.prompt();
    const r = await prompt.userChoice.catch(() => null);
    prompt = null;
    if (r?.outcome === 'accepted') b.hidden = true;
  };
  addEventListener('appinstalled', () => {
    b.hidden = true;
    toast(t('pwa.installed'));
  });
}
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
  if (app.dataset.mode === 'browse') renderBrowse(false);
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
  $('tab-browse').onclick = () => setMode('browse');
  $('list-on').onchange = () => toggleListed($('list-on').checked);
  $('browse-q').oninput = () => drawBrowse();
  $('browse-more').onclick = () => loadBrowse(false);
  $('shop-new').onclick = newMachine;
  $('open-studio').onclick = () => openStudio();
  $('shop-studio').onclick = () => openStudio();
  $('tab-studio').onclick = () => setMode('studio');
  $('tab-stickers').onclick = () => setMode('stickers');
  $('pick-work').onclick = () => openWorkPicker();
  $('wp-make').onclick = () => {
    closeSheet('sheet-workpick');
    openStudio();
  };
  $('pick-stk').onclick = () => openStickerPicker(stickerToGacha, t('stk.pickPrizeTitle'));
  $('mach-sel').onchange = () => switchMachine($('mach-sel').value);
  $('mach-new').onclick = newMachine;
  $('mach-dup').onclick = () => dupMachine(shop.cur);
  bindCover();
  bindMaker();
  bindMachineStickers();
  // 收集簿的大卡、結果卡：3D 閃卡（滑鼠移動／手機傾斜 → 跟著斜，holo.js）
  viewHolo = new Holo($('v-tilt'), $('sheet-card'));
  albumEdit = new AlbumEdit({ store, toast, openSheet, closeSheet, changed: () => renderAlbum() });
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
  bootCardTheme();
  setupPwa();
  fitBar();
  resHolo = new Holo($('r-tilt'), $('result-card'));
  // 從連結進來的玩家 → 回到那台機器；賣家 → 用目前的表單內容試玩
  $('tab-play').onclick = () => {
    unlock();
    const h = location.hash.slice(1);
    enterPlay(isMachineHash(h) ? h : 'draft');
  };
  bindSound();
  // 按鈕、分頁、勾選的小聲音（sfx.js 裡很小聲）
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest?.('button, input[type="checkbox"]');
      if (!el || el.disabled || el.id === 'btn-sound') return;
      if (el.matches('input[type="checkbox"]')) sfx.toggle(el.checked);
      else if (el.closest('.modes')) sfx.tab();
      else sfx.tap();
    },
    true,
  );
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
    // 開店頁：按到機台上的貼紙 → 選它（大小、角度滑桿調這張）；拖 → 沿著表面移動
    stickerEdit: () => app.dataset.mode === 'create',
    onStickerPick: (si) => {
      if (app.dataset.mode !== 'create') return;
      mstkSel = si;
      renderMachineStickers();
    },
    onStickerMove: (si, at) => {
      const x = draft.stickers?.[si];
      if (!x || app.dataset.mode !== 'create') return;
      Object.assign(x, at);
      stkLive();
    },
    onStickerDrop: () => {
      sfx.stick();
      draftChanged();
    },
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
  // 一打開就是「逛機台」（使用者 2026-10-28：「把逛商店放在一開始第一頁」）；轉蛋連結、邀請連結照舊，#album／#shop／#create／#studio 直接到那一頁
  const h = location.hash.slice(1);
  if (h.startsWith('f.')) openInvite(h.slice(2));
  else if (isMachineHash(h)) await enterPlay(h);
  else if (['album', 'shop', 'create', 'studio', 'stickers'].includes(h)) setMode(h);
  else setMode('browse');
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
