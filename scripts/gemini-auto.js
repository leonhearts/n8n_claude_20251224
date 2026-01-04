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
 *   --stabilize=MS         answer stabilize window (default: 6000)
 *   --screenshot=PATH      screenshot path (default: /home/node/scripts/gemini-auto-result.png)
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
  const stabilizeMs = toInt(kv.stabilize, 6000);

  const screenshotPath = kv.screenshot || '/home/node/scripts/gemini-auto-result.png';
  const doScreenshot = !flags.has('--noScreenshot');

  const cdpUrl = kv.cdp || null;
  const headless = !flags.has('--headful'); // only non-CDP

  eprint('[gemini-auto] prompts:', prompts.length);
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
    await waitUntilIdle(globalTimeout);

    const mdLocator = page.locator('.markdown');
    const beforeCount = await mdLocator.count();

    await page.waitForSelector('div[role="textbox"]', { timeout: globalTimeout });
    const textbox = page.locator('div[role="textbox"]').first();
    await textbox.click().catch(() => {});
    await textbox.fill(textToSend);

    const sendButton = page.locator('button[aria-label="送信"], button[aria-label="Send message"]');
    if (await sendButton.count() > 0) {
      await sendButton.first().evaluate(el => el.click());
    } else {
      await page.keyboard.press('Enter');
    }

    await waitForMarkdownIncrease(beforeCount, answerWait);
    await waitUntilIdle(answerWait);
    const answer = await waitForAnswerStable(answerWait, stabilizeMs);

    return { key: `result_p${idx}`, value: answer || '(No response)' };
  }

  async function safeScreenshot() {
    if (!doScreenshot) return;
    try {
      await page.screenshot({ path: screenshotPath });
      eprint('[gemini-auto] screenshot saved:', screenshotPath);
    } catch (_) {}
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

    for (const p of prompts) {
      const idx = p.index ?? '?';
      eprint('[gemini-auto] prompt', idx);

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
