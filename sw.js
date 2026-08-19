// ==========================================
// 📦 sw.js - StockPulse PWA Service Worker v2.0
// ==========================================

const CACHE_NAME = 'stockpulse-v2.0.0';
const STATIC_CACHE = 'static-v2.0.0';
const API_CACHE = 'api-v2.0.0';
const DYNAMIC_CACHE = 'dynamic-v2.0.0';

const urlsToCache = [
  '/',
  '/index.html',
  '/adv-charts.html',
  '/style.css',
  '/manifest.json',
  '/favicon.ico',
  
  // JS files
  '/js/main.js',
  '/js/config.js',
  '/js/cache.js',
  '/js/firebase.js',
  '/js/supabase.js',
  '/js/core.js',
  '/js/indicators.js',
  '/js/app-charts.js',
  '/js/app-dashboard.js',
  '/js/app-features.js',
  '/js/data-service.js',
  '/js/global-fix.js',
  '/js/trade-buy.js',
  '/js/trade-sell.js',
  '/js/trade-history.js',
  '/js/trade-analysis.js',
  '/js/trade-suggestion.js',
  '/js/trade-stock-table.js',
  '/js/marketwatch.js',
  '/js/deep-analysis.js',
  '/js/smart-signals.js',
  '/js/record-date.js',
  '/js/dividend.js',
  '/js/portfolio-manager.js',
  '/js/sync-metadata.js',
  '/js/ui-helpers.js',
  '/js/ui-modals.js',
  '/js/ui-charts.js',
  '/js/dash-performance.js',
  '/js/dash-charts.js',
  '/js/dash-utils.js',
  '/js/dash-signals.js',
  '/js/adv-charts-extras.js',
  '/js/notification.js',
  
  // Icons
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png'
];

// ==========================================
// 🔧 INSTALL EVENT
// ==========================================

self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets...');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('[SW] Cache addAll failed:', err);
      })
  );
  self.skipWaiting();
});

// ==========================================
// 🔄 ACTIVATE EVENT
// ==========================================

self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => {
          return key !== STATIC_CACHE && 
                 key !== API_CACHE && 
                 key !== DYNAMIC_CACHE &&
                 key !== CACHE_NAME;
        }).map(key => {
          console.log('[SW] Removing old cache:', key);
          return caches.delete(key);
        })
      );
    })
  );
  return self.clients.claim();
});

// ==========================================
// 🌐 FETCH EVENT
// ==========================================

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const request = event.request;

  // API requests - network first, cache fallback
  if (url.pathname.includes('/api/') || 
      url.hostname.includes('dse-scraper') ||
      url.hostname.includes('supabase') ||
      url.hostname.includes('bd-stock-api')) {
    
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(API_CACHE).then(cache => {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then(cached => {
            if (cached) return cached;
            return new Response(JSON.stringify({ 
              error: 'Offline', 
              message: 'You are offline. Please check your connection.' 
            }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // Static resources - cache first
  if (urlsToCache.some(path => url.pathname === path) ||
      url.pathname.match(/\.(css|js|png|jpg|svg|woff2?|json|ico)$/)) {
    
    event.respondWith(
      caches.match(request)
        .then(response => {
          if (response) return response;
          return fetch(request).then(fetchRes => {
            if (fetchRes && fetchRes.status === 200) {
              const clone = fetchRes.clone();
              caches.open(DYNAMIC_CACHE).then(cache => {
                cache.put(request, clone);
              });
            }
            return fetchRes;
          });
        })
        .catch(() => {
          return caches.match('/index.html');
        })
    );
    return;
  }

  // HTML pages - network first, cache fallback
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then(cache => {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match('/index.html');
        })
    );
    return;
  }

  // Everything else - network only
  event.respondWith(
    fetch(request).catch(() => {
      return caches.match('/index.html');
    })
  );
});

// ==========================================
// 📡 BACKGROUND SYNC
// ==========================================

self.addEventListener('sync', event => {
  if (event.tag === 'sync-portfolio') {
    event.waitUntil(syncPortfolioData());
  }
});

async function syncPortfolioData() {
  try {
    console.log('[SW] Starting background sync...');
    const cache = await caches.open(API_CACHE);
    const requests = await cache.keys();
    let synced = 0;
    for (const req of requests) {
      if (req.url.includes('/api/') && req.method === 'POST') {
        try {
          const response = await fetch(req);
          if (response.ok) {
            await cache.delete(req);
            synced++;
          }
        } catch (e) {
          console.warn('[SW] Sync failed for:', req.url);
        }
      }
    }
    console.log(`[SW] Background sync completed: ${synced} items synced`);
  } catch (err) {
    console.error('[SW] Background sync failed:', err);
  }
}

// ==========================================
// 📢 PUSH NOTIFICATION
// ==========================================

self.addEventListener('push', event => {
  if (!event.data) {
    console.log('[SW] Push received but no data');
    return;
  }

  try {
    const data = event.data.json();
    const title = data.title || '📊 StockPulse Update';
    const options = {
      body: data.body || 'Your portfolio has been updated.',
      icon: data.icon || '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      vibrate: [200, 100, 200],
      data: {
        url: data.url || '/',
        date: data.date || Date.now()
      },
      actions: [
        { action: 'open', title: '📊 Open App' },
        { action: 'dismiss', title: '✖ Dismiss' }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (e) {
    console.error('[SW] Push notification error:', e);
  }
});

// ==========================================
// 🔔 NOTIFICATION CLICK
// ==========================================

self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// ==========================================
// 📶 NETWORK STATUS CHANGE
// ==========================================

self.addEventListener('online', () => {
  console.log('[SW] Online - checking for updates...');
  self.registration.sync.register('sync-portfolio');
});

self.addEventListener('offline', () => {
  console.log('[SW] Offline - serving from cache');
});

// ==========================================
// 🔄 MESSAGE HANDLER
// ==========================================

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => {
        return Promise.all(
          keys.map(key => {
            console.log('[SW] Clearing cache:', key);
            return caches.delete(key);
          })
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('✅ Service Worker v2.0 loaded successfully');