/**
 * Veo3 ショート動画生成（シンプル版）
 *
 * 既存のSUNOワークフローに組み込むための最小限のスクリプト
 * ジャケット画像から動画を生成
 *
 * モード:
 * - image: 画像から動画を生成（新規プロジェクト）
 * - frame: フレームから動画を生成（既存プロジェクトのタイムラインに追加）
 *
 * 使用方法:
 * node veo3-shorts-simple.js '{"prompt": "プロンプト", "imagePath": "/tmp/output.png"}'
 * node veo3-shorts-simple.js '{"prompt": "プロンプト", "projectUrl": "https://...", "mode": "frame"}'
 *
 * 出力: /tmp/veo3_shorts_kaeuta.mp4
 */

const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

// 共通モジュールをインポート
const common = require('./veo3-common.js');

// デフォルト設定
const DEFAULT_CONFIG = {
  prompt: '',
  imagePath: '/tmp/output_kaeuta.png',
  outputPath: '/tmp/veo3_shorts_kaeuta.mp4',
  mode: 'image', // 'image' または 'frame'
  projectUrl: null,
  videoCount: 2,
  waitTimeout: 600000,
  download: true,
  keepAudio: false,
};

// セレクタ
const SELECTORS = {
  ...common.SELECTORS,
  modeSelector: 'button[role="combobox"]',
  imageToVideoOption: 'text=画像から動画',
  fileInput: 'input[type="file"]',
};

/**
 * Image-to-Videoモードを選択して画像アップロード
 */
async function selectImageToVideoMode(page, imagePath) {
  console.error('Selecting Image-to-Video mode...');

  await page.waitForTimeout(2000);
  await common.dismissNotifications(page);

  const modeBtn = await common.findElement(page, SELECTORS.modeSelector);
  if (modeBtn) {
    await modeBtn.click({ force: true });
    await page.waitForTimeout(1500);

    const i2vOption = await page.$(SELECTORS.imageToVideoOption);
    if (i2vOption) {
      await i2vOption.click({ force: true });
      await page.waitForTimeout(2000);
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
 * 単一の動画を生成（新規プロジェクト用）
 */
async function generateVideo(page, config, index) {
  console.error(`\n=== Generating Video ${index} ===`);

  // Image-to-Videoモードの場合
  if (config.mode === 'image' && config.imagePath) {
    await selectImageToVideoMode(page, config.imagePath);
  }

  await common.inputPromptAndCreate(page, config.prompt, config);
  console.error('Generation started...');
  await page.waitForTimeout(5000);

  // 動画生成完了を待つ
  const result = await common.waitForVideoGeneration(page, config);

  // シーンに追加してScenebuilderに移動
  await common.clickAddToSceneAndGoToBuilder(page);

  return result;
}

/**
 * Frame-to-Video モードで動画を生成（既存プロジェクト用）
 */
async function generateVideoFrame(page, config, index) {
  console.error(`\n=== Generating Frame Video ${index} ===`);

  // Frame-to-Videoモードを選択
  await common.selectFrameToVideoModeOnly(page);

  await common.inputPromptAndCreate(page, config.prompt, config);
  console.error('Generation started...');
  await page.waitForTimeout(5000);

  // タイムライン内で動画生成完了を待つ（マルチシーンワークフロー用）
  const result = await common.waitForVideoInTimeline(page, config);

  return result;
}

/**
 * 最終動画をダウンロード
 */
async function downloadFinalVideo(page, config) {
  console.error('\n=== Downloading final video ===');

  // video要素から最終的なURLを取得
  const videos = await page.$$(SELECTORS.videoElement);
  let finalVideoUrl = null;

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
  const tempPath = config.outputPath.replace('.mp4', '_temp.mp4');
  await common.downloadFile(finalVideoUrl, tempPath);

  // 音声処理
  if (config.keepAudio) {
    // 音声を保持
    execSync(`mv "${tempPath}" "${config.outputPath}"`, { stdio: 'pipe' });
  } else {
    // 音声なしでコピー
    execSync(`ffmpeg -y -i "${tempPath}" -an -c:v copy "${config.outputPath}"`, { stdio: 'pipe' });
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }

  console.error('Output: ' + config.outputPath);
  return config.outputPath;
}

/**
 * メイン処理
 */
async function main() {
  const input = process.argv[2];
  let config = { ...DEFAULT_CONFIG };

  if (input) {
    try {
      // JSONファイルパスの場合はファイルから読み込む
      if (input.endsWith('.json') && fs.existsSync(input)) {
        const fileContent = fs.readFileSync(input, 'utf8');
        config = { ...config, ...JSON.parse(fileContent) };
        console.error('Config loaded from file: ' + input);
      } else {
        // JSON文字列として解析
        config = { ...config, ...JSON.parse(input) };
      }
    } catch (e) {
      console.log(JSON.stringify({ error: 'Invalid JSON: ' + e.message }));
      process.exit(1);
    }
  }

  if (!config.prompt) {
    console.log(JSON.stringify({ error: 'Prompt required' }));
    process.exit(1);
  }

  console.error('=== Veo3 Shorts Generation ===');
  console.error('Mode: ' + config.mode);
  if (config.projectUrl) {
    console.error('Project URL: ' + config.projectUrl);
  }
  if (config.imagePath) {
    console.error('Image: ' + config.imagePath);
  }
  console.error('Prompt: ' + config.prompt.substring(0, 50) + '...');

  let browser, page;
  const results = [];
  let totalTime = 0;

  try {
    browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
    const context = browser.contexts()[0];
    page = await context.newPage();

    // 1. プロジェクトを開始
    await common.startNewProject(page, config);

    if (config.mode === 'frame' && config.projectUrl) {
      // Frame-to-Video モード（既存プロジェクトのタイムラインに追加）
      const result = await generateVideoFrame(page, config, 1);
      results.push(result);
      totalTime += result.time;

      // 追加のシーン拡張
      for (let i = 2; i <= config.videoCount; i++) {
        const extResult = await common.extendScene(page, config, config.prompt, i);
        results.push(extResult);
        totalTime += extResult.time;
      }
    } else {
      // Image-to-Video モード（新規プロジェクト）
      const firstResult = await generateVideo(page, config, 1);
      results.push(firstResult);
      totalTime += firstResult.time;

      // シーン拡張
      for (let i = 2; i <= config.videoCount; i++) {
        const extResult = await common.extendScene(page, config, config.prompt, i);
        results.push(extResult);
        totalTime += extResult.time;
      }
    }

    // 動画をダウンロード
    if (config.download !== false) {
      await downloadFinalVideo(page, config);
    }

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
