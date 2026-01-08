/**
 * Veo3 キャラクター動画生成スクリプト
 *
 * スプレッドシートからプロンプトを読み込み、
 * 1つのベース画像から複数シーンの動画を生成
 *
 * 使用方法:
 * node veo3-character-video.js /tmp/config.json
 *
 * config.json:
 * {
 *   "imagePrompt": "ベース画像のプロンプト",
 *   "videoPrompts": ["シーン1のプロンプト", "シーン2のプロンプト", ...],
 *   "outputPath": "/tmp/output.mp4",
 *   "aspectRatio": "portrait|landscape|square",
 *   "download": true,
 *   "keepAudio": true
 * }
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// Default configuration
const DEFAULT_CONFIG = {
  imagePrompt: '',
  videoPrompts: [],
  outputPath: '/tmp/veo3_character_final.mp4',
  aspectRatio: 'portrait',
  movieTime: '15s',
  download: true,
  keepAudio: false,
  waitTimeout: 600000,
  screenshotDir: '/tmp'
};

// Selectors
const SELECTORS = {
  promptInput: '#PINHOLE_TEXT_AREA_ELEMENT_ID',
  createButton: [
    'button[aria-label="作成"]',
    'button:has(i:text("arrow_forward"))',
  ],
  settingsButton: [
    'button[aria-label*="設定"]',
    'button:has(i:text("tune"))',
  ],
  videoElement: 'video',
  newProjectButton: [
    'button:has-text("新しいプロジェクト")',
    'button:has(i:text("add_2"))',
  ],
  // Images mode
  imagesButton: 'button:has-text("Images")',
  addToPromptButton: 'button:has-text("Add To Prompt")',
  // Videos mode
  videosButton: 'button:has-text("Videos")',
  modeSelector: 'button[role="combobox"]',
  frameToVideoOption: 'text=Frame-to-Video',
  // Scene builder
  addToSceneButton: 'button:has-text("Add to Scene")',
  scenebuilderTab: '[role="tab"]:has-text("Scenebuilder")',
  addClipButton: '#PINHOLE_ADD_CLIP_CARD_ID',
  extendOption: '[role="menuitem"]:has-text("拡張")',
  extendOptionEn: '[role="menuitem"]:has-text("Extend")',
  // Aspect ratio settings
  aspectRatioButton: 'button:has-text("9:16"), button:has-text("16:9"), button:has-text("1:1")',
  outputCountButton: 'button:has-text("1"), button:has-text("2"), button:has-text("4")',
  // Download
  downloadButton: 'button:has(i:text("download"))',
  // Timeline
  timelineArea: '[class*="timeline"], [class*="Timeline"]',
};

/**
 * Download video from URL
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
 * Dismiss notifications
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
 * Find visible element from multiple selectors
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
 * Wait for element with timeout
 */
async function waitForElement(page, selectors, timeout = 10000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const el = await findElement(page, list);
    if (el) return el;
    await page.waitForTimeout(500);
  }
  return null;
}

/**
 * Click element using JavaScript (bypasses overlays)
 */
async function jsClick(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.click();
  }, selector);
}

/**
 * Start new project
 */
async function startNewProject(page) {
  console.error('Opening: https://labs.google/fx/tools/flow');
  await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Login check
  if (page.url().includes('accounts.google.com')) {
    throw new Error('Not logged in to Google');
  }

  await dismissNotifications(page);

  // Click new project button if visible
  const newBtn = await findElement(page, SELECTORS.newProjectButton);
  if (newBtn) {
    await newBtn.click();
    await page.waitForTimeout(5000);
  }
}

/**
 * Switch to Images mode
 */
async function switchToImagesMode(page) {
  console.error('Switching to Images mode...');

  // Try clicking Images button via JavaScript to avoid overlay issues
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const imagesBtn = btns.find(b => b.textContent.includes('Images'));
      if (imagesBtn) imagesBtn.click();
    });
    console.error('Clicked Images button (via JS)');
    await page.waitForTimeout(2000);
  } catch (e) {
    console.error('Images button not found');
  }
}

/**
 * Switch to Videos mode
 */
async function switchToVideosMode(page) {
  console.error('Switching to Videos mode...');

  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const videosBtn = btns.find(b => b.textContent.includes('Videos'));
      if (videosBtn) videosBtn.click();
    });
    console.error('Clicked Videos button (via JS)');
    await page.waitForTimeout(2000);
  } catch (e) {
    console.error('Videos button not found');
  }
}

/**
 * Configure image settings (aspect ratio, output count)
 */
async function configureImageSettings(page, aspectRatio) {
  console.error('Configuring image settings...');

  try {
    // Open settings
    const settingsBtn = await findElement(page, SELECTORS.settingsButton);
    if (settingsBtn) {
      await settingsBtn.click({ force: true });
      await page.waitForTimeout(1000);
      console.error('Clicked settings button');

      // Select aspect ratio
      const aspectMap = {
        'portrait': '9:16',
        'landscape': '16:9',
        'square': '1:1'
      };
      const targetAspect = aspectMap[aspectRatio] || '9:16';

      const aspectBtn = await page.$(`button:has-text("${targetAspect}")`);
      if (aspectBtn) {
        await aspectBtn.click({ force: true });
        console.error('Clicked aspect ratio button');
        await page.waitForTimeout(500);
        console.error('Selected aspect ratio: ' + aspectRatio);
      }

      // Select output count = 1
      const outputBtn = await page.$('button:has-text("1")');
      if (outputBtn) {
        await outputBtn.click({ force: true });
        console.error('Clicked output count button');
        await page.waitForTimeout(500);
        console.error('Selected output count: 1');
      }

      // Close settings by clicking elsewhere
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    console.error('Image settings configured');
  } catch (e) {
    console.error('Settings configuration failed: ' + e.message);
  }
}

/**
 * Generate base image
 */
async function generateBaseImage(page, config) {
  console.error('\n=== Generating Base Image ===');
  console.error('Image prompt: ' + config.imagePrompt.substring(0, 80) + '...');

  // Switch to Images mode
  await switchToImagesMode(page);
  await page.waitForTimeout(1000);

  // Verify we're in Images mode
  const imagesActive = await page.$('button[aria-pressed="true"]:has-text("Images")');
  if (imagesActive) {
    console.error('Images mode activated successfully');
  }

  // Wait for UI to update
  console.error('Waiting for UI to update after mode switch...');
  await page.waitForTimeout(2000);

  // Configure settings
  await configureImageSettings(page, config.aspectRatio);

  // Enter prompt
  const promptInput = await page.waitForSelector(SELECTORS.promptInput, { timeout: 10000 });
  if (!promptInput) throw new Error('Prompt input not found');

  await promptInput.click();
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(config.imagePrompt);
  await page.waitForTimeout(1000);

  // Click create button
  const createBtn = await findElement(page, SELECTORS.createButton);
  if (!createBtn) throw new Error('Create button not found');

  // Wait for button to be enabled
  for (let i = 0; i < 20; i++) {
    const disabled = await createBtn.getAttribute('disabled');
    if (disabled === null) break;
    await page.waitForTimeout(500);
  }

  await createBtn.click({ force: true });
  console.error('Clicked create button');
  await page.waitForTimeout(3000);

  // Wait for image generation
  console.error('Waiting for image generation...');
  const startTime = Date.now();

  while (Date.now() - startTime < config.waitTimeout) {
    await page.waitForTimeout(5000);
    await dismissNotifications(page);

    // Check for "Add To Prompt" button which indicates completion
    const addToPromptBtn = await page.$('button:has-text("Add To Prompt")');
    if (addToPromptBtn && await addToPromptBtn.isVisible()) {
      console.error('Image generated! Found "Add To Prompt" button');
      break;
    }
  }

  console.error('Base image generated successfully (not downloading)');
  console.error('Image generation completed in ' + Math.round((Date.now() - startTime) / 1000) + 's');
}

/**
 * Select Frame-to-Video mode (uses generated image as frame)
 */
async function selectFrameToVideoMode(page) {
  console.error('Selecting Frame-to-Video mode (without upload)...');

  // Click mode selector
  const modeBtn = await findElement(page, SELECTORS.modeSelector);
  if (modeBtn) {
    await modeBtn.click({ force: true });
    console.error('Clicked mode selector');
    await page.waitForTimeout(1000);

    // Select Frame-to-Video
    const f2vOption = await page.$('text=Frame-to-Video');
    if (f2vOption) {
      await f2vOption.click({ force: true });
      console.error('Selected Frame-to-Video');
      await page.waitForTimeout(1000);
    }
  }
}

/**
 * Generate first video from image
 */
async function generateFirstVideo(page, config) {
  console.error('\n=== Generating First Video ===');
  console.error('Video prompt: ' + config.videoPrompts[0].substring(0, 80) + '...');

  // Click "Add To Prompt" to use generated image
  console.error('Looking for Add To Prompt button...');
  const addToPromptBtn = await page.waitForSelector('button:has-text("Add To Prompt")', { timeout: 10000 });
  if (addToPromptBtn) {
    await addToPromptBtn.click({ force: true });
    console.error('Clicked Add To Prompt button');
    await page.waitForTimeout(2000);
  }

  // Switch to Videos mode
  await switchToVideosMode(page);

  // Select Frame-to-Video mode
  await selectFrameToVideoMode(page);

  // Enter video prompt
  const promptInput = await page.waitForSelector(SELECTORS.promptInput, { timeout: 10000 });
  if (!promptInput) throw new Error('Prompt input not found');

  await promptInput.click();
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(config.videoPrompts[0]);
  await page.waitForTimeout(1000);

  // Click create button
  const createBtn = await findElement(page, SELECTORS.createButton);
  if (!createBtn) throw new Error('Create button not found');

  for (let i = 0; i < 20; i++) {
    const disabled = await createBtn.getAttribute('disabled');
    if (disabled === null) break;
    await page.waitForTimeout(500);
  }

  await createBtn.click({ force: true });
  console.error('Clicked create button');
  console.error('Video generation started...');
  await page.waitForTimeout(5000);

  // Wait for video generation
  const startTime = Date.now();

  while (Date.now() - startTime < config.waitTimeout) {
    await page.waitForTimeout(15000);
    console.error('  ' + Math.round((Date.now() - startTime) / 1000) + 's elapsed');
    await dismissNotifications(page);

    // Check for "Add to Scene" button
    const addToSceneBtn = await page.$('button:has-text("Add to Scene")');
    if (addToSceneBtn && await addToSceneBtn.isVisible()) {
      console.error('Video generated! Found "Add to Scene" button');

      // Click Add to Scene
      await addToSceneBtn.click({ force: true });
      console.error('Clicked Add to Scene button');
      await page.waitForTimeout(2000);

      // Switch to Scenebuilder tab
      const scenebuilderTab = await page.$('[role="tab"]:has-text("Scenebuilder")');
      if (scenebuilderTab) {
        await scenebuilderTab.click({ force: true });
        console.error('Clicked Scenebuilder tab');
        await page.waitForTimeout(2000);
      }

      // Wait for scene builder to load
      console.error('Waiting for scene builder...');
      await page.waitForSelector(SELECTORS.addClipButton, { timeout: 30000 });

      // Wait for button to be enabled
      for (let i = 0; i < 20; i++) {
        const addClipBtn = await page.$(SELECTORS.addClipButton);
        if (addClipBtn) {
          const disabled = await addClipBtn.getAttribute('disabled');
          if (disabled === null) {
            console.error('Scene builder loaded and button enabled');
            break;
          }
        }
        await page.waitForTimeout(500);
      }

      return;
    }
  }

  throw new Error('First video generation timeout');
}

/**
 * Click timeline at the end to position for extension
 */
async function clickTimelineEnd(page) {
  console.error('Clicking timeline end...');

  try {
    // Find timeline area
    const timelineArea = await page.$('[class*="timeline"], [class*="Timeline"], [class*="scrubber"]');
    if (timelineArea) {
      const box = await timelineArea.boundingBox();
      if (box) {
        // Click near the right end
        await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2);
        console.error('Clicked timeline at right end');
        await page.waitForTimeout(1000);
        return;
      }
    }
    console.error('Timeline area not found');
  } catch (e) {
    console.error('Timeline click failed: ' + e.message);
  }
}

/**
 * Extend scene with retry logic
 * This is the key function with improved error handling
 */
async function extendScene(page, config, sceneIndex, videoPrompt) {
  console.error(`\n=== Extending Scene ${sceneIndex} ===`);
  console.error('Video prompt: ' + videoPrompt.substring(0, 80) + '...');

  // Click timeline end first
  await clickTimelineEnd(page);

  // Retry logic for clicking add clip button and selecting extend
  const MAX_MENU_RETRIES = 5;
  let menuSuccess = false;

  for (let attempt = 1; attempt <= MAX_MENU_RETRIES; attempt++) {
    console.error(`\n=== Extending Scene ${sceneIndex} ===`);

    await dismissNotifications(page);

    // Wait for add clip button to be visible and enabled
    console.error('Waiting for add clip button to be enabled...');
    let addClipBtn = null;

    for (let i = 0; i < 30; i++) {
      addClipBtn = await page.$(SELECTORS.addClipButton);
      if (addClipBtn) {
        const isVisible = await addClipBtn.isVisible();
        const disabled = await addClipBtn.getAttribute('disabled');
        if (isVisible && disabled === null) {
          console.error('Add clip button is enabled');
          break;
        }
      }
      await page.waitForTimeout(1000);
    }

    if (!addClipBtn) {
      throw new Error('Add clip button not found');
    }

    // Click add clip button using JavaScript to avoid overlay issues
    await page.evaluate(() => {
      const btn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
      if (btn) btn.click();
    });
    console.error('Clicked add clip button (via JS)');
    await page.waitForTimeout(1500);

    // Try to find extend option with retry
    let extendOption = null;

    // First try Japanese selector
    extendOption = await page.$('[role="menuitem"]:has-text("拡張")');
    if (!extendOption) {
      // Try English selector
      extendOption = await page.$('[role="menuitem"]:has-text("Extend")');
    }

    if (extendOption) {
      const isVisible = await extendOption.isVisible();
      if (isVisible) {
        await extendOption.click({ force: true });
        console.error('Selected extend option');
        menuSuccess = true;
        break;
      } else {
        console.error(`Attempt ${attempt}: Extend option found but hidden`);

        // Close the menu by pressing Escape or clicking elsewhere
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);

        // Wait longer before retry
        const waitTime = 2000 * attempt;
        console.error(`Waiting ${waitTime}ms before retry...`);
        await page.waitForTimeout(waitTime);

        // Try scrolling the menu if it exists
        try {
          await page.evaluate(() => {
            const menu = document.querySelector('[role="menu"]');
            if (menu) menu.scrollTop = 0;
          });
        } catch (e) {}
      }
    } else {
      console.error(`Attempt ${attempt}: Extend option not found in menu`);

      // Close menu and retry
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000 * attempt);
    }
  }

  if (!menuSuccess) {
    // Take screenshot for debugging
    const screenshotPath = `/tmp/veo3-extend-failed-scene${sceneIndex}.png`;
    await page.screenshot({ path: screenshotPath });
    console.error(`Screenshot saved: ${screenshotPath}`);
    throw new Error(`Failed to select extend option after ${MAX_MENU_RETRIES} attempts`);
  }

  await page.waitForTimeout(2000);

  // Enter video prompt
  const promptInput = await page.waitForSelector(SELECTORS.promptInput, { timeout: 10000 });
  if (!promptInput) throw new Error('Prompt input not found');

  await promptInput.click();
  await promptInput.fill('');
  await page.waitForTimeout(300);
  await promptInput.fill(videoPrompt);
  await page.waitForTimeout(1000);

  // Click create button
  const createBtn = await findElement(page, SELECTORS.createButton);
  if (!createBtn) throw new Error('Create button not found');

  for (let i = 0; i < 20; i++) {
    const disabled = await createBtn.getAttribute('disabled');
    if (disabled === null) break;
    await page.waitForTimeout(500);
  }

  await createBtn.click({ force: true });
  console.error('Clicked create button');
  console.error('Extension started...');
  await page.waitForTimeout(3000);

  // Wait for extension to complete
  const startTime = Date.now();
  console.error('Waiting for generation to start (add clip button should disappear)...');

  // Wait for add clip button to become available again (indicates completion)
  while (Date.now() - startTime < config.waitTimeout) {
    await page.waitForTimeout(10000);
    await dismissNotifications(page);

    // Check if add clip button is visible and enabled again
    const addClipBtnAgain = await page.$(SELECTORS.addClipButton);
    if (addClipBtnAgain) {
      const isVisible = await addClipBtnAgain.isVisible();
      const disabled = await addClipBtnAgain.getAttribute('disabled');
      if (isVisible && disabled === null) {
        console.error('  ' + Math.round((Date.now() - startTime) / 1000) + 's elapsed');
        console.error(`Scene ${sceneIndex} extended!`);
        return;
      }
    }
  }

  throw new Error(`Scene ${sceneIndex} extension timeout`);
}

/**
 * Download final video
 */
async function downloadFinalVideo(page, config) {
  console.error('\n=== Downloading Final Video ===');

  // Find video element
  const videos = await page.$$('video');
  let videoUrl = null;

  for (const video of videos) {
    const src = await video.getAttribute('src');
    if (src && src.startsWith('http')) {
      videoUrl = src;
    }
  }

  if (!videoUrl) {
    // Try to click download button
    const downloadBtn = await findElement(page, SELECTORS.downloadButton);
    if (downloadBtn) {
      await downloadBtn.click({ force: true });
      await page.waitForTimeout(3000);

      // Check for video again
      for (const video of await page.$$('video')) {
        const src = await video.getAttribute('src');
        if (src && src.startsWith('http')) {
          videoUrl = src;
          break;
        }
      }
    }
  }

  if (!videoUrl) {
    throw new Error('Could not find video URL for download');
  }

  // Download video
  const tempPath = '/tmp/veo3_character_temp.mp4';
  await downloadVideo(videoUrl, tempPath);

  // Process with ffmpeg (remove audio if requested)
  if (config.keepAudio) {
    execSync(`ffmpeg -y -i "${tempPath}" -c copy "${config.outputPath}"`, { stdio: 'pipe' });
  } else {
    execSync(`ffmpeg -y -i "${tempPath}" -an -c:v copy "${config.outputPath}"`, { stdio: 'pipe' });
  }

  // Clean up temp file
  try { fs.unlinkSync(tempPath); } catch (e) {}

  console.error('Output: ' + config.outputPath);
  return config.outputPath;
}

/**
 * Main entry point
 */
async function main() {
  let configPath = process.argv[2];
  let config = { ...DEFAULT_CONFIG };

  // Load config from file if path provided
  if (configPath && fs.existsSync(configPath)) {
    console.error('Read config from file: ' + configPath);
    const fileContent = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(fileContent);
    config = { ...config, ...parsed };
  } else if (configPath) {
    // Try to parse as JSON directly
    try {
      const parsed = JSON.parse(configPath);
      config = { ...config, ...parsed };
    } catch (e) {
      console.log(JSON.stringify({ success: false, error: 'Invalid config: ' + e.message }));
      process.exit(1);
    }
  }

  if (!config.imagePrompt) {
    console.log(JSON.stringify({ success: false, error: 'imagePrompt is required' }));
    process.exit(1);
  }

  if (!config.videoPrompts || config.videoPrompts.length === 0) {
    console.log(JSON.stringify({ success: false, error: 'At least one videoPrompt is required' }));
    process.exit(1);
  }

  console.error('=== Veo3 Character Video Generation ===');
  console.error('Image prompt: ' + config.imagePrompt.substring(0, 50) + '...');
  console.error('Video prompts: ' + config.videoPrompts.length + ' scenes');
  console.error('Style: ' + (config.style || '(default)'));
  console.error('Movie time: ' + config.movieTime);
  console.error('Aspect ratio: ' + config.aspectRatio);
  console.error('Opening: https://labs.google/fx/tools/flow');

  let browser, page;
  const startTime = Date.now();

  try {
    // Connect to Chrome via CDP
    browser = await chromium.connectOverCDP('http://192.168.65.254:9222');
    const context = browser.contexts()[0];
    page = await context.newPage();

    // Start new project
    await startNewProject(page);

    // Generate base image
    await generateBaseImage(page, config);

    // Generate first video
    await generateFirstVideo(page, config);

    // Extend with remaining scenes
    for (let i = 1; i < config.videoPrompts.length; i++) {
      await extendScene(page, config, i + 1, config.videoPrompts[i]);

      // Add a small delay between scenes to prevent rate limiting
      if (i < config.videoPrompts.length - 1) {
        await page.waitForTimeout(2000);
      }
    }

    // Get project URL
    const projectUrl = page.url();

    // Download final video if requested
    let outputPath = null;
    if (config.download) {
      outputPath = await downloadFinalVideo(page, config);
    }

    await page.close();

    const totalTime = Math.round((Date.now() - startTime) / 1000);

    console.log(JSON.stringify({
      success: true,
      outputPath: outputPath,
      projectUrl: projectUrl,
      sceneCount: config.videoPrompts.length,
      totalTime: totalTime + 's'
    }));
    process.exit(0);

  } catch (e) {
    console.error('Error: ' + e.message);

    if (page) {
      try {
        const screenshotPath = '/tmp/veo3-character-error.png';
        await page.screenshot({ path: screenshotPath });
        console.error('Error screenshot saved: ' + screenshotPath);
        await page.close();
      } catch (se) {}
    }

    console.log(JSON.stringify({
      success: false,
      error: e.message,
      sceneCount: 0
    }));
    process.exit(1);
  }
}

main();
