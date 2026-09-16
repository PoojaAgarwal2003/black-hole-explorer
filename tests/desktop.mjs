import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ ...(existsSync(edge) ? { executablePath: edge } : {}), headless: true });
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const session = `test-${Date.now()}`;
const artifacts = path.resolve('artifacts', `desktop-integration-${Date.now()}`);
mkdirSync(artifacts, { recursive: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  });
  const wallpaper = await context.newPage();
  await wallpaper.goto(`${base}/?view=wallpaper&session=${session}`, { waitUntil: 'networkidle' });
  const controls = await context.newPage();
  await controls.setViewportSize({ width: 370, height: 1000 });
  await controls.goto(`${base}/?view=controls&session=${session}`, { waitUntil: 'networkidle' });
  await expect(controls.locator('#app')).toHaveClass(/ready/);
  await expect(wallpaper.locator('#app')).toHaveClass(/ready/);
  await expect(controls.locator('canvas')).toHaveCount(0);
  await expect(wallpaper.locator('#control-panel')).not.toBeVisible();
  await controls.evaluate(name => {
    window.testChannel = new BroadcastChannel(`singularity-${name}`);
    window.testChannel.onmessage = event => {
      if (event.data.type === 'telemetry') window.testStats = event.data.value;
    };
  }, session);
  const send = command => controls.evaluate(value => window.testChannel.postMessage(value), command);
  await controls.locator('#gravity').evaluate(input => {
    input.value = '1.3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(wallpaper.locator('#gravity-value')).toHaveText('1.30 \u00d7');
  await expect(wallpaper.locator('#pause')).toHaveAttribute('aria-label', 'Resume simulation');
  await send({ type: 'launch-at', x: 0.78, y: 0.32 });
  await expect.poll(() => controls.evaluate(() => window.testStats?.active)).toBe(1);
  const position = await controls.evaluate(() => window.testStats.lastLaunch);
  expect(position.x).toBeCloseTo(0.78, 5);
  expect(position.y).toBeCloseTo(0.32, 5);
  await controls.locator('#launch').click();
  await expect(controls.locator('#active-probes')).toHaveText('2');
  await controls.locator('#desktop-orbit-left').click();
  await controls.locator('#desktop-zoom-in').click();
  const downloadPromise = controls.waitForEvent('download');
  await controls.locator('#snapshot').click();
  const download = await downloadPromise;
  await download.saveAs(path.join(artifacts, 'remote-capture.png'));
  await controls.locator('#clear-probes').click();
  for (let i = 0; i < 20; i++) await send({ type: 'launch-at', x: 0.8, y: 0.3 });
  await expect(controls.locator('#active-probes')).toHaveText('16');
  await controls.screenshot({ path: path.join(artifacts, 'control-room.png') });
  await wallpaper.screenshot({ path: path.join(artifacts, 'wallpaper.png') });
  expect(await controls.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const web = await context.newPage();
  await web.goto(base, { waitUntil: 'networkidle' });
  const canvas = web.locator('#universe canvas');
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: bounds.width * 0.78, y: bounds.height * 0.3 } });
  await expect(web.locator('#active-probes')).toHaveText('1');
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await expect(web.locator('#toast')).toContainText('outside the black hole shadow');
  await web.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.7);
  await web.mouse.down();
  await web.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.6, { steps: 6 });
  await web.mouse.up();
  await expect(web.locator('#active-probes')).toHaveText('1');
  await web.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.7);
  await web.mouse.down();
  await web.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.6, { steps: 3 });
  await web.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.7, { steps: 3 });
  await web.mouse.up();
  await expect(web.locator('#active-probes')).toHaveText('1');
  expect(errors).toEqual([]);
  console.log(`Desktop bridge, point launches, probe cap, remote capture, single renderer, and click-versus-orbit checks passed. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
}
