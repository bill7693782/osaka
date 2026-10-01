import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(fs.existsSync);
if (!chrome) throw new Error('找不到 Chrome 或 Edge');

const source = new URL('./kansai-guide-v255.html', import.meta.url).href;
const output = new URL('./guide-pages/', import.meta.url);
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osaka-guide-pages-'));
const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function endpoint() {
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
  ws = new WebSocket(await endpoint());
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
  const { targetId } = await send('Target.createTarget', { url: source });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 820, height: 1200, screenWidth: 820, screenHeight: 1200,
    deviceScaleFactor: 2, mobile: false,
  }, sessionId);
  await send('Page.navigate', { url: source }, sessionId);
  await pause(1200);
  const layout = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const style=document.createElement('style');
      style.textContent='body{padding:0!important}.page{margin:0!important;box-shadow:none!important}';
      document.head.appendChild(style);
      return [...document.querySelectorAll('.page')].map((el,i) => {
        const r=el.getBoundingClientRect();
        return {i,x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height};
      });
    })()`,
  }, sessionId);
  const pages = layout.result.value;
  for (const page of pages) {
    const shot = await send('Page.captureScreenshot', {
      format: 'webp', quality: 92, fromSurface: true, captureBeyondViewport: true,
      clip: { x: page.x, y: page.y, width: page.width, height: page.height, scale: 1 },
    }, sessionId);
    const name = `page-${String(page.i + 1).padStart(2, '0')}.webp`;
    fs.writeFileSync(new URL(name, output), Buffer.from(shot.data, 'base64'));
  }
  const files = fs.readdirSync(output).filter(name => name.endsWith('.webp')).sort();
  const bytes = files.reduce((sum, name) => sum + fs.statSync(new URL(name, output)).size, 0);
  console.log(JSON.stringify({ pages: files.length, files, bytes }, null, 2));
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await pause(250);
  const tempRoot = fs.realpathSync(os.tmpdir()) + path.sep;
  const target = fs.realpathSync(profile);
  if (target.startsWith(tempRoot) && path.basename(target).startsWith('osaka-guide-pages-')) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  }
}
