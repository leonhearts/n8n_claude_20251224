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
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// デフォルト設定
const DEFAULT_CONFIG = {
  prompt: '',
  imagePath: '/tmp/output_kaeuta.png',
  outputPath: '/tmp/veo3_movie.mp4',
  mode: 'frame', // 'frame', 'text', または 'image'
  videoCount: 1,  // 1の場合はシーン拡張なし、2以上でシーン拡張
  waitTimeout: 600000,
  cdpUrl: 'http://192.168.65.254:9222',
  // プロジェクト指定（指定した場合は新規作成せずそのプロジェクトを使用）
  projectUrl: null, // 例: 'https://labs.google/fx/ja/tools/flow/project/xxxxx'
  // 画像生成用オプション
  imageOutputCount: 1,  // 1 または 2
  aspectRatio: 'landscape', // 'landscape'（横向き16:9）または 'portrait'（縦向き9:16）
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
 * 同意ポップアップを閉じる
 */
async function dismissConsentPopup(page) {
  try {
    // 「同意する」ボタンを探してクリック
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
    // ファイルダイアログをEscapeで閉じる
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
  // プロジェクトURLが指定されている場合はそのURLに直接アクセス
  const targetUrl = config.projectUrl || 'https://labs.google/fx/tools/flow';
  console.error('Opening: ' + targetUrl);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // ログインチェック
  if (page.url().includes('accounts.google.com')) {
    throw new Error('Not logged in');
  }

  // ファイルダイアログが開いていたら閉じる
  await dismissFileDialog(page);

  // 同意ポップアップがあれば閉じる
  await dismissConsentPopup(page);

  await dismissNotifications(page);

  // プロジェクトURLが指定されていない場合のみ、新しいプロジェクトボタンをクリック
  if (!config.projectUrl) {
    const newBtn = await findElement(page, SELECTORS.newProjectButton);
    if (newBtn) {
      await newBtn.click();
      await page.waitForTimeout(5000);
    }
  } else {
    console.error('Using existing project');

    // 動画モードの場合、シーンビルダータブに移動
    if (config.mode === 'frame' || config.mode === 'text') {
      const scenebuilderBtn = await page.$(SELECTORS.scenebuilderTab);
      if (scenebuilderBtn && await scenebuilderBtn.isVisible()) {
        await scenebuilderBtn.click();
        console.error('Clicked Scenebuilder tab');
        await page.waitForTimeout(2000);
      }
    }

    await page.waitForTimeout(2000);
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
    // JavaScriptで直接クリック（Playwrightのクリックがオーバーレイでブロックされる場合の対策）
    await addImgBtn.evaluate(el => el.click());
    console.error('Clicked add image button (via JS)');
    await page.waitForTimeout(2000);
  }

  // 4. アップロードボタンをクリックしてファイルダイアログでファイルを設定
  console.error('Looking for upload button...');

  // ファイルダイアログハンドラを設定（開いたらファイルを設定）
  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);

  const uploadBtn = await findElement(page, SELECTORS.uploadButton);
  let fileUploaded = false;

  if (uploadBtn) {
    await uploadBtn.evaluate(el => el.click());
    console.error('Clicked upload button (via JS)');

    // ファイルダイアログが開いた場合、ファイルを直接設定
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

  // 5. fileChooserで設定できなかった場合、file inputを探す
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

  // 6. 「切り抜きして保存」ボタンをクリック
  const cropBtn = await page.$(SELECTORS.cropAndSaveButton);
  if (cropBtn) {
    await cropBtn.click({ force: true });
    console.error('Clicked crop and save');
    await page.waitForTimeout(2000);
  }
}

/**
 * 画像生成モードを選択
 */
async function selectImagesMode(page) {
  console.error('Switching to Images mode...');

  // Imagesボタンをクリック（JSクリック使用）
  const imagesBtn = await page.$(SELECTORS.imagesButton);
  if (imagesBtn) {
    const state = await imagesBtn.getAttribute('data-state');
    if (state !== 'on') {
      await imagesBtn.evaluate(el => el.click());
      console.error('Clicked Images button (via JS)');
      await page.waitForTimeout(1000);
    } else {
      console.error('Images mode already selected');
      // 既にImagesモードなら、セレクタ操作は不要
      return;
    }
  } else {
    console.error('Images button not found');
  }

  // Imagesモードに切り替えた後は、デフォルトで「画像を作成」が選択されるはずなので
  // セレクタ操作は不要（操作するとドロップダウンが開いて入力ができなくなる）
  await page.waitForTimeout(500);
}

/**
 * 画像生成の設定を変更（出力数、縦横比）
 */
async function configureImageSettings(page, config) {
  console.error('Configuring image settings...');

  // 設定ボタンを探してクリック（tuneアイコン）
  const settingsBtn = await page.$(SELECTORS.settingsButton);
  if (settingsBtn) {
    await settingsBtn.evaluate(el => el.click());
    console.error('Clicked settings button');
    await page.waitForTimeout(500);
  }

  // 縦横比の設定
  if (config.aspectRatio) {
    const aspectBtn = await page.$(SELECTORS.aspectRatioButton);
    if (aspectBtn) {
      // 現在の値を確認
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

  // 出力数の設定
  if (config.imageOutputCount) {
    const outputBtn = await page.$(SELECTORS.outputCountButton);
    if (outputBtn) {
      // 現在の値を確認
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

  // 設定パネルを閉じる（Escapeキー）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.error('Image settings configured');
}

/**
 * 画像を生成
 */
async function generateImage(page, config) {
  console.error('\n=== Generating Image ===');

  // 画像モードに切り替え
  await selectImagesMode(page);

  // 画像生成設定を変更
  await configureImageSettings(page, config);

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
  for (let i = 0; i < 120; i++) { // 最大240秒
    await page.waitForTimeout(2000);

    // 生成された画像を探す
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

    // ダウンロードボタンが表示されたら完了
    const downloadBtn = await page.$(SELECTORS.downloadButton);
    if (downloadBtn && await downloadBtn.isVisible()) {
      generated = true;
      console.error('Image generated (download button visible)!');
      break;
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
 * 生成された画像をダウンロード
 */
async function downloadGeneratedImage(page, config) {
  console.error('\n=== Downloading Generated Image ===');

  // 出力パスを画像用に調整
  let outputPath = config.outputPath;
  if (outputPath.endsWith('.mp4')) {
    outputPath = outputPath.replace('.mp4', '.png');
  }

  // 方法1: ダウンロードボタンをクリックしてイベントを待つ（前回成功した方法）
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

      // saveAsを試す
      await download.saveAs(outputPath);
      console.error('Image saved via saveAs: ' + outputPath);
      return outputPath;
    } catch (err) {
      console.error('Download button method failed: ' + err.message);
    }
  }

  // 方法2: 画面上の画像から直接取得（フォールバック）
  console.error('Trying to get image from page (fallback)...');
  const images = await page.$$('img');
  console.error('Found ' + images.length + ' images on page');

  // デバッグ: 画像のsrcをログ出力
  for (let i = 0; i < Math.min(images.length, 5); i++) {
    const src = await images[i].getAttribute('src');
    if (src) {
      console.error('  Image ' + i + ': ' + src.substring(0, 80) + (src.length > 80 ? '...' : ''));
    }
  }

  // data:image形式を探す
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

  // HTTP/HTTPS URLの画像を探す（Google Storage等）
  for (const img of images) {
    const src = await img.getAttribute('src');
    if (src && src.includes('storage.googleapis.com') && src.includes('videofx')) {
      console.error('Found Google Storage image: ' + src.substring(0, 80) + '...');
      try {
        // 拡張子を適切に設定
        let imgOutputPath = outputPath;
        if (src.includes('.jpg') || src.includes('.jpeg')) {
          imgOutputPath = outputPath.replace('.png', '.jpg');
        }
        await downloadVideo(src, imgOutputPath);
        console.error('Image saved from Google Storage: ' + imgOutputPath);
        return imgOutputPath;
      } catch (err) {
        console.error('Failed to download from Google Storage: ' + err.message);
      }
    }
  }

  // blob URLの画像を探す
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
      // 1. プロジェクトを開始
      await startNewProject(page, config);

      // 2. 画像を生成
      await generateImage(page, config);

      // 3. 画像をダウンロード
      const outputPath = await downloadGeneratedImage(page, config);

      totalTime = Math.round((Date.now() - startTime) / 1000);
      console.log(JSON.stringify({
        success: true,
        outputPath: outputPath,
        mode: 'image',
        totalTime: totalTime + 's'
      }));

      await page.close();
      process.exit(0);
    }

    // 動画生成モードの場合
    // 1. プロジェクトを開始（1回だけ）
    await startNewProject(page, config);

    // 2. 1個目: 画像アップロード + 動画生成
    const firstResult = await generateVideo(page, config, 1);
    results.push(firstResult);
    totalTime += firstResult.time;

    // 3. 2個目以降: シーン拡張（videoCountが2以上の場合のみ）
    if (config.videoCount >= 2) {
      for (let i = 2; i <= config.videoCount; i++) {
        const extResult = await extendScene(page, config, i);
        results.push(extResult);
        totalTime += extResult.time;
      }
    }

    // 4. 最終動画をダウンロード
    console.error('\n=== Downloading final video ===');

    const tempPath = '/tmp/veo3_combined_temp.mp4';
    let downloadedFile = null;

    // ダウンロードボタンをクリック
    const downloadBtn = await page.$(SELECTORS.downloadButton);
    if (!downloadBtn || !(await downloadBtn.isVisible())) {
      throw new Error('Download button not found or not visible');
    }

    // 方法1: Playwrightのダウンロードイベントを使用（画像と同じアプローチ）
    console.error('Clicking download button...');
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
      await downloadBtn.click({ force: true });
      console.error('Clicked download button, waiting for download event...');

      const download = await downloadPromise;
      console.error('Download started: ' + download.suggestedFilename());

      const downloadUrl = download.url();
      console.error('Download URL: ' + (downloadUrl ? downloadUrl.substring(0, 100) + '...' : 'null'));

      if (downloadUrl && downloadUrl.startsWith('data:')) {
        // Base64エンコードの場合、デコードして保存
        console.error('Decoding Base64 data URL...');
        const matches = downloadUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          const buffer = Buffer.from(matches[2], 'base64');
          downloadedFile = '/tmp/veo3_download_' + Date.now() + '.mp4';
          fs.writeFileSync(downloadedFile, buffer);
          console.error('Base64 decode successful: ' + downloadedFile + ' (' + (buffer.length / 1024 / 1024).toFixed(2) + 'MB)');
        }
      } else if (downloadUrl && downloadUrl.startsWith('http')) {
        // HTTP URLの場合、直接ダウンロード
        console.error('Downloading via HTTP...');
        downloadedFile = '/tmp/veo3_download_' + Date.now() + '.mp4';
        await downloadVideo(downloadUrl, downloadedFile);
      } else {
        // URLがない場合、saveAsを試す
        downloadedFile = '/tmp/veo3_download_' + Date.now() + '.mp4';
        await download.saveAs(downloadedFile);
        console.error('Saved via saveAs: ' + downloadedFile);
      }
    } catch (err) {
      console.error('Download event method failed: ' + err.message);
    }

    // 方法2: エクスポートダイアログ経由（シーン拡張ありの場合のフォールバック）
    if (!downloadedFile) {
      console.error('Trying export dialog method (fallback)...');

      // ネットワークリクエストをインターセプト
      let capturedDownloadUrl = null;
      page.on('request', request => {
        const url = request.url();
        if ((url.includes('storage.googleapis.com') || url.includes('googleusercontent.com')) &&
            (url.includes('.mp4') || url.includes('video') || url.includes('download'))) {
          console.error('Captured URL: ' + url.substring(0, 100) + '...');
          capturedDownloadUrl = url;
        }
      });

      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(2000);

        // ダウンロードリンクを探す
        const downloadLink = await page.$(SELECTORS.exportDownloadLink);
        if (downloadLink && await downloadLink.isVisible()) {
          console.error('Export dialog found!');
          await page.waitForTimeout(1000);

          // hrefを確認
          const href = await downloadLink.getAttribute('href');
          if (href && href.startsWith('http')) {
            downloadedFile = '/tmp/veo3_export_' + Date.now() + '.mp4';
            await downloadVideo(href, downloadedFile);
            break;
          }

          // クリックしてダウンロードイベントを待つ
          try {
            const dlPromise = page.waitForEvent('download', { timeout: 30000 });
            await downloadLink.evaluate(el => el.click());
            const dl = await dlPromise;
            const dlUrl = dl.url();

            if (dlUrl && dlUrl.startsWith('data:')) {
              const matches = dlUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                downloadedFile = '/tmp/veo3_export_' + Date.now() + '.mp4';
                fs.writeFileSync(downloadedFile, buffer);
                console.error('Base64 decode: ' + downloadedFile);
              }
            } else if (dlUrl) {
              downloadedFile = '/tmp/veo3_export_' + Date.now() + '.mp4';
              await downloadVideo(dlUrl, downloadedFile);
            }
          } catch (e) {
            console.error('Export download failed: ' + e.message);
          }
          break;
        }

        if (i % 10 === 9) {
          console.error('Waiting for export... (' + ((i + 1) * 2) + 's)');
        }
      }
    }

    if (!downloadedFile || !fs.existsSync(downloadedFile)) {
      throw new Error('Download failed - no file downloaded');
    }

    fs.copyFileSync(downloadedFile, tempPath);
    console.error('Copied to temp: ' + tempPath);

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
