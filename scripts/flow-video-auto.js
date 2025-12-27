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
 *
 * 更新履歴:
 * - 2024-12-27: セレクタを実際のUI HTMLに基づいて修正
 *   - プロンプト入力: #PINHOLE_TEXT_AREA_ELEMENT_ID
 *   - 作成ボタン: aria-label="作成"
 *   - 設定ボタン: aria-label="設定"
 *   - 通知ドロワー対応追加
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// セレクタ定義（実際のHTMLに基づく）
const SELECTORS = {
  // プロンプト入力欄
  promptInput: '#PINHOLE_TEXT_AREA_ELEMENT_ID',

  // 作成/Generateボタン
  createButton: [
    'button[aria-label="作成"]',
    'button:has(i:text("arrow_forward"))',
    'button.sc-408537d4-2',
  ],

  // 設定ボタン
  settingsButton: [
    'button[aria-label*="設定"]',
    'button:has(i:text("tune"))',
    'button[aria-controls="radix-:r4p:"]',
  ],

  // モデル選択ボタン（現在のモデル表示）
  modelDisplay: [
    'button:has-text("Veo 3")',
    '.sc-4d92f943-4',
    'button:has(i:text("volume_up"))',
  ],

  // テキストから動画モード選択
  textToVideoMode: [
    'button[role="combobox"]:has-text("テキストから動画")',
    'button:has(span:text("テキストから動画"))',
  ],

  // 通知ドロワー
  notificationDrawer: '[role="region"][aria-label*="通知ドロワー"]',
  notificationItem: '[data-radix-collection-item]',

  // 動画プレーヤー
  videoElement: 'video',

  // エラー表示
  errorMessage: '[role="alert"], .error-message',
};

async function dismissNotifications(page) {
  /**
   * 通知ドロワーの通知を閉じる
   */
  try {
    const notifications = await page.$$(SELECTORS.notificationItem);
    console.error(`Found ${notifications.length} notification(s)`);

    for (const notification of notifications) {
      // スワイプで閉じる（data-swipe-direction="right"）
      const box = await notification.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width + 100, box.y + box.height / 2, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(300);
      }
    }
  } catch (e) {
    console.error('Notification dismissal error (non-fatal): ' + e.message);
  }
}

async function findElement(page, selectors, description) {
  /**
   * 複数のセレクタから要素を探す
   */
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];

  for (const selector of selectorList) {
    try {
      const element = await page.$(selector);
      if (element) {
        const isVisible = await element.isVisible();
        if (isVisible) {
          console.error(`Found ${description} with selector: ${selector}`);
          return element;
        }
      }
    } catch (e) {
      // セレクタが無効な場合はスキップ
    }
  }

  console.error(`Could not find ${description}`);
  return null;
}

async function waitForElement(page, selectors, description, timeout = 10000) {
  /**
   * 要素が表示されるまで待機
   */
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = await findElement(page, selectorList, description);
    if (element) {
      return element;
    }
    await page.waitForTimeout(500);
  }

  return null;
}

async function run() {
  const inputArg = process.argv[2];
  let config = {
    prompt: '',
    model: 'fast', // 'fast' or 'quality'
    projectUrl: null, // 既存プロジェクトURL（オプション）
    waitTimeout: 600000, // 動画生成待機時間（デフォルト10分）
    screenshotDir: '/tmp',
    keepTabOpen: false, // タブを開いたままにするか
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

  // スクリーンショットディレクトリ確認
  if (!fs.existsSync(config.screenshotDir)) {
    try {
      fs.mkdirSync(config.screenshotDir, { recursive: true });
    } catch (e) {
      config.screenshotDir = '/tmp';
    }
  }

  console.error('=== Google Flow Video Generation ===');
  console.error('Prompt: ' + config.prompt.substring(0, 100) + (config.prompt.length > 100 ? '...' : ''));
  console.error('Model: ' + config.model);

  let browser;
  let page;

  try {
    // Chrome CDPに接続
    browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
    const context = browser.contexts()[0];

    // 新しいタブを開く
    page = await context.newPage();

    // Google Flowにアクセス
    const flowUrl = config.projectUrl || 'https://labs.google/fx/tools/flow';
    console.error('Navigating to: ' + flowUrl);
    await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // ログイン確認
    const url = page.url();
    console.error('Current URL: ' + url);

    if (url.includes('accounts.google.com') || url.includes('signin')) {
      const screenshotPath = path.join(config.screenshotDir, 'flow-login-required.png');
      await page.screenshot({ path: screenshotPath });
      await page.close();
      console.log(JSON.stringify({
        error: 'Not logged in to Google',
        screenshot: screenshotPath
      }));
      process.exit(1);
    }

    // ページ読み込み待機
    await page.waitForTimeout(3000);

    // 通知を閉じる
    await dismissNotifications(page);

    // TOPページの場合、「新しいプロジェクト」をクリック
    if (!config.projectUrl) {
      console.error('Checking for New Project button...');
      const newProjectSelectors = [
        'button:has-text("新しいプロジェクト")',
        'button:has(i:text("add_2"))',
        'button:has-text("New project")',
      ];

      for (const selector of newProjectSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn && await btn.isVisible()) {
            console.error('Found New Project button, clicking...');
            await btn.click();
            await page.waitForTimeout(5000);
            console.error('Project page loaded');
            break;
          }
        } catch (e) {
          // continue
        }
      }
    }

    // スクリーンショット（デバッグ用）
    const step1Screenshot = path.join(config.screenshotDir, 'flow-step1-loaded.png');
    await page.screenshot({ path: step1Screenshot });
    console.error('Screenshot saved: ' + step1Screenshot);

    // "テキストから動画" モードが選択されているか確認
    console.error('Checking Text to Video mode...');
    const textToVideoBtn = await findElement(page, SELECTORS.textToVideoMode, 'Text to Video mode');
    if (textToVideoBtn) {
      console.error('Text to Video mode is available');
      // 既に選択されている場合はクリック不要
    }

    // モデル設定を確認・変更（オプション - 失敗しても続行）
    console.error('Configuring model: ' + config.model);
    try {
      const settingsBtn = await findElement(page, SELECTORS.settingsButton, 'Settings button');

      if (settingsBtn) {
        // force: true で無効状態でもクリックを試みる
        await settingsBtn.click({ timeout: 5000 }).catch(() => {
          console.error('Settings button click failed, using default settings');
        });
        await page.waitForTimeout(1500);

        // モデル選択（Veo 3 - Fast または Veo 3 - Quality）
        const modelText = config.model === 'quality' ? 'Quality' : 'Fast';
        const modelOption = await page.$(`button:has-text("${modelText}"), [role="option"]:has-text("${modelText}")`);

        if (modelOption) {
          await modelOption.click();
          console.error('Selected model: ' + modelText);
          await page.waitForTimeout(500);
        }

        // 設定ダイアログを閉じる
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    } catch (e) {
      console.error('Model configuration skipped: ' + e.message);
    }

    // プロンプト入力欄を探す
    console.error('Looking for prompt input...');
    let promptInput = await waitForElement(page, SELECTORS.promptInput, 'Prompt input', 10000);

    if (!promptInput) {
      // フォールバック: 他のセレクタを試す
      const fallbackSelectors = [
        'textarea[placeholder*="動画を生成"]',
        'textarea[placeholder*="テキスト"]',
        'textarea',
        'div[role="textbox"]',
        '[contenteditable="true"]',
      ];
      promptInput = await findElement(page, fallbackSelectors, 'Prompt input (fallback)');
    }

    if (!promptInput) {
      const screenshotPath = path.join(config.screenshotDir, 'flow-no-prompt-input.png');
      await page.screenshot({ path: screenshotPath });

      // デバッグ: HTML構造を出力
      const html = await page.content();
      fs.writeFileSync(path.join(config.screenshotDir, 'flow-debug.html'), html);

      await page.close();
      console.log(JSON.stringify({
        error: 'Could not find prompt input',
        screenshot: screenshotPath,
        debug: 'HTML saved to flow-debug.html'
      }));
      process.exit(1);
    }

    // プロンプトを入力
    console.error('Entering prompt...');
    await promptInput.click();
    await page.waitForTimeout(500);

    // テキストをクリアして入力
    await promptInput.fill('');
    await page.waitForTimeout(300);
    await promptInput.fill(config.prompt);
    await page.waitForTimeout(1000);

    const step2Screenshot = path.join(config.screenshotDir, 'flow-step2-prompt-entered.png');
    await page.screenshot({ path: step2Screenshot });
    console.error('Screenshot saved: ' + step2Screenshot);

    // 作成ボタンを探す
    console.error('Looking for Create/Generate button...');

    // ボタンが有効になるまで待機
    await page.waitForTimeout(1000);

    let createBtn = await findElement(page, SELECTORS.createButton, 'Create button');

    if (!createBtn) {
      // フォールバック
      const fallbackSelectors = [
        'button:has-text("作成")',
        'button:has-text("Generate")',
        'button:has-text("生成")',
        'button:has(i.google-symbols:text("arrow_forward"))',
      ];
      createBtn = await findElement(page, fallbackSelectors, 'Create button (fallback)');
    }

    if (!createBtn) {
      const screenshotPath = path.join(config.screenshotDir, 'flow-no-create-btn.png');
      await page.screenshot({ path: screenshotPath });
      await page.close();
      console.log(JSON.stringify({
        error: 'Could not find Create/Generate button',
        screenshot: screenshotPath
      }));
      process.exit(1);
    }

    // ボタンが有効か確認
    const isDisabled = await createBtn.getAttribute('disabled');
    if (isDisabled !== null) {
      console.error('Create button is disabled. Waiting for it to become enabled...');

      // 最大10秒待機
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(500);
        const stillDisabled = await createBtn.getAttribute('disabled');
        if (stillDisabled === null) {
          console.error('Create button is now enabled');
          break;
        }
      }
    }

    // 生成開始
    console.error('Clicking Create/Generate button...');
    await createBtn.click();
    await page.waitForTimeout(3000);

    const step3Screenshot = path.join(config.screenshotDir, 'flow-step3-generating.png');
    await page.screenshot({ path: step3Screenshot });
    console.error('Screenshot saved: ' + step3Screenshot);

    // 動画生成完了を待つ
    console.error('Waiting for video generation (max ' + (config.waitTimeout / 60000) + ' minutes)...');

    const startTime = Date.now();
    let videoGenerated = false;
    let videoUrl = null;

    while (Date.now() - startTime < config.waitTimeout) {
      await page.waitForTimeout(10000); // 10秒ごとにチェック

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.error('Elapsed: ' + elapsed + 's');

      // 通知を閉じる（生成中に出ることがある）
      await dismissNotifications(page);

      // 動画要素を探す
      const videoElement = await page.$(SELECTORS.videoElement);
      if (videoElement) {
        const src = await videoElement.getAttribute('src');
        if (src && (src.startsWith('http') || src.startsWith('blob:'))) {
          videoUrl = src;
          videoGenerated = true;
          console.error('Video generated! URL: ' + videoUrl.substring(0, 100) + '...');
          break;
        }
      }

      // エラーメッセージをチェック
      const errorMsg = await page.$(SELECTORS.errorMessage);
      if (errorMsg) {
        const errorText = await errorMsg.innerText().catch(() => '');
        if (errorText && (errorText.toLowerCase().includes('error') || errorText.includes('エラー'))) {
          const screenshotPath = path.join(config.screenshotDir, 'flow-error.png');
          await page.screenshot({ path: screenshotPath });
          await page.close();
          console.log(JSON.stringify({
            error: 'Generation error: ' + errorText,
            screenshot: screenshotPath
          }));
          process.exit(1);
        }
      }

      // 進行状況をスクリーンショット（1分ごと）
      if (elapsed % 60 === 0 && elapsed > 0) {
        const progressScreenshot = path.join(config.screenshotDir, `flow-progress-${elapsed}s.png`);
        await page.screenshot({ path: progressScreenshot });
        console.error('Progress screenshot: ' + progressScreenshot);
      }
    }

    // 最終スクリーンショット
    const finalScreenshot = path.join(config.screenshotDir, 'flow-final-result.png');
    await page.screenshot({ path: finalScreenshot });
    console.error('Final screenshot saved: ' + finalScreenshot);

    // プロジェクトURLを取得
    const projectUrl = page.url();

    // タブを閉じるかどうか
    if (!config.keepTabOpen) {
      await page.close();
    } else {
      console.error('Tab kept open as requested');
    }

    // 結果を出力
    const result = {
      success: videoGenerated,
      videoUrl: videoUrl,
      projectUrl: projectUrl,
      screenshot: finalScreenshot,
      generationTime: Math.round((Date.now() - startTime) / 1000) + 's'
    };

    console.log(JSON.stringify(result));
    process.exit(0);

  } catch (e) {
    console.error('Error: ' + e.message);

    if (page) {
      try {
        const errorScreenshot = path.join(config.screenshotDir, 'flow-crash.png');
        await page.screenshot({ path: errorScreenshot });
        await page.close();
      } catch (screenshotError) {
        // スクリーンショット取得失敗は無視
      }
    }

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
