/**
 * Veo3 共通モジュール
 *
 * veo3-shorts-simple.js と veo3-character-video.js で共有する関数群
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// 共通セレクタ
const SELECTORS = {
  promptInput: '#PINHOLE_TEXT_AREA_ELEMENT_ID',
  createButton: [
    'button[aria-label="作成"]',
    'button:has(i:text("arrow_forward"))',
  ],
  videoElement: 'video',
  newProjectButton: [
    'button:has-text("新しいプロジェクト")',
    'button:has(i:text("add_2"))',
  ],

  // Videos/Images 切り替え
  mediaTypeToggle: '[role="group"] button[role="radio"]',
  videosButton: 'button[role="radio"]:has(i:text("videocam"))',
  imagesButton: 'button[role="radio"]:has(i:text("image"))',

  // フレームから動画モード用
  modeSelector: 'button[role="combobox"]',
  frameToVideoOption: 'text=フレームから動画',
  addImageButton: 'button:has(i.google-symbols:text("add"))',
  uploadButton: [
    'button:has(i.google-symbols:text("upload"))',
    'button:has-text("アップロード")',
  ],
  fileInput: 'input[type="file"]',
  cropAndSaveButton: 'button:has-text("切り抜きして保存")',

  // 画像生成モード用
  imageCreateOption: 'text=画像を作成',

  // 画像生成設定用
  settingsButton: 'button:has(i:text("tune"))',
  outputCountButton: 'button[role="combobox"]:has-text("プロンプトごとの出力")',
  aspectRatioButton: 'button[role="combobox"]:has-text("縦横比")',
  outputCount1Option: '[role="option"]:has-text("1")',
  outputCount2Option: '[role="option"]:has-text("2")',
  landscapeOption: '[role="option"]:has-text("横向き")',
  portraitOption: '[role="option"]:has-text("縦向き")',

  // シーン拡張用セレクタ
  addToSceneButton: 'button:has-text("シーンに追加")',
  addClipButton: '#PINHOLE_ADD_CLIP_CARD_ID',
  extendOption: '[role="menuitem"]:has-text("拡張")',
  downloadButton: 'button:has(i:text("download"))',

  // エクスポートダイアログ用
  exportDownloadLink: 'a:has-text("ダウンロード")',
  exportCloseButton: 'button:has-text("閉じる")',

  // シーンビルダータブ
  scenebuilderTab: 'button:has-text("Scenebuilder")',

  // 画像ダウンロード用
  imageDownloadButton: 'button:has(i:text("download"))',
  generatedImage: 'img[alt*="Generated"]',

  // Add To Prompt ボタン（キャラクター動画用）
  addToPromptButton: 'button:has-text("Add To Prompt")',

  // タイムラインエリア（キャラクター動画用）
  timelineArea: '.sc-624db470-0',
};

// デフォルト設定（ベース）
const DEFAULT_CONFIG_BASE = {
  prompt: '',
  outputPath: '/tmp/veo3_output.mp4',
  waitTimeout: 600000,
  cdpUrl: 'http://192.168.65.254:9222',
  projectUrl: null,
  aspectRatio: 'landscape',
  download: true,
  keepAudio: true,
  maxRetries: 3,
  retryDelay: 10000,
};

/**
 * 動画/画像をダウンロード
 */
async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);

    console.error('Downloading: ' + outputPath);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error('Download failed: ' + response.statusCode));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.error('Downloaded: ' + outputPath);
        resolve(outputPath);
      });
    }).on('error', reject);
  });
}

/**
 * 通知を閉じる（タイムラインのスライダーは除外）
 */
async function dismissNotifications(page) {
  try {
    const items = await page.$$('[data-radix-collection-item]:not([role="slider"]):not(.sc-605710a8-2)');
    for (const item of items) {
      const tagName = await item.evaluate(el => el.tagName);
      const role = await item.getAttribute('role');
      if (role === 'slider' || tagName === 'SPAN') continue;

      const box = await item.boundingBox();
      if (box && box.y < 200) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width + 100, box.y + box.height / 2, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(200);
      }
    }
  } catch (e) {}
}

/**
 * 同意ポップアップを閉じる
 */
async function dismissConsentPopup(page) {
  try {
    const consentSelectors = [
      'button:has-text("同意する")',
      'button:has-text("同意")',
      'button:has-text("I agree")',
      'button:has-text("Accept")',
    ];
    for (const sel of consentSelectors) {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click();
        console.error('Dismissed consent popup');
        await page.waitForTimeout(500);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

/**
 * ファイルダイアログが開いていたら閉じる
 */
async function dismissFileDialog(page) {
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } catch (e) {}
}

/**
 * 要素を探す
 */
async function findElement(page, selectors) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const sel of list) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return el;
    } catch (e) {}
  }
  return null;
}

/**
 * プロジェクトを開始（既存または新規）
 */
async function startNewProject(page, config) {
  let targetUrl = config.projectUrl || 'https://labs.google/fx/tools/flow';

  if (targetUrl.includes('/scenes/')) {
    const baseUrl = targetUrl.replace(/\/scenes\/.*$/, '');
    console.error('SceneBuilder URL detected, converting to project URL:');
    console.error('  From: ' + targetUrl);
    console.error('  To: ' + baseUrl);
    targetUrl = baseUrl;
  }

  console.error('Opening: ' + targetUrl);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  if (page.url().includes('accounts.google.com')) {
    throw new Error('Not logged in');
  }

  const currentUrl = page.url();
  if (currentUrl.includes('/scenes/')) {
    console.error('Redirected to SceneBuilder, navigating back to project...');
    const projectBaseUrl = currentUrl.replace(/\/scenes\/.*$/, '');
    await page.goto(projectBaseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  }

  await dismissFileDialog(page);
  await dismissConsentPopup(page);
  await dismissNotifications(page);

  if (!config.projectUrl) {
    const newBtn = await findElement(page, SELECTORS.newProjectButton);
    if (newBtn) {
      await newBtn.click();
      await page.waitForTimeout(5000);
    }
  } else {
    console.error('Using existing project');
    console.error('Waiting for page content to load...');
    await page.waitForTimeout(6000);
  }
}

/**
 * 画像生成モードを選択
 */
async function selectImagesMode(page) {
  console.error('Switching to Images mode...');

  const currentUrl = page.url();
  if (currentUrl.includes('/scenes/')) {
    throw new Error('Cannot switch to Images mode while in SceneBuilder. Current URL: ' + currentUrl);
  }

  let imagesBtn = null;
  for (let i = 0; i < 5; i++) {
    imagesBtn = await page.$(SELECTORS.imagesButton);
    if (imagesBtn) break;
    console.error('Images button not found, waiting... (' + (i + 1) + '/5)');
    await page.waitForTimeout(2000);
  }

  if (!imagesBtn) {
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.error('Page content preview: ' + bodyText);
    throw new Error('Images button not found after 5 attempts. Page may not be in the correct state.');
  }

  const state = await imagesBtn.getAttribute('data-state');
  if (state !== 'on') {
    await imagesBtn.evaluate(el => el.click());
    console.error('Clicked Images button (via JS)');
    await page.waitForTimeout(1500);

    const newState = await imagesBtn.getAttribute('data-state');
    if (newState !== 'on') {
      console.error('Warning: Images button state did not change to "on" after click');
    } else {
      console.error('Images mode activated successfully');
    }
  } else {
    console.error('Images mode already selected');
  }

  await page.waitForTimeout(500);
}

/**
 * 画像生成の設定を変更（出力数、縦横比）
 */
async function configureImageSettings(page, config) {
  console.error('Configuring image settings...');

  const settingsBtn = await page.$(SELECTORS.settingsButton);
  if (settingsBtn) {
    await settingsBtn.evaluate(el => el.click());
    console.error('Clicked settings button');
    await page.waitForTimeout(500);
  }

  if (config.aspectRatio) {
    const aspectBtn = await page.$(SELECTORS.aspectRatioButton);
    if (aspectBtn) {
      const currentText = await aspectBtn.textContent();
      const isLandscape = currentText.includes('横向き');
      const needsChange = (config.aspectRatio === 'landscape' && !isLandscape) ||
                          (config.aspectRatio === 'portrait' && isLandscape);

      if (needsChange) {
        await aspectBtn.evaluate(el => el.click());
        console.error('Clicked aspect ratio button');
        await page.waitForTimeout(300);

        const optionSelector = config.aspectRatio === 'landscape'
          ? SELECTORS.landscapeOption
          : SELECTORS.portraitOption;
        const option = await page.$(optionSelector);
        if (option) {
          await option.evaluate(el => el.click());
          console.error('Selected aspect ratio: ' + config.aspectRatio);
          await page.waitForTimeout(300);
        }
      } else {
        console.error('Aspect ratio already set to: ' + config.aspectRatio);
      }
    }
  }

  if (config.imageOutputCount) {
    const outputBtn = await page.$(SELECTORS.outputCountButton);
    if (outputBtn) {
      const currentText = await outputBtn.textContent();
      const currentCount = currentText.includes('1') && !currentText.includes('2') ? 1 : 2;

      if (currentCount !== config.imageOutputCount) {
        await outputBtn.evaluate(el => el.click());
        console.error('Clicked output count button');
        await page.waitForTimeout(300);

        const optionSelector = config.imageOutputCount === 1
          ? SELECTORS.outputCount1Option
          : SELECTORS.outputCount2Option;
        const option = await page.$(optionSelector);
        if (option) {
          await option.evaluate(el => el.click());
          console.error('Selected output count: ' + config.imageOutputCount);
          await page.waitForTimeout(300);
        }
      } else {
        console.error('Output count already set to: ' + config.imageOutputCount);
      }
    }
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.error('Image settings configured');
}

/**
 * 画像を生成
 * @param {object} options - { skipDownload: boolean } ダウンロードをスキップするか
 */
async function generateImage(page, config, options = {}) {
  console.error('\n=== Generating Image ===');

  await selectImagesMode(page);

  console.error('Waiting for UI to update after mode switch...');
  await page.waitForTimeout(3000);

  await configureImageSettings(page, config);

  const promptInput = await page.waitForSelector(SELECTORS.promptInput, { timeout: 10000 });
  if (!promptInput) throw new Error('Prompt input not found');

  await promptInput.click();
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(config.prompt || config.imagePrompt);
  await page.waitForTimeout(1000);

  let createBtn = await findElement(page, SELECTORS.createButton);
  if (!createBtn) throw new Error('Create button not found');

  for (let i = 0; i < 10; i++) {
    const disabled = await createBtn.getAttribute('disabled');
    if (!disabled) break;
    await page.waitForTimeout(500);
    createBtn = await findElement(page, SELECTORS.createButton);
  }

  await createBtn.evaluate(el => el.click());
  console.error('Clicked create button');

  console.error('Waiting for image generation...');
  let generated = false;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;

  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(2000);

    try {
      const pageText = await page.evaluate(() => document.body.innerText);
      consecutiveErrors = 0;

      if (pageText.includes('生成できませんでした') || pageText.includes('Could not generate')) {
        console.error('Generation error detected on page');
        throw new Error('Image generation failed: 生成できませんでした');
      }
    } catch (evalErr) {
      if (evalErr.message.includes('Execution context was destroyed') ||
          evalErr.message.includes('navigation')) {
        consecutiveErrors++;
        console.error(`  Page navigation detected (${consecutiveErrors}/${maxConsecutiveErrors}), waiting...`);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error('  Multiple navigation errors, waiting for page to stabilize...');
          await page.waitForTimeout(5000);
          consecutiveErrors = 0;
        }
        continue;
      }
      if (evalErr.message.includes('生成できませんでした')) {
        throw evalErr;
      }
    }

    try {
      const images = await page.$$('img');
      for (const img of images) {
        const src = await img.getAttribute('src');
        if (src && (src.startsWith('data:image') || src.includes('generated') || src.includes('blob:'))) {
          generated = true;
          console.error('Image generated!');
          break;
        }
      }
      if (generated) break;

      const downloadBtn = await page.$(SELECTORS.downloadButton);
      if (downloadBtn && await downloadBtn.isVisible()) {
        generated = true;
        console.error('Image generated (download button visible)!');
        break;
      }
    } catch (checkErr) {
      if (checkErr.message.includes('Execution context was destroyed') ||
          checkErr.message.includes('navigation')) {
        console.error('  Context error during image check, continuing...');
        continue;
      }
    }

    if (i % 15 === 14) {
      console.error(`  ${(i + 1) * 2}s elapsed`);
    }
  }

  if (!generated) {
    throw new Error('Image generation timed out');
  }

  return true;
}

/**
 * プロンプト入力して生成ボタンをクリック
 * 改善: プロンプト入力の検出にリトライロジック追加
 */
async function inputPromptAndCreate(page, prompt, config) {
  // プロンプト入力を探す（リトライ付き）
  let promptInput = null;
  const promptSelectors = [
    SELECTORS.promptInput,
    '#PINHOLE_TEXT_AREA_ELEMENT_ID',
    'textarea[placeholder*="プロンプト"]',
    'textarea[placeholder*="prompt"]',
    'textarea',
  ];

  for (let attempt = 0; attempt < 5; attempt++) {
    for (const sel of promptSelectors) {
      try {
        promptInput = await page.waitForSelector(sel, { timeout: 3000, state: 'visible' });
        if (promptInput) {
          console.error(`Found prompt input with: ${sel}`);
          break;
        }
      } catch (e) {
        // 次のセレクタを試す
      }
    }

    if (promptInput) break;

    console.error(`Prompt input not found, retrying... (${attempt + 1}/5)`);
    await page.waitForTimeout(2000);

    // UIが読み込み中かもしれないので、ページをスクロールして更新
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } catch (e) {}
  }

  if (!promptInput) {
    await page.screenshot({ path: '/tmp/veo3-prompt-input-not-found.png' });
    throw new Error('RETRY:Prompt input not found after 5 attempts');
  }

  await promptInput.click();
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(prompt);
  await page.waitForTimeout(1000);

  let createBtn = await findElement(page, SELECTORS.createButton);
  if (!createBtn) {
    // 作成ボタンも探す
    const createSelectors = [
      'button[aria-label="作成"]',
      'button[aria-label="Create"]',
      'button:has(i:text("arrow_forward"))',
      'button:has-text("作成")',
      'button:has-text("Create")',
    ];
    for (const sel of createSelectors) {
      createBtn = await page.$(sel);
      if (createBtn && await createBtn.isVisible()) break;
    }
  }

  if (!createBtn) throw new Error('Create button not found');

  for (let i = 0; i < 20; i++) {
    const disabled = await createBtn.getAttribute('disabled');
    if (disabled === null) break;
    await page.waitForTimeout(500);
  }

  await createBtn.click({ force: true });
  console.error('Clicked create button');
}

/**
 * 動画生成完了を待機（「シーンに追加」ボタンが表示されるまで）
 */
async function waitForVideoGeneration(page, config) {
  const startTime = Date.now();

  while (Date.now() - startTime < config.waitTimeout) {
    await page.waitForTimeout(10000);
    console.error(`  ${Math.round((Date.now() - startTime) / 1000)}s elapsed`);

    await dismissNotifications(page);

    // まず成功をチェック（成功していればエラーチェックは不要）
    const addToSceneBtn = await page.$(SELECTORS.addToSceneButton);
    if (addToSceneBtn && await addToSceneBtn.isVisible()) {
      console.error('Video generated! Found "Add to Scene" button');
      return { success: true, time: Math.round((Date.now() - startTime) / 1000) };
    }

    // 成功していない場合のみエラーをチェック
    // より限定的なエラー検出：ダイアログやアラート要素を探す
    const errorDialog = await page.$('[role="alertdialog"], [role="alert"], .error-message');
    if (errorDialog && await errorDialog.isVisible()) {
      const errorText = await errorDialog.textContent();
      if (errorText && (errorText.includes('生成できませんでした') || errorText.includes('Could not generate'))) {
        console.error('Generation error detected in dialog: ' + errorText.substring(0, 100));
        throw new Error('RETRY:Video generation failed: 生成できませんでした');
      }
    }
  }

  throw new Error('Video generation timed out');
}

/**
 * 「シーンに追加」ボタンをクリックしてシーンビルダーに移動
 */
async function clickAddToSceneAndGoToBuilder(page) {
  const addToSceneBtn = await page.$(SELECTORS.addToSceneButton);
  if (addToSceneBtn && await addToSceneBtn.isVisible()) {
    await addToSceneBtn.click({ force: true });
    console.error('Clicked Add to Scene button');
    await page.waitForTimeout(3000);

    const scenebuilderBtn = await page.$(SELECTORS.scenebuilderTab);
    if (scenebuilderBtn && await scenebuilderBtn.isVisible()) {
      await scenebuilderBtn.click();
      console.error('Clicked Scenebuilder tab');
      await page.waitForTimeout(2000);
    }

    // シーン拡張プラスボタンが有効になるまで待機
    console.error('Waiting for scene builder...');
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const addClipBtn = await page.$(SELECTORS.addClipButton);
      if (addClipBtn && await addClipBtn.isVisible()) {
        const isDisabled = await addClipBtn.getAttribute('disabled');
        if (isDisabled === null) {
          console.error('Scene builder loaded and button enabled');
          break;
        }
        console.error(`  Waiting for add clip button to be enabled... ${i * 2}s`);
      } else {
        console.error(`  Waiting for add clip button... ${i * 2}s`);
      }
    }
  }
}

/**
 * シーン拡張の内部処理（拡張ボタンクリック→プロンプト入力→生成→待機）
 * 改善1: メニュー選択にリトライロジック追加、タイムアウト延長
 * 改善2: クリップ数でより確実に完了を検出
 */
async function extendSceneInternal(page, config, prompt, index) {
  await dismissNotifications(page);

  // 現在のクリップ数をカウント（完了検出用）
  const initialClips = await page.$$(SELECTORS.timelineArea);
  const initialClipCount = initialClips.length;
  console.error(`Current clip count: ${initialClipCount}`);

  console.error('Waiting for add clip button to be enabled...');

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const addClipBtn = await page.$(SELECTORS.addClipButton);
    if (addClipBtn && await addClipBtn.isVisible()) {
      const isDisabled = await addClipBtn.getAttribute('disabled');
      if (isDisabled === null) {
        console.error('Add clip button is enabled');
        break;
      }
      console.error(`  Button still disabled... ${i * 2}s`);
    }
  }

  // ===== 改善1: メニュー選択にリトライロジック追加 =====
  const MAX_MENU_RETRIES = 3;
  let menuSuccess = false;

  for (let attempt = 1; attempt <= MAX_MENU_RETRIES; attempt++) {
    // クリップ追加ボタンをクリック
    await page.evaluate(() => {
      const btn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
      if (btn && !btn.disabled) btn.click();
    });
    console.error('Clicked add clip button (via JS)');
    await page.waitForTimeout(1500);

    // 拡張オプションを探す（タイムアウト延長: 5s → 10s）
    try {
      const extendOption = await page.waitForSelector(SELECTORS.extendOption, {
        timeout: 10000,
        state: 'visible'
      });

      if (extendOption) {
        await extendOption.click({ force: true });
        console.error('Selected extend option');
        menuSuccess = true;
        break;
      }
    } catch (e) {
      console.error(`Attempt ${attempt}/${MAX_MENU_RETRIES}: Extend option not visible - ${e.message}`);

      // メニューを閉じて再試行
      await page.keyboard.press('Escape');
      const waitTime = 2000 * attempt;
      console.error(`Waiting ${waitTime}ms before retry...`);
      await page.waitForTimeout(waitTime);
    }
  }

  if (!menuSuccess) {
    await page.screenshot({ path: `/tmp/veo3-extend-failed-scene${index}.png` });
    throw new Error(`Failed to select extend option after ${MAX_MENU_RETRIES} attempts`);
  }
  // ===== 改善1 ここまで =====

  await page.waitForTimeout(2000);

  await inputPromptAndCreate(page, prompt, config);
  console.error('Extension started...');
  await page.waitForTimeout(5000);

  const startTime = Date.now();
  let completed = false;

  console.error('Waiting for generation to start (add clip button should disappear)...');
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const addBtnCheck = await page.$(SELECTORS.addClipButton);
    if (!addBtnCheck || !(await addBtnCheck.isVisible())) {
      console.error('Add clip button disappeared, generation in progress...');
      break;
    }
  }

  while (Date.now() - startTime < config.waitTimeout) {
    // より頻繁にチェック（5秒ごと）
    await page.waitForTimeout(5000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed % 10 === 0) {
      console.error(`  ${elapsed}s elapsed`);
    }

    await dismissNotifications(page);

    // まず成功をチェック（クリップ数の増加で完了を検出）
    const currentClips = await page.$$(SELECTORS.timelineArea);
    const currentClipCount = currentClips.length;

    const addBtnAgain = await page.$(SELECTORS.addClipButton);
    const buttonVisible = addBtnAgain && await addBtnAgain.isVisible();

    // クリップが増えていて、かつボタンが表示されていれば完了
    if (currentClipCount > initialClipCount && buttonVisible) {
      completed = true;
      console.error(`Scene ${index} extended! (clips: ${initialClipCount} -> ${currentClipCount})`);
      break;
    }

    // クリップは増えたがボタンがまだ非表示の場合は待機を継続
    if (currentClipCount > initialClipCount) {
      console.error(`  Clip added (${currentClipCount}), waiting for button to be ready...`);
      continue; // 成功途中なのでエラーチェックはスキップ
    }

    // 成功していない場合のみエラーをチェック（ダイアログ要素を探す）
    const errorDialog = await page.$('[role="alertdialog"], [role="alert"], .error-message, [data-testid*="error"]');
    if (errorDialog && await errorDialog.isVisible()) {
      const errorText = await errorDialog.textContent();
      if (errorText && (errorText.includes('生成できませんでした') || errorText.includes('Could not generate'))) {
        console.error('Generation error detected in dialog: ' + errorText.substring(0, 100));
        await page.screenshot({ path: `/tmp/veo3-generation-error-scene${index}.png` });
        throw new Error('RETRY:Scene extension failed: 生成できませんでした');
      }
    }
  }

  if (!completed) {
    await page.screenshot({ path: `/tmp/veo3-timeout-scene${index}.png` });
    throw new Error('RETRY:Scene extension timeout');
  }

  // 完了後、少し待機して安定させる
  await page.waitForTimeout(2000);

  return { success: true, time: Math.round((Date.now() - startTime) / 1000) };
}

/**
 * シーン拡張（リトライ機能付き）
 */
async function extendScene(page, config, prompt, index) {
  console.error(`\n=== Extending Scene ${index} ===`);

  const maxRetries = config.maxRetries || 3;
  const retryDelay = config.retryDelay || 10000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.error(`\n=== Retry attempt ${attempt}/${maxRetries} for Scene ${index} ===`);
        const projectUrl = config.projectUrl || page.url();
        const baseProjectUrl = projectUrl.replace(/\/scenes\/.*$/, '');
        console.error('Reloading project page: ' + baseProjectUrl);
        await page.goto(baseProjectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);
        await dismissNotifications(page);
        await dismissConsentPopup(page);

        const scenebuilderBtn = await page.$(SELECTORS.scenebuilderTab);
        if (scenebuilderBtn && await scenebuilderBtn.isVisible()) {
          await scenebuilderBtn.click();
          console.error('Clicked Scenebuilder tab');
          await page.waitForTimeout(3000);
        }

        // 重要: リトライ時は最後のクリップをクリックしてから拡張する
        console.error('Clicking last clip before retry...');
        await page.waitForTimeout(2000); // クリップが読み込まれるまで待機
        await clickTimelineEnd(page);
      }

      const result = await extendSceneInternal(page, config, prompt, index);
      return result;

    } catch (e) {
      lastError = e;
      const isRetryable = e.message.includes('RETRY:') ||
                          e.message.includes('生成できませんでした') ||
                          e.message.includes('Could not generate');

      if (isRetryable && attempt < maxRetries) {
        console.error(`Extension failed (attempt ${attempt}/${maxRetries}): ${e.message}`);
        console.error(`Waiting ${retryDelay / 1000}s before retry...`);
        await page.waitForTimeout(retryDelay);
      } else {
        throw new Error(e.message.replace('RETRY:', ''));
      }
    }
  }

  throw lastError;
}

/**
 * タイムラインの最後のクリップをクリック
 * 改善: 複数のスクロール方法を試行、ブラウザズーム対応
 */
async function clickTimelineEnd(page) {
  console.error('Clicking last clip in timeline...');

  // タイムラインコンテナを探す（複数のセレクタを試行）
  const containerSelectors = [
    '[class*="timeline"] [class*="scroll"]',
    '[class*="sc-"][class*="timeline"]',
    '.sc-5367019-1',
    '[data-testid*="timeline"]',
  ];

  let timelineContainer = null;
  for (const sel of containerSelectors) {
    timelineContainer = await page.$(sel);
    if (timelineContainer) {
      console.error(`Found timeline container with: ${sel}`);
      break;
    }
  }

  // まずタイムラインコンテナを右端までスクロール（複数の方法を試行）
  if (timelineContainer) {
    // 方法1: scrollLeft
    try {
      await page.evaluate((container) => {
        container.scrollLeft = container.scrollWidth;
      }, timelineContainer);
      console.error('Scroll method 1: scrollLeft executed');
    } catch (e) {
      console.error('Scroll method 1 failed: ' + e.message);
    }

    await page.waitForTimeout(300);

    // 方法2: scrollIntoView + End key
    try {
      await page.keyboard.press('End');
      console.error('Scroll method 2: End key pressed');
    } catch (e) {
      console.error('Scroll method 2 failed: ' + e.message);
    }

    await page.waitForTimeout(500);
  }

  // 全てのクリップサムネイルを取得（複数のセレクタを試行）
  const clipSelectors = [
    SELECTORS.timelineArea,
    '[class*="sc-624db470"]',
    '[class*="timeline"] [class*="clip"]',
    '[class*="thumbnail"]',
  ];

  let clips = [];
  for (const sel of clipSelectors) {
    clips = await page.$$(sel);
    if (clips.length > 0) {
      console.error(`Found ${clips.length} clips with: ${sel}`);
      break;
    }
  }

  if (clips.length > 0) {
    const lastClip = clips[clips.length - 1];
    console.error(`Clicking last clip (index ${clips.length - 1})...`);

    // 方法1: scrollIntoViewIfNeeded
    try {
      await lastClip.scrollIntoViewIfNeeded();
      console.error('Scrolled last clip into view');
    } catch (e) {
      console.error('scrollIntoViewIfNeeded failed: ' + e.message);
    }
    await page.waitForTimeout(500);

    // 方法2: evaluate でスクロール
    try {
      await page.evaluate((el) => {
        el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'end' });
      }, lastClip);
      console.error('Scroll via evaluate executed');
    } catch (e) {
      console.error('Scroll via evaluate failed: ' + e.message);
    }
    await page.waitForTimeout(500);

    // クリップをクリック
    try {
      await lastClip.click({ force: true });
      console.error('Clicked last clip in timeline');
    } catch (e) {
      // クリックが失敗したら座標でクリック
      console.error('Direct click failed, trying coordinate click: ' + e.message);
      const box = await lastClip.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        console.error('Clicked via coordinates');
      }
    }

    await page.waitForTimeout(1000);
    return true;
  }

  // フォールバック: ページ全体でスクロール可能な要素を探す
  console.error('No clips found, trying fallback scroll method...');

  try {
    // タイムライン領域を探して右端をクリック
    const scrollResult = await page.evaluate(() => {
      // overflow-x: auto/scroll を持つ要素を探す
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const style = window.getComputedStyle(el);
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') &&
            el.scrollWidth > el.clientWidth) {
          el.scrollLeft = el.scrollWidth;
          return { found: true, scrollWidth: el.scrollWidth };
        }
      }
      return { found: false };
    });
    console.error('Fallback scroll result: ' + JSON.stringify(scrollResult));
  } catch (e) {
    console.error('Fallback scroll failed: ' + e.message);
  }

  await page.waitForTimeout(500);

  // 最後のクリップを再度探す
  clips = await page.$$(SELECTORS.timelineArea);
  if (clips.length > 0) {
    const lastClip = clips[clips.length - 1];
    await lastClip.click({ force: true });
    console.error('Clicked last clip after fallback scroll');
    await page.waitForTimeout(1000);
    return true;
  }

  console.error('Timeline clips not found after all attempts');
  return false;
}

/**
 * 「Add To Prompt」ボタンをクリック
 */
async function clickAddToPrompt(page) {
  console.error('Looking for Add To Prompt button...');

  // セレクタで探す
  let addToPromptBtn = await page.$(SELECTORS.addToPromptButton);

  // 見つからない場合、prompt_suggestionアイコンを含むボタンを探す
  if (!addToPromptBtn) {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && text.includes('Add To Prompt')) {
        addToPromptBtn = btn;
        break;
      }
    }
  }

  if (addToPromptBtn && await addToPromptBtn.isVisible()) {
    await addToPromptBtn.click({ force: true });
    console.error('Clicked Add To Prompt button');
    await page.waitForTimeout(1500);
    return true;
  }

  console.error('Add To Prompt button not found');
  return false;
}

/**
 * Videos モードに切り替え
 */
async function selectVideosMode(page) {
  console.error('Switching to Videos mode...');

  let videosBtn = await page.$(SELECTORS.videosButton);
  if (!videosBtn) {
    console.error('Videos button not found, may already be in Videos mode');
    return;
  }

  const state = await videosBtn.getAttribute('data-state');
  if (state !== 'on') {
    await videosBtn.evaluate(el => el.click());
    console.error('Clicked Videos button (via JS)');
    await page.waitForTimeout(1500);
  } else {
    console.error('Videos mode already selected');
  }
}

/**
 * フレームから動画モードを選択（画像アップロードなし）
 */
async function selectFrameToVideoModeOnly(page) {
  console.error('Selecting Frame-to-Video mode (without upload)...');

  await page.waitForTimeout(1000);

  // モードセレクタを探す（リトライ付き）
  let modeBtn = null;
  for (let i = 0; i < 5; i++) {
    modeBtn = await findElement(page, SELECTORS.modeSelector);
    if (modeBtn) break;

    // 別のセレクタも試す
    modeBtn = await page.$('button[aria-haspopup="listbox"]');
    if (modeBtn) break;

    modeBtn = await page.$('[data-testid*="mode"]');
    if (modeBtn) break;

    console.error(`  Mode selector not found, retrying... (${i + 1}/5)`);
    await page.waitForTimeout(1000);
  }

  if (modeBtn) {
    await modeBtn.click({ force: true });
    console.error('Clicked mode selector');
    await page.waitForTimeout(1500);

    const frameOption = await page.$(SELECTORS.frameToVideoOption);
    if (frameOption) {
      await frameOption.click({ force: true });
      console.error('Selected Frame-to-Video');
      await page.waitForTimeout(2000);
    } else {
      // 英語版も試す
      const frameOptionEn = await page.$('text=Frame to Video');
      if (frameOptionEn) {
        await frameOptionEn.click({ force: true });
        console.error('Selected Frame-to-Video (English)');
        await page.waitForTimeout(2000);
      } else {
        console.error('WARNING: Frame-to-Video option not found');
      }
    }
  } else {
    console.error('WARNING: Mode selector not found - Frame-to-Video mode may not be selected');
    await page.screenshot({ path: '/tmp/veo3-mode-selector-not-found.png' });
  }
}

// エクスポート
module.exports = {
  SELECTORS,
  DEFAULT_CONFIG_BASE,
  downloadFile,
  dismissNotifications,
  dismissConsentPopup,
  dismissFileDialog,
  findElement,
  startNewProject,
  selectImagesMode,
  selectVideosMode,
  configureImageSettings,
  generateImage,
  inputPromptAndCreate,
  waitForVideoGeneration,
  clickAddToSceneAndGoToBuilder,
  extendSceneInternal,
  extendScene,
  clickTimelineEnd,
  clickAddToPrompt,
  selectFrameToVideoModeOnly,
};
