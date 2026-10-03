/* 轻舟 Service Worker：① 推送接收 ② 应用外壳离线缓存（仅静态资源，不缓存接口/云端响应） */
const SHELL = 'qz-shell-v1';
const SHELL_ASSETS = [
  './', './index.html', './app.js', './style.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/onboard-cloud.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 只缓存同源静态资源；API / 远程中继 / 跨域一律走网络，避免把旧页面或接口响应存下来
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/api/') || url.pathname.includes('/api/')) return;
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const cp = res.clone();
          caches.open(SHELL).then(c => c.put(req, cp)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {
    data = { title: '轻舟', body: (e.data && e.data.text()) || '' };
  }
  const title = data.title || '轻舟';
  const opts = {
    body: data.body || '',
    icon: 'icons/onboard-cloud.png',
    badge: 'icons/onboard-cloud.png',
    tag: data.tag || 'qingzhou',
    renotify: true,
    data: { url: data.url || './index.html' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const c of cs) {
        if ('focus' in c) { try { c.navigate(url); } catch (_) {} return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
