/**
 * Veo3 ショート動画生成（シンプル版）
 *
 * 既存のSUNOワークフローに組み込むための最小限のスクリプト
 * ジャケット画像から2つの動画を生成し、結合して出力
 *
 * 使用方法:
 * node veo3-shorts-simple.js '{"prompt": "プロンプト", "imagePath": "/tmp/output_kaeuta.png"}'
 *
 * 出力: /tmp/veo3_shorts_kaeuta.mp4
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// デフォルト設定
const DEFAULT_CONFIG = {
  prompt: '',
  imagePath: '/tmp/output_kaeuta.png',
  outputPath: '/tmp/veo3_shorts_kaeuta.mp4',
  mode: 'frame', // 'frame' または 'text'
  videoCount: 2,
  waitTimeout: 600000,
};

// セレクタ
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

  // フレームから動画モード用
  modeSelector: 'button[role="combobox"]',
  frameToVideoOption: 'text=フレームから動画',
  addImageButton: 'button:has(i.google-symbols:text("add"))',
  uploadButton: 'button:has(i:text("upload"))',
  fileInput: 'input[type="file"]',
  cropAndSaveButton: 'button:has-text("切り抜きして保存")',

  // シーン拡張用セレクタ
  addToSceneButton: 'button:has-text("シーンに追加")',
  addClipButton: '#PINHOLE_ADD_CLIP_CARD_ID',
  extendOption: '[role="menuitem"]:has-text("拡張")',
  downloadButton: 'button:has(i:text("download"))',
};

/**
 * 動画をダウンロード
 */
async function downloadVideo(url, outputPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);

    console.error('Downloading: ' + outputPath);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadVideo(response.headers.location, outputPath).then(resolve).catch(reject);
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
 * 通知を閉じる
 */
async function dismissNotifications(page) {
  try {
    const items = await page.$$('[data-radix-collection-item]');
    for (const item of items) {
      const box = await item.boundingBox();
      if (box) {
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
 * 新しいプロジェクトを開始
 */
async function startNewProject(page) {
  await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // ログインチェック
  if (page.url().includes('accounts.google.com')) {
    throw new Error('Not logged in');
  }

  await dismissNotifications(page);

  // 新しいプロジェクトボタンをクリック
  const newBtn = await findElement(page, SELECTORS.newProjectButton);
  if (newBtn) {
    await newBtn.click();
    await page.waitForTimeout(5000);
  }
}

/**
 * フレームから動画モードを選択して画像をアップロード
 */
async function selectFrameToVideoMode(page, imagePath) {
  console.error('Selecting Frame-to-Video mode...');

  // オーバーレイを閉じるため少し待機
  await page.waitForTimeout(2000);
  await dismissNotifications(page);

  // 1. モードセレクタ（テキストから動画）をクリック
  const modeBtn = await findElement(page, SELECTORS.modeSelector);
  if (modeBtn) {
    await modeBtn.click({ force: true });
    console.error('Clicked mode selector');
    await page.waitForTimeout(1500);

    // 2. 「フレームから動画」を選択
    const frameOption = await page.$(SELECTORS.frameToVideoOption);
    if (frameOption) {
      await frameOption.click({ force: true });
      console.error('Selected Frame-to-Video');
      await page.waitForTimeout(2000);
    }
  }

  // 3. 画像追加のプラスボタンをクリック
  const addImgBtn = await page.$(SELECTORS.addImageButton);
  if (addImgBtn) {
    await addImgBtn.click({ force: true });
    console.error('Clicked add image button');
    await page.waitForTimeout(1500);
  }

  // 4. ファイルを直接設定（アップロードボタンをクリックせずにinput[type="file"]に直接設定）
  const fileInput = await page.$(SELECTORS.fileInput);
  if (fileInput && fs.existsSync(imagePath)) {
    await fileInput.setInputFiles(imagePath);
    console.error('Image uploaded: ' + imagePath);
    await page.waitForTimeout(3000);
  }

  // 6. 「切り抜きして保存」ボタンをクリック
  const cropBtn = await page.$(SELECTORS.cropAndSaveButton);
  if (cropBtn) {
    await cropBtn.click({ force: true });
    console.error('Clicked crop and save');
    await page.waitForTimeout(2000);
  }
}

/**
 * 単一の動画を生成
 */
async function generateVideo(page, config, index) {
  console.error(`\n=== Generating Video ${index} ===`);

  // フレームから動画モードの場合
  if (config.mode === 'frame' && config.imagePath) {
    await selectFrameToVideoMode(page, config.imagePath);
  }

  // プロンプト入力
  const promptInput = await page.waitForSelector(SELECTORS.promptInput, { timeout: 10000 });
  if (!promptInput) throw new Error('Prompt input not found');

  await promptInput.click();
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(config.prompt);
  await page.waitForTimeout(1000);

  // 作成ボタンをクリック
  let createBtn = await findElement(page, SELECTORS.createButton);
  if (!createBtn) throw new Error('Create button not found');

  // ボタンが有効になるまで待機
  for (let i = 0; i < 20; i++) {
    const disabled = await createBtn.getAttribute('disabled');
    if (disabled === null) break;
    await page.waitForTimeout(500);
  }

  await createBtn.click({ force: true });
  console.error('Generation started...');
  await page.waitForTimeout(5000);

  // 動画生成完了を待つ（「シーンに追加」ボタンが表示されるまで）
  const startTime = Date.now();

  while (Date.now() - startTime < config.waitTimeout) {
    await page.waitForTimeout(10000);
    console.error(`  ${Math.round((Date.now() - startTime) / 1000)}s elapsed`);

    await dismissNotifications(page);

    // 「シーンに追加」ボタンが表示されたら動画生成完了
    const addToSceneBtn = await page.$(SELECTORS.addToSceneButton);
    if (addToSceneBtn && await addToSceneBtn.isVisible()) {
      console.error(`Video ${index} generated! Found 'Add to Scene' button`);

      // 「シーンに追加」ボタンをクリック
      await addToSceneBtn.click({ force: true });
      console.error('Clicked Add to Scene button');
      await page.waitForTimeout(3000);

      // シーン拡張プラスボタンが表示されるまで待機
      console.error('Waiting for scene builder...');
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(2000);
        const addClipBtn = await page.$(SELECTORS.addClipButton);
        if (addClipBtn && await addClipBtn.isVisible()) {
          console.error(`Video ${index} ready! Scene builder loaded`);
          break;
        }
        console.error(`  Waiting for add clip button... ${i * 2}s`);
      }
      break;
    }
  }

  return {
    time: Math.round((Date.now() - startTime) / 1000)
  };
}

/**
 * シーン拡張（2個目以降の動画生成）
 */
async function extendScene(page, config, index) {
  console.error(`\n=== Extending Scene ${index} ===`);

  // プラスボタンをクリック（JavaScriptで直接クリックしてドラッグを避ける）
  await dismissNotifications(page);
  await page.waitForSelector(SELECTORS.addClipButton, { timeout: 10000 });

  // JavaScriptで直接クリック（ドラッグ操作を避けるため）
  await page.evaluate(() => {
    const btn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
    if (btn) btn.click();
  });
  console.error('Clicked add clip button (via JS)');
  await page.waitForTimeout(1000);

  // 「拡張…」を選択
  const extendOption = await page.waitForSelector(SELECTORS.extendOption, { timeout: 5000 });
  if (!extendOption) throw new Error('Extend option not found');
  await extendOption.click({ force: true });
  console.error('Selected extend option');
  await page.waitForTimeout(2000);

  // プロンプト入力
  const promptInput = await page.waitForSelector(SELECTORS.promptInput, { timeout: 10000 });
  if (!promptInput) throw new Error('Prompt input not found');

  await promptInput.click();
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(config.prompt);
  await page.waitForTimeout(1000);

  // 作成ボタンをクリック
  let createBtn = await findElement(page, SELECTORS.createButton);
  if (!createBtn) throw new Error('Create button not found');

  // ボタンが有効になるまで待機
  for (let i = 0; i < 20; i++) {
    const disabled = await createBtn.getAttribute('disabled');
    if (disabled === null) break;
    await page.waitForTimeout(500);
  }

  await createBtn.click({ force: true });
  console.error('Extension started...');
  await page.waitForTimeout(5000);

  // 動画生成完了を待つ
  const startTime = Date.now();
  let completed = false;

  // まず、プラスボタンが消える（非表示になる）まで待つ
  console.error('Waiting for generation to start (add clip button should disappear)...');
  let buttonDisappeared = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const addBtnCheck = await page.$(SELECTORS.addClipButton);
    if (!addBtnCheck || !(await addBtnCheck.isVisible())) {
      buttonDisappeared = true;
      console.error('Add clip button disappeared, generation in progress...');
      break;
    }
  }

  // プラスボタンが再度表示されるまで待つ（生成完了）
  while (Date.now() - startTime < config.waitTimeout) {
    await page.waitForTimeout(10000);
    console.error(`  ${Math.round((Date.now() - startTime) / 1000)}s elapsed`);

    await dismissNotifications(page);

    // 拡張完了の判定：プラスボタンが再度表示される
    const addBtnAgain = await page.$(SELECTORS.addClipButton);
    if (addBtnAgain && await addBtnAgain.isVisible()) {
      completed = true;
      console.error(`Scene ${index} extended!`);
      break;
    }
  }

  if (!completed) throw new Error(`Scene ${index} extension timeout`);

  return {
    time: Math.round((Date.now() - startTime) / 1000)
  };
}

/**
 * メイン処理
 */
async function main() {
  const input = process.argv[2];
  let config = { ...DEFAULT_CONFIG };

  if (input) {
    try {
      config = { ...config, ...JSON.parse(input) };
    } catch (e) {
      console.log(JSON.stringify({ error: 'Invalid JSON' }));
      process.exit(1);
    }
  }

  if (!config.prompt) {
    console.log(JSON.stringify({ error: 'Prompt required' }));
    process.exit(1);
  }

  console.error('=== Veo3 Shorts Generation ===');
  console.error('Mode: ' + config.mode);
  console.error('Image: ' + config.imagePath);
  console.error('Prompt: ' + config.prompt.substring(0, 50) + '...');

  let browser, page;
  const results = [];
  let totalTime = 0;

  try {
    browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
    const context = browser.contexts()[0];
    page = await context.newPage();

    // 1. 新しいプロジェクトを開始（1回だけ）
    await startNewProject(page);

    // 2. 1個目: 画像アップロード + 動画生成
    const firstResult = await generateVideo(page, config, 1);
    results.push(firstResult);
    totalTime += firstResult.time;

    // 3. 2個目以降: シーン拡張
    for (let i = 2; i <= config.videoCount; i++) {
      const extResult = await extendScene(page, config, i);
      results.push(extResult);
      totalTime += extResult.time;
    }

    // 4. 最終動画をダウンロード（シーン拡張後は1つの結合された動画になっている）
    console.error('\n=== Downloading final video ===');

    // video要素から最終的なURLを取得
    const videos = await page.$$(SELECTORS.videoElement);
    let finalVideoUrl = null;

    // 最後の動画要素のURLを取得
    for (const video of videos) {
      const src = await video.getAttribute('src');
      if (src && src.startsWith('http')) {
        finalVideoUrl = src;
      }
    }

    if (!finalVideoUrl) {
      throw new Error('Final video URL not found');
    }

    // ダウンロード
    const tempPath = '/tmp/veo3_combined_temp.mp4';
    await downloadVideo(finalVideoUrl, tempPath);

    // 音声なしでコピー
    execSync(`ffmpeg -y -i "${tempPath}" -an -c:v copy "${config.outputPath}"`, { stdio: 'pipe' });

    // 一時ファイル削除
    try { fs.unlinkSync(tempPath); } catch (e) {}

    console.error('Output: ' + config.outputPath);

    await page.close();

    console.log(JSON.stringify({
      success: true,
      outputPath: config.outputPath,
      videoCount: config.videoCount,
      totalTime: totalTime + 's'
    }));
    process.exit(0);

  } catch (e) {
    console.error('Error: ' + e.message);
    if (page) {
      try {
        await page.screenshot({ path: '/tmp/veo3-error.png' });
        await page.close();
      } catch (se) {}
    }
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}

main();
