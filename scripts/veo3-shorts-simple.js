/**
 * Veo3 ショート動画生成（フレームから動画対応版）
 *
 * SUNOワークフロー統合用
 * ジャケット画像から2つの動画を生成（1回目:アップロード、2回目:シーン拡張）
 *
 * 使用方法:
 * node veo3-shorts-simple.js '{"prompt": "プロンプト", "imagePath": "/tmp/output_kaeuta.png"}'
 *
 * モード:
 * - "frame": フレームから動画（画像参照、デフォルト）
 * - "text": テキストから動画
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
  screenshotDir: '/tmp',
};

// セレクタ定義（実際のHTMLに基づく）
const SELECTORS = {
  // 共通
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

  // モード選択
  modeSelector: 'button[role="combobox"]',
  frameToVideoOption: 'text=フレームから動画',
  textToVideoOption: 'text=テキストから動画',
  imageToVideoOption: 'text=画像から動画',

  // フレームから動画用
  addImageButton: 'button:has(i.google-symbols:text("add"))',
  uploadButton: [
    'button:has(i:text("upload"))',
    'button:has-text("アップロード")',
  ],
  fileInput: 'input[type="file"]',
  cropAndSaveButton: [
    'button:has-text("切り抜きして保存")',
    'button:has(i:text("crop"))',
  ],

  // シーン拡張用（2回目以降）
  addClipButton: '#PINHOLE_ADD_CLIP_CARD_ID',
  extendMenuItem: [
    'div[role="menuitem"]:has-text("拡張")',
    'div[role="menuitem"]:has(i:text("logout"))',
  ],

  // ダウンロード
  downloadButton: 'button:has(i:text("download"))',

  // 通知
  notificationItem: '[data-radix-collection-item]',
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
    const items = await page.$$(SELECTORS.notificationItem);
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
async function findElement(page, selectors, timeout = 5000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    for (const sel of list) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          console.error('  Found: ' + sel);
          return el;
        }
      } catch (e) {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}

/**
 * 新しいプロジェクトを開始
 */
async function startNewProject(page) {
  console.error('\n--- Starting new project ---');
  await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  if (page.url().includes('accounts.google.com')) {
    throw new Error('Not logged in to Google');
  }

  await dismissNotifications(page);

  const newBtn = await findElement(page, SELECTORS.newProjectButton);
  if (newBtn) {
    await newBtn.click();
    await page.waitForTimeout(5000);
    console.error('New project created');
  }
}

/**
 * フレームから動画モードを選択して画像をアップロード
 */
async function selectFrameToVideoMode(page, imagePath, config) {
  console.error('\n--- Selecting Frame-to-Video mode ---');

  // 1. モードセレクタをクリック
  const modeBtn = await findElement(page, SELECTORS.modeSelector);
  if (modeBtn) {
    await modeBtn.click();
    await page.waitForTimeout(1000);

    // 2. 「フレームから動画」を選択
    const frameOption = await page.$('text=フレームから動画');
    if (frameOption) {
      await frameOption.click();
      console.error('Selected: フレームから動画');
      await page.waitForTimeout(1500);
    } else {
      console.error('Warning: フレームから動画 option not found, trying alternatives...');
      // 画像から動画を試す
      const imgOption = await page.$('text=画像から動画');
      if (imgOption) {
        await imgOption.click();
        await page.waitForTimeout(1500);
      }
    }
  }

  // 3. 画像追加「+」ボタンをクリック
  console.error('Looking for add image button...');
  const addBtn = await findElement(page, SELECTORS.addImageButton, 10000);
  if (addBtn) {
    await addBtn.click();
    console.error('Clicked add image button');
    await page.waitForTimeout(2000);
  } else {
    console.error('Warning: Add image button not found');
  }

  // 4. 「アップロード」ボタンをクリック
  console.error('Looking for upload button...');
  const uploadBtn = await findElement(page, SELECTORS.uploadButton, 10000);
  if (uploadBtn) {
    await uploadBtn.click();
    console.error('Clicked upload button');
    await page.waitForTimeout(1500);
  }

  // 5. ファイル選択（input[type="file"]にファイルをセット）
  console.error('Setting file input...');
  const fileInput = await page.$(SELECTORS.fileInput);
  if (fileInput && fs.existsSync(imagePath)) {
    await fileInput.setInputFiles(imagePath);
    console.error('File uploaded: ' + imagePath);
    await page.waitForTimeout(3000);
  } else {
    console.error('Warning: File input not found or image does not exist');
    // スクリーンショットを保存
    await page.screenshot({ path: path.join(config.screenshotDir, 'veo3-upload-error.png') });
  }

  // 6. 「切り抜きして保存」ボタンをクリック
  console.error('Looking for crop and save button...');
  const cropBtn = await findElement(page, SELECTORS.cropAndSaveButton, 10000);
  if (cropBtn) {
    await cropBtn.click();
    console.error('Clicked crop and save');
    await page.waitForTimeout(3000);
  } else {
    console.error('Warning: Crop button not found, may already be processed');
  }

  console.error('Frame-to-Video mode setup complete');
}

/**
 * シーン拡張（2回目以降の動画生成）
 */
async function extendScene(page) {
  console.error('\n--- Extending scene ---');

  // 1. シーン拡張「+」ボタンをクリック
  const addClipBtn = await findElement(page, SELECTORS.addClipButton, 10000);
  if (!addClipBtn) {
    throw new Error('Add clip button not found');
  }
  await addClipBtn.click();
  console.error('Clicked add clip button');
  await page.waitForTimeout(1500);

  // 2. 「拡張…」メニューを選択
  const extendItem = await findElement(page, SELECTORS.extendMenuItem, 5000);
  if (!extendItem) {
    throw new Error('Extend menu item not found');
  }
  await extendItem.click();
  console.error('Selected extend option');
  await page.waitForTimeout(2000);
}

/**
 * 動画生成を実行して完了を待つ
 */
async function generateAndWait(page, config, videoIndex) {
  console.error(`\n=== Generating Video ${videoIndex} ===`);

  // プロンプト入力
  console.error('Entering prompt...');
  const promptInput = await page.waitForSelector(SELECTORS.promptInput, { timeout: 15000 });
  if (!promptInput) {
    throw new Error('Prompt input not found');
  }

  await promptInput.click();
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(config.prompt);
  await page.waitForTimeout(1000);

  // 作成ボタンをクリック
  console.error('Looking for create button...');
  const createBtn = await findElement(page, SELECTORS.createButton, 10000);
  if (!createBtn) {
    throw new Error('Create button not found');
  }

  // ボタンが有効になるまで待機
  for (let i = 0; i < 30; i++) {
    const disabled = await createBtn.getAttribute('disabled');
    if (disabled === null) break;
    await page.waitForTimeout(500);
  }

  await createBtn.click();
  console.error('Generation started');
  await page.waitForTimeout(5000);

  // スクリーンショット
  await page.screenshot({ path: path.join(config.screenshotDir, `veo3-generating-${videoIndex}.png`) });

  // 動画生成完了を待つ
  const startTime = Date.now();
  let videoUrl = null;

  while (Date.now() - startTime < config.waitTimeout) {
    await page.waitForTimeout(10000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.error(`  ${elapsed}s elapsed...`);

    await dismissNotifications(page);

    // 動画要素を探す
    const videos = await page.$$(SELECTORS.videoElement);
    for (const video of videos) {
      const src = await video.getAttribute('src');
      if (src && src.startsWith('http')) {
        videoUrl = src;
        console.error(`Video ${videoIndex} ready!`);
        break;
      }
    }

    if (videoUrl) break;
  }

  if (!videoUrl) {
    await page.screenshot({ path: path.join(config.screenshotDir, `veo3-timeout-${videoIndex}.png`) });
    throw new Error(`Video ${videoIndex} generation timeout`);
  }

  // ダウンロード
  const tempPath = `/tmp/veo3_temp_${videoIndex}.mp4`;
  await downloadVideo(videoUrl, tempPath);

  return {
    url: videoUrl,
    path: tempPath,
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
    fs.mkdirSync(config.screenshotDir, { recursive: true });
  }

  console.error('=== Veo3 Shorts Generation ===');
  console.error('Mode: ' + config.mode);
  console.error('Image: ' + config.imagePath);
  console.error('Video count: ' + config.videoCount);
  console.error('Prompt: ' + config.prompt.substring(0, 50) + '...');

  let browser, page;
  const videos = [];

  try {
    browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
    const context = browser.contexts()[0];
    page = await context.newPage();

    // 新しいプロジェクト開始
    await startNewProject(page);

    // モードに応じた処理
    if (config.mode === 'frame' && config.imagePath) {
      // フレームから動画モード

      // 1回目: 画像アップロード + 生成
      await selectFrameToVideoMode(page, config.imagePath, config);
      const video1 = await generateAndWait(page, config, 1);
      videos.push(video1);

      // 2回目以降: シーン拡張
      for (let i = 2; i <= config.videoCount; i++) {
        await extendScene(page);
        const video = await generateAndWait(page, config, i);
        videos.push(video);
      }

    } else {
      // テキストから動画モード
      for (let i = 1; i <= config.videoCount; i++) {
        if (i > 1) {
          await startNewProject(page);
        }
        const video = await generateAndWait(page, config, i);
        videos.push(video);
      }
    }

    // 最終スクリーンショット
    await page.screenshot({ path: path.join(config.screenshotDir, 'veo3-complete.png') });
    await page.close();

    // 動画を結合（音声なし）
    if (videos.length >= 2) {
      console.error('\n--- Concatenating videos ---');

      const listFile = '/tmp/veo3_concat_list.txt';
      const listContent = videos.map(v => `file '${v.path}'`).join('\n');
      fs.writeFileSync(listFile, listContent);

      try {
        execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy -an "${config.outputPath}"`, { stdio: 'pipe' });
      } catch (e) {
        // コーデックが異なる場合は再エンコード
        console.error('Re-encoding with libx264...');
        execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -an "${config.outputPath}"`, { stdio: 'pipe' });
      }

      fs.unlinkSync(listFile);

      // 一時ファイル削除
      videos.forEach(v => {
        try { fs.unlinkSync(v.path); } catch (e) {}
      });

      console.error('Output: ' + config.outputPath);

    } else if (videos.length === 1) {
      execSync(`ffmpeg -y -i "${videos[0].path}" -an -c:v copy "${config.outputPath}"`, { stdio: 'pipe' });
      try { fs.unlinkSync(videos[0].path); } catch (e) {}
    }

    // 結果出力
    const result = {
      success: true,
      outputPath: config.outputPath,
      videoCount: videos.length,
      videos: videos.map((v, i) => ({
        index: i + 1,
        generationTime: v.time + 's'
      })),
      totalTime: videos.reduce((sum, v) => sum + v.time, 0) + 's'
    };

    console.log(JSON.stringify(result));
    process.exit(0);

  } catch (e) {
    console.error('Error: ' + e.message);

    if (page) {
      try {
        await page.screenshot({ path: path.join(config.screenshotDir, 'veo3-error.png') });
        await page.close();
      } catch (se) {}
    }

    console.log(JSON.stringify({
      error: e.message,
      generatedVideos: videos.length
    }));
    process.exit(1);
  }
}

main();
