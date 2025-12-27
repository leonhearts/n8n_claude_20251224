const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
  let prompts = [];

  // 引数から読み込み（n8nから呼ばれる場合）
  if (process.argv[2]) {
    try {
      prompts = JSON.parse(process.argv[2]).prompts || [];
      console.error('[DEBUG] Loaded from arg: ' + prompts.length + ' prompts');
    } catch (e) {
      // テスト用ファイルから読み込み
      if (fs.existsSync('/tmp/input.json')) {
        const data = fs.readFileSync('/tmp/input.json', 'utf8');
        prompts = JSON.parse(data).prompts || [];
        console.error('[DEBUG] Loaded from file: ' + prompts.length + ' prompts');
      } else {
        console.log(JSON.stringify({ error: 'Invalid JSON' }));
        process.exit(1);
      }
    }
  } else if (fs.existsSync('/tmp/input.json')) {
    const data = fs.readFileSync('/tmp/input.json', 'utf8');
    prompts = JSON.parse(data).prompts || [];
    console.error('[DEBUG] Loaded from file: ' + prompts.length + ' prompts');
  }

  console.error('[DEBUG] Connecting to Chrome...');
  const browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
  console.error('[DEBUG] Connected');

  const context = browser.contexts()[0];
  const page = context.pages()[0];

  console.error('[DEBUG] Navigating to Gemini...');
  await page.goto('https://gemini.google.com/app');
  await page.waitForTimeout(3000);

  const results = {};

  for (const p of prompts) {
    console.error('=== Prompt ' + p.index + ' ===');
    try {
      await page.waitForSelector('div[role="textbox"]', { timeout: 15000 });
      await page.click('div[role="textbox"]');
      await page.fill('div[role="textbox"]', p.text);
      await page.waitForTimeout(1000);

      const sendBtn = await page.$('[class*="send-button"]');
      if (sendBtn) {
        await sendBtn.click();
        console.error('[DEBUG] Sent');
      } else {
        await page.keyboard.press('Enter');
      }

      const maxWait = 240000;
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
          const responses = await page.locator('.markdown').all();
          if (responses.length > 0) {
            currentText = await Promise.race([
              responses[responses.length - 1].innerText(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
            ]);
          }
        } catch (e) {}

        console.error('[DEBUG] ' + (elapsed/1000) + 's, len=' + currentText.length);

        if (currentText.length > 0 && currentText === lastText) {
          stableCount++;
          if (stableCount >= 2) break;
        } else {
          stableCount = 0;
        }
        lastText = currentText;
      }

      await page.waitForTimeout(2000);

      let text = '(Response captured)';
      try {
        const responses = await page.locator('.markdown').all();
        if (responses.length > 0) {
          text = await Promise.race([
            responses[responses.length - 1].innerText(),
            new Promise(r => setTimeout(() => r('(timeout)'), 10000))
          ]);
        }
      } catch (e) {}
      results['result_p' + p.index] = text;
    } catch (e) {
      results['result_p' + p.index] = '(Error: ' + e.message + ')';
    }
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: '/home/node/scripts/gemini-auto-result.png' });
  await browser.close();
  console.log(JSON.stringify(results));
  process.exit(0);
}

run().catch(e => {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
