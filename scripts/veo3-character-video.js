/**
 * Veo3 キャラクター動画生成
 *
 * スプレッドシートデータから複数シーンのキャラクター動画を生成
 *
 * ワークフロー:
 * 1. 画像プロンプトからベース画像を生成（ダウンロードなし）
 * 2. 「Add To Prompt」ボタンをクリック
 * 3. 動画プロンプト1を入力 → Frame-to-Videoモード → 生成 → シーンに追加
 * 4. ループ: タイムライン右端クリック → 拡張 → 動画プロンプトN → 生成
 * 5. 最終動画をダウンロード
 *
 * 使用方法:
 * node veo3-character-video.js '{"imagePrompt": "...", "videoPrompts": ["...", "..."], "outputPath": "/tmp/output.mp4"}'
 *
 * または設定ファイル:
 * node veo3-character-video.js /path/to/config.json
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 共通モジュールをインポート
const common = require('./veo3-common');
const {
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
  extendScene,
  clickTimelineEnd,
  clickAddToPrompt,
  selectFrameToVideoModeOnly,
} = common;

// このスクリプト固有のデフォルト設定
const DEFAULT_CONFIG = {
  ...DEFAULT_CONFIG_BASE,
  imagePrompt: '',
  videoPrompts: [],
  outputPath: '/tmp/veo3_character.mp4',
  movieTime: 15, // 目標動画時間（秒）
  style: '', // スタイル指定（空の場合は元動画参照）
  aspectRatio: 'portrait', // キャラクター動画は縦向きがデフォルト
  imageOutputCount: 1,
  sceneDelay: 3000, // 改善3: シーン間の待機時間（ミリ秒）
};

/**
 * ベース画像を生成（ダウンロードなし）
 */
async function generateBaseImage(page, config) {
  console.error('\n=== Generating Base Image ===');
  console.error('Image prompt: ' + config.imagePrompt.substring(0, 80) + '...');

  // 画像生成モードに切り替え
  await selectImagesMode(page);

  console.error('Waiting for UI to update after mode switch...');
  await page.waitForTimeout(3000);

  // 画像設定を構成
  await configureImageSettings(page, {
    aspectRatio: config.aspectRatio,
    imageOutputCount: config.imageOutputCount || 1,
  });

  // プロンプト入力
  const promptInput = await page.waitForSelector(SELECTORS.promptInput, { timeout: 10000 });
  if (!promptInput) throw new Error('Prompt input not found');

  await promptInput.click();
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(config.imagePrompt);
  await page.waitForTimeout(1000);

  // 作成ボタンをクリック
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

  // 画像生成完了を待機
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
      // 「Add To Prompt」ボタンが表示されたら画像生成完了
      const addToPromptBtn = await page.$(SELECTORS.addToPromptButton);
      if (addToPromptBtn && await addToPromptBtn.isVisible()) {
        generated = true;
        console.error('Image generated! Found "Add To Prompt" button');
        break;
      }

      // または画像が表示されていることを確認
      const images = await page.$$('img');
      for (const img of images) {
        const src = await img.getAttribute('src');
        if (src && (src.startsWith('data:image') || src.includes('generated') || src.includes('blob:'))) {
          // ダウンロードボタンも確認
          const downloadBtn = await page.$(SELECTORS.downloadButton);
          if (downloadBtn && await downloadBtn.isVisible()) {
            generated = true;
            console.error('Image generated (download button visible)!');
            break;
          }
        }
      }
      if (generated) break;

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

  console.error('Base image generated successfully (not downloading)');
  return true;
}

/**
 * 最初の動画を生成（Add To Prompt → Frame-to-Video → 生成）
 */
async function generateFirstVideo(page, config, videoPrompt) {
  console.error('\n=== Generating First Video ===');
  console.error('Video prompt: ' + videoPrompt.substring(0, 80) + '...');

  // 「Add To Prompt」ボタンをクリック
  const addToPromptSuccess = await clickAddToPrompt(page);
  if (!addToPromptSuccess) {
    throw new Error('Failed to click Add To Prompt button');
  }

  // Videosモードに切り替え
  await selectVideosMode(page);
  await page.waitForTimeout(2000);

  // Frame-to-Videoモードを選択（画像アップロードなし、既にプロンプトに追加されているため）
  await selectFrameToVideoModeOnly(page);

  // プロンプト入力して生成開始
  await inputPromptAndCreate(page, videoPrompt, config);
  console.error('Video generation started...');
  await page.waitForTimeout(5000);

  // 動画生成完了を待機
  const result = await waitForVideoGeneration(page, config);

  // 「シーンに追加」ボタンをクリックしてシーンビルダーに移動
  await clickAddToSceneAndGoToBuilder(page);

  return result;
}

/**
 * シーンを拡張（タイムライン右端クリック → 拡張）
 */
async function extendWithPrompt(page, config, videoPrompt, index) {
  console.error(`\n=== Extending Scene ${index} ===`);
  console.error('Video prompt: ' + videoPrompt.substring(0, 80) + '...');

  // タイムラインの右端をクリック
  await clickTimelineEnd(page);

  // extendScene関数を使用してシーン拡張
  const result = await extendScene(page, config, videoPrompt, index);

  return result;
}

/**
 * 最終動画をダウンロード
 */
async function downloadFinalVideo(page, config) {
  console.error('\n=== Downloading final video ===');

  const tempPath = config.outputPath.replace('.mp4', '_temp.mp4');
  let downloadedFile = null;

  let downloadBtn = await page.$(SELECTORS.downloadButton);
  if (!downloadBtn || !(await downloadBtn.isVisible())) {
    throw new Error('Download button not found or not visible');
  }

  console.error('Clicking download button to open export dialog...');
  await downloadBtn.click({ force: true });
  await page.waitForTimeout(3000);

  console.error('Waiting for export dialog...');
  let exportDialogFound = false;
  let downloadLink = null;

  for (let i = 0; i < 30; i++) {
    downloadLink = await page.$(SELECTORS.exportDownloadLink);
    if (downloadLink && await downloadLink.isVisible()) {
      exportDialogFound = true;
      console.error('Export dialog found after ' + ((i + 1) * 2) + 's');
      break;
    }

    const closeBtn = await page.$(SELECTORS.exportCloseButton);
    if (closeBtn && await closeBtn.isVisible()) {
      exportDialogFound = true;
      console.error('Export dialog detected (close button visible) after ' + ((i + 1) * 2) + 's');
      break;
    }

    if (i % 5 === 4) {
      console.error('  Waiting for export dialog... ' + ((i + 1) * 2) + 's');
    }
    await page.waitForTimeout(2000);
  }

  if (!exportDialogFound) {
    console.error('Export dialog not found, taking screenshot...');
    await page.screenshot({ path: '/tmp/veo3-character-no-export-dialog.png' });
  }

  console.error('Waiting for export to complete...');
  const exportTimeout = Math.max(config.waitTimeout, 600000);
  const exportStartTime = Date.now();
  let exportComplete = false;

  while (Date.now() - exportStartTime < exportTimeout) {
    downloadLink = await page.$(SELECTORS.exportDownloadLink);

    if (downloadLink && await downloadLink.isVisible()) {
      const href = await downloadLink.getAttribute('href');

      if (href && (href.startsWith('http') || href.startsWith('data:') || href.startsWith('blob:'))) {
        exportComplete = true;
        console.error('Export complete! href ready after ' + Math.round((Date.now() - exportStartTime) / 1000) + 's');
        console.error('  href: ' + href.substring(0, 80) + '...');
        break;
      }

      const linkText = await downloadLink.textContent();
      if (linkText && !linkText.includes('準備') && !linkText.includes('Processing') && !linkText.includes('...')) {
        const isDisabled = await downloadLink.getAttribute('disabled');
        const ariaDisabled = await downloadLink.getAttribute('aria-disabled');
        if (!isDisabled && ariaDisabled !== 'true') {
          console.error('Download link appears ready (text: ' + linkText + ')');
          exportComplete = true;
          break;
        }
      }
    }

    const pageText = await page.evaluate(() => document.body.innerText);
    const hasProgress = pageText.includes('エクスポート中') ||
                        pageText.includes('Exporting') ||
                        pageText.includes('Processing') ||
                        pageText.includes('準備中');

    const elapsed = Math.round((Date.now() - exportStartTime) / 1000);
    if (elapsed % 30 === 0) {
      console.error('  Export in progress... ' + elapsed + 's (progress indicator: ' + hasProgress + ')');
    }

    await page.waitForTimeout(5000);
  }

  if (!exportComplete) {
    console.error('Export may not be complete, but proceeding with download attempt...');
    await page.screenshot({ path: '/tmp/veo3-character-export-timeout.png' });
  }

  let capturedDownloadUrl = null;
  page.on('request', request => {
    const url = request.url();
    if ((url.includes('storage.googleapis.com') || url.includes('googleusercontent.com')) &&
        (url.includes('.mp4') || url.includes('video') || url.includes('download'))) {
      console.error('Captured URL: ' + url.substring(0, 100) + '...');
      capturedDownloadUrl = url;
    }
  });

  // 方法1: hrefから直接取得
  downloadLink = await page.$(SELECTORS.exportDownloadLink);
  if (downloadLink && await downloadLink.isVisible()) {
    const href = await downloadLink.getAttribute('href');
    console.error('Download link href: ' + (href ? href.substring(0, 80) + '...' : 'null'));

    if (href && href.startsWith('http')) {
      console.error('Downloading via HTTP URL...');
      downloadedFile = '/tmp/veo3_character_export_' + Date.now() + '.mp4';
      try {
        await downloadFile(href, downloadedFile);
      } catch (err) {
        console.error('HTTP download failed: ' + err.message);
        downloadedFile = null;
      }
    }

    if (!downloadedFile && href && href.startsWith('data:')) {
      console.error('Decoding data URL...');
      const matches = href.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        const buffer = Buffer.from(matches[2], 'base64');
        downloadedFile = '/tmp/veo3_character_export_' + Date.now() + '.mp4';
        fs.writeFileSync(downloadedFile, buffer);
        console.error('Base64 decode: ' + downloadedFile + ' (' + (buffer.length / 1024 / 1024).toFixed(2) + 'MB)');
      }
    }

    if (!downloadedFile && href && href.startsWith('blob:')) {
      console.error('Fetching blob URL...');
      try {
        const dataUrl = await page.evaluate(async (blobUrl) => {
          const response = await fetch(blobUrl);
          const blob = await response.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        }, href);

        if (dataUrl && dataUrl.startsWith('data:')) {
          const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const buffer = Buffer.from(matches[2], 'base64');
            downloadedFile = '/tmp/veo3_character_export_' + Date.now() + '.mp4';
            fs.writeFileSync(downloadedFile, buffer);
            console.error('Blob fetch successful: ' + downloadedFile + ' (' + (buffer.length / 1024 / 1024).toFixed(2) + 'MB)');
          }
        }
      } catch (err) {
        console.error('Blob fetch failed: ' + err.message);
      }
    }
  }

  // 方法2: クリックしてイベント待機
  if (!downloadedFile) {
    console.error('Trying click download method...');
    downloadLink = await page.$(SELECTORS.exportDownloadLink);

    if (downloadLink && await downloadLink.isVisible()) {
      try {
        const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
        await downloadLink.evaluate(el => el.click());
        console.error('Clicked download link, waiting for download event...');

        const download = await downloadPromise;
        console.error('Download started: ' + download.suggestedFilename());

        const downloadUrl = download.url();
        console.error('Download URL: ' + (downloadUrl ? downloadUrl.substring(0, 100) + '...' : 'null'));

        if (downloadUrl && downloadUrl.startsWith('data:')) {
          const matches = downloadUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const buffer = Buffer.from(matches[2], 'base64');
            downloadedFile = '/tmp/veo3_character_download_' + Date.now() + '.mp4';
            fs.writeFileSync(downloadedFile, buffer);
            console.error('Base64 decode successful: ' + downloadedFile + ' (' + (buffer.length / 1024 / 1024).toFixed(2) + 'MB)');
          }
        } else if (downloadUrl && downloadUrl.startsWith('http')) {
          downloadedFile = '/tmp/veo3_character_download_' + Date.now() + '.mp4';
          await downloadFile(downloadUrl, downloadedFile);
        } else {
          downloadedFile = '/tmp/veo3_character_download_' + Date.now() + '.mp4';
          await download.saveAs(downloadedFile);
          console.error('Saved via saveAs: ' + downloadedFile);
        }
      } catch (err) {
        console.error('Click download method failed: ' + err.message);
      }
    }
  }

  // 方法3: キャプチャしたURL
  if (!downloadedFile && capturedDownloadUrl) {
    console.error('Trying captured URL: ' + capturedDownloadUrl.substring(0, 80) + '...');
    downloadedFile = '/tmp/veo3_character_captured_' + Date.now() + '.mp4';
    try {
      await downloadFile(capturedDownloadUrl, downloadedFile);
    } catch (err) {
      console.error('Captured URL download failed: ' + err.message);
      downloadedFile = null;
    }
  }

  // 方法4: Chromeダウンロードフォルダ
  if (!downloadedFile) {
    console.error('Trying to find Chrome downloaded file (method 4)...');

    const downloadDirs = [
      '/mnt/downloads',
      '/home/node/Downloads'
    ];

    for (let wait = 0; wait < 30; wait++) {
      await page.waitForTimeout(2000);

      for (const dir of downloadDirs) {
        try {
          const files = fs.readdirSync(dir);
          const mp4Files = files
            .filter(f => f.endsWith('.mp4') && (
              f.includes('flow') ||
              f.includes('video') ||
              f.includes('scene') ||
              f.includes('export') ||
              /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)_/.test(f)
            ))
            .map(f => ({
              name: f,
              path: path.join(dir, f),
              mtime: fs.statSync(path.join(dir, f)).mtime
            }))
            .sort((a, b) => b.mtime - a.mtime);

          if (mp4Files.length > 0) {
            const newest = mp4Files[0];
            const stats = fs.statSync(newest.path);
            if (Date.now() - newest.mtime.getTime() < 300000 && stats.size > 100000) {
              console.error('Found Chrome downloaded file: ' + newest.path + ' (' + (stats.size / 1024 / 1024).toFixed(2) + 'MB)');
              downloadedFile = newest.path;
              break;
            }
          }
        } catch (e) {}
      }

      if (downloadedFile) break;

      if (wait % 10 === 9) {
        console.error('  Waiting for Chrome download... (' + ((wait + 1) * 2) + 's)');
      }
    }
  }

  if (!downloadedFile || !fs.existsSync(downloadedFile)) {
    throw new Error('Download failed - no file downloaded');
  }

  fs.copyFileSync(downloadedFile, tempPath);
  console.error('Copied to temp: ' + tempPath);

  const audioOption = config.keepAudio ? '-c:a copy' : '-an';
  console.error('Audio option: ' + (config.keepAudio ? 'keep audio' : 'remove audio'));
  execSync(`ffmpeg -y -i "${tempPath}" ${audioOption} -c:v copy "${config.outputPath}"`, { stdio: 'pipe' });

  try { fs.unlinkSync(tempPath); } catch (e) {}

  console.error('Output: ' + config.outputPath);
  return config.outputPath;
}

/**
 * メイン処理
 */
async function main() {
  let input = process.argv[2];
  let config = { ...DEFAULT_CONFIG };

  if (input) {
    try {
      if (input.startsWith('/') || input.endsWith('.json')) {
        if (fs.existsSync(input)) {
          input = fs.readFileSync(input, 'utf8');
          console.error('Read config from file: ' + process.argv[2]);
        }
      }
      config = { ...config, ...JSON.parse(input) };
    } catch (e) {
      console.log(JSON.stringify({ error: 'Invalid JSON: ' + e.message }));
      process.exit(1);
    }
  }

  // 必須パラメータチェック
  if (!config.imagePrompt) {
    console.log(JSON.stringify({ error: 'imagePrompt required' }));
    process.exit(1);
  }

  if (!config.videoPrompts || config.videoPrompts.length === 0) {
    console.log(JSON.stringify({ error: 'videoPrompts required (array of prompts)' }));
    process.exit(1);
  }

  // 空の動画プロンプトをフィルタリング
  const videoPrompts = config.videoPrompts.filter(p => p && p.trim() !== '');
  if (videoPrompts.length === 0) {
    console.log(JSON.stringify({ error: 'At least one non-empty video prompt required' }));
    process.exit(1);
  }

  console.error('=== Veo3 Character Video Generation ===');
  console.error('Image prompt: ' + config.imagePrompt.substring(0, 50) + '...');
  console.error('Video prompts: ' + videoPrompts.length + ' scenes');
  console.error('Style: ' + (config.style || '(default)'));
  console.error('Movie time: ' + config.movieTime + 's');
  console.error('Aspect ratio: ' + config.aspectRatio);

  let browser, page;
  const results = [];
  let totalTime = 0;
  const startTime = Date.now();

  try {
    browser = await chromium.connectOverCDP(config.cdpUrl);
    const context = browser.contexts()[0];
    page = await context.newPage();

    // ステップ1: プロジェクト開始
    await startNewProject(page, config);

    // ステップ2: ベース画像を生成（ダウンロードなし）
    await generateBaseImage(page, config);
    const imageTime = Math.round((Date.now() - startTime) / 1000);
    console.error(`Image generation completed in ${imageTime}s`);
    results.push({ type: 'image', time: imageTime });

    // ステップ3: 最初の動画を生成
    const firstVideoPrompt = videoPrompts[0];
    const firstVideoResult = await generateFirstVideo(page, config, firstVideoPrompt);
    results.push({ type: 'video', index: 1, time: firstVideoResult.time });
    totalTime += firstVideoResult.time;

    // ステップ4: 追加の動画プロンプトでシーンを拡張
    for (let i = 1; i < videoPrompts.length; i++) {
      const videoPrompt = videoPrompts[i];
      const extendResult = await extendWithPrompt(page, config, videoPrompt, i + 1);
      results.push({ type: 'extension', index: i + 1, time: extendResult.time });
      totalTime += extendResult.time;

      // ===== 改善3: シーン間の待機時間追加 =====
      if (i < videoPrompts.length - 1) {
        const delay = config.sceneDelay || 3000;
        console.error(`Waiting ${delay / 1000}s before next scene...`);
        await page.waitForTimeout(delay);
      }
    }

    // ダウンロードをスキップする場合
    if (!config.download) {
      const projectUrl = page.url();
      console.error('\n=== Skipping download (download: false) ===');
      console.error('Project URL: ' + projectUrl);

      await page.close();

      console.log(JSON.stringify({
        success: true,
        projectUrl: projectUrl,
        sceneCount: videoPrompts.length,
        totalTime: Math.round((Date.now() - startTime) / 1000) + 's',
        downloaded: false,
        results: results
      }));
      process.exit(0);
    }

    // ステップ5: 最終動画をダウンロード
    await downloadFinalVideo(page, config);

    const finalProjectUrl = page.url();
    await page.close();

    const finalTotalTime = Math.round((Date.now() - startTime) / 1000);

    console.log(JSON.stringify({
      success: true,
      outputPath: config.outputPath,
      projectUrl: finalProjectUrl,
      sceneCount: videoPrompts.length,
      totalTime: finalTotalTime + 's',
      downloaded: true,
      results: results
    }));
    process.exit(0);

  } catch (e) {
    console.error('Error: ' + e.message);
    if (page) {
      try {
        await page.screenshot({ path: '/tmp/veo3-character-error.png' });
        await page.close();
      } catch (se) {}
    }
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}

main();
