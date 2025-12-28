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
  cdpUrl: 'http://host.docker.internal:9222',
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
  // エクスポートダイアログ用
  exportDownloadLink: 'a:has-text("ダウンロード")',
  exportCloseButton: 'button:has-text("閉じる")',
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
 * 通知を閉じる（タイムラインのスライダーは除外）
 */
async function dismissNotifications(page) {
  try {
    // 通知要素のみを対象にする（スライダーやタイムライン要素を除外）
    const items = await page.$$('[data-radix-collection-item]:not([role="slider"]):not(.sc-605710a8-2)');
    for (const item of items) {
      // タイムライン関連の要素はスキップ
      const tagName = await item.evaluate(el => el.tagName);
      const role = await item.getAttribute('role');
      if (role === 'slider' || tagName === 'SPAN') continue;

      const box = await item.boundingBox();
      if (box && box.y < 200) { // 画面上部の通知のみ対象
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
  console.error('Looking for file input...');
  await page.waitForTimeout(2000); // ダイアログが開くのを待つ

  const fileInput = await page.$(SELECTORS.fileInput);
  console.error('File input found: ' + (fileInput ? 'yes' : 'no'));

  if (fileInput && fs.existsSync(imagePath)) {
    console.error('Setting input files...');
    await fileInput.setInputFiles(imagePath);
    console.error('Image uploaded: ' + imagePath);
    await page.waitForTimeout(3000);
  } else {
    console.error('File input not found or image does not exist: ' + imagePath);
    // スクリーンショットを撮る
    await page.screenshot({ path: '/tmp/veo3-no-file-input.png' });
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

      // シーン拡張プラスボタンが表示され、有効になるまで待機
      console.error('Waiting for scene builder...');
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(2000);
        const addClipBtn = await page.$(SELECTORS.addClipButton);
        if (addClipBtn && await addClipBtn.isVisible()) {
          // disabled属性がなくなるまで待つ
          const isDisabled = await addClipBtn.getAttribute('disabled');
          if (isDisabled === null) {
            console.error(`Video ${index} ready! Scene builder loaded and button enabled`);
            break;
          }
          console.error(`  Waiting for add clip button to be enabled... ${i * 2}s`);
        } else {
          console.error(`  Waiting for add clip button... ${i * 2}s`);
        }
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

  // プラスボタンが有効になるまで待機
  await dismissNotifications(page);
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

  // JavaScriptで直接クリック（ドラッグ操作を避けるため）
  await page.evaluate(() => {
    const btn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
    if (btn && !btn.disabled) btn.click();
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
    browser = await chromium.connectOverCDP(config.cdpUrl);
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

    // 4. 最終動画をダウンロード
    console.error('\n=== Downloading final video ===');

    const tempPath = '/tmp/veo3_combined_temp.mp4';

    // 可能なダウンロードディレクトリ
    // Windows CDPブラウザ経由のダウンロードは /mnt/downloads にマウントが必要
    // docker run時: -v "C:\Users\Administrator\Downloads:/mnt/downloads"
    const possiblePaths = [
      '/mnt/downloads',  // Windows Downloads フォルダのマウントポイント
      '/home/node/Downloads',
      '/tmp',
      '/home/node',
      '/root/Downloads'
    ];

    // ダウンロード前の既存ファイルを記録
    const existingFiles = new Set();
    for (const dir of possiblePaths) {
      try {
        const files = fs.readdirSync(dir);
        files.forEach(f => existingFiles.add(path.join(dir, f)));
      } catch (e) {}
    }
    console.error('Existing files tracked: ' + existingFiles.size);

    // ステップ1: ダウンロードボタン（アイコン）をクリック → エクスポート開始
    const downloadBtn = await page.$(SELECTORS.downloadButton);
    if (!downloadBtn || !(await downloadBtn.isVisible())) {
      throw new Error('Download button not found or not visible');
    }

    await downloadBtn.click({ force: true });
    console.error('Clicked download button, waiting for export...');

    // ステップ2: エクスポート完了を待ち、ダイアログの「ダウンロード」リンクをクリック
    console.error('Waiting for export dialog...');
    let downloadLinkClicked = false;
    for (let i = 0; i < 60; i++) { // 最大120秒待機
      await page.waitForTimeout(2000);

      // ダウンロードリンクを探す
      const downloadLink = await page.$(SELECTORS.exportDownloadLink);
      if (downloadLink && await downloadLink.isVisible()) {
        console.error('Export complete! Preparing download...');

        // ダイアログが完全に表示されるまで少し待つ
        await page.waitForTimeout(1000);

        // href属性を取得
        const href = await downloadLink.getAttribute('href');
        console.error('Download URL: ' + (href ? href.substring(0, 80) + '...' : 'null'));

        if (href) {
          // target="_blank"を削除してから同じタブでナビゲート
          await downloadLink.evaluate(el => el.removeAttribute('target'));

          // 通常のクリック（forceなし）を試す
          try {
            await downloadLink.click({ timeout: 5000 });
            console.error('Clicked download link (normal click)');
          } catch (clickErr) {
            // クリックが失敗した場合、直接ナビゲート
            console.error('Click failed, navigating directly to URL...');
            await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
          }
        } else {
          // hrefがない場合はforceクリック
          await downloadLink.click({ force: true });
          console.error('Clicked download link (force click, no href)');
        }

        console.error('Download initiated, waiting for file...');
        downloadLinkClicked = true;
        break;
      }

      if (i % 10 === 9) {
        console.error('Still waiting for export... (' + ((i + 1) * 2) + 's)');
      }
    }

    if (!downloadLinkClicked) {
      throw new Error('Export dialog did not appear after 120 seconds');
    }

    // ステップ3: ファイルダウンロードを待つ
    console.error('Waiting for file download...');
    let downloadedFile = null;
    for (let i = 0; i < 45; i++) { // 最大90秒待機
      await page.waitForTimeout(2000);

      for (const dir of possiblePaths) {
        try {
          const files = fs.readdirSync(dir);
          for (const f of files) {
            const fullPath = path.join(dir, f);
            if (f.endsWith('.mp4') &&
                !f.includes('temp') &&
                !f.includes('veo3_') &&
                !existingFiles.has(fullPath)) {
              const stats = fs.statSync(fullPath);
              if (stats.size > 100000) {
                downloadedFile = fullPath;
                console.error('Found downloaded file: ' + downloadedFile + ' (' + (stats.size / 1024 / 1024).toFixed(2) + 'MB)');
                break;
              }
            }
          }
        } catch (e) {}
        if (downloadedFile) break;
      }
      if (downloadedFile) break;

      if (i % 10 === 9) {
        console.error('Still waiting for file... (' + ((i + 1) * 2) + 's)');
      }
    }

    if (downloadedFile) {
      fs.copyFileSync(downloadedFile, tempPath);
      console.error('Copied to temp: ' + tempPath);
      try { fs.unlinkSync(downloadedFile); } catch (e) {}
    } else {
      throw new Error('Download failed - file not found after 90 seconds');
    }

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
