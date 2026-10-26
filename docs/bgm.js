// 背景音樂（使用者 2026-10-26：「可以設定背景音樂」）
//   每台機台由店家選：預設曲（Gemini「音楽を作成」做的，assets/bgm/<id>.mp3）、不要音樂、或自己上傳的曲子
//   兩個 <audio> 交叉淡入淡出：換曲順順地換；曲子快結束前就從頭淡入（Gemini 的曲子頭尾不是無縫的）
//   音量走 WebAudio 的 GainNode（iPhone 的 <audio>.volume 改不了）；開獎時壓低（duck），播獎品的影音時先停（hush）
import { onUnlock, setDuck } from './sfx.js';

const XF = 2.5; // 交叉淡入淡出秒數
let ctx = null;
let bus = null; // 使用者音量
let duckG = null; // 開獎時壓低
let vol = 0.5;
let muted = false;
let want = null; // 想播的網址（null＝安靜）
let cur = null; // 正在播的 { el, g, src, url }
const hushes = new Set();

const level = () => (muted ? 0 : 0.7 * vol * vol);

onUnlock((c) => {
  ctx = c;
  bus = ctx.createGain();
  bus.gain.value = hushes.size ? 0 : level();
  duckG = ctx.createGain();
  duckG.connect(bus).connect(ctx.destination);
  if (want) start(want);
});

setDuck((sec) => {
  if (!duckG || !cur) return;
  const t = ctx.currentTime;
  const g = duckG.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0.28, t + 0.25);
  g.setValueAtTime(0.28, t + sec);
  g.linearRampToValueAtTime(1, t + sec + 1.5);
});

function fade(g, to, sec) {
  const t = ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(to, t + sec);
}

// 一個聲部：<audio> → 淡入淡出用的 gain → duck → 音量
function voice(url) {
  const el = new Audio();
  el.preload = 'auto';
  el.crossOrigin = 'anonymous'; // 雲端（Supabase）跟自己網站的檔案都有 CORS → 可以接進 WebAudio
  el.src = url;
  const g = ctx.createGain();
  g.gain.value = 0;
  let src = null;
  try {
    src = ctx.createMediaElementSource(el);
    src.connect(g).connect(duckG);
  } catch (e) {
    src = null;
  }
  const v = { el, g, src, url, looped: false };
  // 快結束 → 從頭再淡入一份（短的曲子就直接 loop）
  el.addEventListener('timeupdate', () => {
    if (v !== cur || v.looped || !Number.isFinite(el.duration)) return;
    if (el.duration < XF * 4) {
      el.loop = true;
      return;
    }
    if (el.duration - el.currentTime < XF + 0.3) {
      v.looped = true;
      swap(voice(url));
    }
  });
  el.addEventListener('error', () => {
    if (v === cur) cur = null;
  });
  return v;
}

function drop(v, sec) {
  fade(v.g, 0, sec);
  setTimeout(() => {
    v.el.pause();
    v.el.removeAttribute('src');
    v.el.load();
    try {
      v.src?.disconnect();
    } catch (e) {
      /* 已經斷了 */
    }
  }, sec * 1000 + 100);
}

function swap(v) {
  const old = cur;
  cur = v;
  v.el.play().catch(() => {});
  fade(v.g, 1, XF);
  if (old) drop(old, XF);
}

function start(url) {
  if (!ctx) return;
  if (cur?.url === url) return;
  if (!url) {
    if (cur) drop(cur, 1.2);
    cur = null;
    return;
  }
  swap(voice(url));
  if (hushes.size) cur.el.pause();
}

export const bgm = {
  // url＝要播的曲子（null＝安靜）；同一首就不重來
  play(url) {
    want = url || null;
    start(want);
  },
  // 先停一下（key：誰要它停；全部放開才繼續）
  hush(key) {
    hushes.add(key);
    if (!bus) return;
    fade(bus, 0, 0.4);
    setTimeout(() => hushes.size && cur?.el.pause(), 450);
  },
  unhush(key) {
    if (!hushes.delete(key) || hushes.size || !bus) return;
    cur?.el.play().catch(() => {});
    fade(bus, level(), 1.2);
  },
  setVolume(v) {
    vol = Math.max(0, Math.min(1, v));
    if (bus && !hushes.size) fade(bus, level(), 0.15);
  },
  setMuted(m) {
    muted = m;
    if (bus && !hushes.size) fade(bus, level(), 0.3);
  },
  get url() {
    return want;
  },
  // 測試用：現在播到哪
  state() {
    return { el: cur?.el, url: cur?.url || null, paused: cur ? cur.el.paused : null, t: cur?.el.currentTime, dur: cur?.el.duration, webaudio: !!cur?.src, hush: hushes.size, bus: bus?.gain.value, duck: duckG?.gain.value };
  },
};

// 切到別的分頁／App 縮到背景 → 停；回來再繼續
document.addEventListener('visibilitychange', () => (document.hidden ? bgm.hush('hidden') : bgm.unhush('hidden')));
// 獎品的音樂、影片（<audio>／<video>）開始播 → 背景音樂先停，停了再回來
document.addEventListener(
  'play',
  (e) => {
    if (e.target === cur?.el || !(e.target instanceof HTMLMediaElement) || e.target.muted) return;
    bgm.hush(e.target);
    const back = () => bgm.unhush(e.target);
    e.target.addEventListener('pause', back, { once: true });
    e.target.addEventListener('ended', back, { once: true });
    e.target.addEventListener('emptied', back, { once: true });
  },
  true,
);
