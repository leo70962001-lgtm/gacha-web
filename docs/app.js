// Clatter 轉蛋鋪：開店設定 → 產生連結 → 玩家投幣、轉把手、開扭蛋
import { Machine, THEMES } from './machine.js';
import { unlock, setMuted, sfx } from './sfx.js';
import { encodeConfig, decodeConfig, shortId, CURRENCIES, THEME_KEYS, LIMITS } from './codec.js';
import { RARITY, placeholderThumb, priceText, fontsReady } from './decor.js';

// 公開網址（GitHub Pages）：在 claude.ai artifact（iframe）裡看不到外層網址，
// 而且 artifact 要登入才能看 → 分享連結一律指向這裡，任何人都打得開
const PUBLIC_URL = 'https://leo70962001-lgtm.github.io/gacha-web/';

const $ = (id) => document.getElementById(id);
const app = $('app');
const THEME_NAMES = { red: '經典紅', white: '白', yellow: '黃', blue: '藍', mint: '薄荷', pink: '粉紅', black: '黑' };

// 範例機台（第一次打開時的樣子；標明是範例）
const SAMPLE = () => ({
  name: '手作小物轉蛋',
  shop: '範例小舖',
  theme: 'red',
  price: { coins: 5, unit: 10, cur: 'NT$' },
  items: [
    { name: '貓咪鑰匙圈', rarity: 1, qty: 8, img: null },
    { name: '限定貼紙組', rarity: 0, qty: 12, img: null },
    { name: '壓克力小立牌', rarity: 0, qty: 9, img: null },
    { name: '刺繡徽章', rarity: 2, qty: 3, img: null },
    { name: '簽名明信片', rarity: 3, qty: 1, img: null },
  ],
});

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
    let t = thumbCache.get(it.img);
    if (!t) {
      const blob = new Blob([it.img.bytes], { type: it.img.mime });
      t = { url: URL.createObjectURL(blob), bmp: null };
      createImageBitmap(blob)
        .then((b) => {
          t.bmp = b;
          scheduleDecor();
        })
        .catch(() => {});
      thumbCache.set(it.img, t);
    }
    return t;
  }
  const key = `${i}|${it.name}`;
  let t = placeholderCache.get(key);
  if (!t) {
    const c = placeholderThumb(it.name, i);
    t = { url: c.toDataURL(), bmp: c };
    placeholderCache.set(key, t);
  }
  return t;
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
    name: String(it.name || '獎品').slice(0, LIMITS.name),
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
    th.setAttribute('aria-label', `換「${it.name}」的照片`);
    const img = document.createElement('img');
    img.alt = '';
    img.src = thumbOf(draft, i).url;
    th.append(img);
    const name = document.createElement('input');
    name.className = 'name';
    name.value = it.name;
    name.maxLength = LIMITS.name;
    name.setAttribute('aria-label', '獎品名稱');
    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.textContent = '✕';
    del.setAttribute('aria-label', `刪除「${it.name}」`);
    del.disabled = draft.items.length <= 1;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const sel = document.createElement('select');
    sel.className = 'rarity';
    sel.setAttribute('aria-label', '稀有度');
    RARITY.forEach((r, k) => sel.append(new Option(`${r.key} ${r.label}`, k, false, k === it.rarity)));
    const qw = document.createElement('label');
    qw.className = 'qty-wrap';
    const qty = document.createElement('input');
    qty.className = 'qty';
    qty.type = 'number';
    qty.min = 1;
    qty.max = LIMITS.qty;
    qty.value = it.qty;
    qty.setAttribute('aria-label', '數量（顆）');
    qw.append(qty, '顆');
    const odds = document.createElement('span');
    odds.className = 'odds';
    odds.textContent = `機率 ${pct(it.qty / total)}`;
    meta.append(sel, qw, odds);
    li.append(th, name, del, meta);
    ul.append(li);
  });
  $('items-sum').textContent = `${draft.items.length} 種 · 共 ${total} 顆`;
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
  $('price-coins').textContent = `投 ${draft.price.coins} 枚`;
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
    $('items-sum').textContent = `${draft.items.length} 種 · 共 ${total} 顆`;
    document.querySelectorAll('.item').forEach((li) => {
      const it = draft.items[li.dataset.i];
      li.querySelector('.odds').textContent = `機率 ${pct(it.qty / total)}`;
    });
  }
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
    b.setAttribute('aria-label', THEME_NAMES[k]);
    b.style.setProperty('--c', THEMES[k].body);
    b.onclick = () => {
      draft.theme = k;
      for (const x of sw.children) x.setAttribute('aria-checked', String(x === b));
      draftChanged();
    };
    sw.append(b);
  }
  for (const c of CURRENCIES) $('cur').append(new Option(c, c));

  const items = $('items');
  items.addEventListener('input', (e) => {
    const li = e.target.closest('.item');
    if (!li) return;
    const it = draft.items[li.dataset.i];
    if (e.target.classList.contains('name')) it.name = e.target.value.slice(0, LIMITS.name) || '獎品';
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
      toast('這張圖讀不進來，換一張試試（JPG、PNG、WebP）');
    }
  });
  $('add-item').onclick = () => {
    if (draft.items.length >= LIMITS.items) return;
    draft.items.push({ name: `新獎品 ${draft.items.length + 1}`, rarity: 0, qty: 5, img: null });
    draftChanged(true);
    const last = items.lastElementChild?.querySelector('.name');
    last?.focus();
    last?.select();
  };
  $('coins').addEventListener('input', () => {
    draft.price.coins = Math.min(LIMITS.coins, Math.max(1, parseInt($('coins').value, 10) || 1));
    $('price-out').textContent = priceText(draft.price);
    $('price-coins').textContent = `投 ${draft.price.coins} 枚`;
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
    draft.name = $('m-name').value.slice(0, LIMITS.title) || '轉蛋機';
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
    meta.textContent = `連結長度 ${url.length.toLocaleString()} 字${imgs ? `（含 ${imgs} 張照片）` : ''}`;
    meta.classList.toggle('warn', url.length > 8000);
    if (url.length > 8000) meta.textContent += '：有點長，部分聊天軟體可能會截斷，可以少放幾張照片';
    $('link').scrollTop = 0;
  };
  $('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('link').value);
      toast('已複製連結');
    } catch (e) {
      $('link').focus();
      $('link').select();
      toast('已選取連結，按 Ctrl+C（手機長按）複製');
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
function showMachine(cfg, capsules) {
  shown = cfg;
  if (!machine?.loaded) return;
  machine.setTheme(cfg.theme);
  machine.setPile(capsules);
  scheduleDecor();
}
function scheduleDecor() {
  clearTimeout(decorTimer);
  decorTimer = setTimeout(() => {
    if (!machine?.loaded || !shown) return;
    const thumbs = shown.items.map((_, i) => {
      const t = thumbOf(shown, i);
      return t.bmp;
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
  coin: { no: 1, title: '投幣', btn: '投入 1 枚' },
  turn: { no: 2, title: '轉動把手', text: '抓住把手順時針轉一圈，或按「幫我轉」', btn: '幫我轉' },
  busy: { no: 2, title: '喀啦喀啦…', text: '扭蛋掉下來了', btn: null },
  take: { no: 3, title: '拿出扭蛋', text: '點出口的扭蛋把它拿出來', btn: '拿出來' },
  open: { no: 4, title: '打開扭蛋', text: '點一下扭蛋就會打開', btn: '打開！' },
  result: { no: 4, title: '開獎！', text: '', btn: null },
  soldout: { no: 1, title: '全部轉完了', text: '這台機器的扭蛋都被你轉光了。到「我的扭蛋」可以重新補貨（試玩）', btn: '我的扭蛋' },
};

function playKey() {
  return 'clatter.play.' + play.id;
}

async function enterPlay(token) {
  let cfg;
  try {
    cfg = token === 'draft' ? draft : await decodeConfig(token);
  } catch (e) {
    toast('這條連結打不開：' + e.message);
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
  $('p-shop').textContent = cfg.shop || '';
  $('p-shop').hidden = !cfg.shop;
  $('p-name').textContent = cfg.name;
  $('p-kinds').textContent = `全 ${cfg.items.length} 種`;
  $('p-price').textContent = priceText(cfg.price);
  $('p-coins').textContent = `投 ${cfg.price.coins} 枚`;
  showMachine(cfg, left());
  if (left() === 0) setPhase('soldout');
  else setPhase('coin');
  renderWallet();
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
  $('h-step').textContent = `STEP ${s.no} / 4`;
  $('h-title').textContent = s.title;
  const need = play.cfg.price.coins;
  let text = s.text;
  if (ph === 'coin') {
    text =
      play.coins + play.inserted < need
        ? `硬幣不夠了，按「＋5 枚」換試玩硬幣（不會收費）`
        : `把硬幣拖進右上方的投幣口，或直接點投幣口。還要 ${need - play.inserted} 枚`;
  }
  $('h-text').textContent = text;
  const b = $('h-btn');
  b.hidden = !s.btn;
  if (s.btn) b.textContent = s.btn;
  b.disabled = ph === 'coin' && play.coins <= 0;
  machine?.setSlotHint(ph === 'coin');
  machine?.setHandleEnabled(ph === 'turn');
  $('p-left').textContent = `剩 ${left()} / ${play.cfg.items.reduce((a, b) => a + b.qty, 0)} 顆`;
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
  const t = document.createElement('span');
  t.textContent = `已投 ${play.inserted} / ${need}`;
  pips.append(t);
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
  $('r-sub').textContent = `第 ${play.pulls} 轉 · 原始機率 ${pct(it.qty / total)} · 這個你有 ${play.got[idx]} 個`;
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
    else if (onStage) toast('丟進右上方的投幣口喔（有黃色光圈的地方）');
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
  $('l-meta').textContent = `一回 ${priceText(cfg.price)}（投 ${cfg.price.coins} 枚）· 機器裡原本有 ${total} 顆，現在剩 ${left()} 顆`;
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
    b.textContent = `剩 ${play.remaining[i]}/${it.qty}`;
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
    img.alt = n ? it.name : '還沒轉到';
    const nm = document.createElement('div');
    nm.textContent = n ? it.name : '？？？';
    const c = document.createElement('div');
    c.className = 'cnt';
    c.textContent = n ? `× ${n}` : RARITY[it.rarity].key;
    cell.append(img, nm, c);
    grid.append(cell);
  });
  $('c-meta').textContent = `收集 ${kinds} / ${cfg.items.length} 種 · 轉了 ${play.pulls} 次`;
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
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- 啟動 ----------
async function boot() {
  // 從連結進來的玩家：一開始就是玩家畫面，不會先閃過開店表單
  if (location.hash.startsWith('#g1')) app.dataset.mode = 'play';
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
    toast('換了 5 枚試玩硬幣');
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
    toast('補貨完成，扭蛋都回到機器裡了');
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
      if (play?.phase === 'coin') toast(`先投 ${play.cfg.price.coins} 枚硬幣，把手才轉得動`);
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
    $('loading-text').textContent = '機台模型載入失敗，請重新整理頁面';
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
    const t = location.hash.slice(1);
    if (t.startsWith('g1')) enterPlay(t);
  });
}

boot();
