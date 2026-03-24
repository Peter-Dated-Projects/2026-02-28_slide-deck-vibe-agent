/**
 * ---------------------------------------------------------------------------
 * (c) 2026 Freedom, LLC.
 * This file is part of the SlideDeckVibeAgent System.
 *
 * All Rights Reserved. This code is the confidential and proprietary 
 * information of Freedom, LLC ("Confidential Information"). You shall not 
 * disclose such Confidential Information and shall use it only in accordance 
 * with the terms of the license agreement you entered into with Freedom, LLC.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs/promises');
const { chromium } = require('playwright-core');
const sharp = require('sharp');
const PREVIEW_VIEWPORT = { width: 1920, height: 1080 };
const PREVIEW_OUTPUT = { width: 1280, height: 720 };
const PREVIEW_JPEG_QUALITY = 80;
const PREVIEW_CAPTURE_DELAY_MS = 5000;
const PREVIEW_BROWSER_LAUNCH_TIMEOUT_MS = 45000;
(async () => {
  const [, , htmlPath, outputPath] = process.argv;
  if (!htmlPath || !outputPath) {
    throw new Error('Missing htmlPath/outputPath arguments');
  }
  const html = await fs.readFile(htmlPath, { encoding: 'utf-8' });
  const browser = await chromium.launch({
    headless: true,
    timeout: PREVIEW_BROWSER_LAUNCH_TIMEOUT_MS,
    args: ['--disable-gpu', '--disable-dev-shm-usage']
  });
  try {
    const context = await browser.newContext({ viewport: PREVIEW_VIEWPORT });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(PREVIEW_CAPTURE_DELAY_MS);
    const png = await page.screenshot({ type: 'png', fullPage: false });
    const jpeg = await sharp(png)
      .resize(PREVIEW_OUTPUT.width, PREVIEW_OUTPUT.height, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: PREVIEW_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    await fs.writeFile(outputPath, jpeg);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
