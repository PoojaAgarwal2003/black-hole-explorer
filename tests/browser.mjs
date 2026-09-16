import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
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
const artifacts = path.resolve('artifacts', `browser-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(artifacts, { recursive: true });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
};
const setRange = async (page, id, value) => {
  await page.locator(`#${id}`).evaluate((input, number) => {
    input.value = String(number);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  watch(page);
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60000 });
  await expect(page.locator('#app')).toHaveClass(/ready/, { timeout: 60000 });
  await expect(page.locator('#graphics-error')).toBeHidden();
  await expect(page.locator('#universe canvas')).toBeVisible();
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Resume simulation');
  await settle(page);
  await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });
  await page.locator('#universe canvas').screenshot({ path: path.join(artifacts, 'black-hole.png') });

  await page.locator('[data-preset="chaos"]').click();
  await expect(page.locator('#gravity-value')).toHaveText('1.65 \u00d7');
  await expect(page.locator('#particleCount-value')).toHaveText('12,000');
  await expect(page.locator('#object-name')).toHaveText('Chaos');
  await page.locator('[data-preset="quiet"]').click();
  await expect(page.locator('#temperature-value')).toHaveText('4,200 K');
  await page.locator('[data-preset="gargantua"]').click();
  await setRange(page, 'gravity', 1.25);
  await expect(page.locator('#gravity-value')).toHaveText('1.25 \u00d7');
  await expect(page.locator('#object-name')).toHaveText('Your singularity');
  await setRange(page, 'spin', -0.5);
  await expect(page.locator('#spin-value')).toHaveText('-0.50');
  await setRange(page, 'particleCount', 0);
  await expect(page.locator('#particleCount-value')).toHaveText('0');

  await page.locator('#lensing').uncheck({ force: true });
  await settle(page);
  await page.locator('#universe canvas').screenshot({ path: path.join(artifacts, 'without-lensing.png') });
  await page.locator('#lensing').check({ force: true });
  await page.locator('#autoOrbit').check({ force: true });
  await page.locator('#showTrails').uncheck({ force: true });
  await page.locator('#quality').selectOption('performance');
  await page.locator('#quality').selectOption('cinematic');
  await settle(page);
  await page.locator('#quality').selectOption('performance');
  await page.locator('#reset').click();
  await expect(page.locator('#gravity-value')).toHaveText('1.00 \u00d7');
  await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Pause simulation');
  await expect(page.locator('#autoOrbit')).not.toBeChecked();

  await page.locator('#pause').click();
  await page.waitForTimeout(1000);
  const time = await page.locator('#elapsed').textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator('#elapsed')).toHaveText(time);
  await page.locator('#launch').click();
  await expect(page.locator('#toast')).toContainText('Probe armed');
  await expect(page.locator('#active-probes')).toHaveText('1', { timeout: 15000 });
  await page.locator('#pause').click();
  await page.locator('[data-speed="2"]').click();
  await expect(page.locator('[data-speed="2"]')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1500);
  await page.locator('#universe canvas').screenshot({ path: path.join(artifacts, 'probe-flight.png') });
  await page.locator('#clear-probes').click();
  await expect(page.locator('#active-probes')).toHaveText('0');

  await page.locator('#universe canvas').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Resume simulation');
  await page.keyboard.press('l');
  await expect(page.locator('#toast')).toContainText('Probe armed');
  await page.keyboard.press('h');
  await expect(page.locator('#app')).toHaveClass(/hide-hud/);
  await page.keyboard.press('h');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('+');
  const box = await page.locator('#universe canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65 + 120, box.y + box.height * 0.6 + 70, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -250);
  await settle(page);
  await page.locator('#universe canvas').screenshot({ path: path.join(artifacts, 'orbited.png') });
  await page.locator('#reset-camera').click();

  await page.locator('#field-notes').click();
  await expect(page.locator('#notes-dialog')).toBeVisible();
  await expect(page.locator('#notes-dialog')).toContainText('not a scientific solver');
  await page.keyboard.press('Escape');
  await expect(page.locator('#notes-dialog')).not.toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#snapshot').click();
  const download = await downloadPromise;
  await download.saveAs(path.join(artifacts, 'captured-observation.png'));
  expect(download.suggestedFilename()).toMatch(/singularity-.*\.png$/);
  await page.locator('#reset').click();
  await page.locator('#pause').click();
  await page.locator('#quality').selectOption('balanced');
  await page.locator('.panel-scroll').evaluate(panel => { panel.scrollTop = 0; });
  await settle(page);
  await page.screenshot({ path: path.join(artifacts, 'desktop-final.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  watch(mobile);
  await mobile.goto(baseURL, { waitUntil: 'networkidle', timeout: 60000 });
  await expect(mobile.locator('#app')).toHaveClass(/ready/, { timeout: 60000 });
  await expect(mobile.locator('#pause')).toHaveAttribute('aria-label', 'Resume simulation');
  await expect(mobile.locator('#control-panel')).toBeHidden();
  await mobile.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
  await mobile.locator('#mobile-controls').click();
  await expect(mobile.locator('#control-panel')).toBeVisible();
  await mobile.locator('[data-preset="chaos"]').click();
  await expect(mobile.locator('#object-name')).toHaveText('Chaos');
  await mobile.locator('#launch').click();
  await expect(mobile.locator('#toast')).toContainText('Probe armed');
  await mobile.screenshot({ path: path.join(artifacts, 'mobile-controls.png'), fullPage: true });
  await mobile.locator('#close-controls').click();
  await expect(mobile.locator('#control-panel')).toBeHidden();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mobile.close();
  await page.close();
  expect(errors, 'No JavaScript, WebGL shader, or resource errors').toEqual([]);
  console.log('Browser checks passed: WebGL rendering, presets, sliders, toggles, all quality modes, pause, speed, probes, keyboard, orbit/zoom, capture, notes, mobile, and reduced motion.');
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser.close();
}
