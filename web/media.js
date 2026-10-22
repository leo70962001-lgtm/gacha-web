// 獎品的影音：連結（YouTube／Shorts、SoundCloud、Spotify、mp3／mp4 網址）或上傳的本機檔案
// 連結很短 → 放進分享連結；本機檔案太大 → 存在這台裝置的 IndexedDB，只有開店的人自己試玩時能播
import { t } from './i18n.js';

export const MAX_FILE = 50 * 1024 * 1024;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

// 貼上的網址 → { k, u, id?, vertical? }；不支援就回傳 null
// k：yt（YouTube）、sc（SoundCloud）、sp（Spotify）、au（音樂檔網址）、vi（影片檔網址）
export function parseMediaUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch (e) {
    return null;
  }
  if (url.protocol !== 'https:') return null; // http 在 https 頁面會被擋
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const path = url.pathname;
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id = null;
    let vertical = false;
    if (host === 'youtu.be') id = path.slice(1).split('/')[0];
    else if (path.startsWith('/shorts/')) (id = path.split('/')[2]), (vertical = true);
    else if (path.startsWith('/embed/')) id = path.split('/')[2];
    else id = url.searchParams.get('v');
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return { k: 'yt', id, vertical, u: vertical ? `https://youtube.com/shorts/${id}` : `https://youtu.be/${id}` };
  }
  if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
    if (path.length < 2) return null;
    return { k: 'sc', u: `https://${url.hostname}${path}` };
  }
  if (host === 'open.spotify.com') {
    const m = /^(?:\/intl-[a-z-]+)?\/(track|album|playlist|episode|show)\/([A-Za-z0-9]{22})/.exec(path);
    if (!m) return null;
    return { k: 'sp', type: m[1], id: m[2], u: `https://open.spotify.com/${m[1]}/${m[2]}` };
  }
  if (AUDIO_EXT.test(path)) return { k: 'au', u: url.href };
  if (VIDEO_EXT.test(path)) return { k: 'vi', u: url.href };
  return null;
}

// 連結裡帶的是 [k, u]：解碼時重新解析一次，k 對不上就丟掉（連結內容是別人給的）
export function mediaFromLink(row) {
  if (!Array.isArray(row) || typeof row[1] !== 'string' || row[1].length > 400) return null;
  const m = parseMediaUrl(row[1]);
  return m && m.k === row[0] ? m : null;
}

export function mediaToLink(m) {
  if (!m) return null;
  if (m.k === 'file') {
    const r = m.remote && parseMediaUrl(m.remote); // 上傳到雲端的檔案 → 一般的音樂／影片網址
    return r ? [r.k, r.u] : null;
  }
  return [m.k, m.u];
}

// 顯示用的種類：音樂、影片
export function mediaKind(m) {
  if (!m) return null;
  if (m.k === 'file') return m.kind;
  if (m.k === 'au' || m.k === 'sc' || m.k === 'sp') return 'audio';
  return 'video';
}

export function mediaLabel(m) {
  if (!m) return '';
  if (m.k === 'file') return (m.kind === 'video' ? '▶ ' : '♪ ') + m.name;
  if (m.k === 'yt') return '▶ ' + (m.vertical ? 'YouTube Shorts' : 'YouTube');
  if (m.k === 'sc') return '♪ SoundCloud';
  if (m.k === 'sp') return '♪ Spotify';
  const name = decodeURIComponent(new URL(m.u).pathname.split('/').pop() || '');
  return (m.k === 'vi' ? '▶ ' : '♪ ') + name;
}

export function ytThumb(m) {
  return m?.k === 'yt' ? `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg` : null;
}

// ---------- 本機檔案（IndexedDB） ----------
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('clatter-media', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  }
  return dbp;
}
const memory = new Map(); // IndexedDB 不能用時（無痕模式）先放記憶體
const urls = new Map();

export async function saveLocal(file) {
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const d = await db();
  if (d) {
    await new Promise((res, rej) => {
      const tx = d.transaction('files', 'readwrite');
      tx.objectStore('files').put(file, id);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    }).catch(() => memory.set(id, file));
  } else memory.set(id, file);
  return {
    k: 'file',
    kind: file.type.startsWith('video') ? 'video' : 'audio',
    id,
    name: file.name.slice(0, 60),
    mime: file.type,
    size: file.size,
  };
}

export async function localUrl(m) {
  if (urls.has(m.id)) return urls.get(m.id);
  let blob = memory.get(m.id);
  if (!blob) {
    const d = await db();
    if (d)
      blob = await new Promise((res) => {
        const r = d.transaction('files').objectStore('files').get(m.id);
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      });
  }
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(m.id, u);
  return u;
}

export async function removeLocal(m) {
  if (m?.k !== 'file') return;
  memory.delete(m.id);
  const u = urls.get(m.id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(m.id);
  const d = await db();
  if (d) d.transaction('files', 'readwrite').objectStore('files').delete(m.id);
}

// 影片的一格畫面 → 當獎品縮圖
export function videoFrame(src) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = src;
    const done = (c) => {
      v.removeAttribute('src');
      v.load();
      resolve(c);
    };
    v.onloadeddata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 3);
    };
    v.onseeked = () => {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      try {
        c.getContext('2d').drawImage(v, 0, 0);
        done(c);
      } catch (e) {
        done(null);
      }
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
}

// ---------- 播放器 ----------
// 在 box 裡放對應的播放器；回傳 { stop }。delay：等開獎音效先響完
export function mountPlayer(box, m, { poster, delay = 0 } = {}) {
  box.textContent = '';
  if (!m) return { stop() {} };
  let alive = true;
  let el = null;
  const kind = mediaKind(m);
  const timer = setTimeout(start, delay);

  async function start() {
    if (!alive) return;
    if (m.k === 'yt') {
      const f = frame(`https://www.youtube-nocookie.com/embed/${m.id}?autoplay=1&playsinline=1&rel=0`, m.vertical ? 'tall' : 'wide');
      box.append(f);
      return;
    }
    if (m.k === 'sc') {
      box.append(frame(`https://w.soundcloud.com/player/?url=${encodeURIComponent(m.u)}&auto_play=true&visual=true`, 'wide'));
      return;
    }
    if (m.k === 'sp') {
      box.append(frame(`https://open.spotify.com/embed/${m.type}/${m.id}`, m.type === 'track' || m.type === 'episode' ? 'strip' : 'wide'));
      return;
    }
    const src = m.k === 'file' ? await localUrl(m) : m.u;
    if (!alive) return;
    if (!src) {
      const p = document.createElement('p');
      p.className = 'media-missing';
      p.textContent = t('media.missing');
      box.append(p);
      return;
    }
    if (kind === 'video') {
      el = document.createElement('video');
      el.className = 'media-video';
      el.playsInline = true;
      el.controls = true;
      if (poster) el.poster = poster;
      el.src = src;
      box.append(el);
      el.play().catch(() => {
        /* 瀏覽器擋自動播放（有聲）→ 讓玩家自己按播放 */
      });
      return;
    }
    // 音樂：自己做的播放列（播放／暫停、進度）
    el = document.createElement('audio');
    el.src = src;
    el.preload = 'auto';
    const bar = document.createElement('div');
    bar.className = 'player';
    const pp = document.createElement('button');
    pp.type = 'button';
    pp.className = 'pp';
    const prog = document.createElement('div');
    prog.className = 'bar';
    const fill = document.createElement('span');
    prog.append(fill);
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = '0:00';
    bar.append(pp, prog, time, el);
    box.append(bar);
    const sync = () => {
      const playing = !el.paused;
      pp.textContent = playing ? '❚❚' : '▶';
      pp.setAttribute('aria-label', t(playing ? 'media.pause' : 'media.play'));
      bar.classList.toggle('on', playing);
    };
    pp.onclick = () => (el.paused ? el.play().catch(() => {}) : el.pause());
    prog.onclick = (e) => {
      const r = prog.getBoundingClientRect();
      if (el.duration) el.currentTime = ((e.clientX - r.left) / r.width) * el.duration;
    };
    el.ontimeupdate = () => {
      if (el.duration) fill.style.width = (100 * el.currentTime) / el.duration + '%';
      const s = Math.floor(el.currentTime);
      time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    el.onplay = el.onpause = el.onended = sync;
    sync();
    el.play().catch(sync);
  }

  return {
    stop() {
      alive = false;
      clearTimeout(timer);
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      box.textContent = '';
    },
  };
}

function frame(src, shape) {
  const f = document.createElement('iframe');
  f.className = 'media-frame ' + shape;
  f.src = src;
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.allowFullscreen = true;
  f.loading = 'lazy';
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  return f;
}
