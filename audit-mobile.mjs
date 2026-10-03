import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(fs.existsSync);
if (!chrome) throw new Error('找不到 Chrome 或 Edge');

const url = process.argv[2] || new URL('./index.html', import.meta.url).href;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osaka-mobile-'));
const screenshot = path.join(os.tmpdir(), 'osaka-mobile-v265.png');
const pdfScreenshot = path.join(os.tmpdir(), 'osaka-mobile-pdf-v265.png');
const tocScreenshot = path.join(os.tmpdir(), 'osaka-mobile-pdf-toc-v265.png');
const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function devtoolsEndpoint() {
  const active = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(active)) {
      const [port, socketPath] = fs.readFileSync(active, 'utf8').trim().split(/\r?\n/);
      return `ws://127.0.0.1:${port}${socketPath}`;
    }
    await pause(50);
  }
  throw new Error('Chrome DevTools 啟動逾時');
}

let ws;
const pending = new Map();
let seq = 0;
function send(method, params = {}, sessionId) {
  const id = ++seq;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

try {
  ws = new WebSocket(await devtoolsEndpoint());
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    };
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);

  const sizes = [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
  ];
  const reports = [];
  const pdfLayouts = [];
  let pdfFlow = null;
  let featureFlow = null;
  for (const size of sizes) {
    await send('Emulation.setDeviceMetricsOverride', {
      ...size, screenWidth: size.width, screenHeight: size.height,
      deviceScaleFactor: 2, mobile: true,
    }, sessionId);
    await send('Page.navigate', { url }, sessionId);
    await pause(2200);
    await send('Runtime.evaluate', {
      expression: `(() => {
        const name = document.querySelector('#wname');
        if (name) {
          name.value = '手機測試';
          name.dispatchEvent(new Event('input', {bubbles:true}));
          document.querySelector('#wgo')?.click();
        }
        document.querySelector('[data-k="d1"]')?.click();
      })()`,
    }, sessionId);
    await pause(350);
    const result = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const rect = selector => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {left:+r.left.toFixed(1),right:+r.right.toFixed(1),width:+r.width.toFixed(1),height:+r.height.toFixed(1)};
        };
        const offenders = [...document.querySelectorAll('body *')].filter(el => {
          if (el.closest('nav')) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
        }).slice(0,12).map(el => ({tag:el.tagName,cls:el.className||'',text:(el.textContent||'').trim().slice(0,45),right:+el.getBoundingClientRect().right.toFixed(1)}));
        const keyTargets = ['#vbtn','.clock a.qbtn','#qtoggle','[data-k="d1"]','.hero .quick button','.card .lk.go']
          .map(s => ({selector:s,box:rect(s)}));
        return {
          viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
          documentWidth:document.documentElement.scrollWidth,
          bodyWidth:document.body.scrollWidth,
          horizontalOverflow:document.documentElement.scrollWidth > innerWidth,
          brand:rect('.brand'),clock:rect('.clock'),pdf:rect('.clock a.qbtn'),search:rect('#qtoggle'),
          nav:{client:document.querySelector('nav')?.clientWidth,scroll:document.querySelector('nav')?.scrollWidth},
          offenders,keyTargets,
          page:document.title,dayTitle:document.querySelector('.hero .top .w')?.textContent?.trim()||'',
        };
      })()`,
    }, sessionId);
    reports.push(result.result.value);
    if (size.width === 375) {
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
      fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
      await send('Runtime.evaluate', { expression: `document.querySelector('#ccready')?.click();window.__readyWasOpen=document.querySelector('#readypanel')?.classList.contains('on');document.querySelector('[data-ready="passport"]')?.click();document.querySelector('#cctransit')?.click()` }, sessionId);
      await pause(120);
      const dashboard = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => ({command:!!document.querySelector('.cc'),readyOpened:!!window.__readyWasOpen,readyChecked:!!document.querySelector('[data-ready="passport"]')?.checked,transitOpen:document.querySelector('#transitpanel')?.classList.contains('on'),transitLinks:document.querySelectorAll('#transitpanel a').length,weatherText:document.querySelector('.wxact')?.textContent.trim().slice(0,90)||'',stormDecision:wxDecision('d2',{pop:70,wind:10,lo:8,hi:14}).cls}))()`,
      }, sessionId);
      await send('Runtime.evaluate', { expression: `document.querySelector('#ccwallet')?.click()` }, sessionId);
      await pause(120);
      await send('Runtime.evaluate', { expression: `(() => {const x=document.querySelector('[data-wcode="gk050"]');if(x){x.value='TEST-OFFLINE';x.dispatchEvent(new Event('change',{bubbles:true}))}})()` }, sessionId);
      await send('Runtime.evaluate', { expression: `document.querySelector('[data-k="d1"]')?.click();document.querySelector('[data-k="wallet"]')?.click()` }, sessionId);
      await pause(120);
      const walletFlow = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `({cards:document.querySelectorAll('.walletcard').length,fields:document.querySelectorAll('[data-wcode]').length,persisted:document.querySelector('[data-wcode="gk050"]')?.value||'',navSelected:document.querySelector('[data-k="wallet"]')?.getAttribute('aria-selected')})`,
      }, sessionId);
      featureFlow = { dashboard: dashboard.result.value, wallet: walletFlow.result.value };
      await send('Runtime.evaluate', { expression: `document.querySelector('[data-k="d1"]')?.click()` }, sessionId);
      await pause(120);
      await send('Runtime.evaluate', { expression: `localStorage.removeItem('osaka_pdf_page');document.querySelector('a.pdf-open')?.click()` }, sessionId);
      await pause(900);
      const opened = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const view=document.querySelector('#pdfview'),back=document.querySelector('#pdfback'),pages=document.querySelector('#pdfpages');
          const r=back?.getBoundingClientRect();
          return {visible:!!view&&!view.hidden,bodyLocked:document.body.classList.contains('pdf-open'),
            imageCount:pages?.querySelectorAll('img').length||0,loadedImages:[...pages.querySelectorAll('img')].filter(i=>i.complete&&i.naturalWidth>0).length,
            counter:document.querySelector('#pdfcount')?.textContent||'',backHeight:r?+r.height.toFixed(1):0,
            prevDisabled:!!document.querySelector('#pdfprev')?.disabled,hasDownload:!!view?.querySelector('a[download]'),
            tocButtons:document.querySelectorAll('#pdftocgrid button[data-p]').length,
            tripLabel:document.querySelector('#pdftocgrid button.trip')?.childNodes[0]?.textContent||'',
            storedPage:localStorage.getItem('osaka_pdf_page'),currentTab:typeof cur==='undefined'?'':cur,
            detailText:document.querySelector('#pdfdetail')?.textContent||'',detailHidden:!!document.querySelector('#pdfdetail')?.hidden,
            shareUrl:document.querySelector('#pdfshare')?.getAttribute('data-share-url')||'',
            topClient:view?.querySelector('.pdfbar')?.clientWidth||0,topScroll:view?.querySelector('.pdfbar')?.scrollWidth||0,
            bottomClient:view?.querySelector('.pdfpager')?.clientWidth||0,bottomScroll:view?.querySelector('.pdfpager')?.scrollWidth||0,
            historyState:history.state};
        })()`,
      }, sessionId);
      pdfLayouts.push({ width: size.width, topClient: opened.result.value.topClient, topScroll: opened.result.value.topScroll,
        bottomClient: opened.result.value.bottomClient, bottomScroll: opened.result.value.bottomScroll });
      const pdfShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
      fs.writeFileSync(pdfScreenshot, Buffer.from(pdfShot.data, 'base64'));
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdfcount')?.click()` }, sessionId);
      await pause(120);
      const tocMenu = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {const t=document.querySelector('#pdftoc');return {visible:!t.hidden,buttons:t.querySelectorAll('button[data-p]').length,here:t.querySelector('button.here')?.childNodes[0]?.textContent||'',trip:t.querySelector('button.trip')?.childNodes[0]?.textContent||'',historyState:history.state}})()`,
      }, sessionId);
      const tocShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
      fs.writeFileSync(tocScreenshot, Buffer.from(tocShot.data, 'base64'));
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdftocgrid button[data-p="5"]')?.click()` }, sessionId);
      await pause(350);
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdfdetail')?.click()` }, sessionId);
      await pause(350);
      const bridged = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `({readerHidden:document.querySelector('#pdfview')?.hidden,currentTab:typeof cur==='undefined'?'':cur,dayTitle:document.querySelector('.hero .top .w')?.textContent?.trim()||''})`,
      }, sessionId);
      await send('Runtime.evaluate', { expression: `document.querySelector('a.pdf-open')?.click()` }, sessionId);
      await pause(350);
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdfcount')?.click()` }, sessionId);
      await pause(80);
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdftocgrid button[data-p="0"]')?.click()` }, sessionId);
      await pause(350);
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdfnext')?.click()` }, sessionId);
      await pause(550);
      const navigated = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {const p=document.querySelector('#pdfpages');return {counter:document.querySelector('#pdfcount')?.textContent||'',scrollLeft:+p.scrollLeft.toFixed(1),pageWidth:p.clientWidth}})()`,
      }, sessionId);
      await send('Runtime.evaluate', { expression: `(() => {const i=document.querySelectorAll('.pdfpage img')[1],r=i.getBoundingClientRect();i.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}))})()` }, sessionId);
      await pause(100);
      const zoomed = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {const p=document.querySelector('#pdfpages'),z=p.querySelector('.pdfpage.zoom'),i=z?.querySelector('img');return {viewerZoomed:p.classList.contains('zoomed'),pageZoomed:!!z,button:document.querySelector('#pdfzoom')?.textContent||'',imageWidth:i?+i.getBoundingClientRect().width.toFixed(1):0,viewerWidth:p.clientWidth}})()`,
      }, sessionId);
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdfzoom')?.click()` }, sessionId);
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdfback')?.click()` }, sessionId);
      await pause(350);
      const closed = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `({hidden:document.querySelector('#pdfview')?.hidden,dayTitle:document.querySelector('.hero .top .w')?.textContent?.trim()||''})`,
      }, sessionId);
      pdfFlow = { opened: opened.result.value, tocMenu: tocMenu.result.value, bridged: bridged.result.value, navigated: navigated.result.value, zoomed: zoomed.result.value, closed: closed.result.value };
    }
    if (size.width !== 375) {
      await send('Runtime.evaluate', { expression: `document.querySelector('a.pdf-open')?.click()` }, sessionId);
      await pause(350);
      const layout = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {const v=document.querySelector('#pdfview'),t=v.querySelector('.pdfbar'),b=v.querySelector('.pdfpager');return {width:innerWidth,topClient:t.clientWidth,topScroll:t.scrollWidth,bottomClient:b.clientWidth,bottomScroll:b.scrollWidth,counter:document.querySelector('#pdfcount').textContent,storedPage:localStorage.getItem('osaka_pdf_page'),currentTab:typeof cur==='undefined'?'':cur}})()`,
      }, sessionId);
      pdfLayouts.push(layout.result.value);
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdfback')?.click()` }, sessionId);
      await pause(200);
    }
  }
  pdfLayouts.sort((a,b) => a.width-b.width);
  console.log(JSON.stringify({ url, screenshot, pdfScreenshot, tocScreenshot, pdfLayouts, pdfFlow, featureFlow, reports }, null, 2));
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await pause(250);
  const tempRoot = fs.realpathSync(os.tmpdir()) + path.sep;
  const target = fs.realpathSync(profile);
  if (target.startsWith(tempRoot) && path.basename(target).startsWith('osaka-mobile-')) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  }
}
