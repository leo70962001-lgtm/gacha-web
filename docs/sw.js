// 可以安裝的網路 App：離線也能開（使用者 2026-10-26：「追加成可以下載的網路app」）
//   自己的檔案：先拿網路上最新的，斷線就用快取（發佈新版不用等快取過期）
//   版本固定的外部檔案（three.js、字型檔、MediaPipe）：有快取就用；字型的 CSS：先用快取、背景更新
//   Supabase、YouTube 那些不碰（一定要連線）
//   VERSION、ASSETS 由 tools/build_site.py 換掉（docs/ 的檔案清單＋內容雜湊）；本機預覽是空的，只做執行時快取
const VERSION = '37d2fe3befa8';
const ASSETS = ["./", "albumedit.js", "app.js", "assets/ao_body.jpg", "assets/ao_card_body.jpg", "assets/ao_card_knob.jpg", "assets/ao_card_lid.jpg", "assets/ao_handle.jpg", "assets/ao_lid.jpg", "assets/card.b64.txt", "assets/gacha.b64.txt", "assets/icons/apple-touch-icon.png", "assets/icons/favicon-32.png", "assets/icons/icon-192.png", "assets/icons/icon-512.png", "assets/icons/maskable-512.png", "assets/stickers/s01.webp", "assets/stickers/s02.webp", "assets/stickers/s03.webp", "assets/stickers/s04.webp", "assets/stickers/s05.webp", "assets/stickers/s06.webp", "assets/stickers/s07.webp", "assets/stickers/s08.webp", "assets/stickers/s09.webp", "assets/stickers/s10.webp", "assets/stickers/s11.webp", "assets/stickers/s12.webp", "assets/tex/back_candy.webp", "assets/tex/back_cats.webp", "assets/tex/back_dogs.webp", "assets/tex/back_galaxy.webp", "assets/tex/back_night.webp", "assets/tex/back_sakura.webp", "assets/tex/back_shop.webp", "assets/tex/back_stars.webp", "assets/tex/badge.webp", "assets/tex/banner.webp", "assets/tex/bg_cats.webp", "assets/tex/bg_dogs.webp", "assets/tex/bg_galaxy.webp", "assets/tex/bg_night.webp", "assets/tex/bg_sakura.webp", "assets/tex/bg_shop.webp", "assets/tex/bg_stars.webp", "assets/tex/binder.webp", "assets/tex/card.webp", "assets/tex/cardback.webp", "assets/tex/coin.webp", "assets/tex/cside.webp", "assets/tex/foil_pack.webp", "assets/tex/shelf_row.webp", "assets/tex/side.webp", "assets/tex/strip.webp", "assets/tex/wall.webp", "bgm.js", "binder.js", "cardkit.js", "cloud.js", "codec.js", "copy.js", "decor.js", "fx.js", "holo.js", "i18n.js", "machine.js", "manifest.webmanifest", "media.js", "nowplaying.js", "peel.js", "seg.js", "sfx.js", "sticker.js", "stickerbook.js", "trade.js", "index.html"];
const CACHE = 'clatter-' + VERSION;
const RUNTIME = 'clatter-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('clatter-') && k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return; // 音樂、影片的分段請求（206）→ 讓瀏覽器自己拿（快取存不了 206）
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.includes('__snap')) return;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? (await caches.match('./')) || caches.match('index.html') : Response.error())),
    );
    return;
  }
  if (/^(cdn\.jsdelivr\.net|fonts\.gstatic\.com|storage\.googleapis\.com)$/.test(url.hostname)) {
    e.respondWith(
      caches.open(RUNTIME).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(
      caches.open(RUNTIME).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') c.put(req, res.clone()); // <link> 載的 CSS 是 opaque
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
});
