/**
 * gemini-auto.js (FULL / CDP-stable)
 *
 * Usage (CDP / recommended, like Veo3):
 *   node /home/node/scripts/gemini-auto.js /tmp/gemini_input.json --file --cdp=http://192.168.65.254:9222
 *
 * Usage (Cookie + persistent profile):
 *   node /home/node/scripts/gemini-auto.js /tmp/gemini_input.json --file
 *
 * Flags:
 *   --file                 inputArg is a file path containing JSON
 *   --base64               inputArg is base64 JSON
 *   --cdp=URL              connectOverCDP URL
 *   --cookies=PATH         cookie json path (default: /home/node/scripts/gemini-cookies.json)
 *   --profile=DIR          persistent profile dir (default: /home/node/scripts/gemini-browser-profile)
 *   --headful              (non-CDP only) run headful
 *   --goto=URL             gemini url (default: https://gemini.google.com/app)
 *   --timeout=MS           global timeout for waits (default: 180000)
 *   --answerWait=MS        answer wait timeout (default: 180000)
 *   --stabilize=MS         answer stabilize window (default: 10000)
 *   --screenshot=PATH      screenshot path (default: /home/node/scripts/gemini-auto-result.png)
 *   --noScreenshot         disable screenshot
 *   --mode=MODE            select mode: 'fast' (高速モード) or 'think' (思考モード)
 *   --noModeSwitch         skip mode switching
 *   --deleteChat           delete the chat after completion (for production use)
 *
 * Output:
 *   - stdout: JSON (single line). (results or {error:...})
 *   - stderr: logs
 */

const { chromium } = require('playwright');
const fs = require('fs');

function nowIso() {
  return new Date().toISOString();
}

function eprint(...args) {
  console.error(`[${nowIso()}]`, ...args);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseArgs(argv) {
  const flags = new Set();
  const kv = {};
  const positionals = [];

  for (const a of argv) {
    if (a.startsWith('--')) {
      flags.add(a);
      const eq = a.indexOf('=');
      if (eq > 2) {
        const k = a.slice(2, eq);
        const v = a.slice(eq + 1);
        kv[k] = v;
      }
    } else {
      positionals.push(a);
    }
  }
  return { flags, kv, positionals };
}

function toInt(v, def) {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}

// -------- prompts deep finder (robust) --------
function deepFindPrompts(x, depth = 0) {
  if (depth > 12 || x == null) return null;

  if (Array.isArray(x)) {
    if (x.length > 0 && typeof x[0] === 'object' && x[0] && ('text' in x[0] || 'index' in x[0])) {
      return x;
    }
    for (const v of x) {
      const found = deepFindPrompts(v, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof x === 'object') {
    if (Array.isArray(x.prompts)) return x.prompts;
    if (x.json && Array.isArray(x.json.prompts)) return x.json.prompts;
    if (x.data && Array.isArray(x.data.prompts)) return x.data.prompts;
    if (x.item && x.item.json && Array.isArray(x.item.json.prompts)) return x.item.json.prompts;
    if (x.items && Array.isArray(x.items)) {
      const found = deepFindPrompts(x.items, depth + 1);
      if (found) return found;
    }
    for (const k of Object.keys(x)) {
      const found = deepFindPrompts(x[k], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function normalizePrompts(prompts) {
  return prompts.map((p, i) => {
    const normalized = {
      index: (p && p.index != null) ? p.index : (i + 1),
      text: (p && p.text != null) ? String(p.text) : '',
      mode: (p && p.mode) ? String(p.mode) : null, // 'fast', 'think', or null (no change)
    };
    eprint('[gemini-auto] normalizePrompt:', normalized.index, 'mode:', normalized.mode, 'original mode:', p?.mode);
    return normalized;
  });
}

function loadPromptsFromInputText(jsonText) {
  const parsed = JSON.parse(jsonText);
  const prompts = deepFindPrompts(parsed);
  if (!Array.isArray(prompts)) return { error: 'Prompts not found in input' };
  return { prompts: normalizePrompts(prompts) };
}

function readInputFromArgs() {
  const argv = process.argv.slice(2);
  const { flags, kv, positionals } = parseArgs(argv);

  const inputArg = positionals[0];
  if (!inputArg) return { error: 'No input provided', flags, kv };

  try {
    let jsonText = inputArg;

    if (flags.has('--file')) {
      if (!fs.existsSync(inputArg)) {
        return { error: 'Input file not found', filePath: inputArg, flags, kv };
      }
      jsonText = fs.readFileSync(inputArg, 'utf8');
    }

    if (flags.has('--base64')) {
      jsonText = Buffer.from(jsonText, 'base64').toString('utf8');
    }

    const loaded = loadPromptsFromInputText(jsonText);
    if (loaded.error) return { ...loaded, flags, kv };

    return { prompts: loaded.prompts, flags, kv };
  } catch (e) {
    return { error: 'Invalid JSON', message: e.message, flags, kv };
  }
}

function isTargetClosedError(err) {
  const msg = String(err && err.message ? err.message : err);
  return (
    msg.includes('Target page, context or browser has been closed') ||
    msg.includes('Target closed') ||
    msg.includes('has been closed') ||
    msg.includes('Browser has been closed') ||
    msg.includes('Browser disconnected')
  );
}

async function waitForCondition(fn, { timeoutMs = 180000, intervalMs = 500, label = 'condition' } = {}) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${label} (${timeoutMs}ms)`);
    try {
      const ok = await fn();
      if (ok) return;
    } catch (_) {}
    await sleep(intervalMs);
  }
}

async function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

// -----------------------------
// Main
// -----------------------------
async function run() {
  eprint('[gemini-auto] start');

  const input = readInputFromArgs();
  if (input.error) {
    process.stdout.write(JSON.stringify({ error: input.error, message: input.message, filePath: input.filePath }) + '\n');
    process.exit(1);
  }

  const prompts = input.prompts;
  const { flags, kv } = input;

  const cookiePath = kv.cookies || '/home/node/scripts/gemini-cookies.json';
  const userDataDir = kv.profile || '/home/node/scripts/gemini-browser-profile';
  const gotoUrl = kv.goto || 'https://gemini.google.com/app';

  const globalTimeout = toInt(kv.timeout, 180000);
  const answerWait = toInt(kv.answerWait, 180000);
  const stabilizeMs = toInt(kv.stabilize, 10000); // increased for stability

  const screenshotPath = kv.screenshot || '/home/node/scripts/gemini-auto-result.png';
  const doScreenshot = !flags.has('--noScreenshot');

  const cdpUrl = kv.cdp || null;
  const headless = !flags.has('--headful'); // only non-CDP

  // Mode selection: --mode=fast or --mode=think
  const noModeSwitch = flags.has('--noModeSwitch');
  const modeParam = kv.mode || null; // 'fast' or 'think'
  // null means no mode switch by default (let user's current mode stay)
  const targetMode = modeParam; // null, 'fast', or 'think'

  // Delete chat after completion (for production)
  const deleteChat = flags.has('--deleteChat');

  eprint('[gemini-auto] prompts:', prompts.length);
  if (deleteChat) {
    eprint('[gemini-auto] deleteChat enabled');
  }
  if (targetMode) {
    eprint('[gemini-auto] targetMode:', targetMode);
  } else if (noModeSwitch) {
    eprint('[gemini-auto] mode switching disabled');
  } else {
    eprint('[gemini-auto] no mode specified (keeping current)');
  }
  if (cdpUrl) eprint('[gemini-auto] mode: CDP connect', cdpUrl);
  else eprint('[gemini-auto] mode: cookie/profile');

  let browser = null;          // CDP mode only
  let context = null;          // both modes
  let page = null;             // both modes
  let cdpCreatedContext = false; // if we created incognito context via browser.newContext()
  let cdpConnected = false;

  async function connectOrReconnectCDP() {
    // connect
    browser = await chromium.connectOverCDP(cdpUrl);
    cdpConnected = true;

    const contexts = browser.contexts();
    if (contexts && contexts.length > 0) {
      context = contexts[0];
      cdpCreatedContext = false;
    } else {
      context = await browser.newContext();
      cdpCreatedContext = true;
    }

    // always use a fresh page to avoid interfering other tabs
    page = await context.newPage();
  }

  async function ensureLiveCDPPage() {
    if (!cdpUrl) return;

    // if browser missing or disconnected => reconnect
    const disconnected =
      !browser ||
      (typeof browser.isConnected === 'function' && !browser.isConnected());

    if (disconnected) {
      eprint('[gemini-auto] CDP reconnect (browser disconnected)');
      await connectOrReconnectCDP();
      return;
    }

    // if page is closed, recreate
    if (page && page.isClosed && page.isClosed()) {
      eprint('[gemini-auto] recreate page (was closed)');
      page = await context.newPage();
    }

    // if page missing
    if (!page) {
      page = await context.newPage();
    }
  }

  async function gotoWithRetry(url, tries = 3) {
    let lastErr = null;
    for (let i = 1; i <= tries; i++) {
      try {
        await ensureLiveCDPPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        return;
      } catch (e) {
        lastErr = e;
        if (!isTargetClosedError(e)) throw e;

        eprint('[gemini-auto] goto retry', i, String(e.message || e));

        // recreate page and retry; if that fails, reconnect CDP on next loop
        try { if (page && !page.isClosed()) await page.close().catch(() => {}); } catch (_) {}
        page = null;

        // if CDP, try immediate reconnect once
        if (cdpUrl) {
          try {
            await connectOrReconnectCDP();
          } catch (_) {
            // next iteration will attempt again
          }
        }

        await sleep(300);
      }
    }
    throw new Error(`goto failed after retries: ${String(lastErr && lastErr.message ? lastErr.message : lastErr)}`);
  }

  async function checkLoggedIn() {
    const url = page.url();
    eprint('[gemini-auto] url:', url);
    const loggedIn = !url.includes('accounts.google.com') && !url.includes('signin');
    eprint('[gemini-auto] loggedIn:', loggedIn);
    return loggedIn;
  }

  async function openGeminiAndValidate() {
    await gotoWithRetry(gotoUrl, 3);
    await page.waitForTimeout(2000);

    const ok = await checkLoggedIn();
    if (!ok) {
      const err = { error: 'Not logged in', url: page.url() };
      if (doScreenshot) {
        try { await page.screenshot({ path: screenshotPath }); } catch (_) {}
      }
      process.stdout.write(JSON.stringify(err) + '\n');
      throw new Error('Not logged in');
    }
  }

  // -------- Mode switching (fast mode / think mode) --------
  async function ensureMode(mode) {
    // mode: 'fast' or 'think'
    const targetLabel = mode === 'think' ? '思考モード' : '高速モード';
    const targetTestId = mode === 'think' ? 'bard-mode-option-思考モード' : 'bard-mode-option-高速モード';

    eprint('[gemini-auto] ensureMode:', mode, '(' + targetLabel + ')');

    // Wait for UI to settle after previous operations
    await page.waitForTimeout(1500);

    // Click somewhere neutral to reset focus, then scroll to bottom
    await page.evaluate(() => {
      document.body.click();
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(500);

    // Find the mode switch button - try multiple selectors
    let modeSwitchBtn = page.locator('button.input-area-switch');
    let btnCount = await modeSwitchBtn.count();

    eprint('[gemini-auto] mode switch button count:', btnCount);

    if (btnCount === 0) {
      // Try alternative selector
      modeSwitchBtn = page.locator('.input-area-switch');
      btnCount = await modeSwitchBtn.count();
      eprint('[gemini-auto] alternative selector count:', btnCount);
    }

    if (btnCount === 0) {
      eprint('[gemini-auto] mode switch button not found, skipping mode selection');
      // Take a debug screenshot
      try {
        await page.screenshot({ path: '/home/node/scripts/gemini-mode-debug.png' });
        eprint('[gemini-auto] debug screenshot saved');
      } catch (_) {}
      return;
    }

    // Check current mode from button text
    const btnText = await modeSwitchBtn.first().innerText().catch(() => '');
    eprint('[gemini-auto] current mode button text: "' + btnText.trim() + '"');

    if (btnText.includes(targetLabel)) {
      eprint('[gemini-auto] already in target mode:', targetLabel);
      return;
    }

    // Click to open dropdown menu
    eprint('[gemini-auto] clicking mode switch button to open dropdown...');
    try {
      await modeSwitchBtn.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await modeSwitchBtn.first().click({ force: true });
    } catch (e) {
      eprint('[gemini-auto] click failed, trying evaluate:', e.message);
      await modeSwitchBtn.first().evaluate(el => el.click());
    }
    await page.waitForTimeout(1000);

    // Check if dropdown opened by looking for any menu items
    const anyMenuItem = page.locator('[role="menuitemradio"]');
    const menuItemCount = await anyMenuItem.count();
    eprint('[gemini-auto] menu items found:', menuItemCount);

    if (menuItemCount === 0) {
      eprint('[gemini-auto] dropdown did not open, retrying click...');
      await modeSwitchBtn.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Wait for and click the target mode option
    const modeOption = page.locator(`[data-test-id="${targetTestId}"]`);

    try {
      await waitForCondition(async () => {
        const c = await modeOption.count();
        return c > 0;
      }, { timeoutMs: 5000, intervalMs: 200, label: 'mode option visible' });
    } catch (e) {
      eprint('[gemini-auto] mode option wait failed:', e.message);
      // Try clicking the dropdown again
      await modeSwitchBtn.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    const optionCount = await modeOption.count();
    eprint('[gemini-auto] mode option count:', optionCount);

    if (optionCount > 0) {
      eprint('[gemini-auto] clicking mode option:', targetTestId);
      try {
        await modeOption.first().scrollIntoViewIfNeeded();
        await modeOption.first().click({ force: true });
      } catch (e) {
        eprint('[gemini-auto] option click failed, trying evaluate:', e.message);
        await modeOption.first().evaluate(el => el.click());
      }
      await page.waitForTimeout(1000);

      // Verify mode switched
      const newBtnText = await modeSwitchBtn.first().innerText().catch(() => '');
      eprint('[gemini-auto] mode after switch: "' + newBtnText.trim() + '"');

      if (!newBtnText.includes(targetLabel)) {
        eprint('[gemini-auto] WARNING: mode switch may have failed!');
      } else {
        eprint('[gemini-auto] mode switch SUCCESS');
      }
    } else {
      eprint('[gemini-auto] mode option not found:', targetTestId);
      // Take a debug screenshot
      try {
        await page.screenshot({ path: '/home/node/scripts/gemini-mode-debug.png' });
        eprint('[gemini-auto] debug screenshot saved');
      } catch (_) {}
    }
  }

  // stable send logic
  async function waitUntilIdle(timeoutMs) {
    const stopBtn = page.locator('button[aria-label*="停止"], button[aria-label*="Stop"]');
    await waitForCondition(async () => {
      const c = await stopBtn.count();
      if (c === 0) return true;
      try {
        const v = await stopBtn.first().isVisible();
        return !v;
      } catch (_) {
        return true;
      }
    }, { timeoutMs, intervalMs: 500, label: 'idle (stop button hidden)' });
  }

  async function waitForMarkdownIncrease(beforeCount, timeoutMs) {
    const mdLocator = page.locator('.markdown');
    await waitForCondition(async () => (await mdLocator.count()) > beforeCount, {
      timeoutMs, intervalMs: 500, label: 'markdown count increase',
    });
  }

  async function waitForAnswerStable(timeoutMs, stableWindowMs) {
    const mdLocator = page.locator('.markdown');
    const stopBtn = page.locator('button[aria-label*="停止"], button[aria-label*="Stop"]');

    const start = Date.now();
    let lastText = null;
    let lastChange = Date.now();

    while (true) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timeout waiting for answer to stabilize (${timeoutMs}ms)`);
      }

      const count = await mdLocator.count();
      if (count === 0) {
        await sleep(500);
        continue;
      }

      const current = await mdLocator.nth(count - 1).innerText().catch(() => '');
      if (lastText === null) {
        lastText = current;
        lastChange = Date.now();
      } else if (current !== lastText) {
        lastText = current;
        lastChange = Date.now();
      }

      const generating = await (async () => {
        const c = await stopBtn.count();
        if (c === 0) return false;
        try { return await stopBtn.first().isVisible(); } catch (_) { return false; }
      })();

      if (!generating && (Date.now() - lastChange) >= stableWindowMs) {
        return lastText || '';
      }

      await sleep(500);
    }
  }

  async function sendPromptAndGetAnswer(p) {
    const idx = p.index ?? '?';
    const textToSend = String(p.text ?? '').trim();
    if (!textToSend) {
      return { key: `result_p${idx}`, value: '(Skipped: empty prompt)' };
    }

    // if page died, rebuild & reopen gemini
    if (cdpUrl) await ensureLiveCDPPage();
    if (!page || (page.isClosed && page.isClosed())) {
      throw new Error('Page is closed before sending');
    }

    // wait for any ongoing generation to finish before sending (prevents "この回答を停止しました")
    eprint('[gemini-auto] waiting for idle before sending prompt', idx);
    await waitUntilIdle(globalTimeout);

    const mdLocator = page.locator('.markdown');
    const beforeCount = await mdLocator.count();
    eprint('[gemini-auto] markdown count before:', beforeCount);

    await page.waitForSelector('div[role="textbox"]', { timeout: globalTimeout });
    const textbox = page.locator('div[role="textbox"]').first();

    // Wait for textbox to be ready (empty and enabled)
    await waitForCondition(async () => {
      const text = await textbox.innerText().catch(() => '');
      const isEmpty = text.trim() === '' || text.trim() === '\n';
      return isEmpty;
    }, { timeoutMs: 30000, intervalMs: 500, label: 'textbox ready' }).catch(() => {
      eprint('[gemini-auto] textbox not empty, clearing...');
    });

    await textbox.click().catch(() => {});
    await page.waitForTimeout(300);
    await textbox.fill(textToSend);

    const sendButton = page.locator('button[aria-label="送信"], button[aria-label="Send message"]');
    if (await sendButton.count() > 0) {
      await sendButton.first().evaluate(el => el.click());
    } else {
      await page.keyboard.press('Enter');
    }

    eprint('[gemini-auto] prompt sent, waiting for response...');
    await waitForMarkdownIncrease(beforeCount, answerWait);
    eprint('[gemini-auto] markdown increased, waiting for generation to complete...');
    await waitUntilIdle(answerWait);

    // Wait for any loading indicators to disappear (YouTube video analysis, etc.)
    eprint('[gemini-auto] checking for loading indicators...');

    // Check for Gemini avatar spinner (YouTube loading)
    const avatarSpinner = page.locator('.avatar_spinner_animation');
    const spinnerCount = await avatarSpinner.count().catch(() => 0);
    if (spinnerCount > 0) {
      eprint('[gemini-auto] found avatar spinner, waiting for it to hide...');
      await waitForCondition(async () => {
        // Check if spinner is hidden (opacity: 0 or visibility: hidden)
        const isHidden = await avatarSpinner.first().evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.opacity === '0' || style.visibility === 'hidden';
        }).catch(() => true);
        return isHidden;
      }, { timeoutMs: 120000, intervalMs: 1000, label: 'avatar spinner hidden' }).catch(() => {
        eprint('[gemini-auto] avatar spinner wait timeout');
      });
      eprint('[gemini-auto] avatar spinner cleared');
    }

    // Also check for lottie animation completion
    const lottieAnim = page.locator('[data-test-lottie-animation-status]');
    const lottieCount = await lottieAnim.count().catch(() => 0);
    if (lottieCount > 0) {
      eprint('[gemini-auto] found lottie animation, waiting for completion...');
      await waitForCondition(async () => {
        const status = await lottieAnim.first().getAttribute('data-test-lottie-animation-status').catch(() => 'completed');
        return status === 'completed';
      }, { timeoutMs: 120000, intervalMs: 1000, label: 'lottie animation completed' }).catch(() => {
        eprint('[gemini-auto] lottie animation wait timeout');
      });
      eprint('[gemini-auto] lottie animation completed');
    }

    // Additional check for mat-spinner and other common loading indicators
    const loadingSelectors = [
      'mat-spinner',
      '.loading-spinner',
      '[role="progressbar"]',
      'mat-progress-spinner'
    ];
    for (const sel of loadingSelectors) {
      const spinner = page.locator(sel);
      const count = await spinner.count().catch(() => 0);
      if (count > 0) {
        eprint('[gemini-auto] found loading indicator:', sel, 'count:', count);
        await waitForCondition(async () => {
          const c = await spinner.count().catch(() => 0);
          const visible = c > 0 ? await spinner.first().isVisible().catch(() => false) : false;
          return !visible;
        }, { timeoutMs: 120000, intervalMs: 1000, label: 'loading indicator hidden' }).catch(() => {
          eprint('[gemini-auto] loading indicator wait timeout');
        });
        eprint('[gemini-auto] loading indicator cleared');
      }
    }

    eprint('[gemini-auto] waiting for answer to stabilize...');
    const answer = await waitForAnswerStable(answerWait, stabilizeMs);
    eprint('[gemini-auto] answer stabilized, length:', answer.length);

    // Additional wait to ensure UI is fully ready for next action
    await page.waitForTimeout(2000);

    return { key: `result_p${idx}`, value: answer || '(No response)' };
  }

  async function safeScreenshot() {
    if (!doScreenshot) return;
    try {
      await page.screenshot({ path: screenshotPath });
      eprint('[gemini-auto] screenshot saved:', screenshotPath);
    } catch (_) {}
  }

  async function deleteCurrentChat() {
    if (!deleteChat) return;
    eprint('[gemini-auto] deleting current chat...');
    try {
      // Click the conversation actions menu button
      const menuBtn = page.locator('button[data-test-id="actions-menu-button"], button.conversation-actions-menu-button');
      const menuBtnCount = await menuBtn.count();
      if (menuBtnCount === 0) {
        eprint('[gemini-auto] actions menu button not found, skipping delete');
        return;
      }
      await menuBtn.first().click();
      await page.waitForTimeout(500);

      // Click the delete button
      const deleteBtn = page.locator('button[data-test-id="delete-button"]');
      await waitForCondition(async () => {
        const c = await deleteBtn.count();
        return c > 0;
      }, { timeoutMs: 5000, intervalMs: 200, label: 'delete button visible' });

      const deleteBtnCount = await deleteBtn.count();
      if (deleteBtnCount === 0) {
        eprint('[gemini-auto] delete button not found, skipping delete');
        return;
      }
      await deleteBtn.first().click();
      await page.waitForTimeout(500);

      // Click the confirm button in the popup
      const confirmBtn = page.locator('button[data-test-id="confirm-button"]');
      await waitForCondition(async () => {
        const c = await confirmBtn.count();
        return c > 0;
      }, { timeoutMs: 5000, intervalMs: 200, label: 'confirm button visible' });

      const confirmBtnCount = await confirmBtn.count();
      if (confirmBtnCount > 0) {
        await confirmBtn.first().click();
        await page.waitForTimeout(1000);
        eprint('[gemini-auto] chat deleted successfully');
      } else {
        eprint('[gemini-auto] confirm button not found, chat may not be deleted');
      }
    } catch (e) {
      eprint('[gemini-auto] failed to delete chat:', e.message);
    }
  }

  async function closeResources({ cdpMode }) {
    // Always close the page we created (safe)
    try {
      if (page && !(page.isClosed && page.isClosed())) await page.close().catch(() => {});
    } catch (_) {}

    if (cdpMode) {
      // IMPORTANT: DO NOT close browser in CDP mode (Veo3思想)
      // If we created an incognito context, we may close it safely.
      if (cdpCreatedContext && context) {
        try { await context.close().catch(() => {}); } catch (_) {}
      }
      // do not browser.close()
      return;
    }

    // non-CDP: close persistent context
    try {
      if (context) await context.close().catch(() => {});
    } catch (_) {}
  }

  const results = {};
  try {
    if (cdpUrl) {
      await connectOrReconnectCDP();
    } else {
      if (!fs.existsSync(cookiePath)) {
        process.stdout.write(JSON.stringify({ error: 'Cookie file not found', cookiePath }) + '\n');
        process.exit(1);
      }
      await ensureDir(userDataDir);

      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      eprint('[gemini-auto] cookies:', Array.isArray(cookies) ? cookies.length : 'not-array');

      const execPath = chromium.executablePath();
      eprint('[gemini-auto] executablePath:', execPath);

      context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        executablePath: execPath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      });

      if (Array.isArray(cookies) && cookies.length > 0) {
        await context.addCookies(cookies);
      }

      page = context.pages()[0] || await context.newPage();
    }

    eprint('[gemini-auto] goto:', gotoUrl);
    await openGeminiAndValidate();

    // Switch to target mode if specified
    if (!noModeSwitch && targetMode) {
      await ensureMode(targetMode);
    }

    for (const p of prompts) {
      const idx = p.index ?? '?';
      eprint('[gemini-auto] prompt', idx);

      // Per-prompt mode switch (if specified)
      if (p.mode && !noModeSwitch) {
        eprint('[gemini-auto] switching mode for prompt', idx, 'to', p.mode);
        await ensureMode(p.mode);
      }

      // prompt単位で「target closed」時のみ1回リトライ
      let attempt = 0;
      while (true) {
        attempt += 1;
        try {
          const { key, value } = await sendPromptAndGetAnswer(p);
          results[key] = value;
          eprint('[gemini-auto] got answer for', idx, 'len=', (value || '').length);
          break;
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          eprint('[gemini-auto] prompt error', idx, 'attempt', attempt, msg);

          if (attempt >= 2 || !isTargetClosedError(e)) {
            results[`result_p${idx}`] = `(Error: ${msg})`;
            break;
          }

          // target closed → rebuild and retry
          try { await closeResources({ cdpMode: false }); } catch (_) {}
          // CDP mode: reconnect + reopen gemini
          if (cdpUrl) {
            try { await ensureLiveCDPPage(); } catch (_) {}
            try {
              // recreate from scratch
              await connectOrReconnectCDP();
              await openGeminiAndValidate();
            } catch (re) {
              // if even reconnect fails, stop retry
              const remsg = String(re && re.message ? re.message : re);
              results[`result_p${idx}`] = `(Error: ${remsg})`;
              break;
            }
          } else {
            // non-CDP: re-launch context would be needed; treat as fatal
            results[`result_p${idx}`] = `(Error: ${msg})`;
            break;
          }
        }
      }

      await sleep(800);
    }

    await safeScreenshot();
    await deleteCurrentChat(); // Delete chat only on success (keep for debugging on error)
    await closeResources({ cdpMode: !!cdpUrl });

    // stdout: JSON only
    process.stdout.write(JSON.stringify(results) + '\n');
    process.exit(0);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    eprint('[gemini-auto] fatal:', msg);

    await safeScreenshot();
    await closeResources({ cdpMode: !!cdpUrl });

    process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    process.exit(1);
  }
}

run().catch(e => {
  const msg = String(e && e.message ? e.message : e);
  console.error(`[${nowIso()}] [gemini-auto] uncaught:`, msg);
  process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  process.exit(1);
});
