/**
 * Google Flow (labs.google/fx/tools/flow) 動画生成自動化スクリプト
 *
 * 使用方法:
 * node flow-video-auto.js '{"prompt": "動画のプロンプト", "model": "fast|quality"}'
 *
 * 必要条件:
 * - Google AI Pro/Ultra サブスクリプション
 * - Chromeがリモートデバッグモードで起動していること
 * - Googleアカウントでログイン済みであること
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function run() {
  const inputArg = process.argv[2];
  let config = {
    prompt: '',
    model: 'fast', // 'fast' or 'quality'
    projectUrl: null, // 既存プロジェクトURL（オプション）
    waitTimeout: 600000, // 動画生成待機時間（デフォルト10分）
  };

  if (inputArg) {
    try {
      const parsed = JSON.parse(inputArg);
      config = { ...config, ...parsed };
    } catch (e) {
      console.log(JSON.stringify({ error: 'Invalid JSON input' }));
      process.exit(1);
    }
  }

  if (!config.prompt) {
    console.log(JSON.stringify({ error: 'Prompt is required' }));
    process.exit(1);
  }

  console.error('=== Google Flow Video Generation ===');
  console.error('Prompt: ' + config.prompt.substring(0, 100) + '...');
  console.error('Model: ' + config.model);

  let browser;
  try {
    // Chrome CDPに接続
    browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
    const context = browser.contexts()[0];

    // 新しいタブを開く（既存のGeminiタブを邪魔しないため）
    const page = await context.newPage();

    // Google Flowにアクセス
    const flowUrl = config.projectUrl || 'https://labs.google/fx/tools/flow';
    console.error('Navigating to: ' + flowUrl);
    await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // ログイン確認
    const url = page.url();
    console.error('Current URL: ' + url);

    if (url.includes('accounts.google.com') || url.includes('signin')) {
      await page.screenshot({ path: '/home/node/scripts/flow-login-required.png' });
      await page.close();
      console.log(JSON.stringify({
        error: 'Not logged in to Google',
        screenshot: '/home/node/scripts/flow-login-required.png'
      }));
      process.exit(1);
    }

    // ページ読み込み待機
    await page.waitForTimeout(3000);

    // 新規プロジェクトの場合、"+ New project" をクリック
    if (!config.projectUrl) {
      console.error('Looking for New Project button...');
      const newProjectBtn = await page.$('button:has-text("New project"), [aria-label*="New project"], [data-testid*="new-project"]');
      if (newProjectBtn) {
        console.error('Clicking New Project...');
        await newProjectBtn.click();
        await page.waitForTimeout(3000);
      }
    }

    // スクリーンショット（デバッグ用）
    await page.screenshot({ path: '/home/node/scripts/flow-step1-loaded.png' });
    console.error('Screenshot saved: flow-step1-loaded.png');

    // "Text to Video" モードを選択
    console.error('Selecting Text to Video mode...');
    const textToVideoSelector = await page.$('button:has-text("Text to Video"), [aria-label*="Text to Video"], div:has-text("Text to Video")');
    if (textToVideoSelector) {
      await textToVideoSelector.click();
      await page.waitForTimeout(1000);
    }

    // モデル選択（設定アイコンをクリック）
    console.error('Configuring model: ' + config.model);
    const settingsBtn = await page.$('button[aria-label*="settings"], button[aria-label*="Settings"], [data-testid*="settings"]');
    if (settingsBtn) {
      await settingsBtn.click();
      await page.waitForTimeout(1000);

      // モデル選択
      const modelOption = config.model === 'quality'
        ? 'Veo 3 – Quality'
        : 'Veo 3 – Fast';

      const modelBtn = await page.$(`button:has-text("${modelOption}"), [aria-label*="${modelOption}"]`);
      if (modelBtn) {
        await modelBtn.click();
        await page.waitForTimeout(500);
      }

      // 設定を閉じる
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // プロンプト入力ボックスを探す
    console.error('Looking for prompt input...');
    const promptSelectors = [
      'textarea[placeholder*="prompt"]',
      'textarea[placeholder*="Prompt"]',
      'div[role="textbox"]',
      'textarea',
      '[contenteditable="true"]',
      'input[type="text"]'
    ];

    let promptInput = null;
    for (const selector of promptSelectors) {
      promptInput = await page.$(selector);
      if (promptInput) {
        console.error('Found prompt input with selector: ' + selector);
        break;
      }
    }

    if (!promptInput) {
      await page.screenshot({ path: '/home/node/scripts/flow-no-prompt-input.png' });
      await page.close();
      console.log(JSON.stringify({
        error: 'Could not find prompt input',
        screenshot: '/home/node/scripts/flow-no-prompt-input.png'
      }));
      process.exit(1);
    }

    // プロンプトを入力
    console.error('Entering prompt...');
    await promptInput.click();
    await page.waitForTimeout(500);

    // テキストをクリアして入力
    await promptInput.fill('');
    await promptInput.fill(config.prompt);
    await page.waitForTimeout(1000);

    await page.screenshot({ path: '/home/node/scripts/flow-step2-prompt-entered.png' });
    console.error('Screenshot saved: flow-step2-prompt-entered.png');

    // Generateボタンをクリック
    console.error('Looking for Generate button...');
    const generateSelectors = [
      'button:has-text("Generate")',
      'button[aria-label*="Generate"]',
      '[data-testid*="generate"]',
      'button:has-text("生成")'
    ];

    let generateBtn = null;
    for (const selector of generateSelectors) {
      generateBtn = await page.$(selector);
      if (generateBtn) {
        console.error('Found Generate button with selector: ' + selector);
        break;
      }
    }

    if (!generateBtn) {
      await page.screenshot({ path: '/home/node/scripts/flow-no-generate-btn.png' });
      await page.close();
      console.log(JSON.stringify({
        error: 'Could not find Generate button',
        screenshot: '/home/node/scripts/flow-no-generate-btn.png'
      }));
      process.exit(1);
    }

    // 生成開始
    console.error('Clicking Generate...');
    await generateBtn.click();
    await page.waitForTimeout(3000);

    await page.screenshot({ path: '/home/node/scripts/flow-step3-generating.png' });
    console.error('Screenshot saved: flow-step3-generating.png');

    // 動画生成完了を待つ
    console.error('Waiting for video generation (max ' + (config.waitTimeout / 60000) + ' minutes)...');

    const startTime = Date.now();
    let videoGenerated = false;
    let videoUrl = null;

    while (Date.now() - startTime < config.waitTimeout) {
      await page.waitForTimeout(10000); // 10秒ごとにチェック

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.error('Elapsed: ' + elapsed + 's');

      // 動画要素を探す
      const videoElement = await page.$('video');
      if (videoElement) {
        const src = await videoElement.getAttribute('src');
        if (src && src.startsWith('http')) {
          videoUrl = src;
          videoGenerated = true;
          console.error('Video generated! URL: ' + videoUrl.substring(0, 100) + '...');
          break;
        }
      }

      // エラーメッセージをチェック
      const errorMsg = await page.$('[role="alert"], .error-message, div:has-text("Error"), div:has-text("エラー")');
      if (errorMsg) {
        const errorText = await errorMsg.innerText();
        if (errorText.toLowerCase().includes('error') || errorText.includes('エラー')) {
          await page.screenshot({ path: '/home/node/scripts/flow-error.png' });
          await page.close();
          console.log(JSON.stringify({
            error: 'Generation error: ' + errorText,
            screenshot: '/home/node/scripts/flow-error.png'
          }));
          process.exit(1);
        }
      }

      // 進行状況をスクリーンショット（1分ごと）
      if (elapsed % 60 === 0) {
        await page.screenshot({ path: '/home/node/scripts/flow-progress-' + elapsed + 's.png' });
      }
    }

    // 最終スクリーンショット
    await page.screenshot({ path: '/home/node/scripts/flow-final-result.png' });
    console.error('Final screenshot saved: flow-final-result.png');

    // プロジェクトURLを取得
    const projectUrl = page.url();

    await page.close();

    // 結果を出力
    const result = {
      success: videoGenerated,
      videoUrl: videoUrl,
      projectUrl: projectUrl,
      screenshot: '/home/node/scripts/flow-final-result.png',
      generationTime: Math.round((Date.now() - startTime) / 1000) + 's'
    };

    console.log(JSON.stringify(result));

  } catch (e) {
    console.error('Error: ' + e.message);
    console.log(JSON.stringify({
      error: e.message,
      stack: e.stack
    }));
    process.exit(1);
  }
}

run().catch(e => {
  console.error(e);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
