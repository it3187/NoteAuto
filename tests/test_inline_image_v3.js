const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function runInlineImageTestV3() {
  const profilePath = path.resolve(__dirname, 'data', 'chrome_profile');
  console.log(`[Test] Using Chrome Profile: ${profilePath}`);

  console.log('[Test] Launching browser...');
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  console.log('[Test] Navigating to note editor...');
  await page.goto('https://editor.note.com/new');

  // Wait for load
  await page.waitForTimeout(4000);

  if (page.url().includes('login')) {
    console.log('[Test] Redirected to login. Waiting for manual login (max 300s)...');
    try {
      await page.waitForURL('**/new', { timeout: 300000 });
      console.log('[Test] Login detected!');
      await page.waitForTimeout(3000);
    } catch (err) {
      console.error('[Test] Login timed out.');
      await context.close();
      process.exit(1);
    }
  }

  try {
    // 1. Fill Title
    console.log('[Test] Filling title...');
    const titleTextarea = page.locator('textarea[placeholder="記事タイトル"]');
    await titleTextarea.waitFor({ state: 'visible', timeout: 15000 });
    await titleTextarea.click();
    await titleTextarea.fill('【画像テストV3】途中画像挿入検証 ' + new Date().toLocaleString());
    await page.waitForTimeout(1000);

    // 2. Select Cover Image
    console.log('[Test] Finding header image button...');
    const headerImageButton = page.locator('button[aria-label="画像を追加"], button[aria-label="カバー画像を設定する"], .note-editor__header-image-button, button:has-text("画像を設定")').first();
    await headerImageButton.waitFor({ state: 'attached', timeout: 10000 });
    await headerImageButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    console.log('[Test] Clicking cover image button...');
    await headerImageButton.click({ force: true });
    await page.waitForTimeout(2500);

    const galleryMenuItem = page.getByText('記事にあう画像を選ぶ', { exact: true });
    await galleryMenuItem.waitFor({ state: 'visible', timeout: 5000 });
    await galleryMenuItem.click();

    await page.waitForSelector('.ReactModalPortal [class*="modal"], .ReactModalPortal div, [role="dialog"]', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(2000);

    const firstPhoto = page.locator('.ReactModalPortal img').first();
    await firstPhoto.waitFor({ state: 'visible', timeout: 8000 });
    await firstPhoto.click();
    await page.waitForTimeout(2000);

    const selectImageButton = page.locator('.ReactModalPortal button:has-text("この画像を挿入")').first();
    await selectImageButton.waitFor({ state: 'visible', timeout: 5000 });
    await selectImageButton.click();
    await page.waitForTimeout(3000);

    const cropConfirmButton = page.locator('.ReactModalPortal button:has-text("保存")').first();
    await cropConfirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await cropConfirmButton.click();
    await page.waitForTimeout(5000);

    // =========================================================================
    // 3. Scenario E: Click "+" Menu & Upload Real Image File
    // =========================================================================
    console.log('\n--- Running Scenario E: Upload Real File via "+" Menu ---');
    const bodyEditor = page.locator('.ProseMirror, .note-editor__body, div[contenteditable="true"]').first();
    await bodyEditor.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditor.click();

    // Select all & clear
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');

    console.log('[Test Scenario E] Typing intro text...');
    await page.keyboard.insertText('3. アプローチE：追加メニューからの画像アップロード\n以下に本物のファイルをアップロードします：\n');
    await page.waitForTimeout(1000);

    // Press Enter to create a new empty paragraph block
    console.log('[Test Scenario E] Pressing Enter to create empty paragraph...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Click "+" button
    console.log('[Test Scenario E] Clicking "+" menu button...');
    const menuButton = page.locator('button[aria-label="追加メニューを開く"], button[class*="insert-menu"], .note-editor__insert-menu-button, button[aria-label*="メニュー"]').first();
    await menuButton.click({ force: true });
    await page.waitForTimeout(2000);

    // Take debug screenshot to confirm if "+" menu opened
    const debugMenuPath = path.resolve(__dirname, 'debug_menu_opened.png');
    await page.screenshot({ path: debugMenuPath });
    console.log(`[Test Scenario E] Saved debug menu screenshot to: ${debugMenuPath}`);

    // Set up file chooser interceptor
    console.log('[Test Scenario E] Preparing file chooser interceptor...');
    const fileChooserPromise = page.waitForEvent('filechooser');

    // Click "画像" button in the insert menu
    console.log('[Test Scenario E] Clicking "画像を追加" button...');
    const imageUploadButton = page.locator('button[aria-label="画像を追加"], button[aria-label="画像"], button:has-text("画像")').first();
    await imageUploadButton.click({ force: true });

    // Intercept file chooser and set the local file
    const fileChooser = await fileChooserPromise;
    const localImagePath = path.resolve(__dirname, 'Src', 'public', 'last_pipeline_upload.png');
    
    if (!fs.existsSync(localImagePath)) {
      fs.writeFileSync(localImagePath, 'dummy content', 'utf-8');
    }

    console.log(`[Test Scenario E] Uploading file: ${localImagePath}`);
    await fileChooser.setFiles(localImagePath);

    console.log('[Test Scenario E] Waiting for upload and rendering (10s)...');
    await page.waitForTimeout(10000);

    const screenshotPath = path.resolve(__dirname, 'success_inline_E.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`[Test Scenario E] Screenshot saved: ${screenshotPath}`);

    // Save Draft
    console.log('[Test] Saving draft...');
    const saveButton = page.locator('button:has-text("下書き保存")');
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await page.waitForTimeout(5000);
    }

  } catch (error) {
    console.error('[Test] Error during inline image testing V3:', error);
    try {
      const errScreenshot = path.resolve(__dirname, 'error_inline_v3_test.png');
      await page.screenshot({ path: errScreenshot });
      console.log(`[Test] Saved error screenshot: ${errScreenshot}`);
    } catch (shotErr) {
      console.error('[Test] Failed to take error screenshot:', shotErr.message);
    }
  } finally {
    await context.close();
    console.log('[Test] Browser context closed.');
  }
}

runInlineImageTestV3();
