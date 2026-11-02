// Batch: the BOMB MAIDS star photo cards → one card machine (run in the page on leo70962001-lgtm.github.io/gacha-web,
// via the debug hook __gacha.addStudioCard). The art comes from the game on the same origin (/bomb-maids/img/*.webp):
// each cut-out picture is set on a soft background in her colour, cover-fitted to the star card's photo window.
// Usage (javascript_tool): paste this file, then `await __maidCards.run()`.
(() => {
  const MAIDS = [
    { k: 'berry', name: 'ベリー', en: 'BERRY', tag: 'STRIKER', c: ['#ffd6e0', '#ff8fae', '#f2557a'], sr: 'ex-berry-overjoy' },
    { k: 'honey', name: 'ハニー', en: 'HONEY', tag: 'SUPPORT', c: ['#fff1c2', '#ffd36a', '#f2a23a'], sr: 'ex-honey-gift' },
    { k: 'yukino', name: '雪乃', en: 'YUKINO', tag: 'TACTICIAN', c: ['#dff2ff', '#9fd2ff', '#4f8fe8'], sr: 'ex-yukino-confident' },
    { k: 'yoru', name: '夜子', en: 'YORU', tag: 'BLADE', c: ['#ece2ff', '#b9a2ee', '#6e58b8'], sr: 'ex-yoru-serve' },
  ];
  // rarity 3 SSR (stand, gold foil) / 2 SR (her signature expression, silver) / 1 R (joy) / 0 N (fun); stock per card
  const ROWS = (m) => [
    { pic: 'stand-' + m.k, rar: 3, qty: 1, frame: 'gold', sub: 'SUPER STAR', fin: 'rainbow' },
    { pic: m.sr, rar: 2, qty: 3, frame: 'silver', sub: 'SPECIAL', fin: 'holo' },
    { pic: 'emo-' + m.k + '-joy', rar: 1, qty: 6, frame: 'white', sub: 'SMILE', fin: 'texture' },
    { pic: 'emo-' + m.k + '-fun', rar: 0, qty: 10, frame: 'white', sub: 'PLAYFUL', fin: 'none' },
  ];
  const W = 558, H = 828; // the star card's photo window (590×860 minus 16 px all round)
  const load = (src) => new Promise((ok, bad) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = bad; im.src = src; });
  async function art(m, pic) {
    const im = await load('/bomb-maids/img/' + pic + '.webp');
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    // background: her colour, a soft radial glow behind her, scattered dots and little stars
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, m.c[0]); bg.addColorStop(1, m.c[1]);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, W * 0.75);
    glow.addColorStop(0, 'rgba(255,255,255,0.75)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    let seed = m.k.length * 97 + pic.length;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 46; i++) {
      const x = rnd() * W, y = rnd() * H, r = 3 + rnd() * 9;
      g.fillStyle = i % 3 ? 'rgba(255,255,255,0.55)' : m.c[2] + '55';
      if (i % 5 === 0) { // a four-point sparkle
        g.beginPath();
        for (let j = 0; j < 8; j++) { const a = (j * Math.PI) / 4, rr = j % 2 ? r * 0.35 : r * 1.6; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        g.fill();
      } else { g.beginPath(); g.arc(x, y, r * 0.6, 0, Math.PI * 2); g.fill(); }
    }
    // the maid: height fills ~93% of the window, feet at the bottom, centred
    const s = (H * 0.93) / im.height;
    const w = im.width * s, h = im.height * s;
    g.drawImage(im, (W - w) / 2, H - h + 10, w, h);
    return c;
  }
  async function run({ dry = false } = {}) {
    const st = await import(new URL('cardstudio.js', document.baseURI).href);
    const G = window.__gacha;
    if (!G || !G.addStudioCard) throw new Error('page has no __gacha.addStudioCard yet (old cache?)');
    const lang = document.documentElement.lang || 'ja';
    const t = (k) => k;
    let n = 0, first = true;
    const out = [];
    for (const m of MAIDS) for (const row of ROWS(m)) {
      n++;
      const c = await art(m, row.pic);
      const url = c.toDataURL('image/webp', 0.9);
      const d = Object.assign(st.defaultDesign(t), {
        style: 'star', name: m.name, rarity: row.rar, art: { b64: url.split(',')[1], mime: 'image/webp' },
        sframe: row.frame, sname: m.en + ' · ' + row.sub, sgroup: 'BOMB MAIDS', year: '2026', stag: m.tag,
        serial: String(n).padStart(3, '0') + '/016', sink: row.rar >= 2 ? 'gold' : 'white', sig: null, fin3d: row.fin,
      });
      const artImg = await st.artOf(d);
      const card = st.drawDesignCard(d, artImg, st.CARD_OUT[0], lang);
      out.push({ name: d.name, rar: row.rar, pic: row.pic, card: card.toDataURL('image/webp', 0.8) });
      if (!dry) {
        await G.addStudioCard({ design: d, card, music: { k: 'none' }, target: first ? '__new' : G.shop.cur, qty: row.qty, edit: null });
        first = false;
      }
    }
    if (!dry) {
      const dr = G.draft;
      dr.name = 'BOMB MAIDS メイドカード';
    }
    return out;
  }
  window.__maidCards = { run, art, MAIDS };
})();
