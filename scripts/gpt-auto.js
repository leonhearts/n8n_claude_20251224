/**
 * gpt-auto.js - ChatGPT Browser Automation Script
 *
 * Usage:
 *   node gpt-auto.js /path/to/input.json --file --cdp=http://192.168.65.254:9222
 *   node gpt-auto.js '{"prompts":[{"index":1,"text":"..."}]}'
 *
 * Input format:
 *   { "prompts": [{ "index": 1, "text": "prompt text" }] }
 *
 * Output format:
 *   { "result_p1": "response text", "result_p2": "..." }
 */

const { chromium } = require('playwright');
const fs = require('fs');

const LOG_PREFIX = '[gpt-auto]';

function log(msg) {
  console.error(`[${new Date().toISOString()}] ${LOG_PREFIX} ${msg}`);
}

async function run() {
  let prompts = [];
  let cdpUrl = 'http://192.168.65.254:9222';
  let useFile = false;
  let inputPath = '';

  // Parse arguments
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--file') {
      useFile = true;
    } else if (arg.startsWith('--cdp=')) {
      cdpUrl = arg.substring(6);
    } else if (!arg.startsWith('--')) {
      inputPath = arg;
    }
  }

  // Load prompts
  if (useFile && inputPath) {
    // File mode: read JSON from file path
    log(`Reading from file: ${inputPath}`);
    const data = fs.readFileSync(inputPath, 'utf8');
    prompts = JSON.parse(data).prompts || [];
  } else if (inputPath) {
    // Direct JSON argument
    try {
      prompts = JSON.parse(inputPath).prompts || [];
    } catch (e) {
      // Try as file path
      if (fs.existsSync(inputPath)) {
        const data = fs.readFileSync(inputPath, 'utf8');
        prompts = JSON.parse(data).prompts || [];
      } else {
        console.log(JSON.stringify({ error: 'Invalid JSON or file not found' }));
        process.exit(1);
      }
    }
  } else if (fs.existsSync('/tmp/input.json')) {
    // Fallback: read from default file
    log('Reading from /tmp/input.json');
    const data = fs.readFileSync('/tmp/input.json', 'utf8');
    prompts = JSON.parse(data).prompts || [];
  } else {
    console.log(JSON.stringify({ error: 'No input provided' }));
    process.exit(1);
  }

  log(`Loaded ${prompts.length} prompt(s)`);
  log(`Connecting to Chrome at ${cdpUrl}...`);

  const browser = await chromium.connectOverCDP(cdpUrl);
  log('Connected');

  const context = browser.contexts()[0];
  const page = context.pages()[0];

  log('Navigating to ChatGPT...');
  await page.goto('https://chatgpt.com/');
  await page.waitForTimeout(3000);

  const results = {};

  for (const p of prompts) {
    log(`=== Processing Prompt ${p.index} ===`);
    try {
      // Wait for input textarea
      await page.waitForSelector('#prompt-textarea', { timeout: 30000 });
      log('Found input textarea');

      // Clear and focus the input
      await page.click('#prompt-textarea');
      await page.waitForTimeout(500);

      // ProseMirror uses contenteditable, so we need to type character by character
      // First clear any existing content
      await page.evaluate(() => {
        const el = document.querySelector('#prompt-textarea');
        if (el) {
          el.innerHTML = '<p><br class="ProseMirror-trailingBreak"></p>';
        }
      });
      await page.waitForTimeout(300);

      // Type the prompt
      await page.click('#prompt-textarea');
      await page.keyboard.type(p.text, { delay: 5 });
      await page.waitForTimeout(1000);

      log('Entered prompt text');

      // Wait for submit button to appear and click it
      await page.waitForSelector('#composer-submit-button', { timeout: 10000 });
      await page.click('#composer-submit-button');
      log('Clicked submit button');

      // Wait for response
      const maxWait = 300000; // 5 minutes max
      const checkInterval = 5000;
      let elapsed = 0;
      let lastText = '';
      let stableCount = 0;

      // Initial wait for response to start
      await page.waitForTimeout(10000);
      elapsed = 10000;

      while (elapsed < maxWait) {
        await page.waitForTimeout(checkInterval);
        elapsed += checkInterval;

        let currentText = '';
        try {
          // Get the latest assistant message
          const responses = await page.locator('[data-message-author-role="assistant"]').all();
          if (responses.length > 0) {
            const lastResponse = responses[responses.length - 1];
            currentText = await Promise.race([
              lastResponse.innerText(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
            ]);
          }
        } catch (e) {
          log(`Error reading response: ${e.message}`);
        }

        log(`${(elapsed / 1000)}s, response length: ${currentText.length}`);

        // Check if response has stabilized
        if (currentText.length > 0 && currentText === lastText) {
          stableCount++;
          if (stableCount >= 2) {
            log('Response stabilized');
            break;
          }
        } else {
          stableCount = 0;
        }
        lastText = currentText;

        // Also check if streaming indicator is gone
        const isStreaming = await page.$('[data-testid="stop-button"]');
        if (!isStreaming && currentText.length > 0 && stableCount >= 1) {
          log('Streaming complete');
          break;
        }
      }

      // Final wait and capture
      await page.waitForTimeout(2000);

      let responseText = '(No response captured)';
      try {
        const responses = await page.locator('[data-message-author-role="assistant"]').all();
        if (responses.length > 0) {
          responseText = await Promise.race([
            responses[responses.length - 1].innerText(),
            new Promise(r => setTimeout(() => r('(timeout reading response)'), 15000))
          ]);
        }
      } catch (e) {
        responseText = `(Error: ${e.message})`;
      }

      results['result_p' + p.index] = responseText;
      log(`Captured response for prompt ${p.index}: ${responseText.length} chars`);

    } catch (e) {
      log(`Error: ${e.message}`);
      results['result_p' + p.index] = `(Error: ${e.message})`;
    }

    // Wait between prompts
    await page.waitForTimeout(2000);
  }

  // Take screenshot for debugging
  await page.screenshot({ path: '/home/node/scripts/gpt-auto-result.png' });
  log('Screenshot saved');

  await browser.close();
  console.log(JSON.stringify(results));
  process.exit(0);
}

run().catch(e => {
  log(`Fatal error: ${e.message}`);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
