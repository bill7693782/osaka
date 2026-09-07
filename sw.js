/* 澳洲之旅 · Service Worker v25 —— 快取只在自己的命名空間內操作 */
var CACHE='australia-v25';
var PREFIX='australia-';
var CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-512-maskable.png','./favicon.ico'];

self.addEventListener('install',function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(CORE.map(function(u){ return c.add(u).catch(function(){}); }));
  }));
});

/* 只刪自己命名空間的舊快取，不碰同 origin 的其他專案 */
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k.indexOf(PREFIX)===0; })
      .map(function(k){ if(k!==CACHE) return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET') return;
  var url=new URL(req.url);

  /* 🚨 排除自己 —— 版本檢查要抓 sw.js 讀 CACHE，被快取住就永遠讀到舊版 */
  if(url.pathname.indexOf('sw.js')>=0) return;

  /* Firebase 一律走網路，不快取 */
  if(url.hostname.indexOf('firebasedatabase.app')>=0) return;

  /* 天氣／匯率等跨 origin API：網路優先，失敗改用自己快取內的上次結果 */
  if(url.hostname.indexOf('open-meteo.com')>=0||url.hostname.indexOf('er-api.com')>=0){
    e.respondWith(
      fetch(req).then(function(r){
        var cp=r.clone();
        caches.open(CACHE).then(function(c){ c.put(req,cp); });
        return r;
      }).catch(function(){
        return caches.open(CACHE).then(function(c){ return c.match(req); });
      })
    );
    return;
  }

  /* 只處理同源請求，地圖等外部連結交給瀏覽器 */
  if(url.origin!==location.origin) return;

  /* HTML 本體：網路優先 —— 有網路時一定拿到最新版，沒網路才回快取
     （若用快取優先，使用者會永遠看到上一版） */
  var wantsHTML = req.mode==='navigate' ||
    (req.headers.get('accept')||'').indexOf('text/html')>=0;
  if(wantsHTML){
    e.respondWith(
      fetch(req).then(function(r){
        if(r&&r.status===200){
          var cp=r.clone();
          caches.open(CACHE).then(function(c){ c.put(req,cp); });
        }
        return r;
      }).catch(function(){
        return caches.open(CACHE).then(function(c){
          return c.match(req).then(function(hit){
            return hit || c.match('./index.html').then(function(h2){ return h2 || c.match('./'); });
          });
        });
      })
    );
    return;
  }

  /* 其餘靜態檔（圖示、manifest）：快取優先，背景更新 */
  e.respondWith(
    caches.open(CACHE).then(function(c){ return c.match(req); }).then(function(hit){
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
  if(!e.data) return;
  if(e.data==='skipWaiting') self.skipWaiting();            /* 舊格式相容 */
  if(e.data.type==='SKIP_WAITING') self.skipWaiting();
  if(e.data.type==='VER'&&e.ports&&e.ports[0]){
    try{ e.ports[0].postMessage(CACHE); }catch(err){}
  }
});
