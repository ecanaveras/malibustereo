const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startLocalServer } = require('./local-server.cjs');

(async () => {
  const server = await startLocalServer();
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const a = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageA = await a.newPage(), pageB = await b.newPage();
    const errors = [];
    for (const page of [pageA, pageB]) {
      page.on('pageerror', error => errors.push(error.message));
      // Test the community UI without starting the station stream or loading remote fonts.
      await page.route('https://**/*', route => route.abort());
    }
    await pageA.goto(server.origin);
    await pageA.waitForFunction(() => document.querySelector('.community-count').textContent === '1 persona conectada');
    await pageB.goto(server.origin);
    await pageB.waitForFunction(() => document.querySelector('.community-count').textContent === '2 personas conectadas');
    const secondTab = await a.newPage();
    await secondTab.route('https://**/*', route => route.abort());
    await secondTab.goto(server.origin);
    await secondTab.waitForFunction(() => document.querySelector('.community-count').textContent === '2 personas conectadas');
    console.log('PASS: two visitors and same-browser tab deduplication');
    await pageA.getByLabel('Tu apodo').fill('Ana');
    const content = '<img src=x onerror=alert(1)> ¡Saludos desde Pinillos!';
    await pageA.getByLabel('Mensaje', { exact: true }).fill(content);
    await pageA.getByRole('button', { name: 'Enviar', exact: true }).click();
    await pageB.getByText(content, { exact: true }).waitFor();
    assert.equal(await pageB.locator('.community-messages img').count(), 0);
    console.log('PASS: cross-browser live delivery and text-only rendering');
    await pageB.reload();
    await pageB.waitForFunction(() => !document.querySelector('.community-form button').disabled);
    assert.equal(await pageB.locator('.community-messages article').count(), 0);
    console.log('PASS: no history after reload');
    server.disconnectAll();
    await pageB.waitForFunction(() => document.querySelector('.community-form button').disabled);
    await pageB.waitForFunction(() => !document.querySelector('.community-form button').disabled);
    console.log('PASS: automatic reconnection after a dropped WebSocket');
    // A navigation exercises a new socket using the same browser identity.
    await pageB.goto(server.origin + '/malibustereo/');
    await pageB.waitForFunction(() => document.querySelector('.community-count').textContent === '2 personas conectadas');
    await pageB.getByLabel('Tu apodo').fill('Luis');
    await pageB.getByLabel('Mensaje', { exact: true }).fill('Mi borrador');
    await pageB.route('**/api/community/message', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Servicio no disponible.' }) }));
    await pageB.getByRole('button', { name: 'Enviar', exact: true }).click();
    await pageB.getByText('Servicio no disponible.', { exact: true }).waitFor();
    assert.equal(await pageB.getByLabel('Mensaje', { exact: true }).inputValue(), 'Mi borrador');
    console.log('PASS: draft preserved on server error');
    const out = path.resolve(__dirname, '../../test-output'); fs.mkdirSync(out, { recursive: true });
    await pageA.locator('.community-panel').screenshot({ path: path.join(out, 'community-desktop.png') });
    await pageB.setViewportSize({ width: 375, height: 844 });
    assert.equal(await pageB.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    // A taller capture includes the entire component; the preceding layout check uses a phone viewport.
    await pageB.setViewportSize({ width: 375, height: 1200 });
    await pageB.locator('.community-panel').screenshot({ path: path.join(out, 'community-mobile.png') });
    await pageB.evaluate(() => document.documentElement.classList.add('theme-dark'));
    await pageB.locator('.community-panel').screenshot({ path: path.join(out, 'community-mobile-dark.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: 375px layout, light/dark screenshots, no JavaScript exceptions');
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
