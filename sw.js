/* 關西五日 · Service Worker v4 */
var CACHE='kansai5-v62';
var CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];

self.addEventListener('install',function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(CORE.map(function(u){
      return c.add(u).catch(function(){}); // 單一檔案失敗不擋安裝
    }));
  }));
});

self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.map(function(k){ if(k!==CACHE) return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET') return;
  var url=new URL(req.url);

  // 天氣 API：網路優先，失敗就用快取（離線時顯示上次結果）
  if(url.hostname.indexOf('open-meteo.com')>=0||url.hostname.indexOf('er-api.com')>=0){
    e.respondWith(
      fetch(req).then(function(r){
        var cp=r.clone();
        caches.open(CACHE).then(function(c){ c.put(req,cp); });
        return r;
      }).catch(function(){ return caches.match(req); })
    );
    return;
  }

  // 只處理同源請求，地圖等外部連結交給瀏覽器
  if(url.origin!==location.origin) return;

  // App 本體：快取優先，背景更新
  e.respondWith(
    caches.match(req).then(function(hit){
      var net=fetch(req).then(function(r){
        if(r&&r.status===200){
          var cp=r.clone();
          caches.open(CACHE).then(function(c){ c.put(req,cp); });
        }
        return r;
      }).catch(function(){ return hit; });
      return hit||net;
    })
  );
});

self.addEventListener('message',function(e){
  if(e.data==='skipWaiting') self.skipWaiting();
});
