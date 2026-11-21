// 社群（使用者 2026-11-21：「參考網路上有的增加整體用戶跟製作跟交流跟互動感」，supabase/10_social.sql）
//   參考：寶可夢 TCG Pocket（展示櫃、按讚送店主、好友）、Super Mario Maker 2（創作者頁、讚、留言＋スタンプ、排行）、
//         ガチャメーカー（新作／排行）、創作平台的每週主題、每日任務＋連續登入
//   用戶：個人頁（#u.<好友碼>：暱稱、頭像、一句話、3 張展示卡、徽章、公開的機台、貼文）＋追蹤
//   製作：每週主題（開店第 5 步參加，逛機台有專區）、別人的機台「用這台的外觀開一台」（app.js remixFrom）
//   交流：機台留言板（文字／スタンプ；スタンプ會飛過機台）、廣場（抽到的卡、做好的卡貼出來，大家按讚丟スタンプ）
//   互動：讚（第一次讚送店主幾枚）、大家正在轉（逛機台的跑馬燈、機台上的泡泡）、每日任務、通知
//   身分＝錢包（好友碼＝錢包 id）；app.js 傳 ctx 進來（錢包、對話框、去玩某台…）
import { t, lang, addStrings } from './i18n.js';
import { srpc, cloudReady } from './cloud.js';
import { copyText } from './copy.js';

// ---------- スタンプ（Gemini 手繪，tools/cut_stamps.py → assets/stamps/s0–s11.webp） ----------
export const STAMP_N = 12;
const STAMP_EMOJI = ['😍', '🤩', '😂', '😭', '👏', '🙏', '🎉', '🔥', '💖', '✨', '😮', '💤'];
export function stampEl(i, cls = 'stamp-img') {
  const k = Math.max(0, Math.min(STAMP_N - 1, i | 0));
  const img = document.createElement('img');
  img.className = cls;
  img.alt = t('soc.st' + k);
  img.draggable = false;
  img.src = `assets/stamps/s${k}.webp`;
  img.onerror = () => {
    const sp = document.createElement('span');
    sp.className = cls + ' emo';
    sp.textContent = STAMP_EMOJI[k];
    sp.setAttribute('role', 'img');
    sp.setAttribute('aria-label', img.alt);
    img.replaceWith(sp);
  };
  return img;
}

// ---------- 每週主題 ----------
// 第 0 週＝2026-11-16（週一，UTC）；key＝'t' + 週數（公開摘要 meta.w、貼文 theme）
const EPOCH = Date.UTC(2026, 10, 16);
const WEEK = 7 * 864e5;
const WEEKLY = [
  { e: '🐾', zh: '我的寵物', ja: 'うちの子', en: 'My pet' },
  { e: '🍁', zh: '秋天的味道', ja: '秋の味覚', en: 'Taste of autumn' },
  { e: '🧣', zh: '暖呼呼的冬天', ja: 'ぬくぬく冬', en: 'Cozy winter' },
  { e: '🍰', zh: '甜點時間', ja: 'スイーツタイム', en: 'Sweets time' },
  { e: '🌙', zh: '夜晚與星空', ja: '夜と星空', en: 'Night & stars' },
  { e: '🎁', zh: '禮物與節日', ja: 'プレゼントとお祝い', en: 'Gifts & holidays' },
  { e: '🎍', zh: '新年好運', ja: '新年の開運', en: 'New-year luck' },
  { e: '🏙', zh: '我住的城市', ja: 'わたしの街', en: 'My town' },
  { e: '🍜', zh: '美食圖鑑', ja: 'ごはん図鑑', en: 'Food guide' },
  { e: '💫', zh: '我的推', ja: '推し', en: 'My favourite' },
  { e: '🐉', zh: '怪獸與奇幻', ja: 'モンスターとファンタジー', en: 'Monsters & fantasy' },
  { e: '🎨', zh: '一個顏色', ja: 'ひとつの色', en: 'One colour' },
];
export const weekNo = (now = Date.now()) => Math.max(0, Math.floor((now - EPOCH) / WEEK));
export const themeKey = (n = weekNo()) => 't' + n;
export const themeOf = (n = weekNo()) => WEEKLY[((n % WEEKLY.length) + WEEKLY.length) % WEEKLY.length];
export const themeName = (n = weekNo()) => {
  const th = themeOf(n);
  return `${th.e} ${th[lang] || th.zh}`;
};
const themeDaysLeft = () => Math.max(1, Math.ceil((EPOCH + (weekNo() + 1) * WEEK - Date.now()) / 864e5));

// ---------- 徽章 ----------
// 這台裝置算的（收集、開店）＋伺服器數字算的（被轉、讚、追蹤者、貼文）
const BADGES = {
  first: '🎈', ssr: '🌈', col10: '📒', col50: '🏆', shop: '🏪', shop3: '🎪',
  sold10: '💰', sold100: '💎', liked10: '💖', fans5: '🌟', post: '📮', streak7: '🔥',
};
function serverBadges(p) {
  const b = [];
  if (p.sold >= 10) b.push('sold10');
  if (p.sold >= 100) b.push('sold100');
  if (p.likes >= 10) b.push('liked10');
  if (p.followers >= 5) b.push('fans5');
  if (p.posts_n >= 1) b.push('post');
  return b;
}

// ---------- 小工具 ----------
const $ = (id) => document.getElementById(id);
const isId = (s) => /^[0-9A-Za-z]{10}$/.test(s || '');
export const okImg = (u, max = 60000) => (typeof u === 'string' && u.length < max && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : null);
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
const RAR = ['N', 'R', 'SR', 'SSR'];
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, onclick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onclick) b.onclick = onclick;
  return b;
}
export function ago(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === 'zh' ? 'zh-TW' : lang, { numeric: 'auto', style: 'short' });
  if (!Number.isFinite(s)) return '';
  if (s < 50) return t('soc.now'); // 伺服器時鐘快一點（負的）也算剛剛
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), 'day');
  return new Date(ts).toLocaleDateString();
}
const fmtN = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n | 0));
const nameOf = (nm, w) => str(nm, 24) || t('soc.player', { c: String(w || '').slice(0, 4) });
// 頭像：有圖用圖，沒有就用名字第一個字＋好友碼算的顏色
export function avatarEl(av, nm, w, size = 32) {
  const d = el('span', 'av');
  d.style.setProperty('--s', size + 'px');
  const img = okImg(av, 16000);
  if (img) {
    const i = document.createElement('img');
    i.src = img;
    i.alt = '';
    d.append(i);
  } else {
    let h = 0;
    for (const ch of String(w || nm || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    d.style.setProperty('--h', h);
    d.classList.add('ini');
    d.textContent = [...(str(nm, 24) || '?')][0];
  }
  return d;
}
// 圖 → 小的 data:image（貼文、頭像、展示卡）：長邊 max px，webp
export async function toDataImg(src, max = 360, q = 0.82, square = false) {
  const img = await new Promise((res, rej) => {
    if (src instanceof HTMLCanvasElement || src instanceof ImageBitmap || (src instanceof HTMLImageElement && src.complete && src.naturalWidth)) return res(src);
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  if (square) {
    const s = Math.min(w, h);
    c.width = c.height = Math.min(max, s);
    c.getContext('2d').drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, c.width, c.height);
  } else {
    const k = Math.min(1, max / Math.max(w, h));
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  }
  let u = c.toDataURL('image/webp', q);
  if (!u.startsWith('data:image/webp')) u = c.toDataURL('image/jpeg', q);
  return u;
}

export class Social {
  // ctx：wallet()（錢包 {id,key}，沒有就 null）、toast、openSheet、closeSheet、sfx、store、playMachine(id)、
  //      setMode(mode)、curMode()、browseCard(row)、album()、localStats()、setBalance(n)、shopTheme()（去開店第 5 步）、
  //      remix(cfg, src)、stageCfg()（現在機台的設定）、publicUrl
  constructor(ctx) {
    this.c = ctx;
    this.meCache = ctx.store.get('clatter.me') || null;
    this.unread = 0;
    this.claimable = 0;
    this.stage = null; // 機台畫面：{ mid, owner, lastC, lastA, timer }
    this.tick = { after: 0, items: [], i: 0, timer: 0, poll: 0 };
    this.sq = { sort: 'new', items: [], done: false, loading: false };
    this.profId = null;
    this.prevMode = 'browse';
  }

  async w() {
    if (!cloudReady()) return null;
    try {
      return await this.c.wallet();
    } catch (e) {
      return null;
    }
  }
  async call(name, body, needW = true) {
    const w = needW ? await this.w() : null;
    if (needW && !w) throw new Error('e.network');
    return srpc(name, needW ? { p_id: w.id, p_key: w.key, ...body } : body);
  }
  async viewer() {
    const w = await this.w();
    return w ? { p_viewer: w.id, p_vkey: w.key } : {};
  }
  err(e) {
    const m = e?.message || 'e.network';
    this.c.toast(t(m === 'e.notReady' ? 'soc.notReady' : m === 'e.tooMany' ? 'soc.tooMany' : m === 'e.gone' ? 'soc.gone' : m));
  }

  // ---------- 頂列：我的按鈕（頭像＋未讀） ----------
  mountHeader() {
    const b = $('btn-me');
    b.onclick = () => this.openMe();
    this.paintMe();
    const poll = () => !document.hidden && this.refreshBadge();
    setTimeout(poll, 1500);
    setInterval(poll, 60000);
    document.addEventListener('visibilitychange', poll);
  }
  paintMe() {
    const b = $('btn-me');
    const m = this.meCache;
    const w = this.c.store.get('clatter.wallet');
    b.querySelector('.av')?.remove();
    b.prepend(avatarEl(m?.avatar, m?.name || '🙂', w?.id, 28));
    const n = this.unread + this.claimable;
    const badge = $('me-badge');
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
  }
  async refreshBadge() {
    const w = await this.w();
    if (!w) return;
    try {
      const since = this.c.store.get('clatter.noticeSeen');
      const [nt, ms] = await Promise.all([this.call('notices', { p_since: since || null }), this.call('missions', { p_off: -new Date().getTimezoneOffset() })]);
      this.notices = nt;
      this.missions = ms;
      this.unread = nt?.unread | 0;
      this.claimable = (ms?.list || []).filter((x) => x.done && !x.claimed).length;
      this.paintMe();
      if (!$('sheet-me').hidden) this.drawMe();
    } catch (e) {
      /* 還沒裝伺服器（10_social.sql）或離線：先不顯示 */
    }
  }
  bump() {
    clearTimeout(this.bumpT);
    this.bumpT = setTimeout(() => this.refreshBadge(), 1200);
  }

  // ---------- 我的（通知／任務／追蹤中） ----------
  async openMe(tab) {
    this.meTab = tab || this.meTab || (this.claimable && !this.unread ? 'missions' : 'notices');
    this.seenAt = this.c.store.get('clatter.noticeSeen'); // 這次打開之前看到哪裡（新的那幾則標起來）
    this.drawMe();
    this.c.openSheet('sheet-me', $('sheet-me').querySelector('[data-close]'));
    const w = await this.w();
    if (!w) return;
    if (!this.meCache) this.loadMe().catch(() => {});
    await this.refreshBadge();
    if (this.meTab === 'following') this.loadFollowing();
  }
  async loadMe() {
    const w = await this.w();
    if (!w) return null;
    const p = await srpc('profile_get', { p_id: w.id, p_viewer: w.id, p_vkey: w.key });
    this.setMeCache(p);
    return p;
  }
  setMeCache(p) {
    if (!p) return;
    const { machines, posts, ...rest } = p;
    this.meCache = rest;
    this.c.store.set('clatter.me', rest);
    this.paintMe();
  }
  drawMe() {
    const root = $('me-body');
    root.textContent = '';
    const w = this.c.store.get('clatter.wallet');
    const m = this.meCache;
    // 上面：我是誰
    const head = el('div', 'me-head');
    const myAv = avatarEl(m?.avatar, m?.name || '🙂', w?.id, 56);
    myAv.setAttribute('role', 'button');
    myAv.tabIndex = 0;
    myAv.setAttribute('aria-label', t('soc.editProf'));
    myAv.onclick = () => this.openEdit();
    head.append(myAv);
    const who = el('div', 'me-who');
    who.append(el('b', '', m?.name || t('soc.noName')), el('small', '', w?.id ? t('soc.code', { c: w.id }) : ''));
    head.append(who);
    const acts = el('div', 'me-acts');
    acts.append(
      btn('btn', t('soc.editProf'), () => this.openEdit()),
      btn('btn ghost', t('soc.myPage'), () => {
        this.c.closeSheet('sheet-me');
        if (w?.id) this.openProfile(w.id);
      }),
    );
    head.append(acts);
    root.append(head);
    // 分頁
    const seg = el('div', 'seg me-seg');
    seg.setAttribute('role', 'tablist');
    for (const k of ['notices', 'missions', 'following']) {
      const b = btn('', t('soc.tab.' + k), () => {
        this.meTab = k;
        if (k === 'notices') this.markSeen();
        this.drawMe();
        if (k === 'following') this.loadFollowing();
      });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(this.meTab === k));
      const n = k === 'notices' ? this.unread : k === 'missions' ? this.claimable : 0;
      if (n) b.append(el('i', 'dot', String(n > 9 ? '9+' : n)));
      seg.append(b);
    }
    root.append(seg);
    const box = el('div', 'me-box');
    root.append(box);
    if (!cloudReady()) {
      box.append(el('p', 'soc-empty', t('browse.offline')));
      return;
    }
    if (this.meTab === 'notices') this.drawNotices(box);
    else if (this.meTab === 'missions') this.drawMissions(box);
    else this.drawFollowing(box);
  }
  markSeen() {
    const top = this.notices?.items?.[0]?.t;
    this.c.store.set('clatter.noticeSeen', top || new Date().toISOString());
    this.unread = 0;
    this.paintMe();
  }
  drawNotices(box) {
    const items = this.notices?.items;
    if (!items) return box.append(el('p', 'soc-empty', t('soc.loading')));
    if (!items.length) return box.append(el('p', 'soc-empty', t('soc.noNotices')));
    const seen = this.seenAt;
    const ul = el('ul', 'nt-list');
    for (const n of items) {
      const li = el('li', 'nt' + (!seen || n.t > seen ? ' new' : ''));
      li.append(avatarEl(n.av, n.nm, n.w, 36));
      const tx = el('div', 'nt-txt');
      const who = nameOf(n.nm, n.w);
      const mn = str(n.x, 40) || t('soc.yourMachine');
      const line = el('p');
      line.textContent =
        n.k === 'like' ? t('soc.n.like', { who, m: mn })
        : n.k === 'cmt' ? t('soc.n.cmt', { who, m: t('soc.yourMachine') })
        : n.k === 'fol' ? t('soc.n.fol', { who })
        : n.k === 'plike' ? t('soc.n.plike', { who, m: str(n.x, 40) || t('soc.yourPost') })
        : n.k === 'preact' ? t('soc.n.preact', { who, m: str(n.x, 40) || t('soc.yourPost') })
        : t('soc.n.buy', { who, m: mn, n: n.n | 0 });
      tx.append(line);
      if (n.k === 'cmt' && n.x) tx.append(el('q', '', str(n.x, 120)));
      tx.append(el('small', '', ago(n.t)));
      li.append(tx);
      if (n.s != null && (n.k === 'cmt' || n.k === 'preact')) li.append(stampEl(n.s, 'stamp-img sm'));
      li.tabIndex = 0;
      li.onclick = () => {
        this.c.closeSheet('sheet-me');
        if ((n.k === 'cmt' || n.k === 'like' || n.k === 'buy') && isId(n.m)) this.c.playMachine(n.m, n.k === 'cmt');
        else if (isId(n.w)) this.openProfile(n.w);
      };
      ul.append(li);
    }
    box.append(ul);
    if (this.unread) this.markSeen();
  }
  drawMissions(box) {
    const ms = this.missions;
    if (!ms) return box.append(el('p', 'soc-empty', t('soc.loading')));
    // 連續登入：7 格
    const st = el('div', 'streak card-box');
    const days = el('div', 'streak-days');
    const loginDone = ms.list.find((x) => x.k === 'login')?.claimed;
    const cur = ms.pos; // 今天是第幾格（1–7）
    for (let i = 1; i <= 7; i++) {
      const d = el('span', 'sd' + (i < cur || (i === cur && loginDone) ? ' got' : '') + (i === cur ? ' today' : ''));
      d.append(el('b', '', String(i)), el('small', '', i === 7 ? '60' : String(5 + i * 5)));
      days.append(d);
    }
    st.append(el('h3', '', t('soc.streak', { n: ms.streak | 0 })), days);
    box.append(st);
    const ul = el('ul', 'ms-list');
    for (const x of ms.list) {
      const li = el('li', 'ms' + (x.claimed ? ' claimed' : x.done ? ' ready' : ''));
      li.append(el('span', 'ms-ico', { login: '📅', pull: '🎰', like: '💖', talk: '💬', post: '📮', make: '🛠' }[x.k] || '⭐'));
      const tx = el('div', 'ms-txt');
      tx.append(el('b', '', t('soc.m.' + x.k)), el('small', '', t('soc.m.' + x.k + '.d')));
      li.append(tx);
      const coin = el('span', 'ms-coin', '+' + x.c);
      li.append(coin);
      const go = x.claimed
        ? el('span', 'ms-done', t('soc.claimed'))
        : x.done
          ? btn('btn primary ms-btn', t('soc.claim'), (e) => this.claim(x.k, e.currentTarget))
          : btn('btn ghost ms-btn', t('soc.go'), () => this.goMission(x.k));
      li.append(go);
      ul.append(li);
    }
    box.append(ul);
    box.append(el('p', 'mb-hint', t('soc.missionHint')));
  }
  async claim(k, b) {
    b.disabled = true;
    try {
      const r = await this.call('mission_claim', { p_off: -new Date().getTimezoneOffset(), p_k: k });
      this.missions = r.state;
      this.claimable = (r.state?.list || []).filter((x) => x.done && !x.claimed).length;
      if (r.got) {
        this.c.sfx.coin();
        this.c.toast(t('soc.got', { n: r.got }));
        this.c.setBalance(r.balance);
        this.coinBurst(b);
      }
      this.paintMe();
      this.drawMe();
    } catch (e) {
      b.disabled = false;
      this.err(e);
    }
  }
  coinBurst(from) {
    const r = from.getBoundingClientRect();
    for (let i = 0; i < 8; i++) {
      const c = el('i', 'coin-fly');
      c.style.left = r.left + r.width / 2 + 'px';
      c.style.top = r.top + r.height / 2 + 'px';
      c.style.setProperty('--dx', (Math.random() * 2 - 1) * 90 + 'px');
      c.style.setProperty('--dy', -40 - Math.random() * 90 + 'px');
      c.style.animationDelay = i * 30 + 'ms';
      document.body.append(c);
      setTimeout(() => c.remove(), 1100);
    }
  }
  goMission(k) {
    this.c.closeSheet('sheet-me');
    if (k === 'pull' || k === 'like' || k === 'talk') this.c.setMode('browse');
    else if (k === 'post') {
      this.c.setMode('browse');
      this.setView('square');
    } else if (k === 'make') this.c.setMode('create');
  }
  async loadFollowing() {
    try {
      this.following = await this.call('follow_list', {});
    } catch (e) {
      this.following = [];
    }
    if (this.meTab === 'following' && !$('sheet-me').hidden) this.drawMe();
  }
  drawFollowing(box) {
    const list = this.following;
    if (!list) return box.append(el('p', 'soc-empty', t('soc.loading')));
    if (!list.length) return box.append(el('p', 'soc-empty', t('soc.noFollowing')));
    const ul = el('ul', 'fl-list');
    for (const f of list) {
      const li = el('li', 'fl');
      li.append(avatarEl(f.av, f.nm, f.w, 36), el('b', '', nameOf(f.nm, f.w)));
      li.tabIndex = 0;
      li.onclick = () => {
        this.c.closeSheet('sheet-me');
        this.openProfile(f.w);
      };
      ul.append(li);
    }
    box.append(ul);
  }

  // ---------- 編輯個人頁 ----------
  async openEdit() {
    const m = this.meCache || (await this.loadMe().catch(() => null)) || {};
    this.ed = { name: m.name || '', bio: m.bio || '', avatar: m.avatar || null, showcase: Array.isArray(m.showcase) ? m.showcase.slice(0, 3) : [] };
    $('pe-name').value = this.ed.name;
    $('pe-bio').value = this.ed.bio;
    this.drawEdit();
    this.c.openSheet('sheet-prof', $('pe-name'));
  }
  // 收集簿裡有的（轉到過的）→ 頭像、展示卡的選項
  owned() {
    const a = this.c.album();
    const out = [];
    for (const [key, e] of Object.entries(a || {})) {
      if (e?.hidden) continue;
      for (const n of e.order || Object.keys(e.items || {})) {
        const it = e.items?.[n];
        if (!it?.t || !((e.got || {})[n] > 0)) continue;
        out.push({ key: key + '|' + n, n, r: it.r | 0, t: it.t, card: e.kind === 'card' });
      }
    }
    return out.sort((x, y) => y.r - x.r);
  }
  drawEdit() {
    const av = $('pe-av');
    av.textContent = '';
    const w = this.c.store.get('clatter.wallet');
    av.append(avatarEl(this.ed.avatar, $('pe-name').value || '🙂', w?.id, 64));
    const sc = $('pe-show');
    sc.textContent = '';
    for (let i = 0; i < 3; i++) {
      const s = this.ed.showcase[i];
      const b = btn('pe-slot' + (s ? ' has' : ''), s ? '' : '＋');
      if (s?.img) {
        const im = document.createElement('img');
        im.src = s.img;
        im.alt = s.n || '';
        b.append(im);
        b.dataset.r = RAR[s.r | 0];
      }
      b.setAttribute('aria-label', s ? t('soc.removeShow', { n: s.n || '' }) : t('soc.addShow'));
      b.onclick = () => {
        if (s) {
          this.ed.showcase.splice(i, 1);
          this.drawEdit();
        } else this.pickFor = 'show';
        this.drawPick();
      };
      sc.append(b);
    }
    this.drawPick();
  }
  drawPick() {
    const g = $('pe-pick');
    g.textContent = '';
    const list = this.owned();
    $('pe-pick-h').textContent = t(this.pickFor === 'show' ? 'soc.pickShow' : 'soc.pickAv');
    // 頭像：先放 12 個扭蛋寶寶（スタンプ同一套角色），再放收藏（使用者 2026-11-21：「自己的icon可以上傳或選擇自己喜歡的圖」）
    if (this.pickFor !== 'show') {
      for (let i = 0; i < STAMP_N; i++) {
        const b = btn('pe-item preset' + (this.ed.avatarPreset === i ? ' on' : ''));
        b.append(stampEl(i));
        b.title = t('soc.st' + i);
        b.onclick = async () => {
          const img = b.querySelector('img');
          const u = img?.naturalWidth ? await toDataImg(img, 128, 0.85, true).catch(() => null) : null;
          if (!u) return;
          this.ed.avatar = u;
          this.ed.avatarPreset = i;
          this.drawEdit();
        };
        g.append(b);
      }
      if (list.length) g.append(el('small', 'pe-sep', t('soc.fromCol')));
    }
    if (!list.length) {
      g.append(el('p', 'soc-empty', t('soc.noOwned')));
      return;
    }
    for (const it of list.slice(0, 60)) {
      const b = btn('pe-item r' + it.r);
      const im = document.createElement('img');
      im.src = it.t;
      im.alt = it.n;
      im.loading = 'lazy';
      b.append(im);
      b.title = it.n;
      b.onclick = async () => {
        if (this.pickFor === 'show') {
          if (this.ed.showcase.length >= 3) this.ed.showcase.shift();
          const img = await toDataImg(it.t, 240, 0.82).catch(() => null);
          if (img) this.ed.showcase.push({ img, n: it.n.slice(0, 24), r: it.r, c: it.card ? 1 : 0 });
          this.pickFor = 'av';
        } else {
          this.ed.avatar = await toDataImg(it.t, 96, 0.8, true).catch(() => this.ed.avatar);
          this.ed.avatarPreset = null;
        }
        this.drawEdit();
      };
      g.append(b);
    }
  }
  async saveEdit() {
    const name = $('pe-name').value.trim();
    if (!name) {
      $('pe-name').focus();
      return this.c.toast(t('soc.needName'));
    }
    const b = $('pe-save');
    b.disabled = true;
    try {
      const p = await this.call('profile_save', {
        p_name: name.slice(0, 24),
        p_bio: $('pe-bio').value.trim().slice(0, 80),
        p_avatar: this.ed.avatar,
        p_showcase: this.ed.showcase,
        p_badges: this.localBadges(),
      });
      this.setMeCache(p);
      this.c.store.set('clatter.tradeName', p.name); // 好友交換那邊的暱稱是同一個
      this.c.closeSheet('sheet-prof');
      this.c.toast(t('soc.saved'));
      if (!$('sheet-me').hidden) this.drawMe();
      if (this.profId === p.id && this.c.curMode() === 'profile') this.renderProfile(p);
    } catch (e) {
      this.err(e);
    } finally {
      b.disabled = false;
    }
  }
  localBadges() {
    const s = this.c.localStats();
    const b = [];
    if (s.owned >= 1) b.push('first');
    if (s.ssr >= 1) b.push('ssr');
    if (s.owned >= 10) b.push('col10');
    if (s.owned >= 50) b.push('col50');
    if (s.listed >= 1) b.push('shop');
    if (s.machines >= 3) b.push('shop3');
    if ((this.missions?.streak | 0) >= 7) b.push('streak7');
    return b;
  }

  // ---------- 個人頁（#u.<好友碼>） ----------
  async openProfile(id) {
    if (!isId(id)) return;
    const cur = this.c.curMode();
    if (cur !== 'profile') this.prevMode = cur;
    this.profId = id;
    history.replaceState(null, '', location.pathname + location.search + '#u.' + id);
    this.c.setMode('profile');
    const root = $('prof-root');
    root.textContent = '';
    root.append(el('p', 'soc-empty', t('soc.loading')));
    try {
      const p = await srpc('profile_get', { p_id: id, ...(await this.viewer()) });
      if (this.profId !== id) return;
      if (p.me) this.setMeCache(p);
      this.renderProfile(p);
    } catch (e) {
      root.textContent = '';
      root.append(el('p', 'soc-empty', t(e.message === 'e.gone' ? 'soc.noUser' : e.message === 'e.notReady' ? 'soc.notReady' : 'browse.offline')));
    }
  }
  backFromProfile() {
    const m = this.prevMode && this.prevMode !== 'profile' ? this.prevMode : 'browse';
    if (m === 'play') this.c.resume();
    else this.c.setMode(m);
  }
  renderProfile(p) {
    const root = $('prof-root');
    root.textContent = '';
    const top = el('div', 'prof-top');
    top.append(btn('chip chip-back', '‹ ' + t('back.to', { p: t(this.prevMode === 'play' ? 'tab.play' : 'tab.browse') }), () => this.backFromProfile()));
    root.append(top);
    // 名片
    const card = el('section', 'prof-card card-box');
    const hd = el('div', 'prof-hd');
    hd.append(avatarEl(p.avatar, p.name || '?', p.id, 84));
    const who = el('div', 'prof-who');
    const h1 = el('h1', '', nameOf(p.name, p.id));
    who.append(h1);
    if (p.bio) who.append(el('p', 'prof-bio', p.bio));
    const code = btn('prof-code', t('soc.code', { c: p.id }), async () => {
      const ok = await copyText(this.c.publicUrl() + '#u.' + p.id);
      this.c.toast(t(ok ? 'soc.linkCopied' : 'soc.copyFail'));
    });
    who.append(code);
    hd.append(who);
    card.append(hd);
    const stats = el('div', 'prof-stats');
    for (const [k, v] of [['followers', p.followers], ['following', p.following], ['sold', p.sold], ['likes', p.likes]]) {
      const s = el('div', 'ps');
      s.append(el('b', '', fmtN(v | 0)), el('small', '', t('soc.ps.' + k)));
      stats.append(s);
    }
    card.append(stats);
    const badges = [...new Set([...(Array.isArray(p.badges) ? p.badges : []), ...serverBadges(p)])].filter((b) => BADGES[b]);
    if (badges.length) {
      const bw = el('div', 'prof-badges');
      for (const b of badges) {
        const c = el('span', 'badge-chip');
        c.append(el('i', '', BADGES[b]), document.createTextNode(t('soc.b.' + b)));
        c.title = t('soc.b.' + b + '.d');
        bw.append(c);
      }
      card.append(bw);
    }
    const acts = el('div', 'prof-acts');
    if (p.me) acts.append(btn('btn primary', t('soc.editProf'), () => this.openEdit()), btn('btn', t('soc.missions'), () => this.openMe('missions')));
    else {
      const fb = btn('btn ' + (p.i_follow ? '' : 'primary'), t(p.i_follow ? 'soc.following' : 'soc.follow'));
      fb.setAttribute('aria-pressed', String(!!p.i_follow));
      fb.onclick = async () => {
        fb.disabled = true;
        try {
          const r = await this.call('follow_set', { p_to: p.id, p_on: !p.i_follow });
          p.i_follow = r.following;
          p.followers = r.followers;
          this.c.sfx.toggle(r.following);
          if (r.following) this.c.toast(t('soc.followed', { who: nameOf(p.name, p.id) }));
          this.renderProfile(p);
        } catch (e) {
          this.err(e);
          fb.disabled = false;
        }
      };
      acts.append(fb);
      acts.append(btn('btn ghost', t('soc.tradeWith'), () => this.c.invite(p.id)));
    }
    card.append(acts);
    root.append(card);
    // 展示櫃（TCG Pocket 的 showcase）
    const show = (Array.isArray(p.showcase) ? p.showcase : []).filter((s) => okImg(s?.img));
    if (show.length || p.me) {
      const sec = el('section', 'prof-sec');
      sec.append(el('h2', '', t('soc.showcase')));
      const row = el('div', 'showcase');
      for (const s of show) {
        const f = el('figure', 'show-card r' + (s.r | 0) + (s.c ? ' card' : ''));
        const im = document.createElement('img');
        im.src = okImg(s.img);
        im.alt = str(s.n, 24);
        f.append(im, el('figcaption', '', str(s.n, 24)));
        f.append(el('span', 'show-rar', RAR[s.r | 0] || 'N'));
        f.addEventListener('pointermove', (e) => {
          const r = f.getBoundingClientRect();
          f.style.setProperty('--rx', ((e.clientY - r.top) / r.height - 0.5) * -16 + 'deg');
          f.style.setProperty('--ry', ((e.clientX - r.left) / r.width - 0.5) * 16 + 'deg');
          f.style.setProperty('--gx', ((e.clientX - r.left) / r.width) * 100 + '%');
        });
        f.addEventListener('pointerleave', () => f.style.removeProperty('--rx'));
        row.append(f);
      }
      if (!show.length) row.append(el('p', 'soc-empty', t('soc.noShow')));
      sec.append(row);
      root.append(sec);
    }
    // 機台
    const ms = Array.isArray(p.machines) ? p.machines : [];
    const sec2 = el('section', 'prof-sec');
    sec2.append(el('h2', '', t('soc.machines', { n: ms.length })));
    if (ms.length) {
      const g = el('div', 'browse-grid');
      for (const r of ms) {
        const c = this.c.browseCard(r);
        if (c) g.append(c);
      }
      sec2.append(g);
    } else sec2.append(el('p', 'soc-empty', t(p.me ? 'soc.noMachinesMe' : 'soc.noMachines')));
    root.append(sec2);
    // 貼文
    const ps = Array.isArray(p.posts) ? p.posts : [];
    const sec3 = el('section', 'prof-sec');
    sec3.append(el('h2', '', t('soc.posts', { n: p.posts_n | 0 })));
    if (ps.length) {
      const g = el('div', 'sq-grid');
      for (const x of ps) g.append(this.postCard(x));
      sec3.append(g);
    } else sec3.append(el('p', 'soc-empty', t('soc.noPosts')));
    root.append(sec3);
  }

  // ---------- 逛機台：跑馬燈、主題、檢視切換（機台／廣場／排行） ----------
  renderBrowseTop() {
    this.drawTheme();
    const seg = $('browse-view');
    if (!seg.childElementCount)
      for (const k of ['machines', 'square', 'rank']) {
        const b = btn('', '', () => this.setView(k));
        b.dataset.k = k;
        b.setAttribute('role', 'tab');
        seg.append(b);
      }
    this.view = this.view || 'machines';
    for (const b of seg.children) {
      b.textContent = t('soc.v.' + b.dataset.k);
      b.setAttribute('aria-selected', String(b.dataset.k === this.view));
    }
    this.startTicker();
    this.showView();
  }
  setView(k) {
    this.view = k;
    for (const b of $('browse-view').children) b.setAttribute('aria-selected', String(b.dataset.k === k));
    this.showView(true);
  }
  showView(load) {
    $('browse-machines').hidden = this.view !== 'machines';
    $('browse-square').hidden = this.view !== 'square';
    $('browse-rank').hidden = this.view !== 'rank';
    if (this.view === 'square') this.renderSquare(load || !this.sq.items.length);
    if (this.view === 'rank') this.renderRank();
  }
  drawTheme() {
    const box = $('soc-theme');
    box.textContent = '';
    const n = weekNo();
    const th = themeOf(n);
    const left = el('div', 'th-l');
    left.append(el('span', 'th-emo', th.e));
    const tx = el('div', 'th-tx');
    tx.append(el('small', '', t('soc.weekly', { d: themeDaysLeft() })), el('b', '', th[lang] || th.zh));
    left.append(tx);
    const acts = el('div', 'th-acts');
    acts.append(
      btn('btn', t('soc.thSee'), () => this.c.browseSort('theme')),
      btn('btn primary', t('soc.thJoin'), () => this.c.shopTheme()),
    );
    box.append(left, acts);
    const last = el('div', 'th-last');
    box.append(last);
    // 上週的前 3 名（照讚數）
    const lk = themeKey(n - 1);
    if (n > 0 && cloudReady())
      srpc('browse2', { p_sort: 'theme', p_theme: lk, p_limit: 3 })
        .then((rows) => {
          if (!Array.isArray(rows) || !rows.length) return;
          last.append(el('small', '', t('soc.lastWeek', { t: themeName(n - 1) })));
          rows.forEach((r, i) => {
            const b = btn('th-win', '');
            b.append(el('i', '', ['🥇', '🥈', '🥉'][i]), document.createTextNode(str(r.meta?.n, 24) || t('defaultMachine')));
            b.onclick = () => this.c.playMachine(r.id);
            last.append(b);
          });
        })
        .catch(() => {});
  }
  // 大家正在轉：最近的轉蛋，一則一則換（SR／SSR 會亮）
  startTicker() {
    const box = $('soc-ticker');
    if (!cloudReady()) return (box.hidden = true);
    const poll = async () => {
      if (document.hidden || this.c.curMode() !== 'browse') return;
      try {
        const rows = await srpc('activity', { p_after: this.tick.after, p_limit: 20 });
        if (Array.isArray(rows) && rows.length) {
          this.tick.after = Math.max(this.tick.after, ...rows.map((r) => r.id | 0));
          this.tick.items = [...rows, ...this.tick.items].slice(0, 20); // 新的在前，下一則就換成最新的
          this.tick.i = 0;
          if (!box.childElementCount) this.tickShow();
        }
      } catch (e) {
        /* 伺服器還沒裝：不顯示 */
      }
    };
    if (!this.tick.poll) {
      this.tick.poll = setInterval(poll, 30000);
      this.tick.timer = setInterval(() => this.c.curMode() === 'browse' && !document.hidden && this.tickShow(), 4500);
      poll();
    }
  }
  tickShow() {
    const box = $('soc-ticker');
    const items = this.tick.items.filter((r) => Date.now() - new Date(r.t).getTime() < 3 * 864e5);
    box.hidden = !items.length;
    if (!items.length) return;
    const r = items[this.tick.i++ % items.length];
    const line = btn('tk-line' + (r.b >= 2 ? ' rare r' + r.b : ''));
    line.append(r.b >= 2 ? el('b', 'tk-rar r' + r.b, RAR[r.b]) : el('i', 'tk-dot'));
    const who = nameOf(r.nm, r.w);
    const m = str(r.mn, 30) || t('defaultMachine');
    line.append(el('span', 'tk-txt', r.b >= 2 ? t('soc.tk.rare', { who, m, r: RAR[r.b] }) : t('soc.tk.pull', { who, m, n: r.n | 0 })));
    line.append(el('small', '', ago(r.t)));
    line.onclick = () => this.c.playMachine(r.m);
    box.replaceChildren(el('span', 'tk-live', t('soc.live')), line);
  }

  // ---------- 廣場 ----------
  renderSquare(load) {
    const root = $('browse-square');
    if (!root.childElementCount) {
      const bar = el('div', 'sq-bar');
      const chips = el('div', 'chips');
      chips.id = 'sq-sort';
      chips.setAttribute('role', 'tablist');
      for (const k of ['new', 'hot', 'follow', 'theme']) {
        const b = btn('chip', '', () => {
          this.sq.sort = k;
          this.renderSquare(true);
        });
        b.dataset.k = k;
        b.setAttribute('role', 'tab');
        chips.append(b);
      }
      const add = btn('btn primary sq-add', '', () => this.openPicker());
      add.id = 'sq-add';
      bar.append(chips, add);
      const grid = el('div', 'sq-grid');
      grid.id = 'sq-grid';
      const empty = el('p', 'album-empty card-box');
      empty.id = 'sq-empty';
      empty.hidden = true;
      const more = btn('btn', '', () => this.loadSquare(false));
      more.id = 'sq-more';
      more.hidden = true;
      root.append(bar, empty, grid, more);
    }
    for (const b of $('sq-sort').children) {
      b.textContent = b.dataset.k === 'theme' ? themeName() : t('soc.sq.' + b.dataset.k);
      b.setAttribute('aria-selected', String(b.dataset.k === this.sq.sort));
    }
    $('sq-add').textContent = t('soc.post');
    $('sq-more').textContent = t('browse.more');
    if (load) this.loadSquare(true);
    else this.drawSquare();
  }
  async loadSquare(reset) {
    if (this.sq.loading) return;
    if (!cloudReady()) {
      $('sq-empty').hidden = false;
      $('sq-empty').textContent = t('browse.offline');
      return;
    }
    this.sq.loading = true;
    if (reset) {
      this.sq.items = [];
      this.sq.done = false;
    }
    try {
      const rows = await srpc('feed', { p_sort: this.sq.sort, p_theme: this.sq.sort === 'theme' ? themeKey() : null, ...(await this.viewer()), p_limit: 20, p_offset: this.sq.items.length });
      this.sq.items.push(...(Array.isArray(rows) ? rows : []));
      this.sq.done = !Array.isArray(rows) || rows.length < 20;
    } catch (e) {
      $('sq-empty').hidden = false;
      $('sq-empty').textContent = t(e.message === 'e.notReady' ? 'soc.notReady' : 'browse.offline');
      this.sq.loading = false;
      return;
    }
    this.sq.loading = false;
    this.drawSquare();
  }
  drawSquare() {
    const grid = $('sq-grid');
    grid.textContent = '';
    for (const p of this.sq.items) grid.append(this.postCard(p));
    $('sq-empty').hidden = this.sq.items.length > 0;
    $('sq-empty').textContent = t(this.sq.sort === 'follow' ? 'soc.sq.noFollow' : 'soc.sq.empty');
    $('sq-more').hidden = this.sq.done;
  }
  postCard(p) {
    const a = el('article', 'post card-box r' + (p.r | 0));
    const fig = el('div', 'post-img' + (p.k === 'machine' ? ' sq' : ''));
    const im = document.createElement('img');
    im.src = okImg(p.img) || '';
    im.alt = str(p.ti, 40);
    im.loading = 'lazy';
    fig.append(im);
    if (p.r != null && p.k !== 'machine') fig.append(el('span', 'post-rar', RAR[p.r | 0]));
    if (p.th === themeKey()) fig.append(el('span', 'post-th', themeOf().e));
    if (isId(p.m)) {
      fig.tabIndex = 0;
      fig.setAttribute('role', 'button');
      fig.setAttribute('aria-label', t('soc.openMachine'));
      fig.onclick = () => this.c.playMachine(p.m);
    }
    a.append(fig);
    const body = el('div', 'post-body');
    const by = btn('post-by', '');
    by.append(avatarEl(p.av, p.nm, p.w, 22), el('b', '', nameOf(p.nm, p.w)), el('small', '', ago(p.t)));
    by.onclick = () => this.openProfile(p.w);
    body.append(by);
    if (p.ti) body.append(el('h3', '', str(p.ti, 40)));
    if (p.c) body.append(el('p', 'post-cap', str(p.c, 80)));
    // スタンプ統計
    const rc = p.rc && typeof p.rc === 'object' ? Object.entries(p.rc).filter(([k, n]) => /^\d+$/.test(k) && n > 0) : [];
    if (rc.length) {
      const rr = el('div', 'post-rc');
      for (const [k, n] of rc.sort((x, y) => y[1] - x[1]).slice(0, 5)) {
        const c = el('span', 'rc' + (p.my === +k ? ' mine' : ''));
        c.append(stampEl(+k, 'stamp-img xs'), el('b', '', String(n)));
        rr.append(c);
      }
      body.append(rr);
    }
    const acts = el('div', 'post-acts');
    const like = btn('like-btn' + (p.liked ? ' on' : ''), '');
    like.setAttribute('aria-pressed', String(!!p.liked));
    like.setAttribute('aria-label', t('soc.like'));
    like.append(el('i', 'hrt', '♥'), el('b', '', String(p.likes | 0)));
    const paintLike = () => {
      like.classList.toggle('on', !!p.liked);
      like.setAttribute('aria-pressed', String(!!p.liked));
      like.querySelector('b').textContent = String(Math.max(0, p.likes | 0));
    };
    like.onclick = async () => {
      if (like.dataset.busy) return;
      like.dataset.busy = '1';
      const on = !p.liked;
      p.liked = on;
      p.likes = (p.likes | 0) + (on ? 1 : -1);
      paintLike();
      if (on) this.heartPop(like);
      try {
        const r = await this.call('post_like', { p_post: p.id, p_on: on });
        p.likes = r.likes;
        if (r.reward) this.c.toast(t('soc.likeGift', { n: r.reward }));
        this.bump();
      } catch (e) {
        p.liked = !on;
        p.likes = (p.likes | 0) + (on ? -1 : 1);
        this.err(e);
      }
      delete like.dataset.busy;
      paintLike();
    };
    const st = btn('st-btn', '', () => this.stampTray(st, async (k) => {
      try {
        const np = await this.call('post_react', { p_post: p.id, p_stamp: p.my === k ? null : k });
        Object.assign(p, np);
        a.replaceWith(this.postCard(p));
        this.bump();
      } catch (e) {
        this.err(e);
      }
    }));
    st.setAttribute('aria-label', t('soc.stamp'));
    st.append(p.my != null ? stampEl(p.my, 'stamp-img xs') : el('i', '', '☺'), el('span', 'stb-txt', t('soc.stamp')));
    const more = btn('more-btn', '⋯', () => this.postMenu(p, a, more));
    more.setAttribute('aria-label', t('soc.more'));
    acts.append(like, st, more);
    body.append(acts);
    a.append(body);
    return a;
  }
  heartPop(b) {
    if (!b) return;
    const r = b.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const h = el('i', 'heart-fly', '♥');
      h.style.left = r.left + 14 + 'px';
      h.style.top = r.top + 6 + 'px';
      h.style.setProperty('--dx', (Math.random() * 2 - 1) * 40 + 'px');
      h.style.animationDelay = i * 60 + 'ms';
      document.body.append(h);
      setTimeout(() => h.remove(), 1200);
    }
    this.c.sfx.pop();
  }
  async postMenu(p, card, anchor) {
    const me = (await this.w())?.id;
    const menu = el('div', 'pop-menu card-box');
    const close = () => {
      menu.remove();
      removeEventListener('pointerdown', out, true);
    };
    const out = (e) => !menu.contains(e.target) && close();
    if (p.w === me)
      menu.append(btn('', t('soc.del'), async () => {
        close();
        try {
          await this.call('post_del', { p_post: p.id });
          card.remove();
          this.sq.items = this.sq.items.filter((x) => x.id !== p.id);
          this.c.toast(t('soc.deleted'));
        } catch (e) {
          this.err(e);
        }
      }));
    else
      menu.append(btn('', t('soc.report'), async () => {
        close();
        try {
          await this.call('post_report', { p_post: p.id });
          this.c.toast(t('soc.reported'));
        } catch (e) {
          this.err(e);
        }
      }));
    menu.append(btn('', t('soc.seeUser'), () => {
      close();
      this.openProfile(p.w);
    }));
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.min(innerHeight - 120, r.bottom + 4) + 'px';
    menu.style.right = Math.max(8, innerWidth - r.right) + 'px';
    document.body.append(menu);
    setTimeout(() => addEventListener('pointerdown', out, true));
  }
  // スタンプを選ぶ小さいトレイ
  stampTray(anchor, pick) {
    document.querySelector('.st-tray')?.remove();
    const tray = el('div', 'st-tray card-box');
    tray.setAttribute('role', 'menu');
    for (let i = 0; i < STAMP_N; i++) {
      const b = btn('st-pick');
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-label', t('soc.st' + i));
      b.append(stampEl(i));
      b.onclick = () => {
        close();
        this.c.sfx.pop();
        pick(i);
      };
      tray.append(b);
    }
    const out = (e) => !tray.contains(e.target) && e.target !== anchor && close();
    const close = () => {
      tray.remove();
      removeEventListener('pointerdown', out, true);
    };
    const r = anchor.getBoundingClientRect();
    document.body.append(tray);
    const tw = tray.offsetWidth;
    const th = tray.offsetHeight;
    tray.style.left = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
    tray.style.top = (r.top - th - 8 > 8 ? r.top - th - 8 : r.bottom + 8) + 'px';
    setTimeout(() => addEventListener('pointerdown', out, true));
  }

  // ---------- 發到廣場 ----------
  // 從收集簿選一張 → 寫一句話 → 貼出去
  openPicker() {
    this.postDraft = null;
    const list = this.owned();
    const g = $('po-pick');
    g.textContent = '';
    $('po-pick-wrap').hidden = false;
    $('po-form').hidden = true;
    if (!list.length) g.append(el('p', 'soc-empty', t('soc.noOwned')));
    for (const it of list.slice(0, 80)) {
      const b = btn('pe-item r' + it.r);
      const im = document.createElement('img');
      im.src = it.t;
      im.alt = it.n;
      im.loading = 'lazy';
      b.append(im);
      b.title = it.n;
      b.onclick = async () => {
        const img = await toDataImg(it.t, 360, 0.85).catch(() => null);
        if (img) this.openPost({ kind: 'pull', img, title: it.n, rar: it.r, machine: null }, true);
      };
      g.append(b);
    }
    this.c.openSheet('sheet-post', $('sheet-post').querySelector('[data-close]'));
  }
  // d：{ kind: pull|work|machine, img（data:image 或可以畫的圖）, title, rar, machine }
  async openPost(d, inSheet = false) {
    if (!cloudReady()) return this.c.toast(t('browse.offline'));
    let img = okImg(d.img);
    if (!img) img = await toDataImg(d.img, 360, 0.85).catch(() => null);
    if (!img) return this.c.toast(t('pk.failed'));
    while (img.length > 60000) img = await toDataImg(img, 280, 0.7);
    this.postDraft = { ...d, img };
    $('po-pick-wrap').hidden = true;
    $('po-form').hidden = false;
    const pv = $('po-prev');
    pv.textContent = '';
    const im = document.createElement('img');
    im.src = img;
    im.alt = d.title || '';
    pv.append(im);
    pv.className = 'po-prev r' + (d.rar | 0) + (d.kind === 'machine' ? ' sq' : '');
    $('po-title').textContent = d.title || '';
    $('po-cap').value = '';
    $('po-cap').placeholder = t('soc.capPh');
    $('po-th-txt').textContent = t('soc.thTag', { t: themeName() });
    $('po-th').checked = false;
    if (!inSheet) this.c.openSheet('sheet-post', $('po-cap'));
    else $('po-cap').focus();
  }
  async sendPost() {
    const d = this.postDraft;
    if (!d) return;
    const b = $('po-send');
    b.disabled = true;
    try {
      const p = await this.call('post_add', {
        p_kind: d.kind, p_img: d.img, p_title: (d.title || '').slice(0, 40), p_rar: d.rar ?? null,
        p_m: isId(d.machine) ? d.machine : null, p_caption: $('po-cap').value.trim().slice(0, 80), p_theme: $('po-th').checked ? themeKey() : null,
      });
      this.c.closeSheet('sheet-post');
      this.c.toast(t('soc.posted'));
      this.c.sfx.pop();
      this.sq.items.unshift(p);
      if (this.c.curMode() === 'browse' && this.view === 'square') this.drawSquare();
      this.bump();
    } catch (e) {
      this.err(e);
    } finally {
      b.disabled = false;
    }
  }

  // ---------- 排行 ----------
  async renderRank() {
    const root = $('browse-rank');
    root.textContent = '';
    root.append(el('p', 'lede rank-lede', t('soc.rankLede')));
    const ol = el('ol', 'rank-list');
    root.append(ol);
    try {
      const rows = await srpc('top_makers', { p_limit: 20 });
      if (!Array.isArray(rows) || !rows.length) return ol.replaceWith(el('p', 'album-empty card-box', t('soc.rankEmpty')));
      rows.forEach((r, i) => {
        const li = el('li', 'rank-row card-box' + (i < 3 ? ' top' + (i + 1) : ''));
        li.append(el('span', 'rk-no', i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)), avatarEl(r.av, r.nm, r.w, 40));
        const tx = el('div', 'rk-tx');
        tx.append(el('b', '', nameOf(r.nm, r.w)), el('small', '', t('soc.rankLine', { s: fmtN(r.sold), l: fmtN(r.likes) })));
        li.append(tx, el('span', 'rk-sc', fmtN(r.sc)));
        li.tabIndex = 0;
        li.onclick = () => this.openProfile(r.w);
        ol.append(li);
      });
    } catch (e) {
      ol.replaceWith(el('p', 'album-empty card-box', t(e.message === 'e.notReady' ? 'soc.notReady' : 'browse.offline')));
    }
  }

  // ---------- 機台畫面：讚、留言、外觀、店主、即時泡泡 ----------
  // mid＝短連結 id（沒有短連結的機台 → null，社群功能收起來）
  async stageEnter(mid) {
    this.stageLeave();
    const rail = $('soc-rail');
    const maker = $('p-maker');
    rail.hidden = true;
    maker.hidden = true;
    if (!isId(mid) || !cloudReady()) return;
    const S = (this.stage = { mid, lastC: null, lastA: null, timer: 0, info: null });
    try {
      S.info = await srpc('machine_social', { p_m: mid, ...(await this.viewer()) });
    } catch (e) {
      return; // 伺服器還沒裝、離線
    }
    if (this.stage !== S) return;
    this.drawRail();
    // 一開始先記下最新的，之後才冒泡泡
    try {
      const [c, a] = await Promise.all([srpc('comments_list', { p_m: mid, p_limit: 3 }), srpc('activity', { p_m: mid, p_limit: 1 })]);
      if (this.stage !== S) return;
      S.lastC = c?.[0]?.id || 0;
      S.lastA = a?.[0]?.id || 0;
      // 最近的留言先飄一次（Mario Maker 那樣，進來就看得到大家說什麼）
      (c || []).slice().reverse().forEach((x, i) => setTimeout(() => this.stage === S && this.bubble(x, true), 900 + i * 1400));
    } catch (e) {
      S.lastC = S.lastA = 0;
    }
    S.timer = setInterval(() => this.stagePoll(), 12000);
  }
  stageLeave() {
    if (this.stage?.timer) clearInterval(this.stage.timer);
    this.stage = null;
    $('soc-rail').hidden = true;
    $('p-maker').hidden = true;
    $('soc-fly').textContent = '';
  }
  drawRail() {
    const S = this.stage;
    const i = S.info;
    const rail = $('soc-rail');
    rail.hidden = false;
    const like = $('sr-like');
    like.classList.toggle('on', !!i.liked);
    like.setAttribute('aria-pressed', String(!!i.liked));
    like.querySelector('b').textContent = fmtN(i.likes | 0);
    $('sr-talk').querySelector('b').textContent = fmtN(i.cm | 0);
    $('sr-remix').hidden = !!i.nr;
    $('sr-remix').querySelector('b').textContent = i.rxc ? fmtN(i.rxc) : '';
    const maker = $('p-maker');
    const sm = $('sr-maker');
    sm.hidden = maker.hidden = !i.o;
    if (i.o) {
      maker.textContent = '';
      maker.append(avatarEl(i.oav, i.on, i.o, 18), el('span', '', nameOf(i.on, i.o)));
      if (i.w === themeKey()) maker.append(el('i', 'mk-th', themeOf().e));
      maker.onclick = () => this.openProfile(i.o);
      // 機台旁邊的店主頭像（手機上名牌放不下店主，就看這個）
      sm.textContent = '';
      sm.append(avatarEl(i.oav, i.on, i.o, 40));
      sm.setAttribute('aria-label', t('soc.seeUser') + '：' + nameOf(i.on, i.o));
      sm.onclick = () => this.openProfile(i.o);
    }
    const rx = $('p-rx');
    rx.hidden = !i.rx || !i.rxn;
    if (!rx.hidden) {
      rx.textContent = t('soc.inspired', { n: str(i.rxn, 24) });
      rx.onclick = () => this.c.playMachine(i.rx);
    }
  }
  async stagePoll() {
    const S = this.stage;
    if (!S || document.hidden || this.c.curMode() !== 'play') return;
    const me = (await this.w())?.id;
    try {
      const [c, a] = await Promise.all([
        srpc('comments_list', { p_m: S.mid, p_after: S.lastC || 0, p_limit: 10 }),
        srpc('activity', { p_m: S.mid, p_after: S.lastA || 0, p_limit: 10 }),
      ]);
      if (this.stage !== S) return;
      const nc = (c || []).filter((x) => x.id > (S.lastC || 0)).reverse();
      const na = (a || []).filter((x) => x.id > (S.lastA || 0)).reverse();
      if (nc.length) S.lastC = nc[nc.length - 1].id;
      if (na.length) S.lastA = na[na.length - 1].id;
      nc.filter((x) => x.w !== me).forEach((x, i) => setTimeout(() => this.bubble(x), i * 900));
      na.filter((x) => x.w !== me).forEach((x, i) => setTimeout(() => this.pullBubble(x), 400 + i * 1100));
      if (nc.length) {
        S.info.cm = (S.info.cm | 0) + nc.filter((x) => x.w !== me).length;
        this.drawRail();
      }
      if (!$('sheet-talk').hidden && nc.length) this.loadTalk();
    } catch (e) {
      /* 下次再試 */
    }
  }
  // 留言泡泡：スタンプ從右下飄上去；文字從右邊滑進來
  bubble(x, old = false) {
    const fly = $('soc-fly');
    if (x.s != null) {
      const s = el('div', 'fly-stamp');
      s.append(stampEl(x.s), el('small', '', nameOf(x.nm, x.w)));
      s.style.setProperty('--dx', (Math.random() * 2 - 1) * 30 + 'px');
      fly.append(s);
      setTimeout(() => s.remove(), 3600);
      if (!old) this.c.sfx.pop();
    }
    if (x.b) {
      const b = el('div', 'fly-msg');
      b.append(avatarEl(x.av, x.nm, x.w, 22), el('span', '', str(x.b, 60)));
      b.style.top = 18 + Math.random() * 34 + '%';
      fly.append(b);
      setTimeout(() => b.remove(), 7200);
    }
  }
  pullBubble(a) {
    const cfg = this.c.stageCfg();
    let best = -1;
    for (const k of a.pk || []) {
      const it = cfg?.items?.find((x) => (x.uid || '') === k);
      if (it) best = Math.max(best, it.rarity | 0);
    }
    if (best < 0 && a.b != null) best = a.b;
    const fly = $('soc-fly');
    const b = el('div', 'fly-pull' + (best >= 2 ? ' rare r' + best : ''));
    b.textContent = best >= 2 ? t('soc.tk.rareHere', { who: nameOf(a.nm, a.w), r: RAR[best] }) : t('soc.tk.pullHere', { who: nameOf(a.nm, a.w), n: a.n | 0 });
    fly.append(b);
    setTimeout(() => b.remove(), 4200);
  }
  async toggleLike() {
    const S = this.stage;
    if (!S?.info) return;
    const on = !S.info.liked;
    S.info.liked = on;
    S.info.likes = (S.info.likes | 0) + (on ? 1 : -1);
    this.drawRail();
    if (on) {
      this.heartPop($('sr-like'));
      for (let i = 0; i < 5; i++) setTimeout(() => this.flyHeart(), i * 120);
    }
    try {
      const r = await this.call('like_machine', { p_m: S.mid, p_on: on });
      if (this.stage !== S) return;
      S.info.likes = r.likes;
      this.drawRail();
      if (r.reward) this.c.toast(t('soc.likeGift', { n: r.reward }));
      this.bump();
    } catch (e) {
      S.info.liked = !on;
      S.info.likes = (S.info.likes | 0) + (on ? -1 : 1);
      this.drawRail();
      this.err(e);
    }
  }
  flyHeart() {
    const h = el('div', 'fly-heart', '♥');
    h.style.setProperty('--dx', (Math.random() * 2 - 1) * 26 + 'px');
    h.style.setProperty('--h', Math.round(Math.random() * 40 - 20));
    $('soc-fly').append(h);
    setTimeout(() => h.remove(), 2400);
  }

  // ---------- 留言板 ----------
  async openTalk() {
    const S = this.stage;
    if (!S) return;
    $('tk-list').textContent = '';
    $('tk-list').append(el('li', 'soc-empty', t('soc.loading')));
    $('tk-input').value = '';
    $('tk-input').placeholder = t('soc.talkPh');
    const tray = $('tk-stamps');
    if (!tray.childElementCount)
      for (let i = 0; i < STAMP_N; i++) {
        const b = btn('st-pick');
        b.setAttribute('aria-label', t('soc.st' + i));
        b.append(stampEl(i));
        b.onclick = () => this.sendTalk(i);
        tray.append(b);
      }
    this.c.openSheet('sheet-talk', $('tk-input'));
    await this.loadTalk();
  }
  async loadTalk() {
    const S = this.stage;
    if (!S) return;
    const me = (await this.w())?.id;
    let rows;
    try {
      rows = await srpc('comments_list', { p_m: S.mid, p_limit: 50 });
    } catch (e) {
      return this.err(e);
    }
    if (this.stage !== S) return;
    const ul = $('tk-list');
    ul.textContent = '';
    if (!rows?.length) ul.append(el('li', 'soc-empty', t('soc.noTalk')));
    for (const x of rows || []) {
      const li = el('li', 'tk' + (x.w === me ? ' mine' : '') + (x.w === S.info?.o ? ' owner' : ''));
      const av = avatarEl(x.av, x.nm, x.w, 32);
      av.onclick = () => {
        this.c.closeSheet('sheet-talk');
        this.openProfile(x.w);
      };
      li.append(av);
      const bd = el('div', 'tk-bd');
      const hd = el('div', 'tk-hd');
      hd.append(el('b', '', nameOf(x.nm, x.w)));
      if (x.w === S.info?.o) hd.append(el('i', 'tk-own', t('soc.owner')));
      hd.append(el('small', '', ago(x.t)));
      bd.append(hd);
      if (x.b) bd.append(el('p', '', x.b));
      if (x.s != null) bd.append(stampEl(x.s, 'stamp-img md'));
      li.append(bd);
      if (x.w === me || S.info?.o === me) li.append(btn('tk-x', '✕', () => this.delTalk(x.id)));
      else li.append(btn('tk-x rep', '⚑', () => this.reportTalk(x.id)));
      li.lastChild.setAttribute('aria-label', t(x.w === me || S.info?.o === me ? 'soc.del' : 'soc.report'));
      ul.append(li);
    }
    S.info.cm = (rows || []).length;
    this.drawRail();
  }
  async sendTalk(stamp = null) {
    const S = this.stage;
    if (!S) return;
    const inp = $('tk-input');
    const body = stamp == null ? inp.value.trim() : '';
    if (stamp == null && !body) return;
    const b = $('tk-send');
    b.disabled = true;
    try {
      const x = await this.call('comment_add', { p_m: S.mid, p_body: body || null, p_stamp: stamp });
      if (stamp == null) inp.value = '';
      S.lastC = Math.max(S.lastC || 0, x.id);
      this.bubble(x);
      await this.loadTalk();
      this.bump();
    } catch (e) {
      this.err(e);
    } finally {
      b.disabled = false;
    }
  }
  async delTalk(id) {
    try {
      await this.call('comment_del', { p_c: id });
      await this.loadTalk();
    } catch (e) {
      this.err(e);
    }
  }
  async reportTalk(id) {
    try {
      await this.call('comment_report', { p_c: id });
      this.c.toast(t('soc.reported'));
    } catch (e) {
      this.err(e);
    }
  }

  bind() {
    $('pe-save').onclick = () => this.saveEdit();
    $('pe-name').addEventListener('input', () => this.drawEdit());
    $('pe-av-btn').onclick = () => {
      this.pickFor = 'av';
      this.drawPick();
    };
    $('pe-av-clear').onclick = () => {
      this.ed.avatar = null;
      this.ed.avatarPreset = null;
      this.drawEdit();
    };
    // 自己的圖：選檔 → 裁成正方形（開店頁封面那個裁切框）→ 128 px webp（資料庫上限 16000 字，超過就降畫質）
    $('pe-av-up').onclick = async () => {
      const c = await this.c.pickImage(t('soc.avCrop'));
      if (!c) return;
      let q = 0.85;
      let u = await toDataImg(c, 128, q, true).catch(() => null);
      while (u && u.length > 15000 && q > 0.4) u = await toDataImg(c, 112, (q -= 0.15), true).catch(() => null);
      if (!u || u.length > 16000) return this.c.toast(t('t.badImage'));
      this.ed.avatar = u;
      this.ed.avatarPreset = null;
      this.drawEdit();
      this.c.toast(t('soc.avSet'));
    };
    $('po-send').onclick = () => this.sendPost();
    $('po-back').onclick = () => this.openPicker();
    $('tk-send').onclick = () => this.sendTalk();
    $('tk-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.sendTalk();
      }
    });
    $('sr-like').onclick = () => this.toggleLike();
    $('sr-talk').onclick = () => this.openTalk();
    $('sr-remix').onclick = () => {
      const i = this.stage?.info;
      this.c.remix({ id: this.stage?.mid, n: this.c.stageCfg()?.name || '' }, i);
    };
    $('sr-stamp').onclick = () => this.stampTray($('sr-stamp'), (k) => this.sendTalk(k));
  }
}

// ---------- 字 ----------
addStrings({
  zh: {
    'soc.me': '我的', 'soc.now': '剛剛', 'soc.player': '玩家 {c}', 'soc.loading': '讀取中…', 'soc.noName': '還沒取名字',
    'soc.code': '好友碼 {c}', 'soc.editProf': '編輯個人頁', 'soc.myPage': '看我的頁面',
    'soc.tab.notices': '通知', 'soc.tab.missions': '任務', 'soc.tab.following': '追蹤中',
    'soc.noNotices': '還沒有通知。公開機台、發文之後，有人按讚、留言、轉你的機台都會出現在這裡。',
    'soc.yourMachine': '你的機台', 'soc.yourPost': '你的貼文',
    'soc.n.like': '{who} 按讚了「{m}」', 'soc.n.cmt': '{who} 在{m}留言', 'soc.n.fol': '{who} 開始追蹤你',
    'soc.n.plike': '{who} 按讚了你的貼文「{m}」', 'soc.n.preact': '{who} 對「{m}」丟了スタンプ', 'soc.n.buy': '{who} 轉了「{m}」×{n}',
    'soc.streak': '連續登入 {n} 天', 'soc.claim': '領取', 'soc.claimed': '已領', 'soc.go': '去做',
    'soc.m.login': '每日登入', 'soc.m.login.d': '連續第 7 天有 60 枚',
    'soc.m.pull': '轉一次別人的機台', 'soc.m.pull.d': '逛機台找一台喜歡的',
    'soc.m.like': '按 2 個讚', 'soc.m.like.d': '機台或廣場的貼文都可以',
    'soc.m.talk': '留言或丟スタンプ', 'soc.m.talk.d': '在機台旁邊的 💬',
    'soc.m.post': '發一則到廣場', 'soc.m.post.d': '抽到的卡、做好的卡都可以',
    'soc.m.make': '更新或公開自己的機台', 'soc.m.make.d': '改一下機台、按做連結',
    'soc.missionHint': '每天 0 點（你的時區）重置。領到的幣直接進錢包。',
    'soc.got': '領到 {n} 枚！', 'soc.noFollowing': '還沒追蹤任何人。在別人的頁面按「追蹤」，逛機台就多一個「追蹤中」。',
    'soc.needName': '先取一個名字', 'soc.saved': '個人頁存好了', 'soc.pickAv': '選一張當頭像', 'soc.pickShow': '選一張放進展示櫃',
    'soc.addShow': '加一張展示卡', 'soc.removeShow': '拿掉「{n}」', 'soc.noOwned': '收集簿還沒有東西，先去轉幾次吧。',
    'soc.noUser': '找不到這個人', 'soc.notReady': '社群功能還在準備中，稍後再試', 'soc.linkCopied': '個人頁連結複製好了', 'soc.copyFail': '複製不了',
    'soc.ps.followers': '追蹤者', 'soc.ps.following': '追蹤中', 'soc.ps.sold': '被轉次數', 'soc.ps.likes': '收到的讚',
    'soc.follow': '＋ 追蹤', 'soc.following': '追蹤中 ✓', 'soc.followed': '開始追蹤 {who}', 'soc.tradeWith': '加好友交換', 'soc.missions': '每日任務',
    'soc.showcase': '展示櫃', 'soc.noShow': '還沒放展示卡（編輯個人頁可以選 3 張）', 'soc.machines': '公開的機台 {n}',
    'soc.noMachines': '還沒有公開的機台', 'soc.noMachinesMe': '在開店第 5 步勾「公開到逛機台」，機台就會出現在這裡',
    'soc.posts': '貼文 {n}', 'soc.noPosts': '還沒有貼文',
    'soc.b.first': '第一抽', 'soc.b.first.d': '轉到第一個獎品', 'soc.b.ssr': 'SSR 得主', 'soc.b.ssr.d': '抽到過 SSR',
    'soc.b.col10': '收藏家', 'soc.b.col10.d': '收集 10 種', 'soc.b.col50': '大收藏家', 'soc.b.col50.d': '收集 50 種',
    'soc.b.shop': '開店了', 'soc.b.shop.d': '公開了一台機台', 'soc.b.shop3': '連鎖店', 'soc.b.shop3.d': '有 3 台以上的機台',
    'soc.b.sold10': '小有名氣', 'soc.b.sold10.d': '機台被轉 10 次', 'soc.b.sold100': '人氣店家', 'soc.b.sold100.d': '機台被轉 100 次',
    'soc.b.liked10': '大家的最愛', 'soc.b.liked10.d': '收到 10 個讚', 'soc.b.fans5': '有粉絲了', 'soc.b.fans5.d': '5 個人追蹤',
    'soc.b.post': '廣場常客', 'soc.b.post.d': '在廣場發過文', 'soc.b.streak7': '連續 7 天', 'soc.b.streak7.d': '連續登入 7 天',
    'soc.v.machines': '機台', 'soc.v.square': '廣場', 'soc.v.rank': '排行',
    'soc.weekly': '本週主題・還有 {d} 天', 'soc.thSee': '看參加的機台', 'soc.thJoin': '我要參加', 'soc.lastWeek': '上週「{t}」前 3 名',
    'soc.live': 'LIVE', 'soc.tk.pull': '{who} 在「{m}」轉了 {n} 次', 'soc.tk.rare': '{who} 在「{m}」抽到 {r}！',
    'soc.tk.pullHere': '{who} 剛剛轉了 {n} 次', 'soc.tk.rareHere': '🎉 {who} 抽到 {r}！',
    'soc.sq.new': '最新', 'soc.sq.hot': '熱門', 'soc.sq.follow': '追蹤中', 'soc.post': '＋ 發文',
    'soc.sq.empty': '廣場還沒有貼文，當第一個吧！抽到喜歡的卡時，結果畫面按「發到廣場」。', 'soc.sq.noFollow': '追蹤的人還沒發文',
    'soc.like': '讚', 'soc.stamp': 'スタンプ', 'soc.more': '更多', 'soc.del': '刪除', 'soc.report': '檢舉', 'soc.seeUser': '看這個人的頁面',
    'soc.deleted': '刪掉了', 'soc.reported': '收到檢舉，謝謝', 'soc.openMachine': '去轉這台', 'soc.likeGift': '送了店主 {n} 枚 ♥',
    'soc.posted': '發到廣場了！', 'soc.thTag': '參加本週主題 {t}', 'soc.postTitle': '發到廣場', 'soc.postPick': '從收集簿選一張',
    'soc.capPh': '說點什麼（選填，80 字）', 'soc.send': '貼出去', 'soc.pickAgain': '換一張',
    'soc.rankLede': '最近 30 天被轉的次數＋收到的讚 ×3', 'soc.rankEmpty': '還沒有排行', 'soc.rankLine': '被轉 {s}・讚 {l}',
    'soc.owner': '店主', 'soc.noTalk': '還沒有留言，留第一個吧！', 'soc.talkTitle': '留言板', 'soc.talkPh': '留言給店主和大家（120 字）',
    'soc.tooMany': '太快了，等一下再試', 'soc.gone': '已經不在了', 'soc.inspired': '靈感來自「{n}」', 'soc.remix': '用這台的外觀',
    'soc.toSquare': '發到廣場', 'soc.profTitle': '個人頁', 'soc.peName': '名字', 'soc.peBio': '一句話介紹（選填）', 'soc.peAv': '頭像',
    'soc.peShow': '展示櫃（最多 3 張）', 'soc.peAvPick': '從收藏選', 'soc.peAvClear': '用文字頭像', 'soc.peSave': '存好',
    'soc.peAvUp': '📷 上傳圖片', 'soc.avCrop': '裁切頭像', 'soc.avSet': '換好了，按「存好」就會更新', 'soc.fromCol': '從收藏選',
    'soc.st0': '好喜歡', 'soc.st1': '好厲害', 'soc.st2': '好好笑', 'soc.st3': '感動', 'soc.st4': '拍手', 'soc.st5': '謝謝',
    'soc.st6': '恭喜', 'soc.st7': '超燃', 'soc.st8': '愛心', 'soc.st9': '閃亮亮', 'soc.st10': '哇', 'soc.st11': '想睡',
    'soc.remixed': '用「{n}」的外觀開了一台新機台：顏色、背景、卡背、加工、音樂都複製了，放你自己的獎品吧',
    'soc.joinTheme': '參加本週主題 {t}', 'soc.allowRemix': '讓別人可以用這台的外觀開新機台',
    'wallet.k.like': '收到讚', 'wallet.k.bonus': '任務獎勵',
    'browse.likes': '讚最多', 'browse.follow': '追蹤中', 'browse.emptyFollow': '追蹤的人還沒有公開的機台。看到喜歡的店主，點他的名字進個人頁按「追蹤」。', 'browse.emptyTheme': '這週主題還沒有機台參加，當第一個吧！（開店第 5 步）',
    'soc.themeNeedLink': '先做好連結（第 5 步），公開到逛機台後就能參加主題', 'soc.themeNeedList': '勾「公開到逛機台」，下面就有「參加本週主題」',
  },
  ja: {
    'soc.me': 'マイページ', 'soc.now': 'たった今', 'soc.player': 'プレイヤー {c}', 'soc.loading': '読み込み中…', 'soc.noName': '名前がまだありません',
    'soc.code': 'フレンドコード {c}', 'soc.editProf': 'プロフィール編集', 'soc.myPage': '自分のページ',
    'soc.tab.notices': 'おしらせ', 'soc.tab.missions': 'ミッション', 'soc.tab.following': 'フォロー中',
    'soc.noNotices': 'おしらせはまだありません。マシンを公開したり投稿すると、いいね・コメント・ガチャされた通知がここに届きます。',
    'soc.yourMachine': 'あなたのマシン', 'soc.yourPost': 'あなたの投稿',
    'soc.n.like': '{who} が「{m}」にいいねしました', 'soc.n.cmt': '{who} が{m}にコメントしました', 'soc.n.fol': '{who} があなたをフォローしました',
    'soc.n.plike': '{who} が投稿「{m}」にいいねしました', 'soc.n.preact': '{who} が「{m}」にスタンプを送りました', 'soc.n.buy': '{who} が「{m}」を {n} 回まわしました',
    'soc.streak': '連続ログイン {n} 日', 'soc.claim': '受け取る', 'soc.claimed': '受取済み', 'soc.go': 'やる',
    'soc.m.login': '毎日ログイン', 'soc.m.login.d': '7 日目は 60 枚',
    'soc.m.pull': 'ほかの人のマシンを 1 回まわす', 'soc.m.pull.d': 'マシンをさがすで好きな 1 台を',
    'soc.m.like': 'いいねを 2 回', 'soc.m.like.d': 'マシンでも広場の投稿でも OK',
    'soc.m.talk': 'コメントかスタンプ', 'soc.m.talk.d': 'マシンの横の 💬 から',
    'soc.m.post': '広場に 1 回投稿', 'soc.m.post.d': '当てたカードも作ったカードも OK',
    'soc.m.make': '自分のマシンを更新・公開', 'soc.m.make.d': 'マシンを少し変えてリンクを作る',
    'soc.missionHint': '毎日 0 時（あなたのタイムゾーン）にリセット。コインはそのままお財布へ。',
    'soc.got': '{n} 枚ゲット！', 'soc.noFollowing': 'まだだれもフォローしていません。ほかの人のページで「フォロー」すると、マシンをさがすに「フォロー中」が出ます。',
    'soc.needName': '先に名前をつけてください', 'soc.saved': 'プロフィールを保存しました', 'soc.pickAv': 'アイコンにする 1 枚を選ぶ', 'soc.pickShow': 'ショーケースに飾る 1 枚を選ぶ',
    'soc.addShow': 'ショーケースに追加', 'soc.removeShow': '「{n}」を外す', 'soc.noOwned': 'コレクションがまだ空です。まずはガチャを。',
    'soc.noUser': 'このユーザーは見つかりません', 'soc.notReady': 'コミュニティ機能は準備中です。少ししてからお試しください', 'soc.linkCopied': 'プロフィールのリンクをコピーしました', 'soc.copyFail': 'コピーできませんでした',
    'soc.ps.followers': 'フォロワー', 'soc.ps.following': 'フォロー中', 'soc.ps.sold': 'まわされた', 'soc.ps.likes': 'もらったいいね',
    'soc.follow': '＋ フォロー', 'soc.following': 'フォロー中 ✓', 'soc.followed': '{who} をフォローしました', 'soc.tradeWith': 'フレンド交換', 'soc.missions': 'デイリーミッション',
    'soc.showcase': 'ショーケース', 'soc.noShow': 'まだ飾っていません（プロフィール編集で 3 枚まで）', 'soc.machines': '公開マシン {n}',
    'soc.noMachines': '公開しているマシンはまだありません', 'soc.noMachinesMe': 'お店の設定ステップ 5 で「マシンをさがすに公開」をオンにするとここに並びます',
    'soc.posts': '投稿 {n}', 'soc.noPosts': '投稿はまだありません',
    'soc.b.first': 'はじめての 1 回', 'soc.b.first.d': 'はじめて景品をゲット', 'soc.b.ssr': 'SSR ゲッター', 'soc.b.ssr.d': 'SSR を当てた',
    'soc.b.col10': 'コレクター', 'soc.b.col10.d': '10 種類あつめた', 'soc.b.col50': '大コレクター', 'soc.b.col50.d': '50 種類あつめた',
    'soc.b.shop': '開店', 'soc.b.shop.d': 'マシンを公開した', 'soc.b.shop3': 'チェーン店', 'soc.b.shop3.d': 'マシンが 3 台以上',
    'soc.b.sold10': 'ちょっと有名', 'soc.b.sold10.d': '10 回まわされた', 'soc.b.sold100': '人気店', 'soc.b.sold100.d': '100 回まわされた',
    'soc.b.liked10': 'みんなのお気に入り', 'soc.b.liked10.d': 'いいね 10 個', 'soc.b.fans5': 'ファンができた', 'soc.b.fans5.d': 'フォロワー 5 人',
    'soc.b.post': '広場の常連', 'soc.b.post.d': '広場に投稿した', 'soc.b.streak7': '7 日連続', 'soc.b.streak7.d': '7 日連続ログイン',
    'soc.v.machines': 'マシン', 'soc.v.square': '広場', 'soc.v.rank': 'ランキング',
    'soc.weekly': '今週のお題・あと {d} 日', 'soc.thSee': '参加マシンを見る', 'soc.thJoin': '参加する', 'soc.lastWeek': '先週「{t}」トップ 3',
    'soc.live': 'LIVE', 'soc.tk.pull': '{who} が「{m}」を {n} 回まわした', 'soc.tk.rare': '{who} が「{m}」で {r} を当てた！',
    'soc.tk.pullHere': '{who} が今 {n} 回まわした', 'soc.tk.rareHere': '🎉 {who} が {r} を当てた！',
    'soc.sq.new': '新着', 'soc.sq.hot': '人気', 'soc.sq.follow': 'フォロー中', 'soc.post': '＋ 投稿',
    'soc.sq.empty': '広場にはまだ投稿がありません。好きなカードが当たったら、結果画面の「広場に投稿」から一番乗りを！', 'soc.sq.noFollow': 'フォロー中の人はまだ投稿していません',
    'soc.like': 'いいね', 'soc.stamp': 'スタンプ', 'soc.more': 'その他', 'soc.del': '削除', 'soc.report': '通報', 'soc.seeUser': 'この人のページ',
    'soc.deleted': '削除しました', 'soc.reported': '通報を受け付けました', 'soc.openMachine': 'このマシンをまわす', 'soc.likeGift': '店主に {n} 枚おくりました ♥',
    'soc.posted': '広場に投稿しました！', 'soc.thTag': '今週のお題に参加 {t}', 'soc.postTitle': '広場に投稿', 'soc.postPick': 'コレクションから 1 枚選ぶ',
    'soc.capPh': 'ひとこと（任意・80 文字）', 'soc.send': '投稿する', 'soc.pickAgain': '選びなおす',
    'soc.rankLede': '直近 30 日のまわされた回数＋もらったいいね ×3', 'soc.rankEmpty': 'ランキングはまだありません', 'soc.rankLine': 'まわされた {s}・いいね {l}',
    'soc.owner': '店主', 'soc.noTalk': 'コメントはまだありません。一番乗りでどうぞ！', 'soc.talkTitle': 'コメント', 'soc.talkPh': '店主やみんなへコメント（120 文字）',
    'soc.tooMany': '少し時間をおいてください', 'soc.gone': 'もうありません', 'soc.inspired': '「{n}」から着想', 'soc.remix': 'この見た目で作る',
    'soc.toSquare': '広場に投稿', 'soc.profTitle': 'プロフィール', 'soc.peName': '名前', 'soc.peBio': 'ひとこと紹介（任意）', 'soc.peAv': 'アイコン',
    'soc.peShow': 'ショーケース（3 枚まで）', 'soc.peAvPick': 'コレクションから', 'soc.peAvClear': '文字アイコンにする', 'soc.peSave': '保存',
    'soc.peAvUp': '📷 画像をアップロード', 'soc.avCrop': 'アイコンを切り抜く', 'soc.avSet': '変更しました。「保存」で反映されます', 'soc.fromCol': 'コレクションから',
    'soc.st0': 'すき', 'soc.st1': 'すごい', 'soc.st2': 'わらった', 'soc.st3': '感動', 'soc.st4': 'はくしゅ', 'soc.st5': 'ありがとう',
    'soc.st6': 'おめでとう', 'soc.st7': 'アツい', 'soc.st8': 'ハート', 'soc.st9': 'キラキラ', 'soc.st10': 'わお', 'soc.st11': 'ねむい',
    'soc.remixed': '「{n}」の見た目で新しいマシンを作りました。色・背景・カード裏・加工・BGM をコピー済み。景品はあなたのものを入れてね',
    'soc.joinTheme': '今週のお題に参加 {t}', 'soc.allowRemix': 'このマシンの見た目を使った新しいマシン作りを許可',
    'wallet.k.like': 'いいねをもらった', 'wallet.k.bonus': 'ミッション報酬',
    'browse.likes': 'いいね順', 'browse.follow': 'フォロー中', 'browse.emptyFollow': 'フォロー中の人の公開マシンはまだありません。気になる店主の名前からページを開いて「フォロー」しよう。', 'browse.emptyTheme': '今週のお題にはまだ参加マシンがありません。一番乗りでどうぞ！（お店の設定ステップ 5）',
    'soc.themeNeedLink': '先にリンクを作って（ステップ 5）、マシンをさがすに公開するとお題に参加できます', 'soc.themeNeedList': '「マシンをさがすに公開」をオンにすると、その下に「今週のお題に参加」が出ます',
  },
  en: {
    'soc.me': 'Me', 'soc.now': 'just now', 'soc.player': 'Player {c}', 'soc.loading': 'Loading…', 'soc.noName': 'No name yet',
    'soc.code': 'Friend code {c}', 'soc.editProf': 'Edit profile', 'soc.myPage': 'My page',
    'soc.tab.notices': 'Activity', 'soc.tab.missions': 'Missions', 'soc.tab.following': 'Following',
    'soc.noNotices': 'Nothing yet. Once you list a machine or post, likes, comments and pulls on your machines show up here.',
    'soc.yourMachine': 'your machine', 'soc.yourPost': 'your post',
    'soc.n.like': '{who} liked “{m}”', 'soc.n.cmt': '{who} commented on {m}', 'soc.n.fol': '{who} started following you',
    'soc.n.plike': '{who} liked your post “{m}”', 'soc.n.preact': '{who} sent a stamp to “{m}”', 'soc.n.buy': '{who} pulled “{m}” ×{n}',
    'soc.streak': '{n}-day login streak', 'soc.claim': 'Claim', 'soc.claimed': 'Claimed', 'soc.go': 'Go',
    'soc.m.login': 'Daily login', 'soc.m.login.d': 'Day 7 pays 60 coins',
    'soc.m.pull': "Pull someone else's machine", 'soc.m.pull.d': 'Find one you like in Browse',
    'soc.m.like': 'Give 2 likes', 'soc.m.like.d': 'Machines or Square posts',
    'soc.m.talk': 'Comment or send a stamp', 'soc.m.talk.d': 'Tap 💬 beside a machine',
    'soc.m.post': 'Post to the Square', 'soc.m.post.d': 'A card you pulled or made',
    'soc.m.make': 'Update or list your machine', 'soc.m.make.d': 'Tweak it and make the link',
    'soc.missionHint': 'Resets at midnight in your time zone. Coins go straight to your wallet.',
    'soc.got': '+{n} coins!', 'soc.noFollowing': "You aren't following anyone yet. Tap Follow on someone's page and Browse gets a Following tab.",
    'soc.needName': 'Pick a name first', 'soc.saved': 'Profile saved', 'soc.pickAv': 'Pick one as your avatar', 'soc.pickShow': 'Pick one for your showcase',
    'soc.addShow': 'Add a showcase card', 'soc.removeShow': 'Remove “{n}”', 'soc.noOwned': 'Your collection is empty — go pull a few first.',
    'soc.noUser': "Can't find this player", 'soc.notReady': 'Community features are still being set up — try again soon', 'soc.linkCopied': 'Profile link copied', 'soc.copyFail': "Couldn't copy",
    'soc.ps.followers': 'Followers', 'soc.ps.following': 'Following', 'soc.ps.sold': 'Pulls', 'soc.ps.likes': 'Likes',
    'soc.follow': '+ Follow', 'soc.following': 'Following ✓', 'soc.followed': 'Following {who}', 'soc.tradeWith': 'Add as friend', 'soc.missions': 'Daily missions',
    'soc.showcase': 'Showcase', 'soc.noShow': 'Nothing on show yet (pick up to 3 in Edit profile)', 'soc.machines': 'Listed machines {n}',
    'soc.noMachines': 'No listed machines yet', 'soc.noMachinesMe': 'Tick “List in Browse” in step 5 of your shop and your machines appear here',
    'soc.posts': 'Posts {n}', 'soc.noPosts': 'No posts yet',
    'soc.b.first': 'First pull', 'soc.b.first.d': 'Got a first prize', 'soc.b.ssr': 'SSR getter', 'soc.b.ssr.d': 'Pulled an SSR',
    'soc.b.col10': 'Collector', 'soc.b.col10.d': '10 different prizes', 'soc.b.col50': 'Master collector', 'soc.b.col50.d': '50 different prizes',
    'soc.b.shop': 'Shop open', 'soc.b.shop.d': 'Listed a machine', 'soc.b.shop3': 'Chain store', 'soc.b.shop3.d': '3 or more machines',
    'soc.b.sold10': 'Getting known', 'soc.b.sold10.d': 'Machines pulled 10 times', 'soc.b.sold100': 'Popular shop', 'soc.b.sold100.d': 'Machines pulled 100 times',
    'soc.b.liked10': 'Crowd favourite', 'soc.b.liked10.d': '10 likes received', 'soc.b.fans5': 'Has fans', 'soc.b.fans5.d': '5 followers',
    'soc.b.post': 'Square regular', 'soc.b.post.d': 'Posted to the Square', 'soc.b.streak7': '7-day streak', 'soc.b.streak7.d': 'Logged in 7 days in a row',
    'soc.v.machines': 'Machines', 'soc.v.square': 'Square', 'soc.v.rank': 'Ranking',
    'soc.weekly': "This week's theme · {d} days left", 'soc.thSee': 'See entries', 'soc.thJoin': 'Join', 'soc.lastWeek': 'Last week “{t}” top 3',
    'soc.live': 'LIVE', 'soc.tk.pull': '{who} pulled “{m}” ×{n}', 'soc.tk.rare': '{who} hit {r} on “{m}”!',
    'soc.tk.pullHere': '{who} just pulled ×{n}', 'soc.tk.rareHere': '🎉 {who} hit {r}!',
    'soc.sq.new': 'New', 'soc.sq.hot': 'Hot', 'soc.sq.follow': 'Following', 'soc.post': '+ Post',
    'soc.sq.empty': 'No posts yet — be the first! When you pull a card you love, tap “Post to Square” on the result.', 'soc.sq.noFollow': "People you follow haven't posted yet",
    'soc.like': 'Like', 'soc.stamp': 'Stamp', 'soc.more': 'More', 'soc.del': 'Delete', 'soc.report': 'Report', 'soc.seeUser': 'View profile',
    'soc.deleted': 'Deleted', 'soc.reported': 'Thanks, report received', 'soc.openMachine': 'Play this machine', 'soc.likeGift': 'Sent the owner {n} coins ♥',
    'soc.posted': 'Posted to the Square!', 'soc.thTag': "Join this week's theme {t}", 'soc.postTitle': 'Post to Square', 'soc.postPick': 'Pick one from your collection',
    'soc.capPh': 'Say something (optional, 80 chars)', 'soc.send': 'Post', 'soc.pickAgain': 'Pick another',
    'soc.rankLede': 'Pulls in the last 30 days + likes ×3', 'soc.rankEmpty': 'No ranking yet', 'soc.rankLine': 'Pulls {s} · Likes {l}',
    'soc.owner': 'Owner', 'soc.noTalk': 'No comments yet — leave the first one!', 'soc.talkTitle': 'Comments', 'soc.talkPh': 'Say hi to the owner and everyone (120 chars)',
    'soc.tooMany': 'Too fast — try again in a moment', 'soc.gone': "It's gone", 'soc.inspired': 'Inspired by “{n}”', 'soc.remix': 'Use this look',
    'soc.toSquare': 'Post to Square', 'soc.profTitle': 'Profile', 'soc.peName': 'Name', 'soc.peBio': 'One-line bio (optional)', 'soc.peAv': 'Avatar',
    'soc.peShow': 'Showcase (up to 3)', 'soc.peAvPick': 'From collection', 'soc.peAvClear': 'Use letter avatar', 'soc.peSave': 'Save',
    'soc.peAvUp': '📷 Upload image', 'soc.avCrop': 'Crop your avatar', 'soc.avSet': 'Changed — tap Save to apply', 'soc.fromCol': 'From your collection',
    'soc.st0': 'Love it', 'soc.st1': 'Amazing', 'soc.st2': 'LOL', 'soc.st3': 'So moved', 'soc.st4': 'Clap', 'soc.st5': 'Thanks',
    'soc.st6': 'Congrats', 'soc.st7': 'Fire', 'soc.st8': 'Heart', 'soc.st9': 'Sparkly', 'soc.st10': 'Wow', 'soc.st11': 'Sleepy',
    'soc.remixed': 'Made a new machine with the look of “{n}” — colour, background, card back, finish and music copied. Add your own prizes!',
    'soc.joinTheme': "Join this week's theme {t}", 'soc.allowRemix': 'Let others start a machine with this look',
    'wallet.k.like': 'Got a like', 'wallet.k.bonus': 'Mission reward',
    'browse.likes': 'Most liked', 'browse.follow': 'Following', 'browse.emptyFollow': "People you follow haven't listed machines yet. Tap an owner's name to open their page and Follow.", 'browse.emptyTheme': "No machines in this week's theme yet — be the first! (Shop step 5)",
    'soc.themeNeedLink': 'Make the link first (step 5) and list it in Browse to join the theme', 'soc.themeNeedList': "Tick “List in Browse” and “Join this week's theme” appears below it",
  },
});
