/**
 * gpt-auto.js (FULL / CDP-stable)
 * Based on gemini-auto.js pattern
 *
 * Usage (CDP / recommended):
 *   node /home/node/scripts/gpt-auto.js /tmp/gpt_input.json --file --cdp=http://192.168.65.254:9222
 *
 * Usage (Cookie + persistent profile):
 *   node /home/node/scripts/gpt-auto.js /tmp/gpt_input.json --file
 *
 * Flags:
 *   --file                 inputArg is a file path containing JSON
 *   --base64               inputArg is base64 JSON
 *   --cdp=URL              connectOverCDP URL
 *   --cookies=PATH         cookie json path (default: /home/node/scripts/gpt-cookies.json)
 *   --profile=DIR          persistent profile dir (default: /home/node/scripts/gpt-browser-profile)
 *   --headful              (non-CDP only) run headful
 *   --goto=URL             chatgpt url (default: https://chatgpt.com/)
 *   --timeout=MS           global timeout for waits (default: 180000)
 *   --answerWait=MS        answer wait timeout (default: 300000)
 *   --stabilize=MS         answer stabilize window (default: 6000)
 *   --screenshot=PATH      screenshot path (default: /home/node/scripts/gpt-auto-result.png)
 *   --noScreenshot         disable screenshot
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
  return prompts.map((p, i) => ({
    index: (p && p.index != null) ? p.index : (i + 1),
    text: (p && p.text != null) ? String(p.text) : '',
  }));
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
  eprint('[gpt-auto] start');

  const input = readInputFromArgs();
  if (input.error) {
    process.stdout.write(JSON.stringify({ error: input.error, message: input.message, filePath: input.filePath }) + '\n');
    process.exit(1);
  }

  const prompts = input.prompts;
  const { flags, kv } = input;

  const cookiePath = kv.cookies || '/home/node/scripts/gpt-cookies.json';
  const userDataDir = kv.profile || '/home/node/scripts/gpt-browser-profile';
  const gotoUrl = kv.goto || 'https://chatgpt.com/';

  const globalTimeout = toInt(kv.timeout, 180000);
  const answerWait = toInt(kv.answerWait, 300000);
  const stabilizeMs = toInt(kv.stabilize, 6000);

  const screenshotPath = kv.screenshot || '/home/node/scripts/gpt-auto-result.png';
  const doScreenshot = !flags.has('--noScreenshot');

  const cdpUrl = kv.cdp || null;
  const headless = !flags.has('--headful');

  eprint('[gpt-auto] prompts:', prompts.length);
  if (cdpUrl) eprint('[gpt-auto] mode: CDP connect', cdpUrl);
  else eprint('[gpt-auto] mode: cookie/profile');

  let browser = null;
  let context = null;
  let page = null;
  let cdpCreatedContext = false;
  let cdpConnected = false;

  async function connectOrReconnectCDP() {
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

    page = await context.newPage();
  }

  async function ensureLiveCDPPage() {
    if (!cdpUrl) return;

    const disconnected =
      !browser ||
      (typeof browser.isConnected === 'function' && !browser.isConnected());

    if (disconnected) {
      eprint('[gpt-auto] CDP reconnect (browser disconnected)');
      await connectOrReconnectCDP();
      return;
    }

    if (page && page.isClosed && page.isClosed()) {
      eprint('[gpt-auto] recreate page (was closed)');
      page = await context.newPage();
    }

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

        eprint('[gpt-auto] goto retry', i, String(e.message || e));

        try { if (page && !page.isClosed()) await page.close().catch(() => {}); } catch (_) {}
        page = null;

        if (cdpUrl) {
          try {
            await connectOrReconnectCDP();
          } catch (_) {}
        }

        await sleep(300);
      }
    }
    throw new Error(`goto failed after retries: ${String(lastErr && lastErr.message ? lastErr.message : lastErr)}`);
  }

  async function checkLoggedIn() {
    const url = page.url();
    eprint('[gpt-auto] url:', url);

    // Check if we're on login page or if prompt textarea exists
    const isLoginPage = url.includes('auth0') || url.includes('login') || url.includes('auth/');
    const hasPromptTextarea = await page.$('#prompt-textarea');

    const loggedIn = !isLoginPage && hasPromptTextarea;
    eprint('[gpt-auto] loggedIn:', loggedIn);
    return loggedIn;
  }

  async function openChatGPTAndValidate() {
    await gotoWithRetry(gotoUrl, 3);
    await page.waitForTimeout(3000);

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

  // Check if ChatGPT is still generating (stop button visible)
  async function waitUntilIdle(timeoutMs) {
    const stopBtn = page.locator('[data-testid="stop-button"]');
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

  async function waitForAssistantMessageIncrease(beforeCount, timeoutMs) {
    const msgLocator = page.locator('[data-message-author-role="assistant"]');
    await waitForCondition(async () => (await msgLocator.count()) > beforeCount, {
      timeoutMs, intervalMs: 500, label: 'assistant message count increase',
    });
  }

  async function waitForAnswerStable(timeoutMs, stableWindowMs) {
    const msgLocator = page.locator('[data-message-author-role="assistant"]');
    const stopBtn = page.locator('[data-testid="stop-button"]');

    const start = Date.now();
    let lastText = null;
    let lastChange = Date.now();

    while (true) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timeout waiting for answer to stabilize (${timeoutMs}ms)`);
      }

      const count = await msgLocator.count();
      if (count === 0) {
        await sleep(500);
        continue;
      }

      const current = await msgLocator.nth(count - 1).innerText().catch(() => '');
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

    if (cdpUrl) await ensureLiveCDPPage();
    if (!page || (page.isClosed && page.isClosed())) {
      throw new Error('Page is closed before sending');
    }

    await waitUntilIdle(globalTimeout);

    const msgLocator = page.locator('[data-message-author-role="assistant"]');
    const beforeCount = await msgLocator.count();

    // Wait for and click the textarea
    await page.waitForSelector('#prompt-textarea', { timeout: globalTimeout });
    const textbox = page.locator('#prompt-textarea').first();
    await textbox.click().catch(() => {});

    // Type the prompt (ProseMirror contenteditable)
    await page.keyboard.type(textToSend, { delay: 5 });
    await page.waitForTimeout(500);

    // Click send button
    const sendButton = page.locator('#composer-submit-button');
    if (await sendButton.count() > 0) {
      await sendButton.first().click();
    } else {
      // Fallback: press Enter
      await page.keyboard.press('Enter');
    }

    await waitForAssistantMessageIncrease(beforeCount, answerWait);
    await waitUntilIdle(answerWait);
    const answer = await waitForAnswerStable(answerWait, stabilizeMs);

    return { key: `result_p${idx}`, value: answer || '(No response)' };
  }

  async function safeScreenshot() {
    if (!doScreenshot) return;
    try {
      await page.screenshot({ path: screenshotPath });
      eprint('[gpt-auto] screenshot saved:', screenshotPath);
    } catch (_) {}
  }

  async function closeResources({ cdpMode }) {
    try {
      if (page && !(page.isClosed && page.isClosed())) await page.close().catch(() => {});
    } catch (_) {}

    if (cdpMode) {
      if (cdpCreatedContext && context) {
        try { await context.close().catch(() => {}); } catch (_) {}
      }
      return;
    }

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
      eprint('[gpt-auto] cookies:', Array.isArray(cookies) ? cookies.length : 'not-array');

      const execPath = chromium.executablePath();
      eprint('[gpt-auto] executablePath:', execPath);

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

    eprint('[gpt-auto] goto:', gotoUrl);
    await openChatGPTAndValidate();

    for (const p of prompts) {
      const idx = p.index ?? '?';
      eprint('[gpt-auto] prompt', idx);

      let attempt = 0;
      while (true) {
        attempt += 1;
        try {
          const { key, value } = await sendPromptAndGetAnswer(p);
          results[key] = value;
          eprint('[gpt-auto] got answer for', idx, 'len=', (value || '').length);
          break;
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          eprint('[gpt-auto] prompt error', idx, 'attempt', attempt, msg);

          if (attempt >= 2 || !isTargetClosedError(e)) {
            results[`result_p${idx}`] = `(Error: ${msg})`;
            break;
          }

          try { await closeResources({ cdpMode: false }); } catch (_) {}
          if (cdpUrl) {
            try { await ensureLiveCDPPage(); } catch (_) {}
            try {
              await connectOrReconnectCDP();
              await openChatGPTAndValidate();
            } catch (re) {
              const remsg = String(re && re.message ? re.message : re);
              results[`result_p${idx}`] = `(Error: ${remsg})`;
              break;
            }
          } else {
            results[`result_p${idx}`] = `(Error: ${msg})`;
            break;
          }
        }
      }

      await sleep(800);
    }

    await safeScreenshot();
    await closeResources({ cdpMode: !!cdpUrl });

    process.stdout.write(JSON.stringify(results) + '\n');
    process.exit(0);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    eprint('[gpt-auto] fatal:', msg);

    await safeScreenshot();
    await closeResources({ cdpMode: !!cdpUrl });

    process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    process.exit(1);
  }
}

run().catch(e => {
  const msg = String(e && e.message ? e.message : e);
  console.error(`[${nowIso()}] [gpt-auto] uncaught:`, msg);
  process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  process.exit(1);
});
