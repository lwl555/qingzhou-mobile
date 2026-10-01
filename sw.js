/* 轻舟 Service Worker：只干两件事——接收推送、点了通知打开页面。
   不做离线缓存（网页版要连云端/电脑，缓存旧页面反而容易出错）。 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

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
