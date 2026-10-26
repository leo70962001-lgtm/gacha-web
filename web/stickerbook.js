// シール帳（收集簿的一個分頁，使用者 2026-10-26：「增加貼子的功能 跟貼子簿」）
//   一頁一張台紙（點點、方眼、格紋…可以換），貼紙隨便貼：拖曳移動、右下角的圓鈕轉＋縮放、「はがす」撕下來放回下面
//   貼好的也能用手指慢慢撕下來（使用者 2026-10-27：「這個也可以撕下來」）：從貼紙的邊緣拉＝撕（peel.js 的 PeelLayer，跟台紙一樣的折線）、
//   從中間拉＝移動；撕超過一半就整張下來放回下面那排，不到一半彈回去
//   下面一排＝還沒貼的貼紙（數字＝還剩幾張）：拖到頁面上就貼上去；點一下 → 貼到這頁／貼到轉蛋機／放進轉蛋／丟掉
//   資料在 sticker.js（loadBook／saveBook）；位置 x、y、大小 s 都是頁面寬高的比例，換螢幕大小也一樣
import { loadBook, saveBook, stickerUrl, available, trashOne, PAPERS } from './sticker.js';
import { PeelLayer } from './peel.js';

const MAX_PAGES = 30;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export class StickerBook {
  // o＝{ t, toast, sfx, onMake(), onMachine(sticker), onGacha(sticker), changed() }
  constructor(root, o) {
    this.root = root;
    this.o = o;
    this.page = 0;
    this.sel = -1; // 頁面上選中的那張（index）
    this.pick = null; // 下面選中的那張（id）
    this.trashArm = null;
  }

  _build() {
    const { t } = this.o;
    const r = this.root;
    r.textContent = '';
    const sb = el('div', 'sb');
    const bar = el('div', 'sb-bar');
    this.$prev = el('button', 'icon-btn sb-prev', '‹');
    this.$next = el('button', 'icon-btn sb-next', '›');
    this.$pno = el('span', 'sb-pno');
    this.$papers = el('div', 'sb-papers');
    this.$papers.setAttribute('role', 'radiogroup');
    this.$addp = el('button', 'btn ghost sb-addp');
    bar.append(this.$prev, this.$pno, this.$next, this.$papers, this.$addp);
    this.$page = el('div', 'sb-page');
    this.$tools = el('div', 'sb-tools');
    this.$hint = el('p', 'sb-hint');
    const tray = el('div', 'sb-tray');
    this.$make = el('button', 'btn primary sb-make');
    this.$stock = el('div', 'sb-stock');
    tray.append(this.$make, this.$stock);
    this.$acts = el('div', 'sb-acts card-box');
    this.$acts.hidden = true;
    sb.append(bar, this.$page, this.$hint, tray, this.$acts);
    r.append(sb);
    for (const b of [this.$prev, this.$next]) b.type = 'button';
    this.$prev.onclick = () => this._go(this.page - 1);
    this.$next.onclick = () => this._go(this.page + 1);
    this.$addp.onclick = () => {
      const b = loadBook();
      if (b.pages.length >= MAX_PAGES) return;
      b.pages.push({ bg: PAPERS[b.pages.length % PAPERS.length], items: [] });
      saveBook(b);
      this.page = b.pages.length - 1;
      this.render();
    };
    this.$make.onclick = () => this.o.onMake();
    for (const p of PAPERS) {
      const b = el('button', 'sb-paper paper-' + p);
      b.type = 'button';
      b.dataset.p = p;
      b.setAttribute('role', 'radio');
      b.onclick = () => {
        const bk = loadBook();
        bk.pages[this.page].bg = p;
        saveBook(bk);
        this.render();
      };
      this.$papers.append(b);
    }
    this._bindPage();
    this._bindStock();
    this.built = true;
  }

  _go(i) {
    const b = loadBook();
    this.page = Math.max(0, Math.min(b.pages.length - 1, i));
    this.sel = -1;
    this.o.sfx?.flip?.();
    this.render();
  }

  async render() {
    const { t } = this.o;
    if (!this.built) this._build();
    const b = loadBook();
    this.page = Math.max(0, Math.min(b.pages.length - 1, this.page));
    const pg = b.pages[this.page];
    // 圖的網址先全部拿好（IndexedDB）
    const ids = new Set([...b.list.map((s) => s.id), ...pg.items.map((x) => x.id), ...b.packs.map((p) => p.items.find((x) => !x.saved)?.id).filter(Boolean)]);
    this.urls = Object.fromEntries(await Promise.all([...ids].map(async (id) => [id, await stickerUrl(id)])));
    const byId = Object.fromEntries(b.list.map((s) => [s.id, s]));
    // 上面一排
    this.$pno.textContent = t('stk.page', { n: this.page + 1, m: b.pages.length });
    this.$prev.disabled = this.page === 0;
    this.$next.disabled = this.page >= b.pages.length - 1;
    this.$prev.setAttribute('aria-label', t('stk.prev'));
    this.$next.setAttribute('aria-label', t('stk.next'));
    this.$addp.textContent = t('stk.addPage');
    this.$addp.disabled = b.pages.length >= MAX_PAGES;
    for (const x of this.$papers.children) {
      x.setAttribute('aria-checked', String(x.dataset.p === pg.bg));
      x.setAttribute('aria-label', t('stk.p.' + x.dataset.p));
      x.title = t('stk.p.' + x.dataset.p);
    }
    // 頁面
    const page = this.$page;
    page.className = 'sb-page paper-' + pg.bg;
    page.textContent = '';
    pg.items.forEach((it, i) => {
      const s = byId[it.id];
      const url = this.urls[it.id];
      if (!url) return;
      const d = el('div', 'sb-st shine fin-' + (s?.fin || 'flat') + (i === this.sel ? ' sel' : ''));
      d.dataset.i = i;
      d.style.setProperty('--m', `url("${url}")`);
      const im = el('img');
      im.src = url;
      im.alt = s?.name || '';
      im.draggable = false;
      d.append(im);
      if (i === this.sel) {
        const h = el('span', 'sb-h', '↻');
        h.setAttribute('aria-hidden', 'true');
        d.append(h);
      }
      this._place(d, it);
      page.append(d);
    });
    this.$tools.textContent = '';
    if (this.sel >= 0 && pg.items[this.sel]) {
      const peel = el('button', 'btn', t('stk.peel'));
      const front = el('button', 'btn ghost', t('stk.front'));
      peel.type = front.type = 'button';
      peel.onclick = () => this._peel();
      front.onclick = () => this._front();
      this.$tools.append(peel, front);
      page.append(this.$tools);
    }
    this.$hint.textContent = t(b.packs.length ? 'stk.packHint' : b.list.length ? 'stk.hint' : 'stk.empty');
    // 下面一排：還沒貼的
    this.$make.textContent = t('stk.make');
    this.$stock.textContent = '';
    // 還沒撕的：鋁箔包（封著）／台紙（剩幾張）→ 點了打開，用手指撕
    for (const p of b.packs) {
      const left = p.items.filter((x) => !x.saved).length;
      if (!left) continue;
      const sealed = p.kind === 'foil' && !p.open;
      const tile = el('button', 'sb-tile sb-pack' + (sealed ? ' sealed' : ''));
      tile.type = 'button';
      tile.dataset.pack = p.id;
      tile.title = p.title || '';
      tile.setAttribute('aria-label', t(sealed ? 'stk.packTile' : 'stk.sheetTile', { n: left }));
      const im = el('img');
      if (sealed) im.src = this.o.foilUrl || '';
      else im.src = this.urls[p.items.find((x) => !x.saved)?.id] || '';
      im.alt = '';
      im.draggable = false;
      tile.append(im, el('b', 'sb-n', '×' + left), el('span', 'sb-pk-tag', t(sealed ? 'stk.packTag' : 'stk.sheetTag')));
      this.$stock.append(tile);
    }
    for (const s of b.list) {
      const left = available(b, s);
      const tile = el('button', 'sb-tile shine fin-' + s.fin + (left ? '' : ' used') + (this.pick === s.id ? ' on' : ''));
      tile.type = 'button';
      tile.dataset.id = s.id;
      tile.style.setProperty('--m', `url("${this.urls[s.id] || ''}")`);
      tile.title = s.name;
      tile.setAttribute('aria-label', `${s.name} ×${left}`);
      const im = el('img');
      im.src = this.urls[s.id] || '';
      im.alt = '';
      im.draggable = false;
      const n = el('b', 'sb-n', '×' + left);
      tile.append(im, n);
      this.$stock.append(tile);
    }
    this._renderActs(b);
  }

  _place(d, it) {
    d.style.left = it.x * 100 + '%';
    d.style.top = it.y * 100 + '%';
    d.style.width = it.s * 100 + '%';
    d.style.transform = `translate(-50%, -50%) rotate(${it.r}deg)`;
  }

  _renderActs(b) {
    const { t } = this.o;
    const s = b.list.find((x) => x.id === this.pick);
    const a = this.$acts;
    a.hidden = !s;
    if (!s) return;
    a.textContent = '';
    const im = el('img');
    im.src = this.urls[s.id] || '';
    im.alt = '';
    const info = el('div', 'sb-info');
    info.append(el('b', '', s.name || t('stk.defaultName')), el('small', '', `${t('stk.f.' + s.fin)} · ${t('stk.left', { n: available(b, s) })}${s.from ? ' · ' + s.from : ''}`));
    const row = el('div', 'row');
    const btn = (label, cls, fn, dis) => {
      const x = el('button', 'btn ' + cls, label);
      x.type = 'button';
      x.disabled = !!dis;
      x.onclick = fn;
      row.append(x);
      return x;
    };
    const left = available(b, s);
    btn(t('stk.toPage'), 'primary', () => this._stick(s.id, 0.5 + (Math.random() - 0.5) * 0.3, 0.45 + (Math.random() - 0.5) * 0.3), !left);
    btn(t('stk.toMachine'), 'sun', () => this.o.onMachine(s));
    btn(t('stk.toGacha'), '', () => this.o.onGacha(s));
    const tr = btn(t('stk.trash'), 'ghost', async () => {
      if (this.trashArm !== s.id) {
        this.trashArm = s.id;
        tr.textContent = t('stk.trashConfirm');
        return;
      }
      this.trashArm = null;
      if (await trashOne(s.id)) {
        if (!loadBook().list.some((x) => x.id === s.id)) this.pick = null;
        this.render();
        this.o.changed?.();
      }
    }, !left);
    a.append(im, info, row);
  }

  // 貼上去（x、y＝頁面上的比例位置）
  _stick(id, x, y) {
    const b = loadBook();
    const s = b.list.find((v) => v.id === id);
    if (!s || available(b, s) < 1) return this.o.toast(this.o.t('stk.none'));
    const pg = b.pages[this.page];
    pg.items.push({ id, x: Math.max(0.05, Math.min(0.95, x)), y: Math.max(0.05, Math.min(0.95, y)), r: Math.round((Math.random() - 0.5) * 28), s: 0.28 });
    saveBook(b);
    this.sel = pg.items.length - 1;
    this.o.sfx?.stick?.();
    this.render();
    this.o.changed?.();
  }

  // 「はがす」：從右上角自己慢慢撕下來（跟手指撕一樣的折線）
  async _peel() {
    const i = this.sel;
    const st = this.$page.querySelector(`.sb-st[data-i="${i}"]`);
    const im = st?.querySelector('img');
    const it = loadBook().pages[this.page].items[i];
    if (st && im?.complete && it) {
      const L = this._layerFor(st, it, im);
      const h = Math.max(im.naturalWidth, im.naturalHeight) / 2;
      const A = { x: h * 0.62, y: -h * 0.62 };
      this.o.sfx?.peelTick?.();
      await L.animate(A, A, L.far(A, { x: A.x - 1, y: A.y + 1 }), 0.55, true);
      L.end();
    }
    this._remove(i);
  }
  _remove(i) {
    const b = loadBook();
    b.pages[this.page].items.splice(i, 1);
    saveBook(b);
    this.sel = -1;
    this.o.sfx?.peel?.();
    this.render();
    this.o.changed?.();
  }
  // 撕的那一層：蓋在頁面上，貼紙本身先藏起來
  _layerFor(st, it, im) {
    this.layer = this.layer || new PeelLayer(this.$page);
    const pr = this.$page.getBoundingClientRect();
    this.layer.begin(im, it.x * pr.width, it.y * pr.height, it.s * pr.width, (it.r * Math.PI) / 180);
    st.style.visibility = 'hidden';
    this.$tools.hidden = true;
    return this.layer;
  }

  _front() {
    const b = loadBook();
    const items = b.pages[this.page].items;
    items.push(items.splice(this.sel, 1)[0]);
    saveBook(b);
    this.sel = items.length - 1;
    this.render();
  }

  // 頁面上的拖曳：貼紙本體＝移動；右下圓鈕＝轉＋縮放；空白處＝取消選取
  _bindPage() {
    const page = this.$page;
    let drag = null;
    page.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.sb-tools')) return;
      const st = e.target.closest('.sb-st');
      const handle = e.target.closest('.sb-h');
      if (!st) {
        if (this.sel >= 0) {
          this.sel = -1;
          this.render();
        }
        return;
      }
      const i = +st.dataset.i;
      const b = loadBook();
      const it = b.pages[this.page].items[i];
      if (!it) return;
      e.preventDefault();
      try {
        page.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 不是真的指標（測試） */
      }
      const pr = page.getBoundingClientRect();
      if (handle) {
        const cx = pr.left + it.x * pr.width;
        const cy = pr.top + it.y * pr.height;
        drag = { kind: 'rot', i, b, it, st, cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), d0: Math.hypot(e.clientX - cx, e.clientY - cy), r0: it.r, s0: it.s, moved: true };
        return;
      }
      // 按在邊緣（貼紙方框外圈）→ 動了就是撕；按在中間 → 移動
      const cx = pr.left + it.x * pr.width;
      const cy = pr.top + it.y * pr.height;
      const size = it.s * pr.width;
      const rad = (-it.r * Math.PI) / 180;
      const lx = ((e.clientX - cx) * Math.cos(rad) - (e.clientY - cy) * Math.sin(rad)) / size;
      const ly = ((e.clientX - cx) * Math.sin(rad) + (e.clientY - cy) * Math.cos(rad)) / size;
      if (Math.max(Math.abs(lx), Math.abs(ly)) > 0.28) {
        drag = { kind: 'edge', i, b, it, st, pr, x0: e.clientX, y0: e.clientY, moved: false };
        return;
      }
      drag = { kind: 'move', i, b, it, st, pr, ox: e.clientX - (pr.left + it.x * pr.width), oy: e.clientY - (pr.top + it.y * pr.height), x0: e.clientX, y0: e.clientY, moved: false };
      if (this.sel !== i) {
        this.sel = i;
        this.render().then(() => {
          if (drag) drag.st = page.querySelector(`.sb-st[data-i="${i}"]`) || drag.st;
        });
      }
    });
    page.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const { it } = drag;
      if (drag.kind === 'edge') {
        // 從邊緣拉動了 → 開始撕
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
        const im = drag.st.querySelector('img');
        if (!im?.complete) return;
        const L = this._layerFor(drag.st, it, im);
        drag.kind = 'peel';
        drag.moved = true;
        drag.L = L;
        drag.A = L.local(drag.x0 - drag.pr.left, drag.y0 - drag.pr.top);
        drag.P = drag.A;
      }
      if (drag.kind === 'peel') {
        if (drag.anim) return;
        drag.P = drag.L.local(e.clientX - drag.pr.left, e.clientY - drag.pr.top);
        drag.L.draw(drag.A, drag.P);
        const p = drag.L.progress(drag.A, drag.P);
        if (Math.abs(p - (drag.tick || 0)) > 0.08) {
          drag.tick = p;
          this.o.sfx?.peelTick?.();
        }
        return;
      }
      if (drag.kind === 'rot') {
        const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
        const d = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
        it.r = Math.round(drag.r0 + ((a - drag.a0) * 180) / Math.PI);
        it.s = Math.max(0.08, Math.min(0.9, drag.s0 * (d / Math.max(10, drag.d0))));
      } else {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
        const pr = drag.pr;
        it.x = Math.max(0, Math.min(1, (e.clientX - drag.ox - pr.left) / pr.width));
        it.y = Math.max(0, Math.min(1, (e.clientY - drag.oy - pr.top) / pr.height));
      }
      this._place(drag.st, it);
    });
    const up = async () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'edge') {
        // 只是點一下邊緣 → 選它
        if (this.sel !== d.i) {
          this.sel = d.i;
          this.render();
        }
        return;
      }
      if (d.kind === 'peel') {
        const p = d.L.progress(d.A, d.P);
        if (p > 0.5) {
          // 超過一半 → 自己撕完，放回下面那排
          await d.L.animate(d.A, d.P, d.L.far(d.A, d.P), 0.3, true);
          d.L.end();
          this._remove(d.i);
        } else {
          await d.L.animate(d.A, d.P, d.A, 0.2);
          d.L.end();
          d.st.style.visibility = '';
          this.$tools.hidden = false;
        }
        return;
      }
      if (!d.moved) return;
      saveBook(d.b);
      if (d.kind === 'move') this.o.sfx?.stick?.();
    };
    page.addEventListener('pointerup', up);
    page.addEventListener('pointercancel', up);
  }

  // 下面一排：點一下＝選它（出現動作）；拖到頁面上＝貼上去
  _bindStock() {
    const stock = this.$stock;
    let drag = null;
    stock.addEventListener('pointerdown', (e) => {
      const tile = e.target.closest('.sb-tile');
      if (!tile) return;
      drag = { id: tile.dataset.id, pack: tile.dataset.pack, x0: e.clientX, y0: e.clientY, ghost: null, tile, pid: e.pointerId };
    });
    addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (drag.pack) return; // パック：點了才打開，不能拖
      if (!drag.ghost) {
        // 往上拉（或滑鼠拖）才算拖曳；手機橫著滑＝捲動這一排
        if (Math.hypot(dx, dy) < 8 || (e.pointerType === 'touch' && Math.abs(dy) < Math.abs(dx))) return;
        const b = loadBook();
        const s = b.list.find((v) => v.id === drag.id);
        if (!s || available(b, s) < 1) {
          drag = null;
          return;
        }
        const g = el('img', 'sb-ghost');
        g.src = this.urls[drag.id] || '';
        g.alt = '';
        document.body.append(g);
        drag.ghost = g;
        try {
          drag.tile.setPointerCapture(e.pointerId);
        } catch (err) {
          /* 已經放開 */
        }
      }
      drag.ghost.style.left = e.clientX + 'px';
      drag.ghost.style.top = e.clientY + 'px';
    });
    const up = (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      const d = drag;
      drag = null;
      if (d.pack) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) this.o.onPack?.(d.pack);
        return;
      }
      if (!d.ghost) {
        // 點一下：選它／再點一下取消
        this.pick = this.pick === d.id ? null : d.id;
        this.trashArm = null;
        this.render();
        return;
      }
      d.ghost.remove();
      const pr = this.$page.getBoundingClientRect();
      if (e.clientX >= pr.left && e.clientX <= pr.right && e.clientY >= pr.top && e.clientY <= pr.bottom) this._stick(d.id, (e.clientX - pr.left) / pr.width, (e.clientY - pr.top) / pr.height);
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', (e) => {
      if (drag?.ghost) drag.ghost.remove();
      if (drag && e.pointerId === drag.pid) drag = null;
    });
  }
}
