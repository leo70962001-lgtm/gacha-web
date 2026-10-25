// 好友交換（使用者 2026-10-25：「追加卡片跟轉蛋好友交換功能」，supabase/06_trade.sql）
//   好友碼＝錢包 id；加好友＝輸入好友碼，或打開邀請連結（#f.<好友碼>）
//   送出：從收集簿選一個 → 選好友 → 「交換」（對方選一個回送）或「送禮」→ 留言；送出成功就先從收集簿拿掉
//   收到：對方的東西＋留言 → 交換（選一個回送）／收下（送禮）／拒絕
//   我送出的：等回覆（可以取消 → 放回來）、對方收了（回送的東西放進收集簿）、被拒絕（放回來）
//   收集簿還是存在各自的裝置，伺服器只記交換到哪一步；處理過的交換記在 clatter.tradeApplied，不會重複加
//   別人送來的資料都要檢查（圖片只收 data:image 的 base64、名字截長度）才放進收集簿
import { RARITY } from './decor.js';
import { t } from './i18n.js';
import { tradeMe, tradeLookup, tradeOffer, tradeList, tradeAccept, tradeDecline, tradeCancel, tradeDone } from './cloud.js';

const ALBUM = 'clatter.album';
const CODE = /^[0-9A-Za-z]{10}$/;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, fn) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.onclick = fn;
  return b;
}
export const fmtCode = (c) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
export const parseCode = (s) => String(s || '').replace(/[\s-]/g, '');

// 收集簿的機台 key ↔ 交換用的 key：自己的草稿（draft.<uid>）在別人那邊是 d.<我的好友碼>.<uid>
const toTradeKey = (k, me) => (k.startsWith('draft.') ? `d.${me}.${k.slice(6)}` : k);
const fromTradeKey = (k, me) => (k.startsWith(`d.${me}.`) ? 'draft.' + k.slice(me.length + 3) : k);
const globalLink = (l) => (typeof l === 'string' && (/^s\.[0-9A-Za-z]{10}$/.test(l) || (/^g1z\.[A-Za-z0-9._~-]+$/.test(l) && l.length < 60000)) ? l : '');
const okImg = (u) => (typeof u === 'string' && u.length < 150000 && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : null);
const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
const rar = (r) => (Number.isInteger(r) && r >= 0 && r <= 3 ? r : 0);

// 收集簿裡的一個獎品 → 要送出去的資料（機台資訊＋縮圖）
function snapshot(key, e, name, me) {
  const it = e.items[name] || {};
  const order = e.order.slice(0, 16);
  if (!order.includes(name)) order.push(name);
  const rr = {};
  for (const n of order) rr[n] = rar(e.items[n]?.r);
  return {
    m: { key: toTradeKey(key, me), link: globalLink(e.link), name: e.name, kind: e.kind === 'card' ? 'card' : 'capsule', order, rar: rr },
    n: name, r: rar(it.r), t: it.t || null, s: it.s || null, b: it.b || null, st: Number.isFinite(it.st) ? it.st : null,
  };
}

// 別人送來的 → 檢查過的乾淨資料（不合格回傳 null）
export function clean(x) {
  if (!x || typeof x !== 'object') return null;
  const n = str(x.n, 40);
  if (!n) return null;
  const m = x.m && typeof x.m === 'object' ? x.m : {};
  const order = (Array.isArray(m.order) ? m.order : []).map((o) => str(o, 40)).filter(Boolean).slice(0, 16);
  if (!order.includes(n)) order.push(n);
  const rr = {};
  for (const o of order) rr[o] = rar(m.rar?.[o]);
  rr[n] = rar(x.r ?? rr[n]);
  const key = typeof m.key === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(m.key) ? m.key : 'x.' + str(m.name, 20).replace(/[^A-Za-z0-9]/g, '') + order.length;
  return {
    m: { key, link: globalLink(m.link), name: str(m.name, 40) || '?', kind: m.kind === 'card' ? 'card' : 'capsule', order, rar: rr },
    n, r: rr[n], t: okImg(x.t), s: okImg(x.s), b: okImg(x.b), st: Number.isFinite(x.st) ? Math.min(1, Math.max(0, x.st)) : null,
  };
}

export class Trade {
  // d＝{ store, toast, loadWallet, openSheet, closeSheet, openCardView, albumChanged, shareBase, cloudOk, badge }
  constructor(d) {
    this.d = d;
    this.list = { in: [], out: [] };
    this.me = null;
    this.sheet = document.getElementById('sheet-trade');
    this.body = document.getElementById('tr-body');
  }

  get friends() {
    return this.d.store.get('clatter.friends') || [];
  }
  set friends(v) {
    this.d.store.set('clatter.friends', v);
  }
  get log() {
    return this.d.store.get('clatter.tradeLog') || [];
  }
  addLog(e) {
    this.d.store.set('clatter.tradeLog', [{ ...e, at: Date.now() }, ...this.log].slice(0, 20));
  }
  applied(id) {
    return (this.d.store.get('clatter.tradeApplied') || []).includes(String(id));
  }
  markApplied(id) {
    const a = this.d.store.get('clatter.tradeApplied') || [];
    this.d.store.set('clatter.tradeApplied', [String(id), ...a].slice(0, 300));
  }

  // ---------- 收集簿 ----------
  album() {
    return this.d.store.get(ALBUM) || {};
  }
  mine() {
    const out = [];
    for (const [key, e] of Object.entries(this.album()).sort((x, y) => (y[1].ts || 0) - (x[1].ts || 0)))
      for (const n of e.order) if (e.got[n] > 0) out.push({ key, e, n, it: e.items[n] || { r: 0 }, got: e.got[n] });
    return out;
  }
  take(key, n) {
    const a = this.album();
    const e = a[key];
    if (!e?.got[n]) return false;
    e.got[n] -= 1;
    if (e.got[n] <= 0) delete e.got[n];
    this.d.store.set(ALBUM, a);
    return true;
  }
  // 收到的東西放進收集簿（同一台機台就併在一起）→ 回傳 { e, n }（打開大卡用）
  put(x) {
    const a = this.album();
    const key = fromTradeKey(x.m.key, this.w.id);
    const e = a[key] || { name: x.m.name, kind: x.m.kind, link: x.m.link, items: {}, got: {}, order: [] };
    if (!e.link && x.m.link) e.link = x.m.link;
    e.order = [...e.order, ...x.m.order.filter((o) => !e.order.includes(o))];
    for (const o of x.m.order) if (!e.items[o]) e.items[o] = { r: x.m.rar[o] ?? 0 };
    const old = e.items[x.n] || {};
    e.items[x.n] = { r: x.r, t: old.t || x.t, s: old.s || x.s, b: old.b || x.b, st: old.st ?? x.st };
    e.got[x.n] = (e.got[x.n] || 0) + 1;
    e.ts = Date.now();
    a[key] = e;
    this.d.store.set(ALBUM, a);
    return { e: { ...e, key }, n: x.n };
  }
  restore(tradeKey, n) {
    const a = this.album();
    const key = fromTradeKey(String(tradeKey || ''), this.w.id);
    const e = a[key];
    if (!e || typeof n !== 'string') return;
    e.got[n] = (e.got[n] || 0) + 1;
    this.d.store.set(ALBUM, a);
  }

  // ---------- 伺服器 ----------
  async ensure() {
    if (!this.d.cloudOk()) throw new Error('e.network');
    this.w = await this.d.loadWallet();
    if (!this.w) throw new Error('e.network');
    if (!this.me) this.me = await tradeMe(this.w);
    return this.w;
  }
  // 拿最新的交換；我送出的有結果了就處理（放進收集簿／放回來）
  async refresh() {
    await this.ensure();
    this.list = await tradeList(this.w);
    let changed = false;
    for (const o of this.list.out) {
      if (o.status === 'open' || this.applied(o.id)) continue;
      if (o.status === 'accepted') {
        const back = clean(o.back);
        if (back) {
          const got = this.put(back);
          this.addLog({ k: 'swap', who: o.name || fmtCode(o.to), a: String(o.item || ''), b: back.n });
          this.d.toast(t('tr.gotBack', { n: o.name || fmtCode(o.to), i: back.n }));
          this.last = got;
        } else this.addLog({ k: 'gave', who: o.name || fmtCode(o.to), a: String(o.item || '') });
      } else if (o.status === 'declined') {
        this.restore(o.m, o.item);
        this.d.toast(t('tr.returned', { n: o.name || fmtCode(o.to), i: String(o.item || '') }));
      }
      this.markApplied(o.id);
      changed = true;
      tradeDone(this.w, o.id).catch(() => {});
    }
    if (changed) this.d.albumChanged();
    this.badge();
    return this.list;
  }
  badge() {
    const n = this.list.in.length;
    this.d.badge(n);
  }
  // 背景：已經有錢包的話，每分鐘看一次有沒有人送東西來（收集簿分頁的數字）
  poll() {
    clearInterval(this.timer);
    const tick = () => {
      if (document.hidden || !this.d.store.get('clatter.wallet') || !this.d.cloudOk()) return;
      this.refresh().then(() => this.root?.isConnected && !this.root.hidden && this.renderLists()).catch(() => {});
    };
    tick();
    this.timer = setInterval(tick, 60000);
  }

  // ---------- 好友 ----------
  async addFriend(code, quiet = false) {
    code = parseCode(code);
    if (!CODE.test(code)) return this.d.toast(t('tr.badCode'));
    await this.ensure();
    if (code === this.w.id) return this.d.toast(t('tr.self'));
    const names = await tradeLookup([code]);
    if (!(code in names)) return this.d.toast(t('tr.badCode'));
    const f = this.friends.filter((x) => x.id !== code);
    f.unshift({ id: code, name: names[code] || '' });
    this.friends = f;
    if (!quiet) this.d.toast(t('tr.added', { n: names[code] || fmtCode(code) }));
    return true;
  }
  async syncNames() {
    const ids = this.friends.map((f) => f.id);
    if (!ids.length) return;
    const names = await tradeLookup(ids).catch(() => null);
    if (!names) return;
    this.friends = this.friends.map((f) => ({ ...f, name: names[f.id] ?? f.name }));
  }
  nameOf(id) {
    const f = this.friends.find((x) => x.id === id);
    return f?.name || fmtCode(id);
  }

  // ---------- 畫面：收集簿的「好友交換」分頁 ----------
  async render(root) {
    this.root = root;
    root.className = 'trade';
    root.textContent = '';
    if (!this.d.cloudOk()) {
      root.append(el('p', 'album-empty card-box', t('tr.offline')));
      return;
    }
    const wait = el('p', 'album-empty card-box', '…');
    root.append(wait);
    try {
      await this.ensure();
      await Promise.all([this.refresh(), this.syncNames()]);
    } catch (e) {
      wait.textContent = t('tr.offline');
      return;
    }
    root.textContent = '';
    root.append(this.meCard(), (this.inBox = el('section', 'tr-box card-box')), (this.friendBox = el('section', 'tr-box card-box')), (this.outBox = el('section', 'tr-box card-box')), (this.logBox = el('section', 'tr-box card-box')));
    this.renderLists();
  }

  meCard() {
    const c = el('section', 'tr-me card-box');
    const code = el('div', 'tr-code');
    code.append(el('small', '', t('tr.myCode')), el('strong', '', fmtCode(this.w.id)));
    const acts = el('div', 'tr-acts');
    acts.append(
      btn('btn', t('tr.copy'), () => navigator.clipboard?.writeText(this.w.id).then(() => this.d.toast(t('tr.copied')), () => {})),
      btn('btn sun', t('tr.invite'), () => this.invite()),
    );
    const nm = el('form', 'tr-name');
    const lab = el('label', '', t('tr.name'));
    const inp = el('input');
    inp.id = 'tr-name-in';
    lab.htmlFor = 'tr-name-in';
    inp.maxLength = 24;
    inp.placeholder = t('tr.namePh');
    inp.value = this.me?.name || '';
    nm.append(lab, inp, btn('btn', t('tr.save'), null));
    nm.querySelector('button').type = 'submit';
    nm.onsubmit = async (ev) => {
      ev.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      try {
        this.me = await tradeMe(this.w, v);
        this.d.toast(t('tr.saved'));
      } catch (e) {
        this.d.toast(t(e.message));
      }
    };
    c.append(code, acts, nm);
    return c;
  }

  async invite() {
    const url = `${this.d.shareBase()}#f.${this.w.id}`;
    const text = t('tr.inviteText', { c: fmtCode(this.w.id) });
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Clatter', text, url });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    navigator.clipboard?.writeText(`${text}\n${url}`).then(() => this.d.toast(t('tr.inviteCopied')), () => {});
  }

  renderLists() {
    if (!this.inBox) return;
    // 收到的
    const ib = this.inBox;
    ib.textContent = '';
    ib.append(el('h2', '', `${t('tr.inbox')}${this.list.in.length ? ` (${this.list.in.length})` : ''}`));
    if (!this.list.in.length) ib.append(el('p', 'tr-none', t('tr.none')));
    for (const o of this.list.in) {
      const g = clean(o.give);
      if (!g) continue;
      const who = o.name || this.nameOf(o.from);
      const row = el('div', 'tr-offer');
      const txt = el('div', 'tr-otext');
      txt.append(el('b', '', t(o.mode === 'gift' ? 'tr.gives' : 'tr.wantsSwap', { n: who })), el('span', '', `${g.n} · ${g.m.name}`));
      if (o.note) txt.append(el('q', '', String(o.note).slice(0, 80)));
      const acts = el('div', 'tr-acts');
      acts.append(
        btn('btn primary', t(o.mode === 'gift' ? 'tr.acceptGift' : 'tr.accept'), () => this.acceptFlow(o, g)),
        btn('btn', t('tr.decline'), () => this.decline(o)),
      );
      if (!this.friends.some((f) => f.id === o.from)) acts.append(btn('btn', t('tr.add'), () => this.addFriend(o.from).then(() => this.renderLists())));
      row.append(this.mini(g), txt, acts);
      ib.append(row);
    }
    // 好友
    const fb = this.friendBox;
    fb.textContent = '';
    fb.append(el('h2', '', t('tr.friends')));
    const add = el('form', 'tr-add');
    const inp = el('input');
    inp.placeholder = t('tr.addPh');
    inp.maxLength = 14;
    inp.setAttribute('aria-label', t('tr.addPh'));
    add.append(inp, btn('btn sun', t('tr.add'), null));
    add.querySelector('button').type = 'submit';
    add.onsubmit = async (ev) => {
      ev.preventDefault();
      if (await this.addFriend(inp.value).catch((e) => this.d.toast(t(e.message)))) this.renderLists();
    };
    fb.append(add);
    if (!this.friends.length) fb.append(el('p', 'tr-none', t('tr.noFriends')));
    for (const f of this.friends) {
      const row = el('div', 'tr-friend');
      const nm = el('div', 'tr-fname');
      nm.append(el('b', '', f.name || fmtCode(f.id)));
      if (f.name) nm.append(el('small', '', fmtCode(f.id)));
      const del = btn('btn ghost', t('tr.remove'), () => {
        if (del.dataset.sure) {
          this.friends = this.friends.filter((x) => x.id !== f.id);
          this.renderLists();
        } else {
          del.dataset.sure = '1';
          del.textContent = t('tr.removeSure');
        }
      });
      row.append(nm, btn('btn primary', t('tr.send'), () => this.sendFlow({ to: f.id })), del);
      fb.append(row);
    }
    // 送出的
    const ob = this.outBox;
    ob.textContent = '';
    ob.append(el('h2', '', t('tr.outbox')));
    const open = this.list.out.filter((o) => o.status === 'open');
    if (!open.length) ob.append(el('p', 'tr-none', t('tr.none')));
    for (const o of open) {
      const row = el('div', 'tr-friend');
      const nm = el('div', 'tr-fname');
      nm.append(el('b', '', `${String(o.item || '')} → ${o.name || this.nameOf(o.to)}`), el('small', '', t(o.mode === 'gift' ? 'tr.gift' : 'tr.swap') + ' · ' + t('tr.pending')));
      row.append(nm, btn('btn ghost', t('tr.cancel'), () => this.cancel(o)));
      ob.append(row);
    }
    // 紀錄
    const lb = this.logBox;
    lb.textContent = '';
    lb.append(el('h2', '', t('tr.log')));
    const log = this.log;
    if (!log.length) lb.append(el('p', 'tr-none', t('tr.none')));
    const ul = el('ul', 'tr-log');
    for (const l of log.slice(0, 10)) ul.append(el('li', '', t('tr.log.' + l.k, { n: l.who, a: l.a, b: l.b })));
    lb.append(ul);
  }

  // 小張的獎品（卡片或圓徽章）
  mini(x, got = 0) {
    const R = RARITY[x.r] || RARITY[0];
    const m = el('span', `tr-mini ${x.m?.kind === 'card' || x.kind === 'card' ? 'card' : ''} r${x.r}`);
    m.style.setProperty('--rc', `var(--r-${R.key.toLowerCase()})`);
    const pic = el('span', 'tr-pic');
    if (x.t) pic.style.backgroundImage = `url("${x.t}")`;
    m.append(pic, el('span', 'tr-rk', R.key));
    if (got) m.append(el('span', 'tr-cnt', got === 1 ? t('tr.last') : '×' + got));
    return m;
  }

  // ---------- 對話框（sheet-trade）----------
  open(build) {
    this.body.textContent = '';
    build(this.body);
    if (this.sheet.hidden) this.d.openSheet('sheet-trade');
  }
  close() {
    this.d.closeSheet('sheet-trade');
  }

  // 選一個自己的獎品（送出、回送都用這個）
  pick(title, onPick, back) {
    this.open((b) => {
      b.append(el('h2', '', title));
      const items = this.mine();
      if (!items.length) {
        b.append(el('p', 'tr-none', t('tr.empty')));
        return;
      }
      let lastKey = null;
      let grid = null;
      for (const x of items) {
        if (x.key !== lastKey) {
          lastKey = x.key;
          b.append(el('h3', 'tr-ph', x.e.name));
          grid = el('div', 'tr-grid');
          b.append(grid);
        }
        const c = btn('tr-pick', '', () => onPick(x));
        c.append(this.mini({ ...x.it, kind: x.e.kind, r: x.it.r ?? 0 }, x.got), el('span', 'tr-pn', x.n));
        grid.append(c);
      }
      if (back) b.append(btn('btn ghost tr-back', t('tr.back'), back));
    });
  }

  // 送出：item＝{ key, n }（從大卡進來）、to＝好友（從好友列進來）
  sendFlow(st = {}) {
    if (!this.d.cloudOk()) return this.d.toast(t('tr.offline'));
    const s = { mode: 'swap', note: '', ...st };
    const draw = () =>
      this.open((b) => {
        b.append(el('h2', '', t('tr.sendTitle')));
        // 送什麼
        const what = el('div', 'tr-field');
        what.append(el('small', '', t('tr.what')));
        const a = this.album();
        const e = s.item && a[s.item.key];
        if (e && e.got[s.item.n] > 0) {
          const it = e.items[s.item.n] || { r: 0 };
          const row = el('div', 'tr-sel');
          row.append(this.mini({ ...it, kind: e.kind, r: it.r ?? 0 }, e.got[s.item.n]), el('b', '', s.item.n), btn('btn ghost', t('tr.change'), pickIt));
          what.append(row);
        } else what.append(btn('btn sun', t('tr.pick'), pickIt));
        // 送給誰
        const who = el('div', 'tr-field');
        who.append(el('small', '', t('tr.to')));
        const chips = el('div', 'chips');
        if (!this.friends.length) who.append(el('p', 'tr-none', t('tr.noFriends')));
        for (const f of this.friends) {
          const c = btn('chip', f.name || fmtCode(f.id), () => {
            s.to = f.id;
            draw();
          });
          c.setAttribute('aria-pressed', String(s.to === f.id));
          chips.append(c);
        }
        who.append(chips);
        // 交換／送禮
        const how = el('div', 'tr-field');
        how.append(el('small', '', t('tr.mode')));
        const mc = el('div', 'chips');
        for (const k of ['swap', 'gift']) {
          const c = btn('chip', t('tr.' + k), () => {
            s.mode = k;
            draw();
          });
          c.setAttribute('aria-pressed', String(s.mode === k));
          mc.append(c);
        }
        how.append(mc, el('p', 'tr-hint', t(s.mode === 'swap' ? 'tr.swapHint' : 'tr.giftHint')));
        const note = el('input', 'tr-note');
        note.maxLength = 80;
        note.placeholder = t('tr.note');
        note.value = s.note;
        note.oninput = () => (s.note = note.value);
        const go = btn('btn primary big', t('tr.sendBtn'), () => this.send(s, go));
        go.disabled = !(e && e.got[s.item.n] > 0 && s.to);
        b.append(what, who, how, note, go);
      });
    const pickIt = () =>
      this.pick(t('tr.pick'), (x) => {
        s.item = { key: x.key, n: x.n };
        draw();
      }, draw);
    draw();
  }

  async send(s, go) {
    go.disabled = true;
    try {
      await this.ensure();
      const a = this.album();
      const e = a[s.item.key];
      if (!e?.got[s.item.n]) throw new Error('e.gone');
      const snap = snapshot(s.item.key, e, s.item.n, this.w.id);
      await tradeOffer(this.w, s.to, s.mode, snap, s.note.trim());
      this.take(s.item.key, s.item.n);
      this.d.albumChanged();
      this.d.toast(t('tr.sent', { n: this.nameOf(s.to) }));
      this.close();
      await this.refresh().catch(() => {});
      this.renderLists();
    } catch (err) {
      go.disabled = false;
      this.d.toast(t(err.message));
    }
  }

  // 收到的：送禮直接收下；交換先選一個回送
  acceptFlow(o, g) {
    const who = o.name || this.nameOf(o.from);
    if (o.mode === 'gift') return this.accept(o, g, null);
    this.open((b) => {
      b.append(el('h2', '', t('tr.wantsSwap', { n: who })));
      const row = el('div', 'tr-sel');
      row.append(this.mini(g), el('b', '', `${g.n} · ${g.m.name}`));
      b.append(row);
      if (o.note) b.append(el('q', 'tr-q', String(o.note).slice(0, 80)));
      b.append(btn('btn primary big', t('tr.pickBack'), () =>
        this.pick(t('tr.pickBack'), (x) => this.confirmBack(o, g, x), () => this.acceptFlow(o, g))));
    });
  }
  confirmBack(o, g, x) {
    this.open((b) => {
      b.append(el('h2', '', t('tr.confirm')));
      const sw = el('div', 'tr-swap');
      sw.append(this.mini({ ...x.it, kind: x.e.kind, r: x.it.r ?? 0 }), el('span', 'tr-arrow', '⇄'), this.mini(g));
      b.append(sw, el('p', 'tr-hint', t('tr.confirmText', { a: x.n, b: g.n })));
      const go = btn('btn primary big', t('tr.swapGo'), () => this.accept(o, g, x, go));
      b.append(go, btn('btn ghost', t('tr.back'), () => this.acceptFlow(o, g)));
    });
  }
  async accept(o, g, x, go) {
    if (go) go.disabled = true;
    try {
      await this.ensure();
      let back = null;
      if (x) {
        const e = this.album()[x.key];
        if (!e?.got[x.n]) throw new Error('e.gone');
        back = snapshot(x.key, e, x.n, this.w.id);
      }
      await tradeAccept(this.w, o.id, back);
      if (x) this.take(x.key, x.n);
      const got = this.put(g);
      this.addLog(x ? { k: 'swap', who: o.name || this.nameOf(o.from), a: x.n, b: g.n } : { k: 'got', who: o.name || this.nameOf(o.from), b: g.n });
      this.d.albumChanged();
      this.close();
      this.list.in = this.list.in.filter((i) => i.id !== o.id);
      this.badge();
      this.renderLists();
      this.d.toast(t('tr.got', { n: o.name || this.nameOf(o.from), i: g.n }));
      this.d.openCardView(got.e, got.n); // 收到的東西直接用 3D 大卡打開
    } catch (err) {
      if (go) go.disabled = false;
      this.d.toast(t(err.message));
      if (err.message === 'e.gone') this.refresh().then(() => this.renderLists()).catch(() => {});
    }
  }
  async decline(o) {
    try {
      await tradeDecline(this.w, o.id);
    } catch (err) {
      if (err.message !== 'e.gone') return this.d.toast(t(err.message));
    }
    this.list.in = this.list.in.filter((i) => i.id !== o.id);
    this.badge();
    this.renderLists();
  }
  async cancel(o) {
    try {
      await tradeCancel(this.w, o.id);
      this.restore(o.m, o.item);
      this.markApplied(o.id);
      this.d.albumChanged();
      this.d.toast(t('tr.cancelled', { i: String(o.item || '') }));
    } catch (err) {
      this.d.toast(t(err.message));
    }
    await this.refresh().catch(() => {});
    this.renderLists();
  }
}
