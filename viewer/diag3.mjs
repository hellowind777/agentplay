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
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message, '\nSTACK:', (e.stack ?? '').split('\n').slice(0, 8).join('\n')));
// 代理 /api 到真实服务器，用真实数据
await page.route('**/api/**', (route) => route.continue({ url: route.request().url().replace(/^http:\/\/127\.0\.0\.1:\d+/, 'http://127.0.0.1:7317') }));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('svg circle, canvas', { timeout: 20000 });
await page.waitForTimeout(2000);
try {
  await page.click('text=洞察', { timeout: 5000 });
  await page.waitForTimeout(3000);
  console.log('BODY LEN:', (await page.innerText('body')).length);
} catch (e) { console.log('CLICK FAIL:', e.message.split('\n')[0]); }
await browser.close(); server.close();
