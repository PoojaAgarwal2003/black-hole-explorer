import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({
  ...(existsSync(edgePath) ? { executablePath: edgePath } : {}),
  headless: true,
  args: process.env.SOFTWARE_RENDERING === '1'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
    : [],
});
const artifacts = path.resolve('artifacts', `graphics-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(artifacts, { recursive: true });
const errors = [];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function capture(page, name) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#snapshot').click();
  const download = await downloadPromise;
  const destination = path.join(artifacts, `${name}.png`);
  await download.saveAs(destination);
  return page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 128, 96);
    const data = context.getImageData(0, 0, 128, 96).data;
    let dark = 0;
    let bright = 0;
    let shadow = 0;
    let shadowSamples = 0;
    const samples = [];
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 128; x++) {
        const index = (y * 128 + x) * 4;
        const light = (data[index] + data[index + 1] + data[index + 2]) / 3;
        samples.push(light);
        if (light < 30) dark++;
        if (light > 140) bright++;
        if (x > 60 && x < 68 && y > 38 && y < 44) {
          shadow += light;
          shadowSamples++;
        }
      }
    }
    return {
      width: image.naturalWidth, height: image.naturalHeight,
      dark: dark / samples.length, bright: bright / samples.length,
      shadow: shadow / shadowSamples, samples,
    };
  }, readFileSync(destination).toString('base64'));
}

const difference = (a, b) => a.samples.reduce((sum, value, index) => sum + Math.abs(value - b.samples[index]), 0) / a.samples.length;

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await expect(page.locator('#app')).toHaveClass(/ready/, { timeout: 60000 });
  await settle(page);
  const baseline = await capture(page, 'graphics-lensed');
  expect(baseline.width).toBeGreaterThan(800);
  expect(baseline.height).toBeGreaterThan(600);
  expect(baseline.dark, 'Space and the shadow stay dark').toBeGreaterThan(0.5);
  expect(baseline.bright, 'The accretion disk is visibly luminous').toBeGreaterThan(0.03);
  expect(baseline.shadow, 'The black hole is not washed out by bloom').toBeLessThan(45);

  await page.locator('#lensing').uncheck({ force: true });
  await settle(page);
  const straight = await capture(page, 'graphics-unlensed');
  expect(difference(baseline, straight), 'Disabling lensing visibly changes the image').toBeGreaterThan(4);
  await page.locator('#lensing').check({ force: true });
  await page.locator('#universe canvas').evaluate(canvas => {
    for (let i = 0; i < 15; i++) canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  });
  await settle(page);
  const overhead = await capture(page, 'graphics-overhead');
  expect(difference(baseline, overhead), 'Orbit changes the 3D disk orientation').toBeGreaterThan(5);

  await page.locator('#reset-camera').click();
  await page.locator('#gravity').evaluate(input => {
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#universe canvas').evaluate(canvas => {
    for (let i = 0; i < 25; i++) canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
  });
  await settle(page);
  const close = await capture(page, 'graphics-horizon');
  expect(close.bright).toBeGreaterThan(0.01);
  await page.locator('#reset').click();
  await page.waitForTimeout(1800);
  const performance = await page.evaluate(() => {
    const gl = document.querySelector('#universe canvas').getContext('webgl2');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
      fps: Number(document.querySelector('#fps').textContent),
    };
  });
  expect(performance.fps).toBeGreaterThan(0);
  await page.evaluate(() => {
    const gl = document.querySelector('#universe canvas').getContext('webgl2');
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await expect(page.locator('#graphics-error')).toBeVisible();
  await expect(page.locator('#graphics-error-message')).toContainText('graphics connection was interrupted');
  expect(errors).toEqual([]);
  await page.close();

  const unavailable = await browser.newPage();
  await unavailable.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [type, ...args]);
    };
  });
  await unavailable.goto(baseURL);
  await expect(unavailable.locator('#graphics-error')).toBeVisible();
  await expect(unavailable.locator('#graphics-error-message')).toContainText('WebGL 2 could not start');
  await expect(unavailable.locator('#reload')).toBeVisible();
  await unavailable.close();
  console.log(JSON.stringify({
    result: 'Graphics checks passed: nonblank exports, dark shadow, luminous disk, visible lensing, overhead orbit, near-horizon zoom, context loss, and WebGL fallback.',
    performance,
    shadowBrightness: baseline.shadow,
    lensingDifference: difference(baseline, straight),
    artifacts,
  }, null, 2));
} finally {
  await browser.close();
}
