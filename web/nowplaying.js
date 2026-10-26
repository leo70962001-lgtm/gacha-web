// 有音樂／影片的獎品：Apple Music「正在播放」那種卡（使用者 2026-10-26：「有音樂或動畫的設計改成這樣的設計」）
//   背景＝獎品圖放大模糊＋從圖裡抓的顏色做的光斑（慢慢飄）；大張圓角封面（影片就是影片本身）、名稱／機台、
//   進度條（可以拖）＋已播／剩下時間、⏪ 10 秒 ⏯ ⏩ 10 秒、音量、重複播放
//   YouTube／SoundCloud／Spotify 只能用官方嵌入（自己的按鈕控制不到）：YouTube 放在封面的位置，另外兩個放在控制列的位置
import { t } from './i18n.js';
import { mediaKind, localUrl } from './media.js';

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="4" width="4.6" height="16" rx="1.4"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.4"/></svg>',
  back: '<svg viewBox="0 0 32 24" aria-hidden="true"><path d="M15 4v16L3 12zM29 4v16L17 12z"/></svg>',
  fwd: '<svg viewBox="0 0 32 24" aria-hidden="true"><path d="M3 4v16l12-8zM17 4v16l12-8z"/></svg>',
  vol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/></svg>',
  volHi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  loop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
};
const RCOL = ['#9aa3b5', '#2f80ed', '#a45cf0', '#ffb300'];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function btn(cls, icon, label, fn) {
  const b = el('button', cls, icon);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.onclick = fn;
  return b;
}
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// 從封面抓 4 個顏色（飽和、不太暗不太亮、色相分開）→ 背景漸層跟光斑
const DEFAULT = ['#ff5fb0', '#8a5cff', '#4fa8ff', '#ff9ad5'];
let dark = false; // 封面整體偏暗 → 按鈕、進度用白色（不然深色按鈕看不到）
async function palette(src) {
  dark = false;
  if (!src) return DEFAULT;
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
    const c = document.createElement('canvas');
    c.width = c.height = 20;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 20, 20);
    const d = g.getImageData(0, 0, 20, 20).data;
    const px = [];
    let sumL = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, gg, b] = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
      const mx = Math.max(r, gg, b);
      const mn = Math.min(r, gg, b);
      const l = (mx + mn) / 2;
      const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (mx !== mn) h = mx === r ? ((gg - b) / (mx - mn)) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4;
      px.push({ h: (h * 60 + 360) % 360, s, l, score: s * (1 - Math.abs(l - 0.55) * 1.3) });
      sumL += l;
    }
    dark = sumL / px.length < 0.42;
    px.sort((a, b) => b.score - a.score);
    const pick = [];
    for (const p of px) {
      if (pick.length >= 4) break;
      if (p.score < 0.12) break;
      if (pick.every((q) => Math.min(Math.abs(q.h - p.h), 360 - Math.abs(q.h - p.h)) > 28)) pick.push(p);
    }
    if (!pick.length) return DEFAULT;
    while (pick.length < 4) pick.push({ ...pick[0], h: (pick[0].h + 40 * pick.length) % 360 }); // 顏色不夠：同一個色往旁邊轉
    return pick.map((p) => `hsl(${Math.round(p.h)} ${Math.round(Math.min(95, 55 + p.s * 45))}% ${Math.round(Math.min(72, Math.max(52, p.l * 100)))}%)`);
  } catch (e) {
    return DEFAULT;
  }
}

// box 裡放一張「正在播放」卡；d＝{ art 封面圖、artNode 封面的位置放這個（3D 閃卡）、title、artist、rarity、delay 幾毫秒後開始播、autoplay }
//   使用者 2026-10-26：「立體的功能要留著」→ 音樂（含 SoundCloud／Spotify）的封面放 3D 閃卡（holo.js）；影片自己跟著游標斜＋反光；YouTube 維持平的（iframe 斜了不好點）
export function mountNowPlaying(box, m, d = {}) {
  box.textContent = '';
  if (!m) return { stop() {} };
  const kind = mediaKind(m);
  let alive = true;
  let el2 = null; // <audio>／<video>
  const card = el('div', `np ${kind === 'video' ? 'is-video' : 'is-audio'}`);
  const bg = el('div', 'np-bg');
  if (d.art) bg.style.backgroundImage = `url("${d.art}")`;
  const bokeh = el('div', 'np-bokeh');
  for (let i = 0; i < 11; i++) {
    const b = el('i');
    b.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
    b.style.setProperty('--y', `${Math.round(Math.random() * 100)}%`);
    b.style.setProperty('--s', `${Math.round(40 + Math.random() * 90)}px`);
    b.style.setProperty('--c', `var(--c${(i % 4) + 1})`);
    b.style.setProperty('--d', `${(10 + Math.random() * 10).toFixed(1)}s`);
    b.style.setProperty('--dx', `${Math.round(-30 + Math.random() * 60)}px`);
    b.style.setProperty('--dy', `${Math.round(-30 + Math.random() * 60)}px`);
    bokeh.append(b);
  }
  palette(d.art).then((cs) => {
    cs.forEach((c, i) => card.style.setProperty(`--c${i + 1}`, c));
    card.classList.toggle('dark', dark);
  });
  const holo = d.artNode && kind !== 'video' && m.k !== 'yt';
  const art = el('div', 'np-art' + (holo ? ' holo' : ''));
  if (holo) art.append(d.artNode);
  else if (d.art) art.style.backgroundImage = `url("${d.art}")`;
  // 名稱、機台、稀有度、⋯（原本的連結）
  const meta = el('div', 'np-meta');
  const txt = el('div', 'np-txt');
  const ti = el('b');
  ti.textContent = d.title || '';
  const ar = el('span');
  ar.textContent = d.artist || '';
  txt.append(ti, ar);
  meta.append(txt);
  if (d.rarity != null) {
    const rk = el('span', 'np-rk');
    rk.textContent = ['N', 'R', 'SR', 'SSR'][d.rarity] || 'N';
    rk.style.setProperty('--rc', RCOL[d.rarity] || RCOL[0]);
    meta.append(rk);
  }
  if (m.k !== 'file' && m.u) {
    const a = el('a', 'np-btn', ICON.open);
    a.href = m.u;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', t('np.open'));
    meta.append(a);
  }
  card.append(bg, bokeh, art, meta);
  box.append(card);

  const timer = setTimeout(start, d.delay || 0);
  async function start() {
    if (!alive) return;
    // 官方嵌入
    if (m.k === 'yt') {
      art.classList.add(m.vertical ? 'tall' : 'wide');
      art.append(frame(`https://www.youtube-nocookie.com/embed/${m.id}?autoplay=${d.autoplay === false ? 0 : 1}&playsinline=1&rel=0`));
      return;
    }
    if (m.k === 'sc' || m.k === 'sp') {
      const strip = el('div', 'np-embed');
      strip.append(
        m.k === 'sc'
          ? frame(`https://w.soundcloud.com/player/?url=${encodeURIComponent(m.u)}&auto_play=${d.autoplay !== false}&visual=false&color=%23ff5fb0`)
          : frame(`https://open.spotify.com/embed/${m.type}/${m.id}?theme=0`),
      );
      card.append(strip);
      return;
    }
    const src = m.k === 'file' ? await localUrl(m) : m.u;
    if (!alive) return;
    if (!src) {
      const p = el('p', 'np-missing');
      p.textContent = t('media.missing');
      card.append(p);
      return;
    }
    if (kind === 'video') {
      el2 = document.createElement('video');
      el2.playsInline = true;
      if (d.art) el2.poster = d.art;
      art.append(el2, el('i', 'np-glare'));
      art.classList.add('tilty');
      art.onclick = () => (el2.paused ? el2.play().catch(() => {}) : el2.pause());
      // 影片也有立體感：跟著游標斜一點、反光跟著走
      card.addEventListener('pointermove', (e) => {
        const r = art.getBoundingClientRect();
        const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
        const y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
        art.style.setProperty('--ry', `${x * 9}deg`);
        art.style.setProperty('--rx', `${-y * 7}deg`);
        art.style.setProperty('--gx', `${50 + x * 40}%`);
        art.style.setProperty('--gy', `${50 + y * 40}%`);
      });
      card.addEventListener('pointerleave', () => ['--ry', '--rx', '--gx', '--gy'].forEach((k) => art.style.removeProperty(k)));
      el2.addEventListener('loadedmetadata', () => {
        if (!el2.videoWidth || !el2.videoHeight) return;
        const r = Math.min(16 / 9, Math.max(9 / 16, el2.videoWidth / el2.videoHeight));
        art.style.aspectRatio = String(r);
        art.classList.toggle('portrait', r < 0.95); // 直的影片：限制高度、置中
      });
    } else {
      el2 = document.createElement('audio');
      el2.preload = 'auto';
      card.append(el2);
    }
    el2.src = src;
    controls();
    if (d.autoplay !== false) el2.play().catch(() => sync());
  }

  let sync = () => {};
  function controls() {
    const prog = el('div', 'np-prog');
    const bar = el('div', 'np-bar');
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', t('np.seek'));
    bar.tabIndex = 0;
    const fill = el('i', 'np-fill');
    bar.append(fill);
    const times = el('div', 'np-times');
    const cur = el('span');
    const rest = el('span');
    times.append(cur, rest);
    prog.append(bar, times);
    const back = btn('np-ctl', ICON.back, t('np.back'), () => (el2.currentTime = Math.max(0, el2.currentTime - 10)));
    const pp = btn('np-ctl np-pp', ICON.play, t('media.play'), () => (el2.paused ? el2.play().catch(() => {}) : el2.pause()));
    const fwd = btn('np-ctl', ICON.fwd, t('np.fwd'), () => el2.duration && (el2.currentTime = Math.min(el2.duration - 0.1, el2.currentTime + 10)));
    const ctl = el('div', 'np-ctrl');
    ctl.append(back, pp, fwd);
    const vol = el('div', 'np-vol');
    const range = el('input');
    range.type = 'range';
    range.min = 0;
    range.max = 1;
    range.step = 0.01;
    range.value = 1;
    range.setAttribute('aria-label', t('np.vol'));
    range.oninput = () => {
      el2.volume = +range.value;
      vol.style.setProperty('--v', `${Math.round(range.value * 100)}%`);
    };
    vol.style.setProperty('--v', '100%');
    const loop = btn('np-btn np-loop', ICON.loop, t('np.loop'), () => {
      el2.loop = !el2.loop;
      loop.setAttribute('aria-pressed', String(el2.loop));
    });
    loop.setAttribute('aria-pressed', 'false');
    vol.append(el('span', 'np-vi', ICON.vol), range, el('span', 'np-vi', ICON.volHi), loop);
    card.append(prog, ctl, vol);
    const paint = () => {
      const dur = el2.duration || 0;
      const k = dur ? el2.currentTime / dur : 0;
      fill.style.width = `${k * 100}%`;
      cur.textContent = fmt(el2.currentTime);
      rest.textContent = dur ? `−${fmt(dur - el2.currentTime)}` : '';
      bar.setAttribute('aria-valuetext', `${fmt(el2.currentTime)} / ${fmt(dur)}`);
    };
    sync = () => {
      const on = !el2.paused;
      pp.innerHTML = on ? ICON.pause : ICON.play;
      pp.setAttribute('aria-label', t(on ? 'media.pause' : 'media.play'));
      card.classList.toggle('on', on);
    };
    el2.addEventListener('timeupdate', paint);
    el2.addEventListener('loadedmetadata', paint);
    for (const ev of ['play', 'pause', 'ended']) el2.addEventListener(ev, sync);
    // 拖進度條
    const seek = (e) => {
      const r = bar.getBoundingClientRect();
      if (el2.duration) el2.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * el2.duration;
      paint();
    };
    bar.addEventListener('pointerdown', (e) => {
      bar.setPointerCapture(e.pointerId);
      card.classList.add('seeking');
      seek(e);
      bar.onpointermove = seek;
    });
    bar.addEventListener('pointerup', () => {
      bar.onpointermove = null;
      card.classList.remove('seeking');
    });
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') el2.currentTime = Math.min(el2.duration || 0, el2.currentTime + 5);
      if (e.key === 'ArrowLeft') el2.currentTime = Math.max(0, el2.currentTime - 5);
    });
    paint();
    sync();
  }

  return {
    stop() {
      alive = false;
      clearTimeout(timer);
      if (el2) {
        el2.pause();
        el2.removeAttribute('src');
        el2.load();
      }
      box.textContent = '';
    },
  };
}

function frame(src) {
  const f = document.createElement('iframe');
  f.src = src;
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.allowFullscreen = true;
  f.loading = 'lazy';
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  return f;
}
