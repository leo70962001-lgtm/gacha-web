// 收集簿編輯（使用者 2026-10-26：「收集相簿 可以編輯或刪除」）
//   數量：got＝base（從機台轉到的，取大的）＋tr（好友交換進出）−cut（自己拿掉的）
//   刪掉一台＝全部拿掉＋hidden：之後再轉這台，新轉到的才會讓它重新出現（app.js 的 albumSync 也照這個算）
//   改名只改收集簿裡顯示的名字（title），機台本身的名字不動
import { RARITY } from './decor.js';
import { t } from './i18n.js';

const ALBUM = 'clatter.album';

// 舊資料沒有 base：用現在的 got 推回去
export function ensureBase(e, n) {
  e.base = e.base || {};
  e.tr = e.tr || {};
  e.cut = e.cut || {};
  if (e.base[n] == null) e.base[n] = Math.max(0, (e.got[n] || 0) - (e.tr[n] || 0) + (e.cut[n] || 0));
}
export function recount(e, n) {
  const g = (e.base?.[n] || 0) + (e.tr?.[n] || 0) - (e.cut?.[n] || 0);
  if (g > 0) {
    e.got[n] = g;
    delete e.hidden;
  } else delete e.got[n];
}
export const titleOf = (e) => e.title || e.name;

function el(tag, cls, text) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text != null) x.textContent = text;
  return x;
}
function btn(cls, text, fn) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.onclick = fn;
  return b;
}

export class AlbumEdit {
  // d＝{ store, toast, openSheet, closeSheet, changed }
  constructor(d) {
    this.d = d;
    this.sheet = document.getElementById('sheet-edit');
    this.body = document.getElementById('ed-body');
  }
  album() {
    return this.d.store.get(ALBUM) || {};
  }
  save(a) {
    this.d.store.set(ALBUM, a);
    this.d.closeSheet('sheet-edit');
    this.d.changed();
  }
  open(build) {
    this.body.textContent = '';
    build(this.body);
    this.d.openSheet('sheet-edit');
  }

  // 一個獎品：調整持有數量（只能減少，0＝拿掉）
  item(e, n) {
    const a = this.album();
    const x = a[e.key];
    if (!x?.got[n]) return;
    const cur = x.got[n];
    let v = cur;
    const it = x.items[n] || { r: 0 };
    const R = RARITY[it.r] || RARITY[0];
    this.open((b) => {
      b.append(el('h2', '', t('ed.item', { n })), el('p', 'tr-hint', titleOf(x)));
      const pic = el('span', `tr-mini ${x.kind === 'card' ? 'card' : ''} r${it.r || 0}`);
      pic.style.setProperty('--rc', `var(--r-${R.key.toLowerCase()})`);
      const ph = el('span', 'tr-pic');
      if (it.t) ph.style.backgroundImage = `url("${it.t}")`;
      pic.append(ph, el('span', 'tr-rk', R.key));
      const num = el('strong', 'ed-num', String(v));
      const minus = btn('icon-btn', '−', () => set(v - 1));
      const plus = btn('icon-btn', '+', () => set(v + 1));
      minus.setAttribute('aria-label', '−1');
      plus.setAttribute('aria-label', '+1');
      const step = el('div', 'ed-step');
      step.append(minus, num, plus);
      const row = el('div', 'ed-row');
      const lab = el('div', 'ed-lab');
      lab.append(el('small', '', t('ed.count')), step);
      row.append(pic, lab);
      const go = btn('btn primary', t('ed.save'), () => {
        if (v === cur) return this.d.closeSheet('sheet-edit');
        ensureBase(x, n);
        x.cut[n] = (x.cut[n] || 0) + (cur - v);
        recount(x, n);
        this.save(a);
        this.d.toast(t('ed.removed', { c: cur - v, n }));
      });
      const set = (k) => {
        v = Math.max(0, Math.min(cur, k));
        num.textContent = String(v);
        minus.disabled = v <= 0;
        plus.disabled = v >= cur;
        go.textContent = v === 0 ? t('ed.removeAll') : t('ed.save');
        go.classList.toggle('danger', v < cur);
      };
      set(v);
      const acts = el('div', 'row ed-acts');
      acts.append(go, btn('btn ghost', t('ed.cancel'), () => this.d.closeSheet('sheet-edit')));
      b.append(row, el('p', 'tr-hint', t('ed.countHint')), acts);
    });
  }

  // 改名（只改收集簿裡顯示的；空白＝用回原本的名字）
  rename(e) {
    const a = this.album();
    const x = a[e.key];
    if (!x) return;
    this.open((b) => {
      b.append(el('h2', '', t('ed.renameTitle')));
      const f = el('form', 'ed-form');
      const inp = el('input', 'tr-note');
      inp.maxLength = 40;
      inp.value = titleOf(x);
      inp.placeholder = x.name;
      inp.setAttribute('aria-label', t('ed.renameTitle'));
      const acts = el('div', 'row ed-acts');
      const go = el('button', 'btn primary', t('ed.save'));
      go.type = 'submit';
      acts.append(go, btn('btn ghost', t('ed.cancel'), () => this.d.closeSheet('sheet-edit')));
      f.append(inp, el('p', 'tr-hint', t('ed.renameHint', { n: x.name })), acts);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const v = inp.value.trim();
        if (v && v !== x.name) x.title = v;
        else delete x.title;
        this.save(a);
        this.d.toast(t('ed.saved'));
      };
      b.append(f);
      setTimeout(() => inp.select(), 50);
    });
  }

  // 刪掉一台：全部拿掉、藏起來
  remove(e) {
    const a = this.album();
    const x = a[e.key];
    if (!x) return;
    const names = Object.keys(x.got);
    const c = names.reduce((s, n) => s + x.got[n], 0);
    this.open((b) => {
      b.append(el('h2', '', t('ed.deleteTitle', { n: titleOf(x) })), el('p', 'tr-hint', t('ed.deleteText', { k: names.length, c })));
      const acts = el('div', 'row ed-acts');
      acts.append(
        btn('btn primary danger', t('ed.delete'), () => {
          for (const n of names) {
            ensureBase(x, n);
            x.cut[n] = (x.base[n] || 0) + (x.tr[n] || 0);
            recount(x, n);
          }
          x.hidden = true;
          this.save(a);
          this.d.toast(t('ed.deleted', { n: titleOf(x) }));
        }),
        btn('btn ghost', t('ed.cancel'), () => this.d.closeSheet('sheet-edit')),
      );
      b.append(acts);
    });
  }
}
