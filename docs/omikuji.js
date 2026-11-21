// おみくじ機台（使用者 2026-11-21：「追加 おみくじ」「可以自己做籤」「可以做大吉小吉 凶 等等」）
//   模型＝使用者自己做的 D:/_bg/omikuji.blend（左邊玻璃箱＋上面的圓洞、右邊香油錢的木格柵、後面的看板），
//   參考照片＝使用者給的兩張神社おみくじ箱（木框玻璃、白色折好的籤、紅字「おみくじ」、看板寫初穂料）
//   這個檔案：籤的等級、籤紙／看板／箱子上的字（Canvas）、開店頁的「寫籤」編輯器、範例籤、字串
import { t, lang, addStrings } from './i18n.js';

// ---- 籤的等級（吉凶）----
//   r＝對應的稀有度：演出、收藏冊、數據都照它（大吉＝SSR 的大演出；大凶＝很少見，給 SR 的紫色大演出）
export const FORTUNES = [
  { k: 'daikichi', w: '大吉', r: 3, col: '#c8202a', en: 'Great Blessing' },
  { k: 'chukichi', w: '中吉', r: 2, col: '#c8202a', en: 'Middle Blessing' },
  { k: 'shokichi', w: '小吉', r: 1, col: '#c8202a', en: 'Small Blessing' },
  { k: 'kichi', w: '吉', r: 1, col: '#c8202a', en: 'Blessing' },
  { k: 'suekichi', w: '末吉', r: 0, col: '#c8202a', en: 'Future Blessing' },
  { k: 'kyo', w: '凶', r: 0, col: '#23263a', en: 'Curse' },
  { k: 'daikyo', w: '大凶', r: 2, col: '#23263a', en: 'Great Curse' },
];
export const fortuneOf = (k) => FORTUNES.find((f) => f.k === k) || FORTUNES[3];
export const FORTUNE_KEYS = FORTUNES.map((f) => f.k);
export const OMI_LIMITS = { no: 12, msg: 120, label: 8, text: 28, lines: 8, lucky: 20 };

// 籤紙用的字：毛筆字（大吉、おみくじ、第一番）＋明朝體（內文）
export const FONT_BRUSH = '"Yuji Syuku", "Noto Serif TC", serif';
export const FONT_SERIF = '"Noto Serif TC", "Noto Serif JP", serif';
export async function omiFontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`60px ${FONT_BRUSH}`, '大中小末吉凶第番おみくじ御神籤一二三四五六七八九十'),
      document.fonts.load(`700 40px ${FONT_SERIF}`, '願望待人失物旅行商売学問恋愛病気あいうえお'),
      document.fonts.load(`900 40px ${FONT_SERIF}`, '願望待人'),
    ]);
  } catch (e) {
    /* 字型載不到就用備用字 */
  }
}

// 一張籤的內容（item.omi）整理成乾淨的樣子（連結、草稿進來的都過一次）
export function cleanOmi(o) {
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const ls = (Array.isArray(o?.ls) ? o.ls : [])
    .filter((x) => Array.isArray(x))
    .slice(0, OMI_LIMITS.lines)
    .map(([a, b]) => [s(a, OMI_LIMITS.label), s(b, OMI_LIMITS.text)]);
  // pp：照片放哪裡 box＝吉凶的框裡（使用者 2026-11-21：「這裡也可以加圖」）、side＝框旁邊的圓形
  return { f: FORTUNE_KEYS.includes(o?.f) ? o.f : 'kichi', no: s(o?.no, OMI_LIMITS.no), msg: s(o?.msg, OMI_LIMITS.msg), ls, lk: s(o?.lk, OMI_LIMITS.lucky), pp: o?.pp === 'side' ? 'side' : 'box' };
}

// 稀有度 → 預設的籤（照片獎品換成おみくじ機台時用）
export const fortuneForRarity = (r) => ['kichi', 'shokichi', 'chukichi', 'daikichi'][r | 0] || 'kichi';

// ---- 範例籤（七種各一張；寫的是原創的句子）----
const SAMPLE_TEXT = {
  ja: {
    labels: ['願望', '待人', '失物', '旅行', '学問', '恋愛'],
    lucky: 'ラッキーアイテム',
    slips: {
      daikichi: ['春風に 山のさくらの 咲きそろい よろこびごとの 門にあふるる', ['思いのままに叶う', '来る 良い便りあり', '出る 高い所を探せ', '良し 東がよい', '努力が実る', '想いが通じる'], '赤いお守り', 8],
      chukichi: ['雲間より 月のひかりの さしそめて ゆく道しだいに あきらかになる', ['時を待てば叶う', '遅れて来る', '近くにある', '良し 早めに出よ', '少しずつ伸びる', '焦らず育てよ'], '白いハンカチ', 12],
      shokichi: ['小川にも 水はたえずに 流れゆく 小さき幸を 日々に重ねよ', ['小さく叶う', '便りのみ', '出にくい', '近場が吉', '復習が大切', '笑顔が鍵'], '鈴', 14],
      kichi: ['朝ごとに ひらく小窓の 光あり 変わらぬ日々に 福はひそめり', ['叶う', '来る', '出る', '良し', '安心して励め', '素直がよい'], 'お茶', 16],
      suekichi: ['冬枯れの 枝にもつぼみ ふくらみて いずれの春に 花咲かすべし', ['後に叶う', '来るが遅い', '見つかりにくい', '急がぬがよい', '今は基礎を', '時を待て'], '古い本', 10],
      kyo: ['しばしまて 嵐のあとの 空はれて 雲のゆくえに 道はひらけん', ['今は控えよ', '来ない', '出ない', '見合わせよ', '油断するな', '言葉に注意'], '黒い傘', 6],
      daikyo: ['夜ふかく 星も見えねど 明けぬ夜の ためしはなしと 心してまて', ['叶い難し', '来ず', '出ず', 'やめよ', '一からやり直せ', '今は離れよ'], '塩', 2],
    },
  },
  zh: {
    labels: ['願望', '待人', '失物', '旅行', '學業', '戀愛'],
    lucky: '幸運物',
    slips: {
      daikichi: ['春風吹開滿山花，喜事接連到你家。', ['如願以償', '會來，帶來好消息', '找得到，往高處找', '順利，往東最好', '努力有成', '心意相通'], '紅色御守', 8],
      chukichi: ['雲開見月光漸明，前路一步一步清。', ['耐心等待就會實現', '晚一點會來', '就在附近', '順利，早點出發', '慢慢進步', '不急，慢慢培養'], '白手帕', 12],
      shokichi: ['小溪長流不停歇，小小幸福天天疊。', ['小願望會實現', '只有消息', '不太好找', '近處走走較好', '多複習', '笑容是關鍵'], '鈴鐺', 14],
      kichi: ['每天推開小窗戶，平凡日子藏著福。', ['會實現', '會來', '找得到', '順利', '安心努力', '真誠就好'], '一杯茶', 16],
      suekichi: ['冬天枯枝也有芽，等到春天就開花。', ['之後會實現', '會來但較晚', '不容易找到', '不要急著出門', '先打好基礎', '再等等'], '舊書', 10],
      kyo: ['暫且等待風雨停，雲散之後路自明。', ['現在先忍一忍', '不會來', '找不到', '先不要去', '別大意', '說話小心'], '黑傘', 6],
      daikyo: ['夜深不見星和月，沒有天亮不了的夜。', ['難以實現', '不會來', '找不回', '取消吧', '從頭再來', '先保持距離'], '鹽', 2],
    },
  },
  en: {
    labels: ['Wish', 'Awaited', 'Lost item', 'Travel', 'Study', 'Love'],
    lucky: 'Lucky item',
    slips: {
      daikichi: ['Spring wind opens every blossom on the hill — good news keeps knocking at your door.', ['Comes true', 'Arrives with good news', 'Found — look up high', 'Smooth; east is best', 'Effort pays off', 'Your feelings are returned'], 'Something red', 8],
      chukichi: ['The moon slips out between the clouds; your road grows clearer step by step.', ['Comes true if you wait', 'Arrives a little late', 'Close by', 'Good; leave early', 'Steady progress', 'Let it grow slowly'], 'A white handkerchief', 12],
      shokichi: ['Even a small stream never stops — stack up little joys day by day.', ['A small wish comes true', 'Only a letter', 'Hard to find', 'Stay close to home', 'Review often', 'Smile more'], 'A little bell', 14],
      kichi: ['Light comes through the small window every morning; luck hides in ordinary days.', ['Comes true', 'Will come', 'Will turn up', 'Good', 'Keep at it', 'Be honest'], 'A cup of tea', 16],
      suekichi: ['Bare winter branches still hold buds; they will bloom in some spring.', ['Later', 'Comes, but late', 'Hard to find', 'No rush', 'Build the basics', 'Wait a while'], 'An old book', 10],
      kyo: ['Wait a while — after the storm the sky clears and the road opens again.', ['Hold back for now', 'Will not come', 'Will not turn up', 'Postpone it', 'Stay careful', 'Mind your words'], 'A black umbrella', 6],
      daikyo: ['The night is deep and starless, yet no night has ever failed to end.', ['Unlikely', 'Will not come', 'Lost for good', 'Call it off', 'Start over', 'Keep your distance'], 'Salt', 2],
    },
  },
};
const sampleLang = () => (SAMPLE_TEXT[lang] ? lang : 'zh');
export const defaultLabels = () => [...SAMPLE_TEXT[sampleLang()].labels];
export function sampleSlips() {
  const S = SAMPLE_TEXT[sampleLang()];
  return FORTUNES.map((f) => {
    const [msg, texts, lk, qty] = S.slips[f.k];
    return { name: f.w, rarity: f.r, qty, img: null, omi: { f: f.k, no: '', msg, ls: S.labels.map((l, i) => [l, texts[i] || '']), lk } };
  });
}
// 新的一張空白籤（開店頁「＋寫一張籤」）
export function blankSlip(f = 'kichi') {
  const F = fortuneOf(f);
  return { name: F.w, rarity: F.r, qty: 5, img: null, omi: { f: F.k, no: '', msg: '', ls: defaultLabels().map((l) => [l, '']), lk: '' } };
}

// ---- 數字 → 漢數字（第十二番）----
const KAN = '〇一二三四五六七八九';
export function kanjiNum(n) {
  n = Math.max(0, n | 0);
  if (n < 10) return KAN[n];
  if (n < 100) return (n >= 20 ? KAN[Math.floor(n / 10)] : '') + '十' + (n % 10 ? KAN[n % 10] : '');
  return String(n);
}
export const slipNo = (it, i) => it?.omi?.no || (lang === 'en' ? `No. ${i + 1}` : `第${kanjiNum(i + 1)}番`);
const isCJK = (s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s || '');

// ---- 直書（縦書き）----
//   標點、長音、括號要轉 90°；、。放在格子右上
const ROT = new Set([...'ー－—―〜～…‥（）()「」『』【】〈〉《》[]{}-~:;：；']);
const SMALL = new Set([...'、。，．,.']);
function vCols(text, perCol) {
  // 依每欄字數切成欄（行頭不放標點：把標點掛在上一欄的最後）
  const chars = [...(text || '').replace(/\s+/g, '　').trim()];
  const cols = [];
  let cur = [];
  for (const ch of chars) {
    if (cur.length >= perCol && !(SMALL.has(ch) && cur.length === perCol)) {
      cols.push(cur);
      cur = [];
    }
    cur.push(ch);
  }
  if (cur.length) cols.push(cur);
  return cols;
}
function drawVCol(g, chars, x, y, size, gap = 1.05) {
  // x＝這一欄的中心；y＝第一個字的上緣
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  chars.forEach((ch, i) => {
    const cy = y + (i + 0.5) * size * gap;
    if (ROT.has(ch)) {
      g.save();
      g.translate(x, cy);
      g.rotate(Math.PI / 2);
      g.fillText(ch, 0, 0);
      g.restore();
    } else if (SMALL.has(ch)) g.fillText(ch, x + size * 0.32, cy - size * 0.3);
    else g.fillText(ch, x, cy);
  });
}
// 橫書換行（英文以字為單位、中日文以字元）
function wrapLines(g, text, maxW) {
  const out = [];
  const words = isCJK(text) ? [...text] : (text || '').split(/(\s+)/);
  let line = '';
  for (const w of words) {
    const test = line + w;
    if (g.measureText(test).width > maxW && line.trim()) {
      out.push(line.trim());
      line = w.trimStart();
    } else line = test;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

// 和紙的底：米白＋細細的纖維（固定亂數，每次畫一樣）
function paper(g, w, h, seed = 7) {
  g.fillStyle = '#fbf6ea';
  g.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.lineCap = 'round';
  for (let i = 0; i < (w * h) / 900; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const a = rnd() * Math.PI;
    const l = 4 + rnd() * 14;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '150,120,80' : '255,255,255'},${0.05 + rnd() * 0.08})`;
    g.lineWidth = 0.6 + rnd();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
}
const RED = '#c8202a';
const INK = '#2a2420';
function frame(g, x, y, w, h, col = RED) {
  g.strokeStyle = col;
  g.lineWidth = 7;
  g.strokeRect(x, y, w, h);
  g.lineWidth = 2;
  g.strokeRect(x + 11, y + 11, w - 22, h - 22);
}
function cover(g, img, x, y, w, h) {
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  const s = Math.max(w / iw, h / ih);
  g.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
}

// ---- 籤紙的樣式（全部的籤一起；draft.omiPaper）----
//   k：washi 和紙（預設）／preset 卡背那組手繪插畫（assets/tex/back_<id>.webp）／img 自己的圖；c：框的顏色
export const PAPER_COLORS = ['#c8202a', '#1f3a7a', '#b8892b', '#d9608a', '#2f7a4f', '#6b3fa0', '#23263a'];
// 和柄的框（Gemini 2026-11-21 一張五種 → tools/cut_omi_frames.py → assets/tex/omi_frame_<id>.webp，360 × 840）
//   inner＝中間白色紙面（0..1，x y w h）、tab＝上面的小標籤（「おみくじ」寫在這裡）、col＝標題、項目的顏色
const TAB = [0.272, 0.061, 0.44, 0.071];
export const OMI_FRAMES = {
  red: { inner: [0.1295, 0.1406, 0.7009, 0.7847], col: '#c8202a' }, // 朱＋金櫻、麻の葉
  teal: { inner: [0.1295, 0.1406, 0.7277, 0.7847], col: '#1d6c80' }, // 青海波
  gold: { inner: [0.13, 0.1406, 0.7265, 0.7847], col: '#9a6716' }, // 七宝
  indigo: { inner: [0.1216, 0.1388, 0.7342, 0.7865], col: '#2b2d6e' }, // 矢絣
  pink: { inner: [0.1525, 0.1373, 0.704, 0.7879], col: '#cf5d7c' }, // 桜
};
export const FRAME_IDS = Object.keys(OMI_FRAMES);
export const paperColor = (cfg) => {
  const p = cfg?.omiPaper;
  if (/^#[0-9a-f]{6}$/i.test(p?.c || '')) return p.c;
  return p?.k === 'frame' && OMI_FRAMES[p.id] ? OMI_FRAMES[p.id].col : RED;
};
export function cleanPaper(p, presets) {
  const k = p?.k === 'img' && p.img ? 'img' : p?.k === 'preset' && presets.includes(p.id) ? 'preset' : p?.k === 'frame' && OMI_FRAMES[p.id] ? 'frame' : 'washi';
  return { k, id: k === 'preset' || k === 'frame' ? p.id : '', c: /^#[0-9a-f]{6}$/i.test(p?.c || '') ? p.c : '', img: k === 'img' ? p.img : null };
}
// 和柄框的圖＋位置（app 載好圖之後包成這樣交給 drawSlip）
export function frameArt(id, img) {
  const f = OMI_FRAMES[id];
  if (!img || !f) return null;
  return { img, inner: { x: f.inner[0], y: f.inner[1], w: f.inner[2], h: f.inner[3] }, tab: TAB };
}

// ---- 籤紙（打開後的那張）----
//   600 × 1400（真的籤是細長的）；中日文直書、英文橫書
//   it.omi＝{ f 等級, no 番號, msg 詩句／整體運勢, ls [[項目, 內容]…], lk 幸運物 }；photo＝店家放的照片（可以沒有）
export const SLIP_W = 600;
export const SLIP_H = 1400;
export function drawSlip(it, i, cfg, photo = null, art = null) {
  // 和柄的框（Gemini 畫的，art.inner＝中間白色紙面的位置 0..1）：框整張鋪滿，內容畫在透明的一層、縮進白色紙面
  if (art?.inner) {
    const c = document.createElement('canvas');
    c.width = SLIP_W;
    c.height = SLIP_H;
    const g = c.getContext('2d');
    g.drawImage(art.img, 0, 0, SLIP_W, SLIP_H);
    const body = drawSlip(it, i, cfg, photo, 'bare');
    const r = art.inner;
    const iw = r.w * SLIP_W;
    const ih = r.h * SLIP_H;
    const k = Math.min(iw / SLIP_W, ih / SLIP_H);
    g.drawImage(body, r.x * SLIP_W + (iw - SLIP_W * k) / 2, r.y * SLIP_H + (ih - SLIP_H * k) / 2 - 40 * k, SLIP_W * k, SLIP_H * k);
    // 上面的小標籤：「おみくじ」
    const [tx, ty, tw, th] = art.tab;
    g.fillStyle = paperColor(cfg);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${Math.round(th * SLIP_H * 0.62)}px ${FONT_BRUSH}`;
    g.fillText(t('omi.title'), (tx + tw / 2) * SLIP_W, (ty + th / 2) * SLIP_H + 3, tw * SLIP_W * 0.86);
    return c;
  }
  const bare = art === 'bare';
  if (bare) art = null;
  const o = cleanOmi(it.omi);
  const F = fortuneOf(o.f);
  const c = document.createElement('canvas');
  c.width = SLIP_W;
  c.height = SLIP_H;
  const g = c.getContext('2d');
  const W = SLIP_W;
  const H = SLIP_H;
  // 籤紙的樣式（使用者 2026-11-21：「圖可以自己改」）：店家選的插畫或自己的圖鋪滿，框外看得到、框內淡淡的；框、標題、項目換成選的顏色
  const AC = paperColor(cfg);
  if (!bare) {
    paper(g, W, H);
    if (art) {
      cover(g, art, 0, 0, W, H);
      g.fillStyle = 'rgba(251,246,234,0.86)';
      g.fillRect(34, 34, W - 68, H - 68);
    }
    frame(g, 22, 22, W - 44, H - 44, AC);
  }
  const vert = isCJK(o.msg + o.ls.map((x) => x.join('')).join('') + (cfg?.shop || cfg?.name || '')) || (!o.msg && lang !== 'en');
  // 抬頭：店名＋おみくじ（紅字）、番號
  const head = (cfg?.shop || cfg?.name || '').slice(0, 14);
  g.fillStyle = AC;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `44px ${FONT_BRUSH}`;
  if (!bare) g.fillText(t('omi.title'), W / 2, 92); // 和柄框：標題寫在框上的小標籤裡
  if (head) {
    g.font = `700 24px ${FONT_SERIF}`;
    g.fillText(head, W / 2, 140);
  }
  g.fillRect(60, 166, W - 120, 3);
  // 番號（右上直書）＋大字的吉凶（中間，紅框）
  const fy = 196;
  const fh = 360;
  g.fillStyle = INK;
  const no = slipNo(it, i);
  if (vert && isCJK(no)) {
    g.font = `34px ${FONT_BRUSH}`;
    drawVCol(g, [...no], W - 78, fy + 6, 36);
  } else {
    g.font = `700 24px ${FONT_SERIF}`;
    g.textAlign = 'right';
    g.fillText(no, W - 56, fy + 20);
  }
  const inBox = photo && o.pp !== 'side';
  // 照片放旁邊：框往右、窄一點，右邊留空給籤號（使用者 2026-11-21：「壓到了 再調整一下」）
  const bx = photo && !inBox ? 262 : 175;
  const bw = photo && !inBox ? 222 : 250;
  if (inBox) {
    // 照片鋪在吉凶的框裡，蓋一層淡淡的白，大字加白邊（照片上也讀得到）
    g.save();
    g.beginPath();
    g.rect(bx + 10, fy + 24, bw - 20, fh - 60);
    g.clip();
    cover(g, photo, bx + 10, fy + 24, bw - 20, fh - 60);
    g.fillStyle = 'rgba(255,253,248,0.28)';
    g.fillRect(bx + 10, fy + 24, bw - 20, fh - 60);
    g.restore();
  }
  g.strokeStyle = F.col;
  g.lineWidth = 6;
  g.strokeRect(bx, fy + 14, bw, fh - 40);
  g.lineWidth = 2;
  g.strokeRect(bx + 10, fy + 24, bw - 20, fh - 60);
  g.fillStyle = F.col;
  const ch = [...F.w];
  const fs = ch.length === 1 ? 210 : 150;
  g.font = `${fs}px ${FONT_BRUSH}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cy0 = fy + 14 + (fh - 40) / 2;
  if (inBox) {
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 14;
    g.lineJoin = 'round';
    ch.forEach((x, k) => g.strokeText(x, bx + bw / 2, cy0 + (k - (ch.length - 1) / 2) * fs * 0.98));
  }
  ch.forEach((x, k) => g.fillText(x, bx + bw / 2, cy0 + (k - (ch.length - 1) / 2) * fs * 0.98));
  if (lang === 'en') {
    g.font = `700 22px ${FONT_SERIF}`;
    g.fillText(F.en, bx + bw / 2, fy + fh - 6);
  }
  if (photo && !inBox) {
    // 店家的照片：圓形，在吉凶左邊
    const r = 98;
    const px = 154;
    const py = cy0;
    g.save();
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.clip();
    cover(g, photo, px - r, py - r, r * 2, r * 2);
    g.restore();
    g.strokeStyle = AC;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.stroke();
  }
  // 詩句／整體運勢
  const my = fy + fh + 14;
  const mh = 280;
  g.fillStyle = INK;
  if (o.msg) {
    if (vert) {
      const size = 34;
      const per = Math.floor(mh / (size * 1.05));
      g.font = `700 ${size}px ${FONT_SERIF}`;
      // 先照空格分句（和歌的五七五），太長再切
      const parts = o.msg.split(/[\s　]+/).filter(Boolean).flatMap((p) => vCols(p, per));
      const cols = parts.length * 52 > W - 120 ? vCols(o.msg.replace(/[\s　]+/g, ''), per) : parts;
      const cw = Math.min(56, (W - 120) / Math.max(1, cols.length));
      const x0 = W / 2 + ((cols.length - 1) * cw) / 2;
      cols.slice(0, 9).forEach((col, k) => drawVCol(g, col, x0 - k * cw, my + 8, size));
    } else {
      g.font = `italic 700 28px ${FONT_SERIF}`;
      const lines = wrapLines(g, o.msg, W - 130).slice(0, 8);
      g.textAlign = 'center';
      lines.forEach((l, k) => g.fillText(l, W / 2, my + 40 + k * 40 - ((lines.length - 1) * 40) / 2 + 120));
    }
  }
  // 分隔線（中間一個菱形）
  const dy = my + mh + 16;
  g.fillStyle = AC;
  g.fillRect(60, dy, W - 120, 2);
  g.save();
  g.translate(W / 2, dy + 1);
  g.rotate(Math.PI / 4);
  g.fillRect(-8, -8, 16, 16);
  g.restore();
  // 各項（願望、待人…）
  const ly = dy + 26;
  const lh = 1252 - ly - (o.lk ? 66 : 0);
  const ls = o.ls.filter(([a, b]) => a || b);
  if (vert) {
    // 字的大小：讓最長的一項（【項目】＋內容）剛好放進一欄；太長才換欄
    const longest = Math.max(1, ...ls.map(([a, b]) => (a ? [...a].length + 2 : 0) + [...(b || '')].length));
    const size = Math.max(19, Math.min(28, Math.floor(lh / (longest * 1.05))));
    const per = Math.floor(lh / (size * 1.05));
    const cols = [];
    for (const [a, b] of ls) {
      const lab = [...(a ? `【${a}】` : '')];
      const all = vCols(b || '', per - Math.min(lab.length, per - 2));
      cols.push({ lab, txt: all[0] || [] });
      for (const extra of all.slice(1)) cols.push({ lab: [], txt: extra });
    }
    const cw = Math.min(62, (W - 120) / Math.max(1, cols.length));
    const x0 = W / 2 + ((cols.length - 1) * cw) / 2;
    cols.slice(0, 10).forEach((col, k) => {
      const x = x0 - k * cw;
      g.fillStyle = AC;
      g.font = `900 ${size}px ${FONT_SERIF}`;
      drawVCol(g, col.lab, x, ly, size);
      g.fillStyle = INK;
      g.font = `700 ${size}px ${FONT_SERIF}`;
      drawVCol(g, col.txt, x, ly + col.lab.length * size * 1.05, size);
    });
  } else {
    const rowH = Math.min(56, lh / Math.max(1, ls.length));
    ls.forEach(([a, b], k) => {
      const y = ly + rowH * (k + 0.5);
      g.textAlign = 'left';
      g.fillStyle = AC;
      g.font = `900 22px ${FONT_SERIF}`;
      g.fillText(a, 62, y);
      g.fillStyle = INK;
      g.font = `700 22px ${FONT_SERIF}`;
      const lines = wrapLines(g, b, W - 260);
      g.fillText(lines[0] || '', 220, y);
      g.strokeStyle = 'rgba(200,32,42,0.25)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(62, y + rowH / 2);
      g.lineTo(W - 62, y + rowH / 2);
      g.stroke();
    });
  }
  // 幸運物
  if (o.lk) {
    const y = 1236;
    g.strokeStyle = AC;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(60, y - 28, W - 120, 52, 26);
    g.stroke();
    g.fillStyle = AC;
    g.textAlign = 'center';
    g.font = `900 22px ${FONT_SERIF}`;
    const lab = SAMPLE_TEXT[vert ? (lang === 'en' ? 'ja' : sampleLang()) : 'en'].lucky;
    g.fillText(`${lab}　`, W / 2 - g.measureText(o.lk).width / 2 - 6, y - 2);
    g.fillStyle = INK;
    g.font = `700 24px ${FONT_SERIF}`;
    g.textAlign = 'left';
    g.fillText(o.lk, W / 2 - g.measureText(o.lk).width / 2 + g.measureText(`${lab}　`).width / 2 - 6, y - 2);
  }
  // 朱印（右下）
  seal(g, W - 86, H - 84, 32, AC);
  return c;
}
function seal(g, x, y, r, col = RED) {
  g.save();
  g.globalAlpha = 0.85;
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(x - r, y - r, r * 2, r * 2, 8);
  g.stroke();
  g.font = `${r * 0.95}px ${FONT_BRUSH}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('籤', x, y + 2);
  g.restore();
}

// ---- 籤的小圖（收藏冊、10 連、清單的縮圖）：和紙＋大字吉凶 ----
export function drawSlipTag(it, i, size = 128) {
  const o = cleanOmi(it.omi);
  const F = fortuneOf(o.f);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  paper(g, size, size, 11 + i);
  const k = size / 128;
  g.strokeStyle = F.col;
  g.lineWidth = 4 * k;
  g.strokeRect(6 * k, 6 * k, size - 12 * k, size - 12 * k);
  g.lineWidth = 1.2 * k;
  g.strokeRect(11 * k, 11 * k, size - 22 * k, size - 22 * k);
  g.fillStyle = F.col;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const ch = [...F.w];
  const fs = (ch.length === 1 ? 74 : 50) * k;
  g.font = `${fs}px ${FONT_BRUSH}`;
  if (ch.length === 1) g.fillText(ch[0], size / 2, size * 0.5);
  else ch.forEach((x, n) => g.fillText(x, size / 2, size * 0.5 + (n - 0.5) * fs * 0.95));
  return c;
}

// ---- 3D 用：折好的籤（窗裡那堆、從洞拿出來的那張）----
//   白紙、紅色細框、幾條紅色的「字」；一張貼圖大家共用
export function drawFolded() {
  // 橫的小紙包（跟 3D 的折好的籤一樣是橫的）：紅框＋紅字「御神籤」
  //   使用者 2026-11-21 圈出兩條直的摺線：「這個貼圖的材質不是木頭是紙」→ 拿掉直線（看起來像木板接縫），
  //   紙的纖維也調淡、不要褐色（小小一張時褐色纖維會變成木紋）
  const c = document.createElement('canvas');
  c.width = 224;
  c.height = 132;
  const g = c.getContext('2d');
  paper(g, 224, 132, 3);
  g.fillStyle = 'rgba(253,251,246,0.7)';
  g.fillRect(0, 0, 224, 132);
  g.strokeStyle = RED;
  g.lineWidth = 4;
  g.strokeRect(8, 8, 208, 116);
  g.lineWidth = 1.5;
  g.strokeRect(15, 15, 194, 102);
  g.fillStyle = RED;
  g.font = `52px ${FONT_BRUSH}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('御神籤', 112, 70, 176);
  return c;
}
// 籤的背面（打開前看到的、紙的反面）
export function drawSlipBack() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 600;
  const g = c.getContext('2d');
  paper(g, 256, 600, 5);
  g.fillStyle = 'rgba(253,251,246,0.7)'; // 纖維調淡（不要像木紋）
  g.fillRect(0, 0, 256, 600);
  g.strokeStyle = 'rgba(200,32,42,0.35)';
  g.lineWidth = 3;
  g.strokeRect(10, 10, 236, 580);
  return c;
}

// ---- 籤箱設計（使用者 2026-11-21：「讓玩家可以自由設計自己的籤箱」；draft.omiBox）----
//   title 看板的大字、text 看板的說明（換行＝一欄）、label 木板上的直書字、labelC 字的顏色、woodC 自己調的木頭顏色、sign 自己的看板圖
export const BOX_LIMITS = { title: 10, text: 60, label: 6 };
export function cleanBox(b) {
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const col = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : '');
  const out = { title: s(b?.title, BOX_LIMITS.title), text: s(b?.text, BOX_LIMITS.text), label: s(b?.label, BOX_LIMITS.label), labelC: col(b?.labelC), woodC: col(b?.woodC), sign: b?.sign?.bytes ? b.sign : null };
  return out.title || out.text || out.label || out.labelC || out.woodC || out.sign ? out : null;
}

// ---- 後面的看板 ----
//   照參考照片：紅字「おみくじ」、初穂料、說明（直書）、這台有的吉凶；店家可以改標題、說明，或整張換成自己的圖（signImg）
export function drawSign(cfg, priceStr, signImg = null) {
  const W = 1024;
  const H = 720;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (signImg) {
    paper(g, W, H, 13);
    cover(g, signImg, 0, 0, W, H);
    return c;
  }
  const box = cfg?.omiBox || {};
  const AC = box.labelC || RED;
  paper(g, W, H, 13);
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.35;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
  frame(g, 18, 18, W - 36, H - 36, AC);
  // 左上：店名的紅框小標
  const head = (cfg?.name || '').slice(0, 16);
  g.textBaseline = 'middle';
  if (head) {
    g.font = `700 30px ${FONT_SERIF}`;
    const w = Math.min(420, g.measureText(head).width + 36);
    g.strokeStyle = AC;
    g.lineWidth = 3;
    g.strokeRect(60, 58, w, 52);
    g.fillStyle = AC;
    g.textAlign = 'center';
    g.fillText(head, 60 + w / 2, 85, w - 20);
  }
  // 大字おみくじ（右上）
  g.fillStyle = AC;
  g.textAlign = 'right';
  g.font = `112px ${FONT_BRUSH}`;
  g.fillText(box.title || t('omi.title'), W - 64, 104, W - 520);
  // 初穂料
  g.fillStyle = INK;
  g.font = `700 34px ${FONT_SERIF}`;
  g.fillText(t('omi.priceLine', { p: priceStr }), W - 70, 192);
  // 這台的吉凶（有放的才列）
  const have = FORTUNES.filter((f) => (cfg?.items || []).some((it) => (it.omi?.f || 'kichi') === f.k));
  const list = have.length ? have : FORTUNES;
  const cw = Math.min(118, (W - 140) / list.length);
  const x0 = W / 2 - ((list.length - 1) * cw) / 2;
  list.forEach((f, k) => {
    const x = x0 + k * cw;
    g.fillStyle = f.col;
    g.strokeStyle = f.col;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(x - cw * 0.42, 236, cw * 0.84, 92, 12);
    g.stroke();
    g.font = `${[...f.w].length === 1 ? 60 : 46}px ${FONT_BRUSH}`;
    g.textAlign = 'center';
    g.fillText(f.w, x, 284);
  });
  g.fillStyle = AC;
  g.fillRect(70, 352, W - 140, 3);
  // 說明（直書，右到左；英文橫書）
  g.fillStyle = INK;
  const txt = box.text || t('omi.signText');
  if (isCJK(txt)) {
    // 一句一欄：字的大小照最長的那句縮，整塊置中
    const lines = txt.split('\n').filter(Boolean);
    const longest = Math.max(...lines.map((l) => [...l].length));
    const size = Math.min(44, Math.floor(300 / (longest * 1.05)));
    g.font = `700 ${size}px ${FONT_SERIF}`;
    const cols = lines.flatMap((p) => vCols(p, longest));
    const cwid = size * 1.9;
    const x0 = W / 2 + ((cols.length - 1) * cwid) / 2;
    cols.slice(0, 12).forEach((col, k) => drawVCol(g, col, x0 - k * cwid, 380, size));
  } else {
    g.font = `italic 700 36px ${FONT_SERIF}`;
    g.textAlign = 'center';
    const lines = txt.split('\n').flatMap((p) => wrapLines(g, p, W - 200)).slice(0, 6);
    lines.forEach((l, k) => g.fillText(l, W / 2, 420 + k * 50));
  }
  seal(g, 120, H - 110, 50, AC);
  return c;
}

// 右邊木板上的紅字「おみくじ」（直的）：店家可以改字、改顏色
export function drawPanelLabel(cfg = null) {
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 520;
  const g = c.getContext('2d');
  g.fillStyle = cfg?.omiBox?.labelC || RED;
  const txt = cfg?.omiBox?.label || t('omi.title');
  if (isCJK(txt)) {
    const chars = [...txt];
    const size = Math.min(110, 480 / chars.length / 1.02);
    g.font = `${size}px ${FONT_BRUSH}`;
    drawVCol(g, chars, 100, (520 - chars.length * size * 1.02) / 2, size, 1.02);
  } else {
    g.save();
    g.translate(100, 260);
    g.rotate(Math.PI / 2);
    g.font = `84px ${FONT_BRUSH}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, 0, 0, 500);
    g.restore();
  }
  return c;
}

// ---- 字串 ----
addStrings({
  zh: {
    'omi.photoChange': '📷 換照片',
    'omi.pp': '照片放在', 'omi.pp.box': '吉凶的框裡', 'omi.pp.side': '旁邊（圓形）',
    'bgm.p.shrine': '神社',
    'bg.shrine': '神社境內', 'bg.torii': '千本鳥居', 'bg.matsuri': '夏祭り',
    'ob.label': '籤箱設計', 'ob.title': '看板的大字', 'ob.text': '看板的說明（換行＝換一欄）', 'ob.sign': '看板', 'ob.signOwn': '📷 用自己的圖當看板', 'ob.signAuto': '改回自動排版', 'ob.signCrop': '裁切看板的圖',
    'ob.panel': '木板上的字', 'ob.panelC': '字的顏色', 'ob.wood': '箱子的顏色（自己調）', 'ob.woodReset': '用上面的色票', 'ob.hint': '貼紙也能貼在籤箱上（「轉蛋機上的貼紙」）。', 'ob.sumOwn': '自己的設計', 'ob.sumAuto': '預設',
    'omi.paper': '籤紙（全部的籤一起）',
    'fx.label': '稀有的特殊演出',
    'fx.row2': 'SR 抽到時', 'fx.row3': 'SSR 抽到時', 'fx.row2.omikuji': '中吉・大凶', 'fx.row3.omikuji': '大吉',
    'fx.std': '標準', 'fx.sakura': '🌸 櫻吹雪', 'fx.stars': '🌠 流星', 'fx.thunder': '⚡ 雷鳴', 'fx.hanabi': '🎆 花火大會', 'fx.gold': '💰 黃金雨',
    'fx.try': '▶ 預覽',
    'fx.hint': '疊在原本的演出上。選了會在機台前面先放一次給你看。',
    'omi.wrap': '籤裝在',
    'omi.wrap.fold': '📜 折好的紙',
    'omi.wrap.capsule': '🟡 圓的轉蛋',
    'omi.paper.washi': '和紙',
    'omi.frame.red': '朱色・櫻', 'omi.frame.teal': '青海波', 'omi.frame.gold': '金・七寶', 'omi.frame.indigo': '矢絣', 'omi.frame.pink': '粉櫻',
    'omi.paperOwn': '用自己的圖',
    'omi.paperCrop': '裁切籤紙的圖',
    'omi.frameColor': '框跟字的顏色',
    'omi.sound': '聲音（抽到時播放）',
    'omi.soundNone': '還沒有聲音',
    'omi.rec': '🎙 錄一段語音',
    'omi.recStop': '■ 停止錄音 {s} 秒',
    'omi.music': '🎵 音樂・影片',
    'omi.soundDel': '拿掉聲音',
    'omi.micFail': '用不了麥克風：請允許這個網頁使用麥克風',
    'omi.voiceName': '語音籤',
    'step1.omikuji': '寫籤',
    'itemsHint.omikuji': '每張籤可以自己寫：等級（大吉〜大凶）、籤詩、各項運勢、幸運物，也可以放照片。張數越多越容易抽到。',
    'itemsSum.omikuji': '{n} 種籤・共 {q} 張',
    'th.omi.red': '朱漆', 'th.omi.white': '白木', 'th.omi.yellow': '琥珀色', 'th.omi.blue': '藍染', 'th.omi.mint': '竹青', 'th.omi.pink': '櫻色', 'th.omi.black': '黑漆',
    'omi.title': '御神籤',
    'omi.priceLine': '香油錢　一次 {p}',
    'omi.signText': '投入香油錢\n把手伸進箱子\n攪一攪\n抽一張籤',
    'kind.omikuji': 'おみくじ',
    'kind.omikujiSub': '自己寫籤：大吉到大凶，伸手進箱子抽一張',
    'omi.fortune': '籤的等級',
    'omi.no': '籤號',
    'omi.noPh': '第一番（空白＝照順序）',
    'omi.msg': '籤詩／整體運勢',
    'omi.msgPh': '例：春風吹開滿山花，喜事接連到你家。',
    'omi.lines': '各項運勢',
    'omi.addLine': '＋加一項',
    'omi.lucky': '幸運物',
    'omi.luckyPh': '例：紅色御守',
    'omi.edit': '✏️ 寫籤',
    'omi.editTitle': '寫籤',
    'omi.add': '＋寫一張籤',
    'omi.photo': '照片（可以不放）',
    'omi.photoAdd': '📷 放照片',
    'omi.photoDel': '拿掉照片',
    'omi.done': '寫好了',
    'omi.preview': '預覽',
    'omi.labelPh': '項目',
    'omi.textPh': '內容',
    'omi.sample': '放入七種範例籤',
    'omi.sampleAsk': '把清單換成七種範例籤（大吉〜大凶）？目前的籤會被取代',
    'omi.itemsHint': '每張籤可以自己寫：等級、籤詩、各項運勢、幸運物。張數越多越容易抽到',
    'omi.sum': '{n} 種籤・共 {q} 張',
    's.turn.omikuji': '把手伸進箱子',
    's.turnText.omikuji': '在圓洞上畫圈攪一攪（或按按鈕）',
    's.turnBtn.omikuji': '幫我攪',
    's.take.omikuji': '抽出來了！',
    's.takeText.omikuji': '點籤拿到面前',
    's.takeBtn.omikuji': '拿起來',
    's.open.omikuji': '打開籤',
    's.openText.omikuji': '點一下把籤打開',
    's.openBtn.omikuji': '打開',
    'myCaps.omikuji': '我的籤',
    'omi.tie': '綁起來（結籤）',
    'omi.tied': '綁好了，壞運留在這裡 🎋',
    'omi.keep': '帶回去',
    'omi.misfit': 'おみくじ機台只放籤：按「寫籤」把這個獎品寫成一張籤',
    'kc.title.omikuji': '換成おみくじ？',
    'kc.text.omikuji': '{n} 個獎品會變成籤（照稀有度給吉凶，照片留在籤上），之後可以再改',
    'kc.ok.omikuji': '變成籤',
    'kc.done.omikuji': '{n} 個獎品已經寫成籤',
    'omi.fortuneOdds': '{f}：{p}',
  },
  ja: {
    'omi.photoChange': '📷 写真を変える',
    'omi.pp': '写真の場所', 'omi.pp.box': '運勢の枠の中', 'omi.pp.side': '横に丸く',
    'bgm.p.shrine': '神社',
    'bg.shrine': '神社の境内', 'bg.torii': '千本鳥居', 'bg.matsuri': '夏祭り',
    'ob.label': 'おみくじ箱のデザイン', 'ob.title': '看板の大きい字', 'ob.text': '看板の説明（改行＝次の列）', 'ob.sign': '看板', 'ob.signOwn': '📷 自分の画像を看板にする', 'ob.signAuto': '自動レイアウトに戻す', 'ob.signCrop': '看板の画像を切り抜く',
    'ob.panel': '板の文字', 'ob.panelC': '文字の色', 'ob.wood': '箱の色（自分で調整）', 'ob.woodReset': '上の色見本を使う', 'ob.hint': 'シールもおみくじ箱に貼れます（「マシンのシール」）。', 'ob.sumOwn': 'オリジナル', 'ob.sumAuto': 'デフォルト',
    'omi.paper': 'おみくじの紙（全部まとめて）',
    'fx.label': 'レアの特別演出',
    'fx.row2': 'SR が出たとき', 'fx.row3': 'SSR が出たとき', 'fx.row2.omikuji': '中吉・大凶', 'fx.row3.omikuji': '大吉',
    'fx.std': 'いつもの', 'fx.sakura': '🌸 桜吹雪', 'fx.stars': '🌠 流れ星', 'fx.thunder': '⚡ 雷鳴', 'fx.hanabi': '🎆 花火大会', 'fx.gold': '💰 黄金の雨',
    'fx.try': '▶ 見てみる',
    'fx.hint': 'いつもの演出に重ねて出ます。選ぶとマシンの前で一度流れます。',
    'omi.wrap': 'おみくじの入れ方',
    'omi.wrap.fold': '📜 折った紙',
    'omi.wrap.capsule': '🟡 丸いカプセル',
    'omi.paper.washi': '和紙',
    'omi.frame.red': '朱・桜', 'omi.frame.teal': '青海波', 'omi.frame.gold': '金・七宝', 'omi.frame.indigo': '矢絣', 'omi.frame.pink': '桜色',
    'omi.paperOwn': '自分の画像',
    'omi.paperCrop': 'おみくじの紙の画像を切り抜く',
    'omi.frameColor': '枠と文字の色',
    'omi.sound': '音（引いたときに流れる）',
    'omi.soundNone': 'まだ音はありません',
    'omi.rec': '🎙 声を録音する',
    'omi.recStop': '■ 録音を止める {s} 秒',
    'omi.music': '🎵 音楽・動画',
    'omi.soundDel': '音を外す',
    'omi.micFail': 'マイクが使えません：このページにマイクを許可してください',
    'omi.voiceName': 'ボイスおみくじ',
    'step1.omikuji': 'おみくじを書く',
    'itemsHint.omikuji': '一枚ずつ自分で書けます：運勢（大吉〜大凶）、歌、各項目、ラッキーアイテム、写真も入れられます。枚数が多いほど出やすい。',
    'itemsSum.omikuji': '{n} 種・計 {q} 枚',
    'th.omi.red': '朱塗り', 'th.omi.white': '白木', 'th.omi.yellow': '飴色', 'th.omi.blue': '藍', 'th.omi.mint': '若竹', 'th.omi.pink': '桜', 'th.omi.black': '黒漆',
    'omi.title': 'おみくじ',
    'omi.priceLine': '初穂料　一回 {p}',
    'omi.signText': 'お賽銭を納め\n箱の中に手を入れ\nよくかきまぜて\n一枚お引きください',
    'kind.omikuji': 'おみくじ',
    'kind.omikujiSub': '自分で書くおみくじ：大吉〜大凶、箱に手を入れて一枚引く',
    'omi.fortune': '運勢',
    'omi.no': '番号',
    'omi.noPh': '第一番（空欄＝順番どおり）',
    'omi.msg': '歌・総合運',
    'omi.msgPh': '例：春風に 山のさくらの 咲きそろい',
    'omi.lines': '各項目',
    'omi.addLine': '＋項目を追加',
    'omi.lucky': 'ラッキーアイテム',
    'omi.luckyPh': '例：赤いお守り',
    'omi.edit': '✏️ おみくじを書く',
    'omi.editTitle': 'おみくじを書く',
    'omi.add': '＋おみくじを一枚書く',
    'omi.photo': '写真（なくてもOK）',
    'omi.photoAdd': '📷 写真を入れる',
    'omi.photoDel': '写真を外す',
    'omi.done': '書けた',
    'omi.preview': 'プレビュー',
    'omi.labelPh': '項目',
    'omi.textPh': '内容',
    'omi.sample': '七種のサンプルを入れる',
    'omi.sampleAsk': 'リストを七種のサンプル（大吉〜大凶）に入れ替えますか？今のおみくじは置き換わります',
    'omi.itemsHint': '一枚ずつ自分で書けます：運勢、歌、各項目、ラッキーアイテム。枚数が多いほど出やすい',
    'omi.sum': '{n} 種・計 {q} 枚',
    's.turn.omikuji': '箱に手を入れて',
    's.turnText.omikuji': '丸い穴の上でくるっとかきまぜる（ボタンでもOK）',
    's.turnBtn.omikuji': 'かきまぜる',
    's.take.omikuji': '引けた！',
    's.takeText.omikuji': 'おみくじをタップして手元へ',
    's.takeBtn.omikuji': '手に取る',
    's.open.omikuji': 'ひらく',
    's.openText.omikuji': 'タップしておみくじを開く',
    's.openBtn.omikuji': 'ひらく',
    'myCaps.omikuji': '引いたおみくじ',
    'omi.tie': '結んで帰る',
    'omi.tied': '結びました。悪い運はここに置いていきます 🎋',
    'omi.keep': '持ち帰る',
    'omi.misfit': 'おみくじマシンにはおみくじだけ：「おみくじを書く」でこの景品をおみくじにしてください',
    'kc.title.omikuji': 'おみくじにする？',
    'kc.text.omikuji': '{n} 個の景品がおみくじになります（レア度で運勢、写真はおみくじに残ります）。あとで書き直せます',
    'kc.ok.omikuji': 'おみくじにする',
    'kc.done.omikuji': '{n} 個の景品をおみくじにしました',
    'omi.fortuneOdds': '{f}：{p}',
  },
  en: {
    'omi.photoChange': '📷 Change photo',
    'omi.pp': 'Photo goes', 'omi.pp.box': 'Inside the fortune box', 'omi.pp.side': 'Beside it (round)',
    'bgm.p.shrine': 'Shrine',
    'bg.shrine': 'Shrine grounds', 'bg.torii': 'Torii tunnel', 'bg.matsuri': 'Summer festival',
    'ob.label': 'Omikuji box design', 'ob.title': 'Sign title', 'ob.text': 'Sign text (new line = new column)', 'ob.sign': 'Sign', 'ob.signOwn': '📷 Use my own picture as the sign', 'ob.signAuto': 'Back to the automatic sign', 'ob.signCrop': 'Crop the sign picture',
    'ob.panel': 'Text on the box', 'ob.panelC': 'Text colour', 'ob.wood': 'Box colour (custom)', 'ob.woodReset': 'Use the swatches above', 'ob.hint': 'Stickers can go on the box too ("Stickers on the machine").', 'ob.sumOwn': 'Custom', 'ob.sumAuto': 'Default',
    'omi.paper': 'Slip paper (all slips)',
    'fx.label': 'Special effects for rare pulls',
    'fx.row2': 'When SR comes out', 'fx.row3': 'When SSR comes out', 'fx.row2.omikuji': 'Middle Blessing / Great Curse', 'fx.row3.omikuji': 'Great Blessing',
    'fx.std': 'Standard', 'fx.sakura': '🌸 Cherry blossoms', 'fx.stars': '🌠 Shooting stars', 'fx.thunder': '⚡ Thunder', 'fx.hanabi': '🎆 Fireworks show', 'fx.gold': '💰 Golden rain',
    'fx.try': '▶ Preview',
    'fx.hint': 'Plays on top of the usual effect. Picking one plays it once in front of the machine.',
    'omi.wrap': 'Slips come',
    'omi.wrap.fold': '📜 Folded paper',
    'omi.wrap.capsule': '🟡 In round capsules',
    'omi.paper.washi': 'Washi',
    'omi.frame.red': 'Vermilion sakura', 'omi.frame.teal': 'Seigaiha waves', 'omi.frame.gold': 'Gold shippo', 'omi.frame.indigo': 'Yagasuri arrows', 'omi.frame.pink': 'Pink sakura',
    'omi.paperOwn': 'My own picture',
    'omi.paperCrop': 'Crop the slip picture',
    'omi.frameColor': 'Frame and text colour',
    'omi.sound': 'Sound (plays when drawn)',
    'omi.soundNone': 'No sound yet',
    'omi.rec': '🎙 Record a voice message',
    'omi.recStop': '■ Stop recording {s}s',
    'omi.music': '🎵 Music / video',
    'omi.soundDel': 'Remove sound',
    'omi.micFail': "Can't use the microphone: allow this page to use it",
    'omi.voiceName': 'Voice fortune',
    'step1.omikuji': 'Write the slips',
    'itemsHint.omikuji': 'Write each slip yourself: fortune (Great Blessing to Great Curse), verse, topics, lucky item, even a photo. More copies = more likely to be drawn.',
    'itemsSum.omikuji': '{n} slips · {q} copies',
    'th.omi.red': 'Vermilion lacquer', 'th.omi.white': 'Plain wood', 'th.omi.yellow': 'Amber varnish', 'th.omi.blue': 'Indigo', 'th.omi.mint': 'Bamboo green', 'th.omi.pink': 'Sakura', 'th.omi.black': 'Black lacquer',
    'omi.title': 'OMIKUJI',
    'omi.priceLine': 'Offering · one draw {p}',
    'omi.signText': 'Make an offering,\nreach into the box,\nstir the slips\nand draw just one.',
    'kind.omikuji': 'Omikuji',
    'kind.omikujiSub': 'Write your own fortune slips, from Great Blessing to Great Curse',
    'omi.fortune': 'Fortune',
    'omi.no': 'Number',
    'omi.noPh': 'No. 1 (blank = in order)',
    'omi.msg': 'Verse / overall luck',
    'omi.msgPh': 'e.g. Spring wind opens every blossom on the hill',
    'omi.lines': 'Topics',
    'omi.addLine': '+ Add a topic',
    'omi.lucky': 'Lucky item',
    'omi.luckyPh': 'e.g. Something red',
    'omi.edit': '✏️ Write slip',
    'omi.editTitle': 'Write a fortune slip',
    'omi.add': '+ Write a slip',
    'omi.photo': 'Photo (optional)',
    'omi.photoAdd': '📷 Add photo',
    'omi.photoDel': 'Remove photo',
    'omi.done': 'Done',
    'omi.preview': 'Preview',
    'omi.labelPh': 'Topic',
    'omi.textPh': 'Text',
    'omi.sample': 'Use the 7 sample slips',
    'omi.sampleAsk': 'Replace the list with the 7 sample slips (Great Blessing to Great Curse)? Your current slips will be replaced.',
    'omi.itemsHint': 'Write each slip yourself: fortune, verse, topics, lucky item. More copies = more likely to be drawn.',
    'omi.sum': '{n} slips · {q} copies',
    's.turn.omikuji': 'Reach into the box',
    's.turnText.omikuji': 'Draw circles over the hole to stir (or press the button)',
    's.turnBtn.omikuji': 'Stir for me',
    's.take.omikuji': 'You drew one!',
    's.takeText.omikuji': 'Tap the slip to pick it up',
    's.takeBtn.omikuji': 'Pick it up',
    's.open.omikuji': 'Unfold it',
    's.openText.omikuji': 'Tap to unfold your fortune',
    's.openBtn.omikuji': 'Unfold',
    'myCaps.omikuji': 'My fortunes',
    'omi.tie': 'Tie it here',
    'omi.tied': 'Tied — the bad luck stays here 🎋',
    'omi.keep': 'Keep it',
    'omi.misfit': 'An omikuji machine holds fortune slips only: press "Write slip" to turn this prize into one',
    'kc.title.omikuji': 'Switch to omikuji?',
    'kc.text.omikuji': '{n} prizes will become fortune slips (fortune from rarity, photos stay on the slip). You can rewrite them later.',
    'kc.ok.omikuji': 'Make slips',
    'kc.done.omikuji': '{n} prizes turned into fortune slips',
    'omi.fortuneOdds': '{f}: {p}',
  },
});
