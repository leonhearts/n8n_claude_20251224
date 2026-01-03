/**
 * gpt-auto.js - ChatGPT Browser Automation Script
 * Uses launchPersistentContext with cookies (same as gemini-auto.js)
 *
 * Usage:
 *   node gpt-auto.js /path/to/input.json --file
 *
 * Input format:
 *   { "prompts": [{ "index": 1, "text": "prompt text" }] }
 *
 * Output format:
 *   { "result_p1": "response text", "result_p2": "..." }
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[gpt-auto]';
const COOKIES_PATH = '/home/node/gpt-cookies.json';
const USER_DATA_DIR = '/home/node/gpt-profile';

function log(msg) {
  console.error(`[${new Date().toISOString()}] ${LOG_PREFIX} ${msg}`);
}

async function run() {
  log('start');

  let prompts = [];
  let useFile = false;
  let inputPath = '';

  // Parse arguments
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--file') {
      useFile = true;
    } else if (!arg.startsWith('--')) {
      inputPath = arg;
    }
  }

  // Load prompts
  if (useFile && inputPath) {
    log(`Reading from file: ${inputPath}`);
    const data = fs.readFileSync(inputPath, 'utf8');
    prompts = JSON.parse(data).prompts || [];
  } else if (inputPath) {
    try {
      prompts = JSON.parse(inputPath).prompts || [];
    } catch (e) {
      if (fs.existsSync(inputPath)) {
        const data = fs.readFileSync(inputPath, 'utf8');
        prompts = JSON.parse(data).prompts || [];
      } else {
        console.log(JSON.stringify({ error: 'Invalid JSON or file not found' }));
        process.exit(1);
      }
    }
  } else if (fs.existsSync('/tmp/input.json')) {
    log('Reading from /tmp/input.json');
    const data = fs.readFileSync('/tmp/input.json', 'utf8');
    prompts = JSON.parse(data).prompts || [];
  } else {
    console.log(JSON.stringify({ error: 'No input provided' }));
    process.exit(1);
  }

  log(`prompts: ${prompts.length}`);

  // Load cookies if available
  let cookies = [];
  if (fs.existsSync(COOKIES_PATH)) {
    cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    log(`cookies: ${cookies.length}`);
  } else {
    log('no cookies file found, will need to login manually first');
  }

  // Find Playwright's Chrome executable
  const homeDir = process.env.HOME || '/home/node';
  const cacheDir = path.join(homeDir, '.cache', 'ms-playwright');
  let executablePath = null;

  if (fs.existsSync(cacheDir)) {
    const dirs = fs.readdirSync(cacheDir).filter(d => d.startsWith('chromium'));
    if (dirs.length > 0) {
      const chromiumDir = path.join(cacheDir, dirs[dirs.length - 1]);
      const possiblePaths = [
        path.join(chromiumDir, 'chrome-linux64', 'chrome'),
        path.join(chromiumDir, 'chrome-linux', 'chrome'),
        path.join(chromiumDir, 'chrome')
      ];
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          executablePath = p;
          break;
        }
      }
    }
  }

  log(`mode: launchPersistentContext (cookie/profile)`);
  log(`executablePath: ${executablePath || 'default'}`);

  // Ensure user data directory exists
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  // Launch browser with persistent context
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ],
    viewport: { width: 1280, height: 800 }
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);

  const page = context.pages()[0] || await context.newPage();

  // Add cookies if available
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }

  log('goto: https://chatgpt.com/');
  await page.goto('https://chatgpt.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  log(`url: ${page.url()}`);

  // Check if logged in
  const isLoggedIn = await page.$('#prompt-textarea');
  log(`loggedIn: ${!!isLoggedIn}`);

  if (!isLoggedIn) {
    // Save screenshot for debugging
    await page.screenshot({ path: '/home/node/scripts/gpt-auto-result.png' });
    await context.close();
    console.log(JSON.stringify({ error: 'Not logged in to ChatGPT. Please login and save cookies.' }));
    process.exit(1);
  }

  const results = {};

  for (const p of prompts) {
    log(`prompt ${p.index}`);
    try {
      // Wait for input textarea
      await page.waitForSelector('#prompt-textarea', { timeout: 30000 });

      // Click and focus
      await page.click('#prompt-textarea');
      await page.waitForTimeout(500);

      // Type the prompt (ProseMirror contenteditable)
      await page.keyboard.type(p.text, { delay: 10 });
      await page.waitForTimeout(1000);

      // Wait for submit button and click
      await page.waitForSelector('#composer-submit-button', { timeout: 10000 });
      await page.click('#composer-submit-button');
      log('sent');

      // Wait for response
      const maxWait = 300000; // 5 minutes
      const checkInterval = 5000;
      let elapsed = 0;
      let lastText = '';
      let stableCount = 0;

      await page.waitForTimeout(10000);
      elapsed = 10000;

      while (elapsed < maxWait) {
        await page.waitForTimeout(checkInterval);
        elapsed += checkInterval;

        let currentText = '';
        try {
          const responses = await page.locator('[data-message-author-role="assistant"]').all();
          if (responses.length > 0) {
            currentText = await Promise.race([
              responses[responses.length - 1].innerText(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
            ]);
          }
        } catch (e) {}

        log(`${(elapsed / 1000)}s, len=${currentText.length}`);

        if (currentText.length > 0 && currentText === lastText) {
          stableCount++;
          if (stableCount >= 2) break;
        } else {
          stableCount = 0;
        }
        lastText = currentText;

        // Check if streaming is done
        const stopBtn = await page.$('[data-testid="stop-button"]');
        if (!stopBtn && currentText.length > 0 && stableCount >= 1) {
          break;
        }
      }

      await page.waitForTimeout(2000);

      // Capture final response
      let responseText = '(No response)';
      try {
        const responses = await page.locator('[data-message-author-role="assistant"]').all();
        if (responses.length > 0) {
          responseText = await Promise.race([
            responses[responses.length - 1].innerText(),
            new Promise(r => setTimeout(() => r('(timeout)'), 15000))
          ]);
        }
      } catch (e) {
        responseText = `(Error: ${e.message})`;
      }

      log(`got answer for ${p.index} len= ${responseText.length}`);
      results['result_p' + p.index] = responseText;

    } catch (e) {
      log(`error: ${e.message}`);
      results['result_p' + p.index] = `(Error: ${e.message})`;
    }

    await page.waitForTimeout(2000);
  }

  // Save cookies for future use
  const currentCookies = await context.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(currentCookies, null, 2));
  log('cookies saved');

  // Screenshot
  await page.screenshot({ path: '/home/node/scripts/gpt-auto-result.png' });
  log('screenshot saved: /home/node/scripts/gpt-auto-result.png');

  await context.close();
  console.log(JSON.stringify(results));
  process.exit(0);
}

run().catch(e => {
  log(`Fatal error: ${e.message}`);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
