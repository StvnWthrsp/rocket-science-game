const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 5174;
const URL = 'http://127.0.0.1:' + PORT + '/';

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error('Vite server did not start at ' + url);
}

(async () => {
  const server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  let browser;
  try {
    await waitForServer(URL);
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });

    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1600);
    assert.equal(await page.title(), 'Rocket Science: Cats in Space');
    assert.ok(await page.isVisible('#screen-menu'), 'menu should be visible');
    assert.ok(await page.isVisible('#btn-menu-start'), 'start button should exist');

    await page.click('#btn-menu-start');
    await page.waitForTimeout(900);
    assert.ok(await page.isVisible('#screen-vab'), 'VAB should open');
    const before = await page.evaluate(() => window.__rs.stats().totalDeltaV);
    await page.click('#part-tabs [data-cat="fuel"]');
    await page.waitForTimeout(150);
    await page.click('[data-part="tank_s"]');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => window.__rs.stats().totalDeltaV);
    assert.ok(after > before, 'adding a tank should increase delta-v');
    await page.click('#btn-stack-remove');
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await page.evaluate(() => window.__rs.stats().totalDeltaV)) - before) < 0.01, 'removing the part should restore delta-v');

    await page.click('#btn-vab-launch');
    await page.waitForTimeout(1100);
    assert.ok(await page.isVisible('#screen-flight'), 'flight screen should open');
    const pre = await page.evaluate(() => ({ s: window.__game.state, ship: !!window.__game.ship, alt: window.__game.ship?.telemetry().altitude }));
    assert.equal(pre.s, 'flight');
    assert.ok(pre.ship);
    assert.ok(pre.alt < 50, 'ship should start on the pad, got altitude ' + pre.alt);

    await page.click('#btn-flight-map');
    await page.waitForTimeout(350);
    assert.ok(await page.isVisible('#screen-map'), 'map should open');
    await page.click('#btn-map-system');
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__game.map.view), 'system');
    await page.click('#btn-map-close');
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__game.state), 'flight');

    await page.evaluate(() => {
      const g = window.__game;
      g.engageAuto('ascent');
      g.debugSimulate(900);
    });
    const progress = await page.evaluate(() => window.__game.progress);
    assert.ok(progress.orbit, 'autopilot should reach a stable orbit');
    assert.ok(await page.evaluate(() => window.__game.ship.telemetry().apoapsis > 70000), 'apoapsis should be above the atmosphere');

    assert.deepEqual(errors, [], 'no page errors expected: ' + errors.join(' | '));
    console.log('UI E2E OK: menu → VAB edit → launch → map → autopilot orbit');
  } finally {
    if (browser) await browser.close();
    if (server && server.pid) {
      try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill('SIGTERM'); } catch { /* ignore */ } }
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
