const { chromium } = require('playwright');

async function run() {
  const inputArg = process.argv[2];
  let prompts = [];
  if (inputArg) {
    try {
      prompts = JSON.parse(inputArg).prompts || [];
    } catch (e) {
      console.log(JSON.stringify({ error: 'Invalid JSON' }));
      process.exit(1);
    }
  }

  const browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  await page.goto('https://gemini.google.com/app');
  await page.waitForTimeout(3000);

  const results = {};

  for (const p of prompts) {
    console.error('--- Prompt ' + p.index + ' ---');
    try {
      await page.waitForSelector('div[role="textbox"]', { timeout: 15000 });
      await page.click('div[role="textbox"]');
      await page.fill('div[role="textbox"]', p.text);
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');

      const maxWait = 240000;
      const checkInterval = 3000;
      let elapsed = 0;

      // ローディング終了を待つ
      while (elapsed < maxWait) {
        await page.waitForTimeout(checkInterval);
        elapsed += checkInterval;

        // 送信ボタンが再度有効になったら応答完了
        const sendBtn = await page.$('button[aria-label="送信"]:not([disabled]), button[aria-label="Send message"]:not([disabled])');
        if (sendBtn) {
          console.error('Response complete at ' + (elapsed/1000) + 's');
          break;
        }
      }

      // 少し待ってからテキスト取得
      await page.waitForTimeout(2000);

      let text = '(Response captured)';
      try {
        const responses = await page.locator('.markdown').all();
        if (responses.length > 0) {
          text = await Promise.race([
            responses[responses.length - 1].innerText(),
            new Promise(r => setTimeout(() => r('(Response captured)'), 5000))
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
  console.log(JSON.stringify(results));
}

run().catch(e => {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
