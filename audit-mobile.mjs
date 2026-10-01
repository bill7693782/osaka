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
const screenshot = path.join(os.tmpdir(), 'osaka-mobile-v257.png');
const pdfScreenshot = path.join(os.tmpdir(), 'osaka-mobile-pdf-v257.png');
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
  let pdfFlow = null;
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
      await send('Runtime.evaluate', { expression: `document.querySelector('a.pdf-open')?.click()` }, sessionId);
      await pause(900);
      const opened = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const view=document.querySelector('#pdfview'),back=document.querySelector('#pdfback'),frame=document.querySelector('#pdfframe');
          const r=back?.getBoundingClientRect();
          return {visible:!!view&&!view.hidden,bodyLocked:document.body.classList.contains('pdf-open'),
            frameSrc:frame?.getAttribute('src')||'',backHeight:r?+r.height.toFixed(1):0,
            hasExternal:!!view?.querySelector('a[target="_blank"]'),hasDownload:!!view?.querySelector('a[download]'),
            historyState:history.state};
        })()`,
      }, sessionId);
      const pdfShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
      fs.writeFileSync(pdfScreenshot, Buffer.from(pdfShot.data, 'base64'));
      await send('Runtime.evaluate', { expression: `document.querySelector('#pdfback')?.click()` }, sessionId);
      await pause(350);
      const closed = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `({hidden:document.querySelector('#pdfview')?.hidden,dayTitle:document.querySelector('.hero .top .w')?.textContent?.trim()||''})`,
      }, sessionId);
      pdfFlow = { opened: opened.result.value, closed: closed.result.value };
    }
  }
  console.log(JSON.stringify({ url, screenshot, pdfScreenshot, pdfFlow, reports }, null, 2));
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
