// Start `wavegame dev cartridges/connect-four --port 8111` first.
// Set PLAYWRIGHT_MODULE to an existing Playwright installation; no package dependency is required.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const base = process.env.WAVEGAME_TEST_URL || 'http://127.0.0.1:8111';
const evidence = process.env.EVIDENCE_DIR || '/tmp/connect-four-audit';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
async function waitText(frame, selector, text) {
  await frame.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent === text, { selector, text });
}
async function views(page) {
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 2);
  await page.locator('iframe').evaluateAll((frames) => frames.forEach((frame) => { frame.style.height = '960px'; }));
  await page.locator('iframe').first().contentFrame().locator('#turn').filter({ hasText: 'Your turn' }).waitFor();
  await page.locator('iframe').nth(1).contentFrame().locator('#turn').filter({ hasText: 'Opponent’s turn' }).waitFor();
  const frames = page.frames().filter((frame) => frame.url().includes('/cartridge/ui/'));
  assert.equal(frames.length, 2);
  await waitText(frames[0], '#turn', 'Your turn');
  await waitText(frames[1], '#turn', 'Opponent’s turn');
  return frames;
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  let frames = await views(page);
  assert.equal(await frames[1].locator('.drop:enabled').count(), 0);
  // Exercise native keyboard activation, then complete a real authority win.
  await frames[0].locator('.drop').first().focus();
  await page.keyboard.press('Enter');
  await waitText(frames[1], '#turn', 'Your turn');
  for (const [seat, column] of [[2, 0], [1, 1], [2, 1], [1, 2], [2, 2], [1, 3]]) {
    await frames[seat - 1].locator('.drop').nth(column).click();
    await waitText(frames[seat === 1 ? 1 : 0], '#turn', seat === 1 && column === 3 ? 'Opponent wins' : 'Your turn');
  }
  assert.equal(await frames[0].locator('.winner').count(), 4);
  await waitText(frames[0], '#message', 'You connected four.');
  await page.locator('iframe').first().screenshot({ path: path.join(evidence, 'desktop-victory.png') });
  await frames[0].locator('#rematch').click();
  await waitText(frames[0], '#rematch', 'Waiting for opponent…');
  await frames[1].locator('#rematch').click();
  await waitText(frames[1], '#turn', 'Your turn');
  assert.match(await frames[0].locator('#seat').textContent(), /Seat 1 · Your disc: Yellow 2/);
  await frames[1].locator('.drop').nth(4).click();
  await waitText(frames[0], '#turn', 'Your turn');
  // Disconnect/rejoin preserves the existing authority board and disc ownership.
  await page.locator('.seat-heading button').first().click();
  await page.locator('.seat-heading button').first().click();
  await page.locator('iframe').first().contentFrame().locator('#seat').filter({ hasText: 'Yellow 2' }).waitFor();
  frames = page.frames().filter((frame) => frame.url().includes('/cartridge/ui/'));
  const first = frames.find((frame) => frame.url().includes('seat=1'));
  await waitText(first, '#turn', 'Your turn');
  assert.equal(await first.locator('.disc.red').count(), 1);
  assert.match(await first.locator('#seat').textContent(), /Yellow 2/);
  await first.locator('#surrender').click();
  await waitText(first, '#message', 'You surrendered.');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(base);
  const mobileFrames = await views(mobile);
  // Give the cartridge an exact 320px viewport, independent of simulator chrome.
  await mobile.locator('iframe').first().evaluate((frame) => { frame.style.width = '320px'; frame.style.height = '680px'; });
  const geometry = await mobileFrames[0].evaluate(() => ({
    width: innerWidth, scroll: document.documentElement.scrollWidth,
    controls: [...document.querySelectorAll('button:not([hidden])')].map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
    motion: getComputedStyle(document.querySelector('.disc')).animationName,
  }));
  assert.equal(geometry.width, 320);
  assert.equal(geometry.scroll, 320);
  assert.ok(geometry.controls.every((bounds) => bounds.width >= 44 && bounds.height >= 44));
  assert.equal(geometry.motion, 'none');
  await mobileFrames[0].locator('.drop').nth(6).tap();
  await waitText(mobileFrames[1], '#turn', 'Your turn');
  await mobile.locator('iframe').first().screenshot({ path: path.join(evidence, 'mobile-320.png') });

  // A native-session double exercises failure/status paths the simulator cannot emit.
  const native = await browser.newPage({ viewport: { width: 390, height: 844 } });
  native.on('pageerror', (error) => errors.push(error.message));
  await native.addInitScript(() => {
    const view = { cells: Array(42).fill(0), turn: 'player-1', winner: null, draw: false, moves: 0,
      winningCells: [], rematchVotes: [false, false], viewer: 'player-1', myDisc: 1, canDrop: Array(7).fill(true), revision: 0 };
    window.testCalls = 0;
    window.WaveGames = { connect: async () => ({ context: { seat: 1 }, view,
      onView: (listener) => { window.testView = listener; }, onStatus: (listener) => { window.testStatus = listener; }, onRoster() {},
      storage: { get() {}, set() {}, remove() {} },
      sendAction: async () => { window.testCalls += 1; if (window.testCalls === 1) return { accepted: false, reason: 'That column is full' }; throw new Error('Bridge request timed out'); },
    }) };
  });
  await native.goto(`${base}/cartridge/ui/index.html`);
  await waitText(native.mainFrame(), '#turn', 'Your turn');
  await native.locator('.drop').first().click();
  await waitText(native.mainFrame(), '#message', 'That column is full');
  assert.equal(await native.locator('.drop:enabled').count(), 7);
  await native.locator('.drop').first().click();
  await waitText(native.mainFrame(), '#message', 'Bridge request timed out');
  await native.evaluate(() => window.testStatus('recovering'));
  assert.equal(await native.locator('.drop:enabled').count(), 0);
  await waitText(native.mainFrame(), '#message', 'Reconnecting to the match…');
  await native.evaluate(() => window.testStatus('connected'));
  assert.equal(await native.locator('.drop:enabled').count(), 7);
  await native.evaluate(() => window.testStatus('closed'));
  assert.equal(await native.locator('button:enabled:not([hidden])').count(), 0);
  assert.equal(await native.evaluate(() => window.testCalls), 2, 'Failed actions must never auto-resubmit');
  const startup = await browser.newPage();
  startup.on('pageerror', (error) => errors.push(error.message));
  await startup.addInitScript(() => { window.WaveGames = { connect: async () => { throw new Error('Host rejected connection'); } }; });
  await startup.goto(`${base}/cartridge/ui/index.html`);
  await waitText(startup.mainFrame(), '#turn', 'Connection failed');
  assert.match(await startup.locator('#message').textContent(), /Host rejected connection/);
  assert.equal(await startup.locator('button:enabled:not([hidden])').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`Connect Four browser checks passed: keyboard win, rematch, rejoin, surrender, 320px touch layout, native rejection/status/startup errors. Evidence: ${evidence}`);
} finally {
  await browser.close();
}
