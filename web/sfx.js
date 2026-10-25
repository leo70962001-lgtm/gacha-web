// 音效：全部用 WebAudio 即時合成，不需要音檔
// 瀏覽器規定要使用者先點過才能出聲 → 第一次點擊時呼叫 unlock()
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.55;
}

// 單一音：頻率 f0→f1、快速起音、指數衰減
function tone(type, f0, f1, at, dur, vol) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function noise(at, dur, vol, type, f0, f1 = f0, q = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(master);
  s.start(at, Math.random() * 0.5);
  s.stop(at + dur + 0.02);
}

const ready = () => ctx && !muted;
const now = () => ctx.currentTime;

// 金屬的泛音不是整數倍（1 : 2.76 : 5.40）→ 聽起來像硬幣
function clink(at, base, vol) {
  tone('sine', base, base, at, 0.22, vol);
  tone('sine', base * 2.76, base * 2.7, at, 0.12, vol * 0.5);
  tone('sine', base * 5.4, base * 5.3, at, 0.06, vol * 0.3);
}

export const sfx = {
  coin() {
    if (!ready()) return;
    const t = now();
    clink(t, 1850, 0.35);
    noise(t, 0.03, 0.15, 'highpass', 4000);
    // 硬幣在機器裡往下滾
    [0.16, 0.25, 0.31, 0.35].forEach((d, i) => clink(t + d, 1500 - i * 120, 0.12 - i * 0.02));
  },
  tick() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.025, 0.35, 'bandpass', 2600, 2600, 3);
    tone('square', 700, 500, t, 0.03, 0.06);
  },
  rattle() {
    if (!ready()) return;
    const t = now();
    for (let i = 0; i < 7; i++) {
      const d = Math.random() * 0.35;
      noise(t + d, 0.03, 0.08 + Math.random() * 0.08, 'bandpass', 1200 + Math.random() * 1800, 1500, 4);
    }
  },
  thud(v = 1) {
    if (!ready()) return;
    const t = now();
    tone('sine', 170, 60, t, 0.2, 0.45 * v);
    noise(t, 0.08, 0.25 * v, 'lowpass', 900);
    noise(t, 0.04, 0.12 * v, 'bandpass', 2200, 2200, 3); // 塑膠殼的「喀」
  },
  locked() {
    if (!ready()) return;
    const t = now();
    tone('square', 140, 120, t, 0.09, 0.08);
    tone('square', 140, 120, t + 0.11, 0.09, 0.08);
  },
  whoosh() {
    if (!ready()) return;
    noise(now(), 0.45, 0.22, 'bandpass', 300, 2400, 1.2);
  },
  shake() {
    if (!ready()) return;
    const t = now();
    for (let i = 0; i < 6; i++) noise(t + i * 0.08, 0.04, 0.1 + i * 0.03, 'bandpass', 1600, 1600, 5);
  },
  // 轉卡機：卡片從出卡口滑出來（紙擦過塑膠的沙一聲＋喀）
  cardOut() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.22, 0.35, 'bandpass', 2600, 900, 1.2);
    tone('square', 180, 120, t + 0.2, 0.05, 0.08);
  },
  // 翻卡：紙片甩過空氣
  flip() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.16, 0.4, 'highpass', 1800, 5200, 0.8);
    tone('sine', 520, 980, t + 0.02, 0.12, 0.12);
  },
  pop() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.12, 0.5, 'bandpass', 700, 3500, 1.5);
    tone('sine', 380, 1300, t, 0.12, 0.3);
  },
  // 小鼓連打：越打越快、越打越大聲（集氣時）
  drumroll(dur) {
    if (!ready() || dur <= 0) return;
    const t = now();
    let at = 0;
    let gap = 0.13;
    while (at < dur) {
      const k = at / dur;
      noise(t + at, 0.05, 0.05 + 0.25 * k * k, 'bandpass', 1800 + 1200 * k, 1800 + 1200 * k, 1.2);
      tone('triangle', 190, 150, t + at, 0.04, 0.03 + 0.06 * k);
      gap = Math.max(0.035, gap * 0.94);
      at += gap;
    }
    // 最後一下鈸
    noise(t + dur, 1.2, 0.3, 'highpass', 5000);
  },
  // 定格的「叮——」
  hitstop() {
    if (!ready()) return;
    const t = now();
    tone('sine', 2093, 2093, t, 0.35, 0.18);
    tone('sine', 3136, 3136, t, 0.3, 0.1);
  },
  // 集氣：音高往上爬＋雜訊越來越亮（SSR 從更低開始、更長）
  charge(dur, rarity) {
    if (!ready() || dur <= 0) return;
    const t = now();
    const f0 = rarity === 3 ? 110 : 180;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 8, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(5000, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(lp).connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.1);
    noise(t, dur, 0.12, 'bandpass', 500, 7000, 2);
  },
  // 心跳（SSR 關燈後）
  heartbeat(n) {
    if (!ready()) return;
    const t = now();
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.75;
      tone('sine', 70, 45, at, 0.16, 0.5);
      tone('sine', 65, 42, at + 0.2, 0.14, 0.35);
    }
  },
  // 升格（銀蛋變金蛋）
  upgrade() {
    if (!ready()) return;
    const t = now();
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => {
      const f = 880 * Math.pow(2, s / 12);
      tone('triangle', f, f, t + i * 0.045, 0.3, 0.12);
    });
    noise(t, 0.6, 0.08, 'highpass', 7000);
  },
  // 爆開：低音重擊，越稀有越重
  boom(rarity) {
    if (!ready()) return;
    const t = now();
    const v = [0.15, 0.3, 0.5, 0.7][rarity];
    tone('sine', 120, 38, t, 0.5 + rarity * 0.2, v);
    noise(t, 0.3 + rarity * 0.15, v * 0.6, 'lowpass', 1200, 200);
    if (rarity >= 2) noise(t, 1.2, 0.08, 'highpass', 6000);
  },
  firework() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.12, 0.35, 'bandpass', 1500, 600, 1);
    for (let i = 0; i < 9; i++) noise(t + 0.15 + Math.random() * 0.5, 0.025, 0.06, 'highpass', 5000);
  },
  // 開獎音：稀有度越高，音階越長、越亮
  reveal(rarity) {
    if (!ready()) return;
    const t = now() + 0.05;
    const C5 = 523.25;
    const semis = [[0, 4, 7], [0, 4, 7, 12], [0, 4, 7, 12, 16, 19], [-5, 0, 4, 7, 12, 16, 19, 24]][rarity];
    const step = [0.09, 0.08, 0.07, 0.065][rarity];
    semis.forEach((s, i) => {
      const f = C5 * Math.pow(2, s / 12);
      tone('triangle', f, f, t + i * step, 0.5, 0.22);
      if (rarity >= 2) tone('sine', f * 2, f * 2, t + i * step, 0.35, 0.08);
    });
    const end = t + semis.length * step;
    if (rarity >= 2) {
      // 和弦延音＋閃亮雜訊
      [0, 4, 7, 12].forEach((s) => {
        const f = C5 * Math.pow(2, (s + 12) / 12);
        tone('sine', f, f, end, 1.4, 0.07);
      });
      noise(end, 1.2, 0.06, 'highpass', 6000);
    }
    if (rarity === 3) {
      // 合唱和弦：幾個微微走音的鋸齒波疊起來，慢慢進、慢慢收
      const pad = [0, 4, 7, 11, 14].map((st) => C5 * 0.5 * Math.pow(2, st / 12));
      for (const f of pad)
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const lp = ctx.createBiquadFilter();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          lp.type = 'lowpass';
          lp.frequency.value = 1800;
          g.gain.setValueAtTime(0.0001, end);
          g.gain.exponentialRampToValueAtTime(0.025, end + 0.35);
          g.gain.exponentialRampToValueAtTime(0.0001, end + 3.2);
          o.connect(lp).connect(g).connect(master);
          o.start(end);
          o.stop(end + 3.3);
        }
      for (let i = 0; i < 10; i++) {
        const f = 1800 + Math.random() * 2600;
        tone('sine', f, f, end + 0.1 + i * 0.09, 0.25, 0.05);
      }
    }
  },
};
