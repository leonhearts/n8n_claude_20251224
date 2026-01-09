/**
 * Veo3 動画/画像生成（シンプル版）
 *
 * 既存のSUNOワークフローに組み込むための最小限のスクリプト
 * - 動画モード: ジャケット画像から動画を生成し、シーン拡張して出力
 * - 画像モード: プロンプトから画像を生成して出力
 *
 * 使用方法:
 *
 * 動画生成（フレームから動画）:
 * node veo3-shorts-simple.js '{"mode": "frame", "prompt": "プロンプト", "imagePath": "/tmp/output_kaeuta.png"}'
 *
 * 画像生成:
 * node veo3-shorts-simple.js '{"mode": "image", "prompt": "プロンプト"}'
 *
 * 出力:
 * - 動画: /tmp/veo3_shorts_kaeuta.mp4
 * - 画像: /tmp/veo3_shorts_kaeuta.png
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
  configureImageSettings,
  generateImage,
  inputPromptAndCreate,
  waitForVideoGeneration,
  clickAddToSceneAndGoToBuilder,
  extendScene,
} = common;

// このスクリプト固有のデフォルト設定
const DEFAULT_CONFIG = {
  ...DEFAULT_CONFIG_BASE,
  imagePath: '/tmp/output_kaeuta.png',
  outputPath: '/tmp/veo3_movie.mp4',
  mode: 'frame', // 'frame', 'text', または 'image'
  videoCount: 1,
  imageOutputCount: 1,
};

/**
 * フレームから動画モードを選択して画像をアップロード
 */
async function selectFrameToVideoMode(page, imagePath) {
  console.error('Selecting Frame-to-Video mode...');

  await page.waitForTimeout(2000);
  await dismissNotifications(page);

  const modeBtn = await findElement(page, SELECTORS.modeSelector);
  if (modeBtn) {
    await modeBtn.click({ force: true });
    console.error('Clicked mode selector');
    await page.waitForTimeout(1500);

    const frameOption = await page.$(SELECTORS.frameToVideoOption);
    if (frameOption) {
      await frameOption.click({ force: true });
      console.error('Selected Frame-to-Video');
      await page.waitForTimeout(2000);
    }
  }

  const addImgBtn = await page.$(SELECTORS.addImageButton);
  if (addImgBtn) {
    await addImgBtn.evaluate(el => el.click());
    console.error('Clicked add image button (via JS)');
    await page.waitForTimeout(2000);
  }

  // 既存のアップロード済み画像があれば削除
  console.error('Checking for existing uploaded images...');
  let existingImageRemoved = false;

  const closeIcons = await page.$$('i.google-symbols');
  console.error('  Found ' + closeIcons.length + ' google-symbols icons...');

  for (const icon of closeIcons) {
    try {
      const iconText = await icon.evaluate(el => el.textContent);
      if (iconText && iconText.trim() === 'close') {
        console.error('  Found close icon, clicking parent div...');
        await icon.evaluate(el => el.parentElement.click());
        await page.waitForTimeout(1500);
        existingImageRemoved = true;
        console.error('  Existing image removed!');
        break;
      }
    } catch (e) {}
  }

  if (!existingImageRemoved) {
    const allIcons = await page.$$('i');
    console.error('  Checking ' + allIcons.length + ' <i> elements...');
    for (const icon of allIcons) {
      try {
        const iconText = await icon.evaluate(el => el.textContent);
        if (iconText && iconText.trim() === 'close') {
          console.error('  Found <i>close</i>, clicking...');
          await icon.click({ force: true });
          await page.waitForTimeout(1500);
          existingImageRemoved = true;
          console.error('  Existing image removed!');
          break;
        }
      } catch (e) {}
    }
  }

  if (!existingImageRemoved) {
    console.error('  No existing image found to remove (proceeding with upload)');
  } else {
    console.error('  Clicking add button again after removing existing image...');
    const allIcons = await page.$$('i.google-symbols');
    let addClicked = false;
    for (const icon of allIcons) {
      try {
        const iconText = await icon.evaluate(el => el.textContent);
        if (iconText && iconText.trim() === 'add') {
          await icon.evaluate(el => el.parentElement.click());
          console.error('  Clicked add button');
          await page.waitForTimeout(2000);
          addClicked = true;
          break;
        }
      } catch (e) {}
    }
    if (!addClicked) {
      console.error('  Could not find add button, trying SELECTORS.addImageButton...');
      const addBtn = await page.$(SELECTORS.addImageButton);
      if (addBtn) {
        await addBtn.evaluate(el => el.click());
        console.error('  Clicked add image button via selector');
        await page.waitForTimeout(2000);
      }
    }
  }

  console.error('Looking for upload button...');

  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);

  const uploadBtn = await findElement(page, SELECTORS.uploadButton);
  let fileUploaded = false;

  if (uploadBtn) {
    await uploadBtn.evaluate(el => el.click());
    console.error('Clicked upload button (via JS)');

    const fileChooser = await fileChooserPromise;
    if (fileChooser) {
      console.error('File dialog opened, setting file via fileChooser...');
      if (fs.existsSync(imagePath)) {
        await fileChooser.setFiles(imagePath);
        console.error('Image uploaded via fileChooser: ' + imagePath);
        fileUploaded = true;
        await page.waitForTimeout(3000);
      } else {
        console.error('Image file does not exist: ' + imagePath);
        await page.keyboard.press('Escape');
      }
    } else {
      console.error('File dialog did not open');
      await page.waitForTimeout(1000);
    }
  } else {
    console.error('Upload button not found');
  }

  if (!fileUploaded) {
    console.error('Looking for file input (fallback)...');
    await page.waitForTimeout(1000);

    const fileInput = await page.$(SELECTORS.fileInput);
    console.error('File input found: ' + (fileInput ? 'yes' : 'no'));

    if (fileInput && fs.existsSync(imagePath)) {
      console.error('Setting input files...');
      await fileInput.setInputFiles(imagePath);
      console.error('Image uploaded: ' + imagePath);
      await page.waitForTimeout(3000);
    } else {
      console.error('File input not found or image does not exist: ' + imagePath);
      await page.screenshot({ path: '/tmp/veo3-no-file-input.png' });
    }
  }

  const cropBtn = await page.$(SELECTORS.cropAndSaveButton);
  if (cropBtn) {
    await cropBtn.click({ force: true });
    console.error('Clicked crop and save');
    await page.waitForTimeout(2000);
  }
}

/**
 * 生成された画像をダウンロード
 */
async function downloadGeneratedImage(page, config) {
  console.error('\n=== Downloading Generated Image ===');

  console.error('Waiting for generated image to be fully loaded...');
  await page.waitForTimeout(3000);

  let outputPath = config.outputPath;
  if (outputPath.endsWith('.mp4')) {
    outputPath = outputPath.replace('.mp4', '.png');
  }

  console.error('Clicking download button...');
  const downloadBtn = await page.$(SELECTORS.downloadButton);
  if (downloadBtn) {
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
      await downloadBtn.click();
      console.error('Clicked download button, waiting for download event...');

      const download = await downloadPromise;
      console.error('Download started: ' + download.suggestedFilename());

      const downloadUrl = download.url();
      console.error('Download URL: ' + (downloadUrl ? downloadUrl.substring(0, 100) + '...' : 'null'));

      if (downloadUrl && downloadUrl.startsWith('data:')) {
        const matches = downloadUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          const buffer = Buffer.from(matches[2], 'base64');
          fs.writeFileSync(outputPath, buffer);
          console.error('Image saved: ' + outputPath + ' (' + (buffer.length / 1024).toFixed(2) + 'KB)');
          return outputPath;
        }
      }

      await download.saveAs(outputPath);
      console.error('Image saved via saveAs: ' + outputPath);
      return outputPath;
    } catch (err) {
      console.error('Download button method failed: ' + err.message);
    }
  }

  // フォールバック: 画面上の画像から直接取得
  console.error('Trying to get image from page (fallback)...');
  const images = await page.$$('img');
  console.error('Found ' + images.length + ' images on page');

  for (let i = 0; i < Math.min(images.length, 5); i++) {
    const src = await images[i].getAttribute('src');
    if (src) {
      console.error('  Image ' + i + ': ' + src.substring(0, 80) + (src.length > 80 ? '...' : ''));
    }
  }

  for (const img of images) {
    const src = await img.getAttribute('src');
    if (src && src.startsWith('data:image')) {
      const matches = src.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        const buffer = Buffer.from(matches[2], 'base64');
        if (buffer.length > 10000) {
          fs.writeFileSync(outputPath, buffer);
          console.error('Image saved from page: ' + outputPath + ' (' + (buffer.length / 1024).toFixed(2) + 'KB)');
          return outputPath;
        }
      }
    }
  }

  for (const img of images) {
    const src = await img.getAttribute('src');
    if (!src) continue;

    const isGoogleImage = src.includes('storage.googleapis.com') ||
                          src.includes('lh3.googleusercontent.com/gg/') ||
                          src.includes('lh3.google.com');

    if (isGoogleImage && !src.includes('/a/ACg8oc')) {
      console.error('Found Google image: ' + src.substring(0, 80) + '...');
      try {
        const size = await img.evaluate(el => ({ width: el.naturalWidth, height: el.naturalHeight }));
        console.error('  Size: ' + size.width + 'x' + size.height);

        if (size.width < 200 || size.height < 200) {
          console.error('  Skipping (too small)');
          continue;
        }

        let imgOutputPath = outputPath;
        if (src.includes('.jpg') || src.includes('.jpeg')) {
          imgOutputPath = outputPath.replace('.png', '.jpg');
        }
        await downloadFile(src, imgOutputPath);
        console.error('Image saved from Google: ' + imgOutputPath);
        return imgOutputPath;
      } catch (err) {
        console.error('Failed to download from Google: ' + err.message);
      }
    }
  }

  for (const img of images) {
    const src = await img.getAttribute('src');
    if (src && src.startsWith('blob:')) {
      console.error('Found blob URL, trying to fetch...');
      try {
        const dataUrl = await page.evaluate(async (imgSrc) => {
          const response = await fetch(imgSrc);
          const blob = await response.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        }, src);

        if (dataUrl && dataUrl.startsWith('data:image')) {
          const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const buffer = Buffer.from(matches[2], 'base64');
            fs.writeFileSync(outputPath, buffer);
            console.error('Image saved from blob: ' + outputPath + ' (' + (buffer.length / 1024).toFixed(2) + 'KB)');
            return outputPath;
          }
        }
      } catch (err) {
        console.error('Failed to fetch blob: ' + err.message);
      }
    }
  }

  throw new Error('Failed to download generated image');
}

/**
 * 動画生成の内部処理（リトライなし）
 */
async function generateVideoInternal(page, config, index) {
  if (config.mode === 'frame' && config.imagePath) {
    await selectFrameToVideoMode(page, config.imagePath);
  }

  await inputPromptAndCreate(page, config.prompt, config);
  console.error('Generation started...');
  await page.waitForTimeout(5000);

  const result = await waitForVideoGeneration(page, config);

  // 「シーンに追加」ボタンをクリックしてシーンビルダーに移動
  await clickAddToSceneAndGoToBuilder(page);

  return result;
}

/**
 * 単一の動画を生成（リトライ機能付き）
 */
async function generateVideo(page, config, index) {
  console.error(`\n=== Generating Video ${index} ===`);

  const maxRetries = config.maxRetries || 3;
  const retryDelay = config.retryDelay || 10000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.error(`\n=== Retry attempt ${attempt}/${maxRetries} for Video ${index} ===`);
        const projectUrl = config.projectUrl || page.url();
        console.error('Reloading project page: ' + projectUrl);
        await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);
        await dismissNotifications(page);
        await dismissConsentPopup(page);
      }

      const result = await generateVideoInternal(page, config, index);
      return result;

    } catch (e) {
      lastError = e;
      const isRetryable = e.message.includes('RETRY:') ||
                          e.message.includes('生成できませんでした') ||
                          e.message.includes('Could not generate');

      if (isRetryable && attempt < maxRetries) {
        console.error(`Generation failed (attempt ${attempt}/${maxRetries}): ${e.message}`);
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
 * 最終動画をダウンロード
 */
async function downloadFinalVideo(page, config) {
  console.error('\n=== Downloading final video ===');

  const tempPath = '/tmp/veo3_combined_temp.mp4';
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
    await page.screenshot({ path: '/tmp/veo3-no-export-dialog.png' });
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
    await page.screenshot({ path: '/tmp/veo3-export-timeout.png' });
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
      downloadedFile = '/tmp/veo3_export_' + Date.now() + '.mp4';
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
        downloadedFile = '/tmp/veo3_export_' + Date.now() + '.mp4';
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
            downloadedFile = '/tmp/veo3_export_' + Date.now() + '.mp4';
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
            downloadedFile = '/tmp/veo3_download_' + Date.now() + '.mp4';
            fs.writeFileSync(downloadedFile, buffer);
            console.error('Base64 decode successful: ' + downloadedFile + ' (' + (buffer.length / 1024 / 1024).toFixed(2) + 'MB)');
          }
        } else if (downloadUrl && downloadUrl.startsWith('http')) {
          downloadedFile = '/tmp/veo3_download_' + Date.now() + '.mp4';
          await downloadFile(downloadUrl, downloadedFile);
        } else {
          downloadedFile = '/tmp/veo3_download_' + Date.now() + '.mp4';
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
    downloadedFile = '/tmp/veo3_captured_' + Date.now() + '.mp4';
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

  if (!config.prompt) {
    console.log(JSON.stringify({ error: 'Prompt required' }));
    process.exit(1);
  }

  console.error('=== Veo3 Generation ===');
  console.error('Mode: ' + config.mode);
  if (config.mode !== 'image') {
    console.error('Image: ' + config.imagePath);
  }
  console.error('Prompt: ' + config.prompt.substring(0, 50) + '...');

  let browser, page;
  const results = [];
  let totalTime = 0;
  const startTime = Date.now();

  try {
    browser = await chromium.connectOverCDP(config.cdpUrl);
    const context = browser.contexts()[0];
    page = await context.newPage();

    // 画像生成モードの場合
    if (config.mode === 'image') {
      const maxRetries = config.maxRetries || 3;
      const retryDelay = config.retryDelay || 10000;
      let lastError = null;
      let outputPath = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            console.error(`\n=== Retry attempt ${attempt}/${maxRetries} for Image Generation ===`);
            const projectUrl = config.projectUrl || page.url();
            console.error('Reloading project page: ' + projectUrl);
            await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(5000);
            await dismissNotifications(page);
            await dismissConsentPopup(page);
          } else {
            await startNewProject(page, config);
          }

          await generateImage(page, config);
          outputPath = await downloadGeneratedImage(page, config);
          break; // 成功したらループを抜ける

        } catch (e) {
          lastError = e;
          const isRetryable = e.message.includes('RETRY:') ||
                              e.message.includes('生成できませんでした') ||
                              e.message.includes('Could not generate') ||
                              e.message.includes('Image generation failed');

          if (isRetryable && attempt < maxRetries) {
            console.error(`Image generation failed (attempt ${attempt}/${maxRetries}): ${e.message}`);
            console.error(`Waiting ${retryDelay / 1000}s before retry...`);
            await page.waitForTimeout(retryDelay);
          } else {
            throw new Error(e.message.replace('RETRY:', ''));
          }
        }
      }

      if (!outputPath) {
        throw lastError || new Error('Image generation failed after all retries');
      }

      const projectUrl = page.url();
      totalTime = Math.round((Date.now() - startTime) / 1000);
      console.log(JSON.stringify({
        success: true,
        outputPath: outputPath,
        projectUrl: projectUrl,
        mode: 'image',
        totalTime: totalTime + 's'
      }));

      await page.close();
      process.exit(0);
    }

    // 動画生成モードの場合
    await startNewProject(page, config);

    const firstResult = await generateVideo(page, config, 1);
    results.push(firstResult);
    totalTime += firstResult.time;

    if (config.videoCount >= 2) {
      for (let i = 2; i <= config.videoCount; i++) {
        const extResult = await extendScene(page, config, config.prompt, i);
        results.push(extResult);
        totalTime += extResult.time;
      }
    }

    if (!config.download) {
      const projectUrl = page.url();
      console.error('\n=== Skipping download (download: false) ===');
      console.error('Project URL: ' + projectUrl);

      await page.close();

      console.log(JSON.stringify({
        success: true,
        projectUrl: projectUrl,
        videoCount: config.videoCount,
        totalTime: totalTime + 's',
        downloaded: false
      }));
      process.exit(0);
    }

    await downloadFinalVideo(page, config);

    const finalProjectUrl = page.url();
    await page.close();

    console.log(JSON.stringify({
      success: true,
      outputPath: config.outputPath,
      projectUrl: finalProjectUrl,
      videoCount: config.videoCount,
      totalTime: totalTime + 's',
      downloaded: true
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
