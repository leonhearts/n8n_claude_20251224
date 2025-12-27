/**
 * Google Flow (Veo3) ショート動画生成スクリプト
 *
 * 2つの動画を生成し、FFmpegで結合して16秒のショート動画を作成
 * SUNOオーディオと組み合わせて使用
 *
 * 使用方法:
 * node flow-video-shorts.js '{"prompt": "プロンプト", "mode": "text"|"image", "imagePath": "/path/to/image.jpg"}'
 *
 * モード:
 * - "text": テキストから動画 (Text-to-Video)
 * - "image": 画像から動画 (Image-to-Video)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

/**
 * URLから動画をダウンロード
 */
async function downloadVideo(url, outputPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);

    console.error('Downloading video to: ' + outputPath);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.error('Redirecting to: ' + redirectUrl);
        downloadVideo(redirectUrl, outputPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error('Download failed with status: ' + response.statusCode));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes) {
          const percent = Math.round((downloadedBytes / totalBytes) * 100);
          process.stderr.write(`\rDownload progress: ${percent}%`);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.error('\nDownload complete: ' + outputPath);
        resolve(outputPath);
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

/**
 * FFmpegで動画を結合
 */
function concatenateVideos(video1Path, video2Path, outputPath) {
  console.error('Concatenating videos...');

  // 一時的なリストファイルを作成
  const listFile = '/tmp/ffmpeg-concat-list.txt';
  const listContent = `file '${video1Path}'\nfile '${video2Path}'`;
  fs.writeFileSync(listFile, listContent);

  // FFmpegで結合（音声なし）
  const cmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy -an "${outputPath}"`;
  console.error('Running: ' + cmd);

  try {
    execSync(cmd, { stdio: 'pipe' });
    console.error('Concatenation complete: ' + outputPath);
    fs.unlinkSync(listFile);
    return outputPath;
  } catch (e) {
    console.error('FFmpeg concat error: ' + e.message);
    // 再エンコードを試みる
    const cmdReencode = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -an "${outputPath}"`;
    execSync(cmdReencode, { stdio: 'pipe' });
    fs.unlinkSync(listFile);
    return outputPath;
  }
}

/**
 * オーディオを動画に追加
 */
function addAudioToVideo(videoPath, audioPath, outputPath) {
  console.error('Adding audio to video...');

  // 動画の長さに合わせてオーディオをトリム
  const cmd = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outputPath}"`;
  console.error('Running: ' + cmd);

  try {
    execSync(cmd, { stdio: 'pipe' });
    console.error('Audio added: ' + outputPath);
    return outputPath;
  } catch (e) {
    console.error('FFmpeg audio error: ' + e.message);
    throw e;
  }
}

// セレクタ定義
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
  notificationDrawer: '[role="region"][aria-label*="通知ドロワー"]',
  notificationItem: '[data-radix-collection-item]',
  videoElement: 'video',
  errorMessage: '[role="alert"], .error-message',

  // Image-to-Video用セレクタ
  imageUploadButton: [
    'button:has-text("画像から動画")',
    'button:has-text("Image to video")',
    '[role="combobox"]:has-text("画像")',
  ],
  imageInput: 'input[type="file"]',
  modeSelector: [
    'button[role="combobox"]',
    '.mode-selector',
  ],
};

async function dismissNotifications(page) {
  try {
    const notifications = await page.$$(SELECTORS.notificationItem);
    for (const notification of notifications) {
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
    console.error('Notification dismissal error: ' + e.message);
  }
}

async function findElement(page, selectors, description) {
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
    } catch (e) {}
  }

  console.error(`Could not find ${description}`);
  return null;
}

async function waitForElement(page, selectors, description, timeout = 10000) {
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

/**
 * 単一の動画を生成
 */
async function generateSingleVideo(page, config, videoIndex) {
  console.error(`\n=== Generating Video ${videoIndex} ===`);

  // 通知を閉じる
  await dismissNotifications(page);

  // モード選択（Image-to-Video の場合）
  if (config.mode === 'image' && config.imagePath) {
    console.error('Selecting Image-to-Video mode...');

    // モード選択ボタンをクリック
    const modeBtn = await findElement(page, SELECTORS.modeSelector, 'Mode selector');
    if (modeBtn) {
      await modeBtn.click();
      await page.waitForTimeout(1000);

      // 「画像から動画」を選択
      const imageOption = await page.$('text=画像から動画');
      if (imageOption) {
        await imageOption.click();
        await page.waitForTimeout(1000);
      }
    }

    // 画像をアップロード
    const fileInput = await page.$(SELECTORS.imageInput);
    if (fileInput) {
      await fileInput.setInputFiles(config.imagePath);
      console.error('Image uploaded: ' + config.imagePath);
      await page.waitForTimeout(2000);
    }
  }

  // プロンプト入力
  let promptInput = await waitForElement(page, SELECTORS.promptInput, 'Prompt input', 10000);

  if (!promptInput) {
    const fallbackSelectors = [
      'textarea[placeholder*="動画を生成"]',
      'textarea',
      'div[role="textbox"]',
      '[contenteditable="true"]',
    ];
    promptInput = await findElement(page, fallbackSelectors, 'Prompt input (fallback)');
  }

  if (!promptInput) {
    throw new Error('Could not find prompt input');
  }

  console.error('Entering prompt...');
  await promptInput.click();
  await page.waitForTimeout(500);
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(config.prompt);
  await page.waitForTimeout(1000);

  // 作成ボタンをクリック
  let createBtn = await findElement(page, SELECTORS.createButton, 'Create button');
  if (!createBtn) {
    const fallbackSelectors = [
      'button:has-text("作成")',
      'button:has-text("Generate")',
    ];
    createBtn = await findElement(page, fallbackSelectors, 'Create button (fallback)');
  }

  if (!createBtn) {
    throw new Error('Could not find Create button');
  }

  // ボタンが有効になるまで待機
  for (let i = 0; i < 20; i++) {
    const isDisabled = await createBtn.getAttribute('disabled');
    if (isDisabled === null) break;
    await page.waitForTimeout(500);
  }

  console.error('Clicking Create button...');
  await createBtn.click();
  await page.waitForTimeout(3000);

  // 動画生成完了を待つ
  console.error('Waiting for video generation...');
  const startTime = Date.now();
  let videoUrl = null;

  while (Date.now() - startTime < config.waitTimeout) {
    await page.waitForTimeout(10000);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.error(`Video ${videoIndex}: ${elapsed}s elapsed`);

    await dismissNotifications(page);

    const videoElement = await page.$(SELECTORS.videoElement);
    if (videoElement) {
      const src = await videoElement.getAttribute('src');
      if (src && (src.startsWith('http') || src.startsWith('blob:'))) {
        videoUrl = src;
        console.error(`Video ${videoIndex} generated! URL: ${videoUrl.substring(0, 100)}...`);
        break;
      }
    }

    // エラーチェック
    const errorMsg = await page.$(SELECTORS.errorMessage);
    if (errorMsg) {
      const errorText = await errorMsg.innerText().catch(() => '');
      if (errorText && errorText.includes('エラー')) {
        throw new Error('Generation error: ' + errorText);
      }
    }
  }

  if (!videoUrl) {
    throw new Error(`Video ${videoIndex} generation timeout`);
  }

  // 動画をダウンロード
  let localPath = null;
  if (videoUrl && !videoUrl.startsWith('blob:')) {
    const filename = `flow-video-${videoIndex}-${Date.now()}.mp4`;
    localPath = path.join(config.outputDir, filename);
    await downloadVideo(videoUrl, localPath);
  }

  return {
    videoUrl,
    localPath,
    generationTime: Math.round((Date.now() - startTime) / 1000)
  };
}

async function run() {
  const inputArg = process.argv[2];
  let config = {
    prompt: '',
    mode: 'text', // 'text' or 'image'
    imagePath: null, // Image-to-Video用の画像パス
    audioPath: null, // SUNOオーディオパス（オプション）
    videoCount: 2, // 生成する動画数
    waitTimeout: 600000, // 動画生成待機時間（デフォルト10分）
    outputDir: '/tmp/videos',
    outputFilename: null, // 最終出力ファイル名
    screenshotDir: '/tmp',
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

  // 出力ディレクトリ作成
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }
  if (!fs.existsSync(config.screenshotDir)) {
    fs.mkdirSync(config.screenshotDir, { recursive: true });
  }

  console.error('=== Veo3 Shorts Generation ===');
  console.error('Mode: ' + config.mode);
  console.error('Prompt: ' + config.prompt.substring(0, 100));
  console.error('Video count: ' + config.videoCount);

  let browser;
  let page;
  const generatedVideos = [];

  try {
    // Chrome CDPに接続
    browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
    const context = browser.contexts()[0];
    page = await context.newPage();

    // Google Flowにアクセス
    console.error('Navigating to Google Flow...');
    await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // ログイン確認
    const url = page.url();
    if (url.includes('accounts.google.com')) {
      throw new Error('Not logged in to Google');
    }

    // 新しいプロジェクトを開始
    const newProjectSelectors = [
      'button:has-text("新しいプロジェクト")',
      'button:has(i:text("add_2"))',
    ];
    for (const selector of newProjectSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn && await btn.isVisible()) {
          console.error('Clicking New Project button...');
          await btn.click();
          await page.waitForTimeout(5000);
          break;
        }
      } catch (e) {}
    }

    // 複数の動画を生成
    for (let i = 1; i <= config.videoCount; i++) {
      // 2つ目以降は新しいプロジェクトを作成
      if (i > 1) {
        console.error('Creating new project for video ' + i);
        await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        for (const selector of newProjectSelectors) {
          try {
            const btn = await page.$(selector);
            if (btn && await btn.isVisible()) {
              await btn.click();
              await page.waitForTimeout(5000);
              break;
            }
          } catch (e) {}
        }
      }

      const result = await generateSingleVideo(page, config, i);
      generatedVideos.push(result);

      // スクリーンショット
      const screenshot = path.join(config.screenshotDir, `flow-video-${i}-complete.png`);
      await page.screenshot({ path: screenshot });
    }

    await page.close();

    // 動画を結合
    let finalVideoPath = null;
    if (generatedVideos.length >= 2 && generatedVideos[0].localPath && generatedVideos[1].localPath) {
      const concatOutput = path.join(config.outputDir, `flow-concat-${Date.now()}.mp4`);
      concatenateVideos(generatedVideos[0].localPath, generatedVideos[1].localPath, concatOutput);

      // オーディオを追加（指定されている場合）
      if (config.audioPath && fs.existsSync(config.audioPath)) {
        const finalFilename = config.outputFilename || `flow-shorts-${Date.now()}.mp4`;
        finalVideoPath = path.join(config.outputDir, finalFilename);
        addAudioToVideo(concatOutput, config.audioPath, finalVideoPath);
        fs.unlinkSync(concatOutput); // 中間ファイル削除
      } else {
        finalVideoPath = concatOutput;
      }
    } else if (generatedVideos.length === 1 && generatedVideos[0].localPath) {
      finalVideoPath = generatedVideos[0].localPath;
    }

    // 結果を出力
    const result = {
      success: true,
      videoCount: generatedVideos.length,
      videos: generatedVideos.map((v, i) => ({
        index: i + 1,
        url: v.videoUrl,
        localPath: v.localPath,
        generationTime: v.generationTime + 's'
      })),
      finalVideoPath: finalVideoPath,
      totalGenerationTime: generatedVideos.reduce((sum, v) => sum + v.generationTime, 0) + 's'
    };

    console.log(JSON.stringify(result));
    process.exit(0);

  } catch (e) {
    console.error('Error: ' + e.message);

    if (page) {
      try {
        const errorScreenshot = path.join(config.screenshotDir, 'flow-shorts-error.png');
        await page.screenshot({ path: errorScreenshot });
        await page.close();
      } catch (screenshotError) {}
    }

    console.log(JSON.stringify({
      error: e.message,
      generatedVideos: generatedVideos.length,
      partialResults: generatedVideos
    }));
    process.exit(1);
  }
}

run().catch(e => {
  console.error(e);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
