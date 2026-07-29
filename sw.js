/* ==========================================================================
 * Service Worker
 *
 * 只缓存程序文件，绝不碰用户数据（数据在 IndexedDB 里，SW 看不到也不该看）。
 * 作用域自动限定在 /bingli/ —— 碰不到同一域名下的其他应用。
 *
 * 策略上和只有单文件的应用不同：这里有 4 个 JS 文件，
 * 如果走 cache-first 而某次忘了改 VERSION，就会出现
 * 「新的 app.js 配旧的 store.js」这种半更新状态 —— 对存数据的应用来说
 * 这是最坏的失败模式。所以程序文件一律 network-first，图标才用 cache-first。
 * ========================================================================== */
const VERSION = "bl-v11";

const ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./data.js", "./core.js", "./store.js", "./ai.js", "./vision.js", "./print.js", "./app.js",
  "./icon-192.png", "./icon-512.png", "./icon-maskable.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // 某个文件拿不到也不该卡住安装
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  /* 跨域和非 GET 一律放行，不拦不缓存。
     这一段是各家大模型 API 调用不被打断的原因，改动前想清楚。 */
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  const isProgram = req.mode === "navigate" ||
                    /\.(html|js|json)$/.test(url.pathname) ||
                    url.pathname.endsWith("/");

  if (isProgram) {
    /* network-first：先拿新的，拿不到再用缓存，导航失败兜底到首页。
     *
     * 必须带 cache:"no-store"。不带的话，SW 内部的 fetch 会先命中浏览器
     * 自己的 HTTP 缓存 —— GitHub Pages 发的是 Cache-Control: max-age=600，
     * 于是部署后十分钟内「network-first」拿回来的仍然是旧文件，
     * 正好制造出这个策略本来要避免的「新 app.js 配旧 store.js」。
     * 这里已经过滤成同源 GET，用 url 重新发请求是安全的。 */
    e.respondWith(
      fetch(req.url, { cache: "no-store", credentials: "same-origin" })
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) =>
          hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined)))
    );
    return;
  }

  /* 图标之类不会变的：cache-first */
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
