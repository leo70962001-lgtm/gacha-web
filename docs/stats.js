// 機台的數據後台（使用者 2026-10-28：「增加在自己的機台裡可以知道有誰轉過自己的轉蛋跟國家分布」「可以參考 YouTube 的後台可以看到的加進去」）
//   照 YouTube Studio 的分法：概覽（次數、玩家、金幣、每人平均＋跟前一段比、每日長條、最近 48 小時、最新動態）
//   觀眾（新玩家／回頭客、國家、裝置、從哪裡來、幾點來轉的熱圖、轉最多的玩家）、獎品（每個獎品轉走幾個、稀有度分布）
//   資料：supabase/09_players.sql 的 machine_stats（最近 2000 筆＋全部的分布）；國家是玩家裝置時區推的
import { flag, countryName } from './geo.js';

const DAY = 864e5;
const el = (tag, cls, text) => {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text != null) x.textContent = text;
  return x;
};
const nf = (n) => Number(n || 0).toLocaleString();
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 滑過（手機：點）長條、格子 → 小提示框
let tip = null;
function bindTip(node, text) {
  const show = (e) => {
    tip = tip || document.body.appendChild(el('div', 'st-tip'));
    tip.textContent = text();
    tip.hidden = false;
    const r = node.getBoundingClientRect();
    const x = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2));
    tip.style.left = x + 'px';
    tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
    e?.stopPropagation?.();
  };
  node.addEventListener('pointerenter', show);
  node.addEventListener('focus', show);
  node.addEventListener('click', show);
  node.addEventListener('pointerleave', () => tip && (tip.hidden = true));
  node.addEventListener('blur', () => tip && (tip.hidden = true));
  node.tabIndex = 0;
}

// 一排橫的長條（國家、裝置、來源…）：rows＝[{ label, icon, n }]，大的在上面
function barList(rows, total, { muted = [] } = {}) {
  const box = el('div', 'st-bars');
  const max = Math.max(1, ...rows.map((r) => r.n));
  for (const r of rows) {
    const row = el('div', 'st-bar' + (muted.includes(r.key) ? ' muted' : ''));
    const lab = el('span', 'st-bl');
    if (r.icon) lab.append(el('i', 'st-ico', r.icon));
    lab.append(r.label);
    const track = el('span', 'st-track');
    const fill = el('span', 'st-fill');
    fill.style.width = r.n ? `${Math.max(2, (r.n / max) * 100)}%` : '0';
    track.append(fill);
    row.append(lab, track, el('span', 'st-bv', `${nf(r.n)} · ${pct(r.n, total)}%`));
    bindTip(row, () => `${r.label}：${nf(r.n)}（${pct(r.n, total)}%）`);
    box.append(row);
  }
  return box;
}

export class MachineStats {
  // d＝{ t, lang(), load() → machine_stats 的結果, pulled() → { item key: n }, items() → [{ key, name, r, qty, thumb }] }
  constructor(root, d) {
    this.root = root;
    this.d = d;
    this.period = 28;
    this.tab = 'overview';
  }
  async open() {
    const { t } = this.d;
    this.root.textContent = '';
    this.root.append(el('p', 'hint-text', t('st.loading')));
    try {
      [this.data, this.pulled] = await Promise.all([this.d.load(), this.d.pulled().catch(() => ({}))]);
    } catch (e) {
      this.root.textContent = '';
      this.root.append(el('p', 'hint-text', t(e.message === 'e.notReady' ? 'st.notReady' : 'st.fail')));
      return;
    }
    this.render();
  }

  // 這段期間的明細（period 天；0＝全部）
  slice(days, back = 0) {
    const ev = this.data.events || [];
    if (!days) return ev;
    const now = Date.now();
    const to = now - back * days * DAY;
    const from = to - days * DAY;
    return ev.filter((e) => {
      const ts = new Date(e.t).getTime();
      return ts > from && ts <= to;
    });
  }
  render() {
    const { t } = this.d;
    const root = this.root;
    root.textContent = '';
    // 上面：期間、分頁
    const bar = el('div', 'st-top');
    const per = el('div', 'chips st-chips');
    for (const p of [7, 28, 90, 0]) {
      const b = el('button', 'chip', p ? t('st.days', { n: p }) : t('st.all'));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(this.period === p));
      b.onclick = () => {
        this.period = p;
        this.render();
      };
      per.append(b);
    }
    const tabs = el('div', 'chips st-tabs');
    for (const k of ['overview', 'audience', 'prizes']) {
      const b = el('button', 'chip', t('st.tab.' + k));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(this.tab === k));
      b.onclick = () => {
        this.tab = k;
        this.render();
      };
      tabs.append(b);
    }
    bar.append(tabs, per);
    root.append(bar);
    if (!this.data.pulls) {
      root.append(el('p', 'album-empty card-box', t('st.empty')));
      return;
    }
    const body = el('div', 'st-body');
    root.append(body);
    if (this.tab === 'overview') this.overview(body);
    else if (this.tab === 'audience') this.audience(body);
    else this.prizes(body);
    root.append(el('p', 'st-note', t('st.note')));
  }

  card(parent, title, sub) {
    const c = el('section', 'st-card card-box');
    const h = el('div', 'st-h');
    h.append(el('h3', null, title));
    if (sub) h.append(el('small', null, sub));
    c.append(h);
    parent.append(c);
    return c;
  }

  overview(body) {
    const { t } = this.d;
    const all = !this.period;
    const cur = this.slice(this.period);
    const prev = all ? null : this.slice(this.period, 1);
    const sum = (ev) => ev.reduce((a, e) => a + e.n, 0);
    const uniq = (ev) => new Set(ev.map((e) => e.w)).size;
    const capped = all && (this.data.events || []).length >= 2000;
    const k = {
      pulls: all ? this.data.pulls : sum(cur),
      players: all ? this.data.players_n : uniq(cur),
      coins: all ? this.data.coins : null,
    };
    // 金幣：明細沒有每筆金額 → 用全部的平均單價換算
    const unit = this.data.pulls ? this.data.coins / this.data.pulls : 0;
    if (k.coins == null) k.coins = Math.round(sum(cur) * unit);
    k.avg = k.players ? (k.pulls / k.players).toFixed(1) : '0';
    const pk = prev ? { pulls: sum(prev), players: uniq(prev), coins: Math.round(sum(prev) * unit) } : null;
    const tiles = el('div', 'st-kpis');
    const tile = (label, v, pv) => {
      const x = el('div', 'st-kpi card-box');
      x.append(el('small', null, label), el('b', null, typeof v === 'string' ? v : nf(v)));
      if (pv != null && typeof v === 'number') {
        const d = pv ? Math.round(((v - pv) / pv) * 100) : null;
        x.append(el('span', 'st-delta' + (d == null ? '' : d >= 0 ? ' up' : ' down'), d == null ? t('st.new') : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% ${t('st.vsPrev', { n: this.period })}`));
      }
      tiles.append(x);
    };
    tile(t('st.k.pulls'), k.pulls, pk?.pulls);
    tile(t('st.k.players'), k.players, pk?.players);
    tile(t('st.k.coins'), k.coins, pk?.coins);
    tile(t('st.k.avg'), k.avg);
    body.append(tiles);
    // 每日長條（全部＝最近 90 天）
    const days = this.period || 90;
    const c = this.card(body, t('st.daily'), capped ? t('st.capped') : null);
    const now = new Date();
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets.push({ key: dayKey(d), d, n: 0, w: new Set() });
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    for (const e of this.slice(days)) {
      const i = idx.get(dayKey(new Date(e.t)));
      if (i == null) continue;
      buckets[i].n += e.n;
      buckets[i].w.add(e.w);
    }
    const max = Math.max(1, ...buckets.map((b) => b.n));
    const chart = el('div', 'st-cols');
    chart.style.setProperty('--n', days);
    for (const b of buckets) {
      const col = el('span', 'st-col');
      const f = el('span', 'st-colf');
      f.style.height = b.n ? `${Math.max(3, (b.n / max) * 100)}%` : '0';
      col.append(f);
      bindTip(col, () => `${b.d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', weekday: 'short' })}　${t('st.tipPulls', { n: b.n, p: b.w.size })}`);
      chart.append(col);
    }
    const axis = el('div', 'st-axis');
    axis.append(el('span', null, buckets[0].d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })), el('span', null, t('st.today')));
    const yl = el('span', 'st-ymax', nf(max));
    c.append(yl, chart, axis);
    // 最近 48 小時（像 YouTube 的即時）＋最新動態
    const live = this.card(body, t('st.live'));
    const hrs = Array.from({ length: 48 }, () => 0);
    const nowMs = Date.now();
    for (const e of this.data.events || []) {
      const h = Math.floor((nowMs - new Date(e.t).getTime()) / 36e5);
      if (h >= 0 && h < 48) hrs[47 - h] += e.n;
    }
    const lv = el('div', 'st-live');
    lv.append(el('b', 'st-big', nf(hrs.reduce((a, b) => a + b, 0))), el('small', null, t('st.liveSub')));
    const mx = Math.max(1, ...hrs);
    const mini = el('div', 'st-cols mini');
    mini.style.setProperty('--n', 48);
    hrs.forEach((n, i) => {
      const col = el('span', 'st-col');
      const f = el('span', 'st-colf');
      f.style.height = n ? `${Math.max(4, (n / mx) * 100)}%` : '0';
      col.append(f);
      bindTip(col, () => t('st.hoursAgo', { h: 47 - i, n }));
      mini.append(col);
    });
    lv.append(mini);
    const feed = el('ul', 'st-feed');
    for (const e of (this.data.events || []).slice(-8).reverse()) {
      const li = el('li');
      const who = this.who(e.w);
      li.append(el('span', 'st-flag', flag(e.c)), el('b', null, who), el('span', null, `×${e.n}`), el('small', null, this.ago(e.t)));
      feed.append(li);
    }
    live.append(lv, el('h4', null, t('st.latest')), feed);
  }

  // 玩家顯示名：名字（好友那邊設的）＞「玩家 AbCd」；自己的錢包＝「自己」
  who(w4) {
    const p = (this.data.players || []).find((x) => x.w === w4);
    if (p?.me) return this.d.t('st.me');
    return p?.name || this.d.t('st.player', { w: w4 });
  }
  ago(ts) {
    const s = (Date.now() - new Date(ts).getTime()) / 1000;
    const { t } = this.d;
    if (s < 3600) return t('st.minAgo', { n: Math.max(1, Math.round(s / 60)) });
    if (s < 86400) return t('st.hrAgo', { n: Math.round(s / 3600) });
    return new Date(ts).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  }

  audience(body) {
    const { t } = this.d;
    const lang = this.d.lang();
    const all = !this.period;
    const cur = this.slice(this.period);
    const from = all ? 0 : Date.now() - this.period * DAY;
    // 新玩家／回頭客：第一次轉在這段期間裡＝新玩家
    const ps = (this.data.players || []).filter((p) => new Date(p.last).getTime() > from);
    const fresh = ps.filter((p) => new Date(p.first).getTime() > from).length;
    const ret = ps.length - fresh;
    const nr = this.card(body, t('st.newRet'));
    const split = el('div', 'st-split');
    const a = el('span', 'st-sa');
    a.style.flex = String(Math.max(fresh, 0.0001));
    const b = el('span', 'st-sb');
    b.style.flex = String(Math.max(ret, 0.0001));
    split.append(a, b);
    const leg = el('div', 'st-legend');
    leg.append(el('span', 'st-la', `${t('st.new2')} ${nf(fresh)}（${pct(fresh, ps.length)}%）`), el('span', 'st-lb', `${t('st.returning')} ${nf(ret)}（${pct(ret, ps.length)}%）`));
    nr.append(split, leg);
    // 國家／裝置／來源：這段期間的明細（全部＝伺服器全部的分布）
    const dist = (field, allKey) => {
      if (all) return this.data[allKey] || {};
      const m = {};
      for (const e of cur) m[e[field] || '??'] = (m[e[field] || '??'] || 0) + e.n;
      return m;
    };
    const rowsOf = (m, label, icon) =>
      Object.entries(m)
        .map(([key, n]) => ({ key, n, label: label(key), icon: icon?.(key) }))
        .sort((x, y) => (x.key === '??') - (y.key === '??') || y.n - x.n);
    const grid = el('div', 'st-grid');
    body.append(grid);
    const cm = dist('c', 'countries');
    const ctot = Object.values(cm).reduce((x, y) => x + y, 0);
    let crows = rowsOf(cm, (k) => countryName(k, lang) || t('st.unknownC'), (k) => flag(k));
    if (crows.filter((r) => r.key !== '??').length > 10) {
      const known = crows.filter((r) => r.key !== '??');
      const other = known.slice(10).reduce((s, r) => s + r.n, 0);
      crows = [...known.slice(0, 10), { key: 'other', n: other, label: t('st.otherC'), icon: '🌐' }, ...crows.filter((r) => r.key === '??')];
    }
    this.card(grid, t('st.countries'), t('st.countriesSub', { n: crows.filter((r) => r.key !== '??' && r.key !== 'other').length })).append(barList(crows, ctot, { muted: ['??'] }));
    const dm = dist('d', 'devices');
    this.card(grid, t('st.devices')).append(barList(rowsOf(dm, (k) => t('st.dev.' + (k === '??' ? 'unknown' : k)), (k) => ({ phone: '📱', tablet: '📲', desktop: '💻' })[k] || '·'), Object.values(dm).reduce((x, y) => x + y, 0), { muted: ['??'] }));
    const sm = dist('s', 'sources');
    this.card(grid, t('st.sources')).append(barList(rowsOf(sm, (k) => t('st.src.' + (k === '??' ? 'unknown' : k)), (k) => ({ browse: '🧭', link: '🔗', album: '📒', shop: '🏪', other: '·' })[k] || '·'), Object.values(sm).reduce((x, y) => x + y, 0), { muted: ['??'] }));
    // 幾點來轉：星期 × 小時（看的人的當地時間）
    const hm = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const e of cur) {
      const d = new Date(e.t);
      hm[d.getDay()][d.getHours()] += e.n;
    }
    const hmax = Math.max(1, ...hm.flat());
    const heat = this.card(body, t('st.when'), t('st.whenSub'));
    const tbl = el('div', 'st-heat');
    const wd = [...Array(7)].map((_, i) => new Date(2026, 0, 4 + i).toLocaleDateString(lang === 'zh' ? 'zh-TW' : lang, { weekday: 'short' }));
    tbl.append(el('span'));
    for (let h = 0; h < 24; h++) tbl.append(el('span', 'st-hh', h % 6 ? '' : String(h)));
    for (let d = 0; d < 7; d++) {
      tbl.append(el('span', 'st-hd', wd[d]));
      for (let h = 0; h < 24; h++) {
        const v = hm[d][h];
        const cell = el('span', 'st-hc');
        cell.style.setProperty('--k', v ? (0.15 + 0.85 * (v / hmax)).toFixed(3) : 0);
        bindTip(cell, () => `${wd[d]} ${h}:00–${h + 1}:00　${t('st.tipN', { n: v })}`);
        tbl.append(cell);
      }
    }
    heat.append(tbl);
    // 轉最多的玩家
    const top = this.card(body, t('st.top'), t('st.topSub', { n: ps.length }));
    const ul = el('ol', 'st-top10');
    for (const p of ps.slice().sort((x, y) => y.n - x.n).slice(0, 10)) {
      const li = el('li');
      li.append(el('span', 'st-flag', flag(p.c)), el('b', null, p.me ? t('st.me') : p.name || t('st.player', { w: p.w })), el('span', null, t('st.timesCoins', { n: nf(p.n), c: nf(p.coins) })), el('small', null, this.ago(p.last)));
      ul.append(li);
    }
    top.append(ul);
  }

  prizes(body) {
    const { t } = this.d;
    const items = this.d.items();
    const pulled = this.pulled || {};
    const total = Object.values(pulled).reduce((a, b) => a + b, 0);
    const c = this.card(body, t('st.prizeTitle'), t('st.prizeSub'));
    const rows = items.map((it) => ({ key: it.key, n: pulled[it.key] || 0, label: it.name, r: it.r, thumb: it.thumb, left: Math.max(0, it.qty - (pulled[it.key] || 0)) })).sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...rows.map((r) => r.n));
    const box = el('div', 'st-bars st-prizes');
    for (const r of rows) {
      const row = el('div', 'st-bar');
      const lab = el('span', 'st-bl');
      if (r.thumb) {
        const im = el('img');
        im.src = r.thumb;
        im.alt = '';
        lab.append(im);
      }
      lab.append(el('i', 'st-rk r' + r.r, ['N', 'R', 'SR', 'SSR'][r.r]), r.label);
      const track = el('span', 'st-track');
      const fill = el('span', 'st-fill');
      fill.style.width = `${r.n ? Math.max(2, (r.n / max) * 100) : 0}%`;
      track.append(fill);
      row.append(lab, track, el('span', 'st-bv', t('st.pulledLeft', { n: nf(r.n), l: nf(r.left) })));
      bindTip(row, () => `${r.label}：${t('st.pulledLeft', { n: nf(r.n), l: nf(r.left) })}`);
      box.append(row);
    }
    c.append(box);
    // 稀有度分布
    const rr = [0, 0, 0, 0];
    for (const r of rows) rr[r.r] += r.n;
    const rc = this.card(body, t('st.rarity'));
    rc.append(barList(rr.map((n, i) => ({ key: 'r' + i, n, label: ['N', 'R', 'SR', 'SSR'][i] })), total));
  }
}
