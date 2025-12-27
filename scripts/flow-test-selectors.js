/**
 * Google Flow セレクタ検証テストスクリプト
 *
 * 使用方法:
 * node flow-test-selectors.js
 *
 * このスクリプトは動画生成を行わず、セレクタが正しく機能するかのみを確認します。
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// セレクタ定義（flow-video-auto.jsと同じ）
const SELECTORS = {
  promptInput: '#PINHOLE_TEXT_AREA_ELEMENT_ID',
  createButton: [
    'button[aria-label="作成"]',
    'button:has(i:text("arrow_forward"))',
    'button.sc-408537d4-2',
  ],
  settingsButton: [
    'button[aria-label*="設定"]',
    'button:has(i:text("tune"))',
  ],
  modelDisplay: [
    'button:has-text("Veo 3")',
    '.sc-4d92f943-4',
  ],
  textToVideoMode: [
    'button[role="combobox"]:has-text("テキストから動画")',
    'button:has(span:text("テキストから動画"))',
  ],
  notificationDrawer: '[role="region"][aria-label*="通知ドロワー"]',
  notificationItem: '[data-radix-collection-item]',
};

async function testSelector(page, selectors, name) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  const results = [];

  for (const selector of selectorList) {
    try {
      const element = await page.$(selector);
      if (element) {
        const isVisible = await element.isVisible();
        const text = await element.innerText().catch(() => '');
        results.push({
          selector,
          found: true,
          visible: isVisible,
          text: text.substring(0, 50),
        });
      } else {
        results.push({ selector, found: false });
      }
    } catch (e) {
      results.push({ selector, found: false, error: e.message });
    }
  }

  return { name, results };
}

async function run() {
  console.log('=== Google Flow Selector Test ===\n');

  let browser;
  let page;

  try {
    // Chrome CDPに接続
    console.log('Connecting to Chrome CDP...');
    browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
    const context = browser.contexts()[0];

    // 新しいタブを開く
    page = await context.newPage();

    // Google Flowにアクセス
    console.log('Navigating to Google Flow...');
    await page.goto('https://labs.google/fx/tools/flow', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(5000);

    // ログイン確認
    const url = page.url();
    console.log('Current URL: ' + url);

    if (url.includes('accounts.google.com')) {
      console.log('\n❌ ERROR: Not logged in to Google');
      await page.close();
      process.exit(1);
    }

    // TOPページの場合、「新しいプロジェクト」をクリック
    console.log('Checking for New Project button...');
    const newProjectSelectors = [
      'button:has-text("新しいプロジェクト")',
      'button:has(i:text("add_2"))',
      'button:has-text("New project")',
    ];

    for (const selector of newProjectSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn && await btn.isVisible()) {
          console.log('Found New Project button, clicking...');
          await btn.click();
          await page.waitForTimeout(5000);
          console.log('Project page loaded');
          break;
        }
      } catch (e) {
        // continue
      }
    }

    console.log('\n--- Testing Selectors ---\n');

    // 各セレクタをテスト
    const tests = [
      { selectors: SELECTORS.promptInput, name: 'Prompt Input' },
      { selectors: SELECTORS.createButton, name: 'Create Button' },
      { selectors: SELECTORS.settingsButton, name: 'Settings Button' },
      { selectors: SELECTORS.modelDisplay, name: 'Model Display' },
      { selectors: SELECTORS.textToVideoMode, name: 'Text to Video Mode' },
      { selectors: SELECTORS.notificationDrawer, name: 'Notification Drawer' },
      { selectors: SELECTORS.notificationItem, name: 'Notification Items' },
    ];

    const allResults = [];

    for (const test of tests) {
      const result = await testSelector(page, test.selectors, test.name);
      allResults.push(result);

      const found = result.results.some(r => r.found && r.visible);
      const status = found ? '✅' : '❌';

      console.log(`${status} ${test.name}:`);
      for (const r of result.results) {
        if (r.found) {
          console.log(`   ✓ ${r.selector}`);
          console.log(`     visible: ${r.visible}, text: "${r.text}"`);
        } else {
          console.log(`   ✗ ${r.selector}`);
        }
      }
      console.log('');
    }

    // スクリーンショット保存
    const screenshotPath = '/tmp/flow-selector-test.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('Screenshot saved: ' + screenshotPath);

    // HTML保存（デバッグ用）
    const html = await page.content();
    const htmlPath = '/tmp/flow-page-structure.html';
    fs.writeFileSync(htmlPath, html);
    console.log('HTML saved: ' + htmlPath);

    // サマリー
    console.log('\n--- Summary ---');
    const passedCount = allResults.filter(r => r.results.some(x => x.found && x.visible)).length;
    console.log(`Passed: ${passedCount}/${allResults.length}`);

    if (passedCount === allResults.length) {
      console.log('\n✅ All selectors working correctly!');
    } else {
      console.log('\n⚠️  Some selectors need adjustment. Check the HTML file for details.');
    }

    await page.close();

  } catch (e) {
    console.error('\n❌ Error: ' + e.message);

    if (page) {
      try {
        await page.screenshot({ path: '/tmp/flow-test-error.png' });
      } catch (screenshotError) {
        // ignore
      }
      await page.close();
    }

    process.exit(1);
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
