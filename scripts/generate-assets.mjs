/**
 * Renders the PNG icons and the default social image from HTML/canvas with
 * Playwright's Chromium. Run once after changing the brand: npm run assets
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const PRESET = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(PRESET) ? { executablePath: PRESET } : {});
mkdirSync('public/icons', { recursive: true });
mkdirSync('public/images', { recursive: true });

const icon = (size) => `<html><body style="margin:0;background:#04060c">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
<defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="0.22" stop-color="#5ee7ff"/><stop offset="0.6" stop-color="#5ee7ff" stop-opacity="0.35"/><stop offset="1" stop-color="#9b87ff" stop-opacity="0"/></radialGradient></defs>
<rect width="64" height="64" fill="#04060c"/>
<g stroke="#5ee7ff" stroke-opacity="0.55" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M32 32 L14 20 M32 32 L50 18 M32 32 L47 47 M32 32 L18 46 M32 32 L33 10"/></g>
<g fill="#9b87ff"><circle cx="14" cy="20" r="3"/><circle cx="50" cy="18" r="2.5"/><circle cx="47" cy="47" r="3"/><circle cx="18" cy="46" r="2.5"/><circle cx="33" cy="10" r="2"/></g>
<circle cx="32" cy="32" r="14" fill="url(#g)"/></svg></body></html>`;

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(icon(size));
  await page.screenshot({ path: `public/icons/${name}` });
  await page.close();
}

const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.setContent(`<html><body style="margin:0;background:#04060c;font-family:Inter,system-ui,sans-serif">
<canvas id="c" width="1200" height="630"></canvas>
<script>
const c = document.getElementById('c').getContext('2d');
let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const g = c.createRadialGradient(820, 315, 10, 820, 315, 700); g.addColorStop(0, '#0f2240'); g.addColorStop(1, '#04060c');
c.fillStyle = g; c.fillRect(0, 0, 1200, 630);
c.globalCompositeOperation = 'lighter';
const nodes = [];
const centers = [[820, 315, '94,231,255'], [990, 230, '214,120,255'], [690, 180, '125,255,178'], [930, 470, '94,200,255'], [700, 450, '155,135,255']];
for (const [cx, cy, col] of centers) for (let i = 0; i < 60; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * 95; nodes.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, col]); }
c.lineWidth = 1;
for (let i = 1; i < nodes.length; i++) { const a = nodes[i], b = nodes[Math.floor(r() * i)]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 140) { c.strokeStyle = 'rgba(' + a[2] + ',0.22)'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); } }
for (const [cx, cy, col] of centers.slice(1)) { c.strokeStyle = 'rgba(' + col + ',0.35)'; c.beginPath(); c.moveTo(820, 315); c.quadraticCurveTo((820 + cx) / 2 + 40, (315 + cy) / 2 - 40, cx, cy); c.stroke(); }
for (const [x, y, col] of nodes) { const rad = 3 + r() * 7; const gg = c.createRadialGradient(x, y, 0, x, y, rad); gg.addColorStop(0, 'rgba(255,255,255,0.9)'); gg.addColorStop(0.3, 'rgba(' + col + ',0.8)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gg; c.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
c.globalCompositeOperation = 'source-over';
c.fillStyle = '#8fb3d9'; c.font = '600 20px ui-monospace, monospace'; c.fillText('INTERNET ORGANISM', 72, 120);
c.fillStyle = '#eef4ff'; c.font = '600 64px Inter, system-ui, sans-serif'; c.fillText('One internet.', 72, 250); c.fillText('One living organism.', 72, 330);
c.fillStyle = '#b9c9e0'; c.font = '28px Inter, system-ui, sans-serif'; c.fillText('Every trace changes the world.', 72, 400);
</script></body></html>`);
await og.screenshot({ path: 'public/images/og-default.png' });
await browser.close();
console.warn('assets written');
