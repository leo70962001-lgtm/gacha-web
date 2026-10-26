// 可以安裝的網路 App：離線也能開（使用者 2026-10-26：「追加成可以下載的網路app」）
//   自己的檔案：先拿網路上最新的，斷線就用快取（發佈新版不用等快取過期）
//   版本固定的外部檔案（three.js、字型檔、MediaPipe）：有快取就用；字型的 CSS：先用快取、背景更新
//   Supabase、YouTube 那些不碰（一定要連線）
//   VERSION、ASSETS 由 tools/build_site.py 換掉（docs/ 的檔案清單＋內容雜湊）；本機預覽是空的，只做執行時快取
const VERSION = 'dev';
const ASSETS = [];
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
