// 半月 PWA service worker —— 纯手写，无第三方依赖。
// 策略：
//   1) 静态资源（带 hash 的 js/css/字体/图片）—— cache-first，命中即返，离线可用。
//   2) 页面导航（HTML）—— network-first，失败则回退到已缓存的壳，断网也能看已访问过的文章。
//   3) /api 与云端请求 —— 一律走网络，绝不缓存（含登录态/私密数据）。
const VERSION = 'banyue-v1'
const SHELL = `${VERSION}-shell`
const ASSET = `${VERSION}-asset`

// 安装时把应用壳塞进缓存，离线首屏不白屏
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      cache.addAll(['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']).catch(() => undefined),
    ),
  )
  self.skipWaiting()
})

// 旧版本缓存清理
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // 永远不缓存接口和云同步请求
  if (url.pathname.startsWith('/api') || url.origin !== self.location.origin) return

  // 导航请求：先网络，失败用壳兜底
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((cache) => cache.put(req, copy)).catch(() => undefined)
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html'))),
    )
    return
  }

  // 静态资源：缓存优先，未命中再走网络并回填
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit
      return fetch(req).then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone()
          caches.open(ASSET).then((cache) => cache.put(req, copy)).catch(() => undefined)
        }
        return res
      })
    }),
  )
})
