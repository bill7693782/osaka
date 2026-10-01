import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const begin = app.indexOf('var MAP=');
const end = app.indexOf('var BOOK=', begin);
if (begin < 0 || end < 0) throw new Error('找不到行程資料 D');
const data = {};
vm.createContext(data);
vm.runInContext(app.slice(begin, end), data);
const days = data.D;

const version = '255';
const htmlPath = path.join(root, `kansai-guide-v${version}.html`);
const pdfPath = path.join(root, `kansai-guide-v${version}.pdf`);
const appUrl = 'https://bill7693782.github.io/osaka/';

// 速覽版選出決策點、重要交通與主要活動；逐站說明保留在 App。
const picks = {
  d0: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  d1: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  d2: [0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 14, 16, 18, 20, 21, 22, 24, 25, 26, 27],
  d3: [0, 1, 2, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  d4: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  d5: [0, 2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23],
};
const meta = {
  d0: { place: 'TAIPEI / DEPARTURE', route: '台北車站 → 桃園機場 → 關西', color: '#8fa3b8', tip: '護照、JR Pass、VJW 截圖與五人行李，出門前再確認一次。' },
  d1: { place: 'KYOTO', route: '關西機場 → 伏見稻荷 → 飯店補眠 → 四条', color: '#c98925', tip: '紅眼班機後不跑山區；14:30 回飯店睡滿 2.5 小時。' },
  d2: { place: 'INE / AMANOHASHIDATE', route: '京都 → 伊根舟屋 → 傘松公園 → 天橋立 → 京都', color: '#287f9b', tip: '福知山轉乘只有 8 分鐘；下午只留傘松，取消飛龍觀趕場。' },
  d3: { place: 'NARA / OSAKA', route: '京都 → 奈良公園 → 難波 → 鶴橋', color: '#a76643', tip: '藥師寺改列下次；下午提早進大阪休息，17:20 再出門。' },
  d4: { place: 'MINOH / OSAKA', route: '難波 → 箕面 → 梅田 → 大阪城 → 道頓堀', color: '#7866ad', tip: '通天閣改列下次；17:35 抵達はり重門口。' },
  d5: { place: 'OSAKA / HOMECOMING', route: '木津市場 → 海遊館 → 最後購物 → 關西機場', color: '#4b8b5a', tip: '15:50 停止購物；18:20 搭はるか，退稅查驗在託運前。' },
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const clean = value => String(value ?? '').replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').trim();
const short = (value, length = 25) => {
  const text = clean(value).replace(/<[^>]+>/g, '');
  return text.length > length ? text.slice(0, length - 1) + '…' : text;
};

function row(slot) {
  const label = esc(clean(slot.t));
  const tag = slot.g?.length ? `<span class="tag">${esc(short(slot.g[0], 25))}</span>` : '';
  return `<div class="row${slot.dead ? ' hard' : ''}"><time>${esc(slot.a)}</time><span class="rowtitle">${label}</span>${tag}</div>`;
}

function dayPage(key, pageNum) {
  const day = days[key];
  const m = meta[key];
  const slots = picks[key].map(i => {
    if (!day.s[i]) throw new Error(`${key} 缺少第 ${i} 站`);
    return day.s[i];
  });
  const lines = slots.map(row).join('');
  const dayName = key === 'd0' ? '出發前夜' : `DAY ${key.slice(1).padStart(2, '0')}`;
  return `<section class="page day" style="--accent:${m.color}">
    <div class="topline"><span>${m.place}</span><span>KANSAI · 2026</span></div>
    <header class="dayhead"><div class="daynum">${key === 'd0' ? '00' : key.slice(1).padStart(2, '0')}</div>
      <div><p class="eyebrow">${dayName} · ${esc(day.date)}</p><h2>${esc(day.title)}</h2><p class="route">${esc(m.route)}</p></div></header>
    <div class="crux"><span>今日關鍵</span><b>${esc(day.crux.t)}　${esc(day.crux.w)}</b></div>
    <div class="timeline"><div class="columns"><span>時間</span><span>行程</span><span>提示</span></div>${lines}</div>
    <div class="tip"><span>KEEP IN MIND</span><p>${esc(m.tip)}</p></div>
    <footer><span>紅色時間＝必須守住的節點 · 詳情與導航請看 App</span><span>${String(pageNum).padStart(2, '0')} / 08</span></footer>
  </section>`;
}

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>關西五日｜旅行速覽</title>
<style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#ddd8cc;color:#1d2a31;font-family:"Microsoft JhengHei","Noto Sans TC","Hiragino Sans",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;position:relative;overflow:hidden;background:#f8f5ee;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.cover{padding:19mm 18mm;background:#16232b;color:#f6eee1}
.cover:before{content:"";position:absolute;width:185mm;height:185mm;border:1px solid rgba(225,171,88,.29);border-radius:50%;right:-67mm;top:20mm;box-shadow:0 0 0 15mm rgba(225,171,88,.045),0 0 0 39mm rgba(225,171,88,.035)}
.cover:after{content:"";position:absolute;width:92mm;height:92mm;border:1px solid rgba(225,171,88,.27);border-radius:50%;right:22mm;bottom:-40mm}
.cover .kicker{font-size:9pt;letter-spacing:.35em;color:#d4a968;font-weight:700}
.cover .rule{height:1px;background:#a9804d;margin:19mm 0 19mm;width:45mm}
.cover h1{font-family:"Microsoft JhengHei","Noto Serif TC",serif;font-size:55pt;line-height:1.12;letter-spacing:.12em;margin:0 0 7mm;font-weight:600}
.cover .sub{font-size:17pt;letter-spacing:.1em;color:#eacb9b;margin:0}
.cover .dates{margin-top:15mm;font-size:11pt;letter-spacing:.16em}
.cover .journey{position:absolute;left:18mm;right:18mm;bottom:26mm;border-top:1px solid rgba(255,255,255,.26);padding-top:8mm;font-size:12pt;line-height:2;color:#e6dfd1}
.cover .journey small{display:block;font-size:8pt;color:#d4a968;letter-spacing:.2em;margin-top:4mm}
.cover .edition{position:absolute;right:18mm;top:19mm;font-size:8pt;letter-spacing:.2em;color:#aab6b9}
.quick{padding:14mm 17mm}
.topline{display:flex;justify-content:space-between;align-items:center;height:11mm;border-top:2mm solid var(--accent,#b8823a);font-size:7.5pt;font-weight:700;letter-spacing:.2em;color:var(--accent,#93662f);padding-top:2mm}
.quick h2{font-size:28pt;line-height:1.25;margin:10mm 0 3mm;letter-spacing:.04em}
.quick .intro{font-size:10.5pt;color:#647078;margin:0 0 10mm}
.quick .grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.quick .card{min-height:37mm;padding:6mm;border:1px solid #d5d2c9;background:#fffdf8}
.quick .card span{display:block;font-size:8pt;letter-spacing:.12em;color:#997044;font-weight:800;margin-bottom:4mm}
.quick .card b{font-size:14pt;line-height:1.4}.quick .card p{font-size:9.5pt;color:#52616b;line-height:1.65;margin:2mm 0 0}
.quick h3{font-size:12pt;letter-spacing:.08em;margin:13mm 0 4mm;border-bottom:1px solid #b9b4a7;padding-bottom:2mm}
.quick .decision{display:grid;grid-template-columns:24mm 1fr;gap:3mm;padding:3mm 0;border-bottom:1px solid #ded9cf;font-size:10.5pt}
.quick .decision time{color:#a44b42;font-weight:800}.quick .decision b{font-weight:700}
.quick .appbox{position:absolute;left:17mm;right:17mm;bottom:25mm;background:#1c3038;color:#f4ecdf;padding:7mm 8mm}
.quick .appbox b{font-size:12pt}.quick .appbox p{font-size:9pt;line-height:1.6;margin:2mm 0;color:#e2dfd5}.quick .appbox a{color:#e9b972;font-size:10pt;text-decoration:none}
.day{padding:0 16mm}
.dayhead{display:grid;grid-template-columns:30mm 1fr;align-items:center;min-height:44mm;border-bottom:1px solid #d8d4ca;gap:4mm}
.daynum{font:700 48pt/1 Georgia,serif;color:var(--accent)}
.eyebrow{margin:0 0 2mm;color:var(--accent);font-size:8pt;font-weight:800;letter-spacing:.18em}
.dayhead h2{font-size:18pt;line-height:1.3;margin:0 0 2mm;letter-spacing:.01em}.route{margin:0;color:#68767a;font-size:8.5pt}
.crux{display:flex;align-items:center;gap:4mm;background:var(--accent);color:#fff;padding:3mm 4mm;margin:5mm 0 4mm;min-height:12mm}
.crux span{font-size:8pt;border-right:1px solid rgba(255,255,255,.5);padding-right:4mm;white-space:nowrap}.crux b{font-size:10.5pt;line-height:1.3}
.columns,.row{display:grid;grid-template-columns:20mm minmax(0,1fr) 32mm;gap:2mm;align-items:center}
.columns{font-size:7pt;color:#909a9b;letter-spacing:.1em;padding:1mm 2mm 2mm;border-bottom:1px solid #c6c8c4}
.row{min-height:8.25mm;border-bottom:1px solid #e2e0d9;padding:1.25mm 2mm}
.row time{font:700 10pt/1.2 Consolas,monospace;color:#24343d}.rowtitle{font-size:9.4pt;line-height:1.28;font-weight:600}
.row.hard{background:rgba(174,66,60,.065)}.row.hard time{color:#b14b42}.row.hard .rowtitle{font-weight:800}
.tag{font-size:7.5pt;color:#6d7879;line-height:1.25;overflow:hidden;max-height:2.5em}
.tip{position:absolute;left:16mm;right:16mm;bottom:22mm;border-top:1.5px solid var(--accent);padding-top:3mm;display:grid;grid-template-columns:27mm 1fr;gap:3mm}
.tip span{font-size:6.5pt;font-weight:800;color:var(--accent);letter-spacing:.14em}.tip p{font-size:9pt;line-height:1.5;margin:0}
.day footer{position:absolute;left:16mm;right:16mm;bottom:10mm;display:flex;justify-content:space-between;color:#849092;font-size:7pt;border-top:1px solid #d6d5ce;padding-top:3mm}
@media screen{body{padding:12mm}.page{margin:0 auto 10mm;box-shadow:0 6px 35px #8d8980}}
@media print{body{background:#fff;padding:0}}
</style></head><body>
<section class="page cover"><div class="kicker">A SMALL GUIDE FOR A BIG JOURNEY</div><div class="edition">TRAVEL EDITION · V${version}</div><div class="rule"></div><h1>關西<br>五日</h1><p class="sub">把重要時刻，放在眼前。</p><div class="dates">12 — 17 NOV 2026 · KYOTO / OSAKA</div><div class="journey">京都的山與鳥居，伊根的海，奈良的鹿，<br>再回到大阪的街與夜。<small>5 TRAVELLERS · 6 DAYS · 1 CLEAR ROUTE</small></div></section>
<section class="page quick" style="--accent:#b8823a"><div class="topline"><span>BEFORE WE GO</span><span>02 / 08</span></div><h2>先看這一頁，<br>再開始旅行。</h2><p class="intro">PDF 看節奏與死線；地址、導航、訂位細節和即時調整請開 App。</p>
<div class="grid"><div class="card"><span>去程航班</span><b>GK050 · 桃園 → 關西</b><p>11/13 凌晨 02:30 起飛<br>Day 0 晚上先前往機場</p></div><div class="card"><span>回程航班</span><b>GK057 · 關西 → 桃園</b><p>11/17 晚上 23:10 起飛<br>22:30 前到登機門</p></div><div class="card"><span>京都住宿</span><b>曼迪 京都車站</b><p>Day 1–2 · 京都站周邊</p></div><div class="card"><span>大阪住宿</span><b>WELLSTAY 難波</b><p>Day 3–5 · 難波／元町</p></div></div>
<h3>三個先決定好的時刻</h3><div class="decision"><time>DAY 1</time><b>14:30 回飯店補眠；第一天不跑山區。</b></div><div class="decision"><time>DAY 3</time><b>17:20 離開飯店，準時前往鶴橋晚餐。</b></div><div class="decision"><time>DAY 5</time><b>15:50 停止購物；18:20 搭はるか去機場。</b></div>
<div class="appbox"><b>完整行程在 App</b><p>逐站導航、票券與訂位、天氣、備案、五人行前進度與分帳，都在手機裡。</p><a href="${appUrl}">${appUrl}</a></div></section>
${['d0','d1','d2','d3','d4','d5'].map((key, i) => dayPage(key, i + 3)).join('\n')}
</body></html>`;

fs.writeFileSync(htmlPath, html, 'utf8');

const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browser = candidates.find(fs.existsSync);
if (!browser) throw new Error(`已產生 ${htmlPath}，但找不到 Chrome 或 Edge 來輸出 PDF`);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osaka-pdf-'));
try {
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--print-to-pdf-no-header',
    `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
  ], { cwd: root, stdio: 'pipe', timeout: 60000 });
} finally {
  const tempRoot = fs.realpathSync(os.tmpdir()) + path.sep;
  const target = fs.realpathSync(profile);
  if (target.startsWith(tempRoot) && path.basename(target).startsWith('osaka-pdf-')) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  }
}
if (!fs.existsSync(pdfPath)) throw new Error('PDF 輸出失敗');
console.log(`${path.basename(pdfPath)}: ${fs.statSync(pdfPath).size} bytes`);
