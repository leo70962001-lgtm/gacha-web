// 音效：全部用 WebAudio 即時合成，不需要音檔
// 瀏覽器規定要使用者先點過才能出聲 → 第一次點擊時呼叫 unlock()
// 2026-10-26 改版（使用者：「優化音效」）：
//   - 總線：每個聲音 → 效果音音量 → 壓縮器（大聲的不爆、小聲的聽得到）→ 喇叭；另外送一點進房間殘響（程式產生）
//   - 每次音高、左右位置都差一點點（同一個聲音連打不會像機關槍）
//   - 開獎、升格改用 FM 鐘聲（像鐵琴）；硬幣、把手、扭蛋落下、開蛋重做；新增按鈕、分頁、勾選的小聲音
//   - 效果音、背景音樂分開調音量（bgm.js 共用同一個 AudioContext，開獎時叫它壓低音量）
let ctx = null;
let bus = null; // 效果音音量
let wetIn = null; // → 殘響
let noiseBuf = null;
let vol = 0.8;
let muted = false;
const waiting = new Set();
let duckFn = () => {};

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    bus = ctx.createGain();
    bus.gain.value = level();
    bus.connect(comp);
    const rev = ctx.createConvolver();
    rev.buffer = roomIR(1.5);
    wetIn = ctx.createGain();
    wetIn.connect(rev).connect(bus);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const f of waiting) f(ctx);
    waiting.clear();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// bgm.js：AudioContext 做好就通知（使用者點過畫面之後）
export function onUnlock(f) {
  if (ctx) f(ctx);
  else waiting.add(f);
}
// bgm.js 註冊：開獎時把背景音樂壓低 sec 秒
export function setDuck(f) {
  duckFn = f;
}

const level = () => (muted ? 0 : 0.62 * vol * vol); // 滑桿 → 音量用平方（聽起來比較均勻）
function apply() {
  if (bus) bus.gain.setTargetAtTime(level(), ctx.currentTime, 0.03);
}
export function setMuted(m) {
  muted = m;
  apply();
}
export function setSfxVolume(v) {
  vol = Math.max(0, Math.min(1, v));
  apply();
}

// 房間殘響：兩聲道衰減的雜訊，前面幾毫秒是早期反射（高頻比較快消失 → 暖一點）
function roomIR(sec) {
  const n = Math.round(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      lp += (Math.random() * 2 - 1 - lp) * (0.55 - 0.4 * k); // 越後面越悶
      d[i] = lp * Math.pow(1 - k, 2.6) * (i < ctx.sampleRate * 0.012 ? 0 : 1);
    }
  }
  return b;
}

const vary = (f, c = 0.03) => f * (1 + (Math.random() * 2 - 1) * c);
const rpan = (k = 0.3) => (Math.random() * 2 - 1) * k;

// 一個聲音的出口：pan＝左右（−1..1）、wet＝送進殘響多少
function out(pan = 0, wet = 0.12) {
  const g = ctx.createGain();
  let node = g;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    node = p;
  }
  node.connect(bus);
  if (wet > 0) {
    const w = ctx.createGain();
    w.gain.value = wet;
    node.connect(w).connect(wetIn);
  }
  return g;
}

// 單一音：頻率 f0→f1、快速起音、指數衰減
function tone(type, f0, f1, at, dur, v, o = {}) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(v, at + (o.attack || 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out(o.pan, o.wet));
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function noise(at, dur, v, type, f0, f1 = f0, q = 1, o = {}) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(v, at + (o.attack || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(out(o.pan, o.wet));
  s.start(at, Math.random() * 0.5);
  s.stop(at + dur + 0.02);
}

// FM 鐘聲（鐵琴）：調變器 3.5 倍頻、一開始很亮、很快變圓
function bell(f, at, dur, v, o = {}) {
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const mg = ctx.createGain();
  const g = ctx.createGain();
  car.frequency.value = f;
  mod.frequency.value = f * (o.ratio || 3.5);
  mg.gain.setValueAtTime(f * (o.index || 2.2), at);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, at + Math.min(dur, 0.5));
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(v, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  mod.connect(mg).connect(car.frequency);
  car.connect(g).connect(out(o.pan ?? rpan(0.35), o.wet ?? 0.3));
  mod.start(at);
  car.start(at);
  mod.stop(at + dur + 0.02);
  car.stop(at + dur + 0.02);
}

const ready = () => ctx && !muted && vol > 0;
const now = () => ctx.currentTime;
const semi = (f, s) => f * Math.pow(2, s / 12);

// 金屬的泛音不是整數倍（1 : 2.76 : 5.40 : 8.93）→ 聽起來像硬幣
function clink(at, base, v, pan = 0) {
  const o = { pan, wet: 0.14 };
  tone('sine', base, base * 0.998, at, 0.32, v, o);
  tone('sine', base * 2.76, base * 2.74, at, 0.18, v * 0.5, o);
  tone('sine', base * 5.4, base * 5.36, at, 0.08, v * 0.3, o);
  tone('sine', base * 8.93, base * 8.9, at, 0.04, v * 0.16, o);
  noise(at, 0.015, v * 0.5, 'highpass', 6000, 6000, 1, o);
}

// 塑膠扭蛋殼互相敲到：空心的「叩」（共振峰）
function knock(at, f, v, pan = 0) {
  noise(at, 0.05, v, 'bandpass', f, f * 0.96, 9, { pan, wet: 0.1 });
  tone('sine', f * 0.5, f * 0.45, at, 0.05, v * 0.25, { pan, wet: 0.05 });
}

export const sfx = {
  coin() {
    if (!ready()) return;
    const t = now();
    const p = rpan(0.15);
    clink(t, vary(1850, 0.04), 0.32, p);
    // 硬幣在機器裡往下滾、一路碰到兩邊
    [0.15, 0.24, 0.3, 0.34, 0.37].forEach((d, i) => clink(t + d + Math.random() * 0.015, vary(1550 - i * 110, 0.03), 0.11 - i * 0.017, p + rpan(0.2)));
    // 掉進錢箱
    tone('sine', vary(240), 150, t + 0.42, 0.12, 0.12, { wet: 0.08 });
    noise(t + 0.42, 0.08, 0.1, 'lowpass', 1400, 600, 1, { wet: 0.08 });
  },
  // 把手的棘輪：塑膠「喀」＋機身共鳴
  tick() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.022, 0.32, 'bandpass', vary(3100, 0.06), 2600, 4, { wet: 0.05 });
    tone('triangle', vary(260, 0.04), 170, t, 0.05, 0.1, { wet: 0.05 });
    if (Math.random() < 0.3) tone('sine', vary(1900, 0.05), 1700, t + 0.012, 0.09, 0.025, { wet: 0.1 }); // 彈簧
  },
  // 窗裡的扭蛋互相碰撞
  rattle() {
    if (!ready()) return;
    const t = now();
    for (let i = 0; i < 8; i++) knock(t + Math.random() * 0.38, 900 + Math.random() * 1500, 0.06 + Math.random() * 0.08, rpan(0.5));
  },
  // 扭蛋掉進出口：空心塑膠「咚」＋小彈一下
  thud(v = 1) {
    if (!ready()) return;
    const t = now();
    const f = vary(1100, 0.08);
    tone('sine', vary(165, 0.05), 62, t, 0.22, 0.42 * v, { wet: 0.08 });
    noise(t, 0.08, 0.22 * v, 'lowpass', 900, 900, 1, { wet: 0.06 });
    knock(t, f, 0.22 * v);
    if (v > 0.5) {
      knock(t + 0.13, f * 1.04, 0.09 * v);
      tone('sine', 140, 80, t + 0.13, 0.08, 0.12 * v);
    }
  },
  locked() {
    if (!ready()) return;
    const t = now();
    for (const d of [0, 0.12]) {
      tone('triangle', 170, 140, t + d, 0.09, 0.12, { wet: 0.04 });
      noise(t + d, 0.03, 0.12, 'bandpass', 900, 900, 3);
    }
  },
  whoosh() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.45, 0.2, 'bandpass', 300, 2400, 1.2, { pan: -0.3, wet: 0.15 });
    noise(t + 0.05, 0.4, 0.12, 'bandpass', 400, 3000, 1.4, { pan: 0.3, wet: 0.15 });
  },
  shake() {
    if (!ready()) return;
    const t = now();
    for (let i = 0; i < 6; i++) knock(t + i * 0.08, vary(1500, 0.1), 0.08 + i * 0.025, i % 2 ? 0.25 : -0.25);
  },
  // 轉卡機：卡片從出卡口滑出來（紙擦過塑膠的沙一聲＋喀）
  cardOut() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.24, 0.32, 'bandpass', 2800, 900, 1.2, { wet: 0.08 });
    noise(t, 0.2, 0.08, 'highpass', 6000, 6000, 1, { wet: 0.05 });
    tone('triangle', 200, 130, t + 0.21, 0.05, 0.1);
  },
  // 翻卡：紙片甩過空氣
  flip() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.16, 0.38, 'highpass', 1800, 5200, 0.8, { pan: rpan(0.3), wet: 0.12 });
    bell(vary(1046, 0.02), t + 0.03, 0.4, 0.06, { wet: 0.25 });
  },
  // 開蛋：塑膠扣「啪」＋空氣「啵」＋一點亮晶晶
  pop() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.03, 0.4, 'bandpass', 3200, 3200, 3, { wet: 0.1 });
    noise(t + 0.01, 0.12, 0.45, 'bandpass', 700, 3500, 1.5, { wet: 0.12 });
    tone('sine', 380, 1300, t + 0.01, 0.12, 0.26, { wet: 0.12 });
    bell(2093, t + 0.08, 0.5, 0.05);
    bell(3136, t + 0.13, 0.4, 0.035);
  },
  // 小鼓連打：越打越快、越打越大聲（集氣時）
  drumroll(dur) {
    if (!ready() || dur <= 0) return;
    const t = now();
    let at = 0;
    let gap = 0.13;
    let side = 1;
    while (at < dur) {
      const k = at / dur;
      noise(t + at, 0.05, 0.05 + 0.25 * k * k, 'bandpass', 1800 + 1200 * k, 1800 + 1200 * k, 1.2, { pan: 0.15 * side, wet: 0.12 });
      tone('triangle', 190, 150, t + at, 0.04, 0.03 + 0.06 * k, { wet: 0.08 });
      gap = Math.max(0.035, gap * 0.94);
      at += gap;
      side = -side;
    }
    // 最後一下鈸
    noise(t + dur, 1.4, 0.28, 'highpass', 5000, 5000, 1, { wet: 0.35 });
    duckFn(dur + 1.5);
  },
  // 定格的「叮——」
  hitstop() {
    if (!ready()) return;
    const t = now();
    bell(2093, t, 0.9, 0.14, { pan: 0, wet: 0.35 });
    bell(3136, t, 0.7, 0.07, { pan: 0, wet: 0.35 });
  },
  // 集氣：音高往上爬＋雜訊越來越亮（SSR 從更低開始、更長）
  charge(dur, rarity) {
    if (!ready() || dur <= 0) return;
    const t = now();
    const f0 = rarity === 3 ? 110 : 180;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(5000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    lp.connect(g).connect(out(0, 0.2));
    // 兩個微微走音的鋸齒波 → 比較厚
    for (const det of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 8, t + dur);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    noise(t, dur, 0.1, 'bandpass', 500, 7000, 2, { wet: 0.2 });
    duckFn(dur + 1.5);
  },
  // 心跳（SSR 關燈後）
  heartbeat(n) {
    if (!ready()) return;
    const t = now();
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.75;
      tone('sine', 70, 45, at, 0.16, 0.5, { wet: 0.05 });
      tone('sine', 65, 42, at + 0.2, 0.14, 0.35, { wet: 0.05 });
    }
    duckFn(n * 0.75 + 1);
  },
  // 升格（銀蛋變金蛋）：鐵琴往上刷
  upgrade() {
    if (!ready()) return;
    const t = now();
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => bell(semi(880, s), t + i * 0.045, 0.7, 0.1, { pan: -0.4 + i * 0.13 }));
    noise(t, 0.7, 0.07, 'highpass', 7000, 7000, 1, { wet: 0.3 });
  },
  // 爆開：低音重擊，越稀有越重
  boom(rarity) {
    if (!ready()) return;
    const t = now();
    const v = [0.15, 0.3, 0.5, 0.7][rarity];
    tone('sine', 120, 38, t, 0.5 + rarity * 0.2, v, { wet: 0.15 });
    noise(t, 0.3 + rarity * 0.15, v * 0.6, 'lowpass', 1200, 200, 1, { wet: 0.2 });
    if (rarity >= 2) noise(t, 1.4, 0.08, 'highpass', 6000, 6000, 1, { wet: 0.4 });
  },
  firework() {
    if (!ready()) return;
    const t = now();
    const p = rpan(0.6);
    noise(t, 0.12, 0.32, 'bandpass', 1500, 600, 1, { pan: p, wet: 0.3 });
    for (let i = 0; i < 10; i++) noise(t + 0.15 + Math.random() * 0.55, 0.025, 0.05, 'highpass', 5000, 5000, 1, { pan: p + rpan(0.3), wet: 0.4 });
  },
  // 開獎音：稀有度越高，音階越長、越亮（鐵琴＋殘響；SR 以上加和弦，SSR 再加合唱）
  reveal(rarity) {
    if (!ready()) return;
    const t = now() + 0.05;
    const C5 = 523.25;
    const semis = [[0, 4, 7], [0, 4, 7, 12], [0, 4, 7, 12, 16, 19], [-5, 0, 4, 7, 12, 16, 19, 24]][rarity];
    const step = [0.09, 0.08, 0.07, 0.065][rarity];
    duckFn([1.2, 1.6, 2.6, 4.2][rarity]);
    semis.forEach((s, i) => {
      const f = semi(C5, s);
      const p = -0.35 + (0.7 * i) / Math.max(1, semis.length - 1);
      bell(f, t + i * step, 0.9, 0.17, { pan: p });
      tone('triangle', f, f, t + i * step, 0.35, 0.07, { pan: p, wet: 0.2 });
    });
    const end = t + semis.length * step;
    if (rarity >= 1) bell(semi(C5, 24), end, 1.4, 0.08, { pan: 0 });
    if (rarity >= 2) {
      // 和弦延音＋閃亮雜訊
      [0, 4, 7, 12].forEach((s, i) => bell(semi(C5, s + 12), end + i * 0.012, 1.8, 0.06, { pan: -0.3 + i * 0.2, wet: 0.4 }));
      noise(end, 1.4, 0.05, 'highpass', 6000, 6000, 1, { wet: 0.45 });
    }
    if (rarity === 3) {
      // 合唱和弦：幾個微微走音的鋸齒波疊起來，慢慢進、慢慢收
      const pad = [0, 4, 7, 11, 14].map((st) => semi(C5 * 0.5, st));
      for (const f of pad)
        for (const det of [-7, 7]) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const lp = ctx.createBiquadFilter();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          lp.type = 'lowpass';
          lp.frequency.value = 1800;
          g.gain.setValueAtTime(0.0001, end);
          g.gain.exponentialRampToValueAtTime(0.022, end + 0.35);
          g.gain.exponentialRampToValueAtTime(0.0001, end + 3.2);
          o.connect(lp).connect(g).connect(out(det < 0 ? -0.4 : 0.4, 0.35));
          o.start(end);
          o.stop(end + 3.3);
        }
      for (let i = 0; i < 12; i++) bell(1800 + Math.random() * 2600, end + 0.1 + i * 0.085, 0.4, 0.035, { wet: 0.45 });
    }
  },
  // ---------- 介面的小聲音（很小聲） ----------
  tap() {
    if (!ready()) return;
    const t = now();
    tone('sine', vary(820, 0.04), 1050, t, 0.06, 0.05, { wet: 0.04 });
    noise(t, 0.012, 0.04, 'bandpass', 4000, 4000, 2);
  },
  tab() {
    if (!ready()) return;
    const t = now();
    tone('triangle', 660, 660, t, 0.07, 0.05, { wet: 0.06 });
    tone('triangle', 990, 990, t + 0.05, 0.09, 0.05, { wet: 0.06 });
  },
  toggle(on) {
    if (!ready()) return;
    const t = now();
    tone('sine', on ? 700 : 1000, on ? 1100 : 650, t, 0.09, 0.06, { wet: 0.05 });
  },
  // シール帳：貼上去「ぺたっ」、撕下來「ぺりっ」
  stick() {
    if (!ready()) return;
    const t = now();
    tone('sine', vary(210, 0.05), 120, t, 0.08, 0.16, { wet: 0.05 });
    noise(t, 0.05, 0.1, 'lowpass', 1400, 600, 1, { wet: 0.04 });
  },
  peel() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.22, 0.16, 'bandpass', 900, 4200, 3, { wet: 0.08 });
    tone('sine', 500, 900, t + 0.18, 0.06, 0.05, { wet: 0.08 });
  },
  // 對話框打開：軟軟的「啵」
  open() {
    if (!ready()) return;
    const t = now();
    tone('sine', 300, 620, t, 0.1, 0.07, { wet: 0.08 });
    noise(t, 0.08, 0.04, 'bandpass', 1200, 2400, 1.5, { wet: 0.08 });
  },
};
