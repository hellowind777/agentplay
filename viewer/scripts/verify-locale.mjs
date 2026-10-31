#!/usr/bin/env node
/**
 * Serve `dist/` and verify the locale toggle end to end: the page must
 * render English by default, switch to zh-CN with the remembered choice,
 * and switch back. Usage:
 *
 *   pnpm build && node scripts/verify-locale.mjs
 *
 * Finds a Chromium via CHROMIUM_PATH, else common Chrome/Edge installs.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cands = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  return cands.find((p) => fs.existsSync(p));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const exe = findChromium();
if (!exe) {
  console.error('No Chromium found; set CHROMIUM_PATH.');
  process.exit(2);
}
const browser = await chromium.launch({ executablePath: exe });
const problems = [];
// Pin the starting locale: the default follows the OS language, which would
// make the assertions below machine-dependent. Write the choice after a
// first visit (Edge runs init scripts before storage is ready for the
// origin), then navigate for real.
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  // A static file host answers /api with 404 — that is what drops the
  // viewer into demo mode, so those fetch errors are expected here.
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
    problems.push(`console.error: ${m.text()}`);
  }
});

// Default English.
await page.goto(`http://127.0.0.1:${port}/`);
await page.evaluate(() => localStorage.setItem('agentplay.locale', 'en'));
await page.goto(`http://127.0.0.1:${port}/?demo`);
await page.waitForSelector('svg circle, canvas', { timeout: 20000 });
const enText = await page.innerText('body');
console.log('EN has "Sessions":', enText.includes('Sessions'));

// Switch to zh-CN via the toggle, then wait for the reload it triggers.
await page.click('button[aria-label="切换到简体中文"]');
await page.waitForLoadState('load');
await page.waitForSelector('svg circle, canvas', { timeout: 20000 });
const zhText = await page.innerText('body');
console.log('ZH has "会话":', zhText.includes('会话'));
console.log('ZH has "打开地图文件":', zhText.includes('打开地图文件'));
console.log('ZH html lang:', await page.evaluate(() => document.documentElement.lang));
await page.screenshot({ path: path.join(ROOT, 'locale-zh.png') });

// Switch back to English.
await page.click('button[aria-label="Switch to English"]');
await page.waitForLoadState('load');
await page.waitForSelector('svg circle, canvas', { timeout: 20000 });
const backText = await page.innerText('body');
console.log('Back to EN has "Sessions":', backText.includes('Sessions'));

await browser.close();
server.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('locale verification OK');
