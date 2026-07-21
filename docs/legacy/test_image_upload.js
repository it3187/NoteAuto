const { chromium } = require('playwright');
const path = require('path');

async function runTest() {
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
    await titleTextarea.fill('【テスト】自動化パイプライン検証用タイトル ' + new Date().toLocaleString());
    await page.waitForTimeout(1000);

    // 2. Select Cover Image (Before filling body)
    console.log('[Test] Finding header image button...');
    const headerImageButton = page.locator('button[aria-label="画像を追加"], button[aria-label="カバー画像を設定する"], .note-editor__header-image-button, button:has-text("画像を設定")').first();
    
    await headerImageButton.waitFor({ state: 'attached', timeout: 10000 });
    await headerImageButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    console.log('[Test] Clicking cover image button...');
    await headerImageButton.click({ force: true });
    await page.waitForTimeout(2500);

    // Click "記事にあう画像を選ぶ"
    console.log('[Test] Clicking "記事にあう画像を選ぶ"...');
    const galleryMenuItem = page.getByText('記事にあう画像を選ぶ', { exact: true });
    await galleryMenuItem.waitFor({ state: 'visible', timeout: 5000 });
    await galleryMenuItem.click();

    console.log('[Test] Waiting for Photo Gallery modal...');
    await page.waitForSelector('.ReactModalPortal [class*="modal"], .ReactModalPortal div, [role="dialog"]', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(3000);

    console.log('[Test] Clicking the first image in the gallery...');
    const firstPhoto = page.locator('.ReactModalPortal img').first();
    await firstPhoto.waitFor({ state: 'visible', timeout: 8000 });
    await firstPhoto.click();
    await page.waitForTimeout(2000);

    // Click "この画像を挿入" button (Image Selection Step)
    console.log('[Test] Clicking "この画像を挿入" button...');
    const selectImageButton = page.locator('.ReactModalPortal button:has-text("この画像を挿入")').first();
    await selectImageButton.waitFor({ state: 'visible', timeout: 5000 });
    await selectImageButton.click();
    console.log('[Test] First button "この画像を挿入" clicked.');
    
    await page.waitForTimeout(3000); // Wait for Crop/Trim modal to appear

    // [DEBUG] Scan crop modal for buttons
    console.log('[Test Debug] Scanning buttons in Crop/Trim modal...');
    const cropButtons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ReactModalPortal button, .ReactModalPortal [role="button"], .ReactModalPortal div')).map(el => {
        const text = el.innerText ? el.innerText.trim() : '';
        if (text && text.length < 60 && (text.includes('挿入') || text.includes('設定') || text.includes('保存') || text.includes('適用') || text.includes('キャンセル'))) {
          return { tagName: el.tagName, text: text, className: el.className };
        }
        return null;
      }).filter(x => x !== null);
    });
    console.log('[Test Debug] Found crop buttons:', JSON.stringify(cropButtons, null, 2));

    // Wait and Click confirmation button on Cropping Step (It might also be named "この画像を挿入")
    console.log('[Test] Looking for crop confirmation button...');
    const cropConfirmButton = page.locator('.ReactModalPortal button:has-text("この画像を挿入"), .ReactModalPortal button:has-text("適用"), .ReactModalPortal button:has-text("設定"), .ReactModalPortal button:has-text("保存")').first();
    await cropConfirmButton.waitFor({ state: 'visible', timeout: 10000 });
    console.log('[Test] Clicking crop confirmation button...');
    await cropConfirmButton.click();
    console.log('[Test] Crop confirmation button clicked.');

    await page.waitForTimeout(5000); // Wait for cover image to render completely and modal to close

    // 3. Fill Body (Dummy HTML paste)
    console.log('[Test] Pasting body HTML...');
    const bodyEditor = page.locator('.ProseMirror, .note-editor__body, div[contenteditable="true"]');
    await bodyEditor.first().waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditor.first().click();

    // Select all & clear
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');

    const dummyHtml = `
      <h2>自動化テストセクション</h2>
      <p>これは自動化パイプラインの動作テスト原稿です。画像が正常にセットされているか確認してください。</p>
    `;

    const pasteSuccess = await page.evaluate((html) => {
      const editor = document.querySelector('.ProseMirror') || document.querySelector('div[contenteditable="true"]');
      if (!editor) return false;
      editor.focus();
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      dt.setData('text/plain', html.replace(/<[^>]*>/g, ''));
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      editor.dispatchEvent(pasteEvent);
      return true;
    }, dummyHtml);

    if (pasteSuccess) {
      console.log('[Test] Rich text HTML pasted successfully.');
    } else {
      console.log('[Test] Paste failed, inserting fallback text.');
      await page.keyboard.insertText('Fallback text input');
    }

    await page.waitForTimeout(2000);

    // 4. Save Draft
    console.log('[Test] Clicking save draft...');
    const saveButton = page.locator('button:has-text("下書き保存")');
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await page.waitForTimeout(5000);
      console.log('[Test] Save draft clicked.');
    }

    const screenshotPath = path.resolve(__dirname, 'last_image_test_success.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`[Test] Success! Screenshot saved: ${screenshotPath}`);

  } catch (error) {
    console.error('[Test] Error occurred during process:', error);
    const errorScreenshotPath = path.resolve(__dirname, 'error_image_test.png');
    await page.screenshot({ path: errorScreenshotPath });
    console.log(`[Test] Saved error screenshot: ${errorScreenshotPath}`);
  } finally {
    await context.close();
    console.log('[Test] Browser context closed.');
  }
}

runTest();
