// 收集簿（使用者 2026-10-25：「把收集部給優化 分卡片冊跟轉蛋收集品 卡片冊做成像冊子一樣」）
//   卡片冊（Binder）：像真的集換式卡冊 — Gemini 畫的封面（點了翻開）→ 封面內側是目錄 → 一頁 9 格透明卡套（3×3）
//     寬的畫面兩頁攤開、中間三個鐵環；窄的（手機）一次一頁。翻頁＝那一張紙繞著書背轉 180°（3D），
//     箭頭、左右滑、鍵盤 ←→ 都能翻；每台轉卡機從新的一頁開始，第一頁上面有索引標籤
//   轉蛋收藏（Shelf）：Gemini 畫的木頭層板＋扭蛋壁紙的展示櫃；每個獎品站在打開的扭蛋殼裡（有去背的話是立起來的公仔），
//     還沒轉到的是關著的灰色扭蛋
import { RARITY } from './decor.js';
import { t } from './i18n.js';
import { titleOf } from './albumedit.js';
import { finOf } from './codec.js';

const PER = 9; // 一頁 9 格
const TEX = 'assets/tex/';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const have = (e) => e.order.filter((n) => e.got[n]).length;

export class Binder {
  // opts＝{ onCard(e, name) 打開大卡、onPlay(link) 再去轉、editing 編輯中、onEditItem(e, name)、onRename(e)、onDelete(e) }（每次 renderAlbum 換新的）
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.s = 0; // 攤開到第幾張（0＝闔著）
    this.busy = false;
    root.className = 'binder';
    this.book = el('div', 'bk-book');
    this.left = el('div', 'bk-side bk-left');
    this.right = el('div', 'bk-side bk-right');
    this.rings = el('div', 'bk-rings');
    for (let i = 0; i < 3; i++) this.rings.append(el('i'));
    this.book.append(this.left, this.right, this.rings);
    const nav = el('div', 'bk-nav');
    this.prevB = el('button', 'icon-btn bk-prev', '‹');
    this.nextB = el('button', 'icon-btn bk-next', '›');
    this.pageL = el('span', 'bk-page');
    nav.append(this.prevB, this.pageL, this.nextB);
    root.append(this.book, nav);
    this.prevB.onclick = () => this.go(-1);
    this.nextB.onclick = () => this.go(1);
    // 左右滑翻頁（點卡套的時候不算）
    let sx = null;
    this.book.addEventListener('pointerdown', (e) => (sx = e.clientX));
    this.book.addEventListener('pointerup', (e) => {
      if (sx == null) return;
      const dx = e.clientX - sx;
      sx = null;
      if (Math.abs(dx) > 50) this.go(dx < 0 ? 1 : -1);
    });
    addEventListener('keydown', (e) => {
      if (!root.offsetParent || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('.sheet:not([hidden])')) return;
      if (e.key === 'ArrowRight') this.go(1);
      if (e.key === 'ArrowLeft') this.go(-1);
    });
    new ResizeObserver(() => this.fit()).observe(root);
  }

  // 一頁多寬：寬的畫面兩頁攤開（每頁最多 430 px），窄的一頁（高度也要塞得下）
  fit() {
    const W = this.root.clientWidth;
    if (!W) return;
    const wide = W >= 700;
    const pw = wide ? Math.min(430, (W - 28 - 34) / 2) : Math.min(W - 36, 440, Math.max(240, (innerHeight - 230) * 0.74));
    this.root.style.setProperty('--pw', `${Math.floor(pw)}px`);
    if (wide !== this.wide) {
      // 兩頁 ↔ 一頁：換算成同一個位置
      if (this.wide != null) this.s = wide ? Math.ceil(this.s / 2) : Math.max(0, this.s * 2 - 1);
      this.wide = wide;
      this.render();
    }
  }

  set(entries) {
    this.entries = entries;
    const pages = [];
    for (const [pid, e] of entries) {
      const n = Math.max(1, Math.ceil(e.order.length / PER));
      for (let k = 0; k < n; k++) pages.push({ pid, e, k, n, start: k * PER, slots: e.order.slice(k * PER, (k + 1) * PER) });
    }
    this.pages = pages;
    if (this.wide == null) this.fit();
    this.render();
  }

  // 兩頁攤開：第 i 張紙＝正面（右頁）＋背面（左頁）；第 0 張是封面（背面＝目錄）
  get leaves() {
    const L = [{ front: 'cover', back: 'index' }];
    for (let i = 0; i < this.pages.length; i += 2) L.push({ front: this.pages[i], back: this.pages[i + 1] || 'blank' });
    return L;
  }
  // 一頁一頁：封面、目錄、內頁
  get faces() {
    return ['cover', 'index', ...this.pages];
  }
  get max() {
    return this.wide ? this.leaves.length : this.faces.length - 1;
  }
  spread(s = this.s) {
    if (!this.wide) return { left: null, right: this.faces[s] };
    const L = this.leaves;
    return { left: s > 0 ? L[s - 1].back : null, right: s < L.length ? L[s].front : 'backcover' };
  }

  render() {
    if (!this.pages) return;
    // 第一次畫：不要從「打開」滑到「闔著」
    if (!this.shown) {
      this.shown = true;
      this.root.classList.add('bk-init');
      requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.remove('bk-init')));
    }
    this.s = Math.max(0, Math.min(this.s, this.max));
    const { left, right } = this.spread();
    this.root.classList.toggle('spread', !!this.wide);
    this.root.classList.toggle('single', !this.wide);
    this.root.classList.toggle('closed', this.s === 0);
    this.root.classList.toggle('editing', !!this.opts.editing);
    this.left.replaceChildren(...(left ? [this.face(left)] : []));
    this.right.replaceChildren(this.face(right));
    this.prevB.disabled = this.s === 0;
    this.nextB.disabled = this.s >= this.max;
    this.prevB.setAttribute('aria-label', t('album.prev'));
    this.nextB.setAttribute('aria-label', t('album.next'));
    // 頁碼（內頁從 1 開始算）
    const total = this.pages.length;
    const no = (f) => (f && typeof f === 'object' ? this.pages.indexOf(f) + 1 : 0);
    const a = [no(left), no(right)].filter(Boolean);
    const label = a.length ? t('album.pageOf', { a: a.join('–'), b: total }) : left === 'index' || right === 'index' ? t('album.index') : t('album.cover');
    this.pageL.textContent = label;
  }

  // 翻頁：那張紙繞著書背轉過去（往後翻＝從左邊轉回來）
  go(d, to = null) {
    if (this.busy) return;
    const s1 = to ?? this.s + d;
    if (s1 < 0 || s1 > this.max || s1 === this.s) return;
    const fwd = s1 > this.s;
    const before = this.spread();
    const after = this.spread(s1);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.s = s1;
    if (reduced) return this.render();
    this.busy = true;
    // 紙：正面＝往前翻時目前的右頁、背面＝翻過去後的左頁（往後翻反過來）
    const leaf = el('div', 'bk-leaf');
    const fr = el('div', 'bk-face bk-front');
    const bk = el('div', 'bk-face bk-back');
    const shade = el('i', 'bk-shade');
    if (this.wide) {
      fr.append(this.face(fwd ? before.right : after.right));
      bk.append(this.face(fwd ? after.left : before.left));
    } else {
      fr.append(this.face(fwd ? before.right : after.right));
      bk.append(this.face('blank-back'));
    }
    leaf.append(fr, bk, shade);
    // 底下先換好：往前翻 → 右頁換成新的、左頁還是舊的；往後翻 → 左頁換成新的、右頁還是舊的
    if (fwd) {
      this.right.replaceChildren(this.face(after.right));
      this.root.classList.toggle('closed', false);
    } else {
      if (this.wide) this.left.replaceChildren(...(after.left ? [this.face(after.left)] : []));
      else this.right.replaceChildren(this.face(before.right));
    }
    if (fwd && before.right === 'cover') leaf.classList.add('is-cover');
    if (!fwd && after.right === 'cover') leaf.classList.add('is-cover');
    this.book.append(leaf);
    const from = fwd ? 0 : -180;
    const to2 = fwd ? -180 : 0;
    const dur = leaf.classList.contains('is-cover') ? 800 : 620;
    const anim = leaf.animate([{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to2}deg)` }], { duration: dur, easing: 'cubic-bezier(.45,.05,.25,1)' });
    shade.animate([{ opacity: 0 }, { opacity: 0.35, offset: 0.5 }, { opacity: 0 }], { duration: dur });
    if (!this.wide) leaf.animate(fwd ? [{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 1 }], { duration: dur });
    anim.onfinish = () => {
      leaf.remove();
      this.busy = false;
      this.render();
    };
  }

  // 一面紙的內容
  face(f) {
    if (f === 'cover') {
      const c = el('button', 'bf bf-cover');
      c.type = 'button';
      c.setAttribute('aria-label', t('album.open'));
      c.append(el('span', 'bf-open', t('album.open')));
      c.onclick = () => this.go(1);
      return c;
    }
    if (f === 'backcover') return el('div', 'bf bf-lining');
    if (f === 'blank-back') return el('div', 'bf bf-page bf-blankback');
    if (f === 'index') return this.indexPage();
    const p = el('div', 'bf bf-page');
    const grid = el('div', 'bk-grid');
    if (f === 'blank') {
      for (let i = 0; i < PER; i++) grid.append(this.emptyPocket());
      p.append(grid);
      return p;
    }
    const { e, k, n, start, slots } = f;
    // 每台機台的第一頁：上面一個索引標籤（機台名、收集進度）
    const tab = el('div', 'bk-tab' + (k === 0 ? '' : ' cont'));
    tab.append(el('b', '', titleOf(e)), el('small', '', `${have(e)} / ${e.order.length}${n > 1 ? ` · ${k + 1}/${n}` : ''}`));
    p.append(tab);
    slots.forEach((name, i) => grid.append(this.pocket(e, name, start + i)));
    for (let i = slots.length; i < PER; i++) grid.append(this.emptyPocket());
    p.append(grid, el('span', 'bk-no', String(this.pages.indexOf(f) + 1)));
    return p;
  }

  emptyPocket() {
    const m = el('div', 'pk empty');
    m.append(el('span', 'pk-sleeve'));
    return m;
  }

  pocket(e, name, idx) {
    const it = e.items[name] || { r: 0 };
    const got = e.got[name] || 0;
    const R = RARITY[it.r] || RARITY[0];
    if (!got) {
      const m = el('div', 'pk miss');
      m.append(el('span', 'pk-no', `No.${String(idx + 1).padStart(2, '0')}`), el('span', 'pk-q', '?'), el('span', 'pk-sleeve'));
      return m;
    }
    const fx = finOf(e.fin, it.r); // 店家選的表面加工
    const b = el('button', `pk got r${it.r} fx-${fx}`);
    b.type = 'button';
    b.style.setProperty('--rc', `var(--r-${R.key.toLowerCase()})`);
    const card = el('span', 'pk-card');
    if (it.t) card.style.backgroundImage = `url("${it.t}")`;
    card.append(el('span', 'pk-holo fx-' + fx), el('span', 'pk-name', name));
    if (it.md) card.append(el('span', 'pk-media', it.md[0] === 'yt' || it.md[0] === 'vi' ? '▶' : '♪'));
    b.append(card, el('span', 'pk-rk', R.key), el('span', 'pk-cnt', '×' + got), el('span', 'pk-sleeve'));
    b.setAttribute('aria-label', `${name} ${R.key} ×${got}`);
    b.onclick = () => (this.opts.editing ? this.opts.onEditItem(e, name) : this.opts.onCard(e, name));
    return b;
  }

  // 目錄（封面內側）：每台轉卡機一行 — 名字、進度、翻到那頁、再去轉
  indexPage() {
    const p = el('div', 'bf bf-page bf-index');
    p.append(el('h3', '', t('album.index')));
    const ul = el('ul');
    for (const [, e] of this.entries) {
      const li = el('li');
      const first = this.pages.findIndex((x) => x.e === e);
      const go = el('button', 'idx-go');
      go.type = 'button';
      go.setAttribute('aria-label', `${titleOf(e)} — ${t('album.go')}`);
      const bar = el('i', 'idx-bar');
      const fill = el('i');
      fill.style.width = `${Math.round((have(e) / Math.max(1, e.order.length)) * 100)}%`;
      bar.append(fill);
      go.append(el('b', '', titleOf(e)), bar, el('small', '', `${have(e)} / ${e.order.length}`), el('span', 'idx-pg', `p.${first + 1}`));
      go.onclick = () => this.go(0, this.wide ? Math.floor((first + 1) / 2) + 1 : first + 2); // 那一頁在右頁（偶數）或左頁（奇數）的那一張
      li.append(go);
      if (this.opts.editing) {
        // 編輯中：改名、刪掉這台
        const ren = el('button', 'btn idx-again', t('ed.rename'));
        ren.onclick = () => this.opts.onRename(e);
        const del = el('button', 'btn idx-again danger', t('ed.delete'));
        del.onclick = () => this.opts.onDelete(e);
        li.append(ren, del);
      } else if (e.link) {
        const again = el('button', 'btn sun idx-again', t('album.again'));
        again.onclick = () => this.opts.onPlay(e.link);
        li.append(again);
      }
      ul.append(li);
    }
    p.append(ul);
    return p;
  }
}

// 轉蛋收藏：每台轉蛋機一個展示櫃（壁紙＋一層一層的木板），獎品站在打開的扭蛋殼裡
export function renderShelf(root, entries, { onCard, onPlay, editing, onEditItem, onRename, onDelete }) {
  root.className = 'shelf' + (editing ? ' editing' : '');
  root.textContent = '';
  for (const [, e] of entries) {
    const cab = el('section', 'cab card-box');
    const head = el('div', 'cab-head');
    const prog = el('div', 'prog');
    const bar = el('i');
    bar.style.width = `${Math.round((have(e) / Math.max(1, e.order.length)) * 100)}%`;
    prog.append(bar);
    head.append(el('h2', '', titleOf(e)), prog, el('small', '', `${have(e)} / ${e.order.length}`));
    if (editing) {
      const ren = el('button', 'btn', t('ed.rename'));
      ren.onclick = () => onRename(e);
      const del = el('button', 'btn danger', t('ed.delete'));
      del.onclick = () => onDelete(e);
      head.append(ren, del);
    } else if (e.link) {
      const again = el('button', 'btn sun', t('album.again'));
      again.onclick = () => onPlay(e.link);
      head.append(again);
    }
    const body = el('div', 'cab-body');
    body.style.setProperty('--wall', `url("${TEX}wall.webp")`);
    body.style.setProperty('--row', `url("${TEX}shelf_row.webp")`);
    e.order.forEach((name, i) => {
      const it = e.items[name] || { r: 0 };
      const got = e.got[name] || 0;
      const R = RARITY[it.r] || RARITY[0];
      const cell = el(got ? 'button' : 'div', `cap ${got ? 'got' : 'miss'} r${it.r}`);
      cell.style.setProperty('--rc', `var(--r-${R.key.toLowerCase()})`);
      cell.style.setProperty('--i', i);
      const toy = el('span', 'cap-toy' + (got && it.s ? ' fig' : ''));
      if (got) toy.style.backgroundImage = `url("${it.s || it.t}")`;
      // 公仔：去背圖上面空的那段（頭頂以上）切掉，主體剛好站滿這格的高度
      if (got && it.s) toy.style.backgroundSize = `auto ${Math.round(100 / Math.max(0.4, 1 - (it.st ?? 0)))}%`;
      else toy.textContent = '?';
      cell.append(el('span', 'cap-dome'), toy, el('span', 'cap-cup'), el('span', 'cap-tag', got ? name : t('album.miss')));
      if (got && it.md) cell.append(el('span', 'cap-media', it.md[0] === 'yt' || it.md[0] === 'vi' ? '▶' : '♪'));
      if (got) {
        cell.type = 'button';
        cell.append(el('span', 'cap-rk', R.key), el('span', 'cap-cnt', '×' + got));
        cell.setAttribute('aria-label', `${name} ${R.key} ×${got}`);
        cell.onclick = () => (editing ? onEditItem(e, name) : onCard(e, name));
      }
      body.append(cell);
    });
    cab.append(head, body);
    root.append(cab);
  }
}

