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
  mode: 'image', // 'image' または 'text'
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
  modeSelector: 'button[role="combobox"]',
  imageToVideoOption: 'text=画像から動画',
  fileInput: 'input[type="file"]',
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
 * Image-to-Videoモードを選択
 */
async function selectImageToVideoMode(page, imagePath) {
  console.error('Selecting Image-to-Video mode...');

  // モードセレクタをクリック
  const modeBtn = await findElement(page, SELECTORS.modeSelector);
  if (modeBtn) {
    await modeBtn.click();
    await page.waitForTimeout(1000);

    // 「画像から動画」を選択
    const i2vOption = await page.$('text=画像から動画');
    if (i2vOption) {
      await i2vOption.click();
      await page.waitForTimeout(1500);
    }
  }

  // 画像をアップロード
  const fileInput = await page.$(SELECTORS.fileInput);
  if (fileInput && fs.existsSync(imagePath)) {
    await fileInput.setInputFiles(imagePath);
    console.error('Image uploaded: ' + imagePath);
    await page.waitForTimeout(3000);
  }
}

/**
 * 単一の動画を生成
 */
async function generateVideo(page, config, index) {
  console.error(`\n=== Generating Video ${index} ===`);

  // Image-to-Videoモードの場合
  if (config.mode === 'image' && config.imagePath) {
    await selectImageToVideoMode(page, config.imagePath);
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

  await createBtn.click();
  console.error('Generation started...');
  await page.waitForTimeout(5000);

  // 動画生成完了を待つ
  const startTime = Date.now();
  let videoUrl = null;

  while (Date.now() - startTime < config.waitTimeout) {
    await page.waitForTimeout(10000);
    console.error(`  ${Math.round((Date.now() - startTime) / 1000)}s elapsed`);

    await dismissNotifications(page);

    const video = await page.$(SELECTORS.videoElement);
    if (video) {
      const src = await video.getAttribute('src');
      if (src && src.startsWith('http')) {
        videoUrl = src;
        console.error(`Video ${index} ready!`);
        break;
      }
    }
  }

  if (!videoUrl) throw new Error(`Video ${index} generation timeout`);

  // ダウンロード
  const tempPath = `/tmp/veo3_temp_${index}.mp4`;
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
  const videos = [];

  try {
    browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
    const context = browser.contexts()[0];
    page = await context.newPage();

    // 動画を生成
    for (let i = 1; i <= config.videoCount; i++) {
      await startNewProject(page);
      const result = await generateVideo(page, config, i);
      videos.push(result);
    }

    await page.close();

    // 動画を結合（音声なし）
    if (videos.length >= 2) {
      console.error('\nConcatenating videos...');

      const listFile = '/tmp/veo3_concat_list.txt';
      const listContent = videos.map(v => `file '${v.path}'`).join('\n');
      fs.writeFileSync(listFile, listContent);

      // 結合（音声なし）
      try {
        execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy -an "${config.outputPath}"`, { stdio: 'pipe' });
      } catch (e) {
        // 再エンコード
        execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -an "${config.outputPath}"`, { stdio: 'pipe' });
      }

      fs.unlinkSync(listFile);
      console.error('Output: ' + config.outputPath);

      // 一時ファイル削除
      videos.forEach(v => {
        try { fs.unlinkSync(v.path); } catch (e) {}
      });
    } else if (videos.length === 1) {
      // 1つだけの場合はコピー
      execSync(`ffmpeg -y -i "${videos[0].path}" -an -c:v copy "${config.outputPath}"`, { stdio: 'pipe' });
    }

    console.log(JSON.stringify({
      success: true,
      outputPath: config.outputPath,
      videoCount: videos.length,
      totalTime: videos.reduce((sum, v) => sum + v.time, 0) + 's'
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
