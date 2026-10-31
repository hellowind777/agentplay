import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';
const DIST = path.resolve('dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.route('**/api/**', (r) => r.continue({ url: r.request().url().replace(/^http:\/\/127\.0\.0\.1:\d+/, 'http://127.0.0.1:7317') }));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('svg circle, canvas', { timeout: 20000 });
await page.waitForTimeout(2500);
const seen = new Set();
async function dump(tag) {
  const text = await page.innerText('body');
  const en = text.split('\n').map(s => s.trim()).filter(s =>
    /^[A-Za-z0-9 $·.,:;()\/%#'"+\-–—×≥≤→?&!]{2,}$/.test(s) && /[A-Za-z]{3,}/.test(s) && !seen.has(s)
  );
  en.forEach(s => seen.add(s));
  console.log(`\n===== ${tag} (${en.length}) =====`);
  console.log(en.slice(0, 60).join('\n'));
}
await dump('会话列表');
await page.click('text=洞察');
await page.waitForTimeout(2500);
await dump('洞察-总览');
// 逐个洞察子页面
for (const tab of ['花费', '会话如何收尾', '失败命令', '什么在失败', '搜索热力图', '浪费', '压缩', '运行健康']) {
  try {
    await page.click(`text=${tab}`, { timeout: 2500 });
    await page.waitForTimeout(1200);
    await dump(`洞察-${tab}`);
  } catch (e) { console.log(`(tab ${tab} not found)`); }
}
await browser.close(); server.close();
