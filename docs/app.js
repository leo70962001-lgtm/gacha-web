// Clatter 轉蛋鋪：開店設定 → 產生連結 → 玩家投幣、轉把手、開扭蛋
import { Machine, THEMES } from './machine.js';
import { unlock, setMuted, sfx } from './sfx.js';
import { encodeConfig, decodeConfig, shortId, CURRENCIES, THEME_KEYS, LIMITS } from './codec.js';
import { RARITY, placeholderThumb, priceText, fontsReady } from './decor.js';
import { t, lang, setLang, applyDom, LANGS } from './i18n.js';

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
  }));
  if (!THEME_KEYS.includes(d.theme)) d.theme = 'red';
  if (!d.price || !CURRENCIES.includes(d.price.cur)) d.price = { coins: 5, unit: 10, cur: 'NT$' };
  return d;
}
function saveDraft() {
  store.set('clatter.draft', {
    ...draft,
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
    li.append(th, name, del, meta);
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
    }
  });
  $('file').addEventListener('change', async () => {
    const f = $('file').files[0];
    if (!f || fileFor < 0) return;
    try {
      draft.items[fileFor].img = await shrinkImage(f);
      draftChanged(true);
    } catch (e) {
      toast(t('t.badImage'));
    }
  });
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
  store.set(playKey(), { remaining: play.remaining, got: play.got, coins: play.coins, pulls: play.pulls });
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
  $('h-text').textContent = text;
  const b = $('h-btn');
  b.hidden = !s.btn;
  if (s.btn) b.textContent = t(s.btn);
  b.disabled = ph === 'coin' && play.coins <= 0;
  machine?.setSlotHint(ph === 'coin');
  machine?.setHandleEnabled(ph === 'turn');
  $('p-left').textContent = t('left', { l: left(), t: play.cfg.items.reduce((a, b) => a + b.qty, 0) });
  $('got-count').textContent = Object.keys(play.got).length;
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
  if (play.inserted >= play.cfg.price.coins) setPhase('turn');
  else setPhase('coin');
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
  const idx = draw();
  play.pending = idx;
  play.remaining[idx]--;
  play.pulls++;
  savePlay();
  renderWallet();
  await machine.dispense(play.cfg.items[idx].rarity);
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
  if (it.rarity === 3 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const f = document.createElement('div');
    f.className = 'flash';
    document.body.append(f);
    setTimeout(() => f.remove(), 800);
  }
  sfx.reveal(it.rarity);
  const first = !play.got[idx];
  play.got[idx] = (play.got[idx] || 0) + 1;
  savePlay();
  showResult(idx, first);
  setPhase('result');
}

function showResult(idx, first) {
  const it = play.cfg.items[idx];
  const r = RARITY[it.rarity];
  const card = $('result-card');
  card.className = `sheet-card result r${it.rarity}`;
  card.style.setProperty('--rc', `var(--r-${r.key.toLowerCase()})`);
  $('r-rank').textContent = `${r.key} ${r.label}`;
  $('r-img').src = thumbOf(play.cfg, idx).url;
  $('r-name').textContent = it.name;
  $('r-new').hidden = !first;
  const total = play.cfg.items.reduce((a, b) => a + b.qty, 0);
  $('r-sub').textContent = t('resultSub', { n: play.pulls, p: pct(it.qty / total), c: play.got[idx] });
  openSheet('sheet-result', $('r-again'));
}

function afterResult() {
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

// ---------- 對話框 ----------
let lastFocus = null;
function openSheet(id, focusEl) {
  lastFocus = document.activeElement;
  $(id).hidden = false;
  (focusEl || $(id).querySelector('button'))?.focus();
}
function closeSheet(id) {
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
    const cell = document.createElement('div');
    cell.className = 'cell' + (n ? '' : ' miss');
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
    enterPlay(h.startsWith('g1') ? h : linkToken || 'draft');
  };
  $('btn-sound').onclick = () => {
    const on = $('btn-sound').getAttribute('aria-pressed') !== 'true';
    $('btn-sound').setAttribute('aria-pressed', String(on));
    setMuted(!on);
    if (on) unlock();
  };
  $('h-btn').onclick = hintAction;
  $('btn-topup').onclick = () => {
    play.coins += 5;
    savePlay();
    setPhase(play.phase);
    toast(t('t.topup'));
  };
  $('btn-lineup').onclick = openLineup;
  $('p-odds').onclick = openLineup;
  $('btn-collection').onclick = openCollection;
  $('r-again').onclick = afterResult;
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
      if (e.target === s) s.id === 'sheet-result' ? afterResult() : closeSheet(s.id);
    }),
  );
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.sheet')].find((s) => !s.hidden);
    if (open) open.id === 'sheet-result' ? afterResult() : closeSheet(open.id);
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
  });
  window.__gacha = { machine, get play() { return play; }, get draft() { return draft; } }; // 除錯用
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
