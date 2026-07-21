const { chromium } = require('playwright');
const path = require('path');

async function runInlineImageTestV2() {
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
    await titleTextarea.fill('【画像テストV2】途中画像挿入検証 ' + new Date().toLocaleString());
    await page.waitForTimeout(1000);

    // 2. Select Cover Image (Corrected 2-step buttons)
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

    // Step 1 Image Selection Button
    const selectImageButton = page.locator('.ReactModalPortal button:has-text("この画像を挿入")').first();
    await selectImageButton.waitFor({ state: 'visible', timeout: 5000 });
    await selectImageButton.click();
    await page.waitForTimeout(3000);

    // Step 2 Cropping Modal Button
    const cropConfirmButton = page.locator('.ReactModalPortal button:has-text("保存")').first();
    await cropConfirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await cropConfirmButton.click();
    await page.waitForTimeout(5000); // Wait for modal to fully close

    // =========================================================================
    // 3. Scenario A-2: Base64 Inline Image Paste
    // =========================================================================
    console.log('\n--- Running Scenario A-2: Base64 Inline Image Paste ---');
    const bodyEditor = page.locator('.ProseMirror, .note-editor__body, div[contenteditable="true"]').first();
    await bodyEditor.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditor.click();

    // Select all & clear
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');

    // 1x1 Red Dot PNG Base64
    const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const htmlWithBase64Image = `
      <h2>1. アプローチA-2：Base64画像ペースト</h2>
      <p>この文章の直後に、Base64でエンコードされたダミー赤ドット画像を貼り付けます。</p>
      <img src="data:image/png;base64,${base64Png}" alt="Red Dot Image" />
      <p>画像の下の文章です。画像としてエディタに自動取り込みされているか確認してください。</p>
    `;

    console.log('[Test Scenario A-2] Pasting Base64 HTML via clipboard...');
    await page.evaluate((html) => {
      const editor = document.querySelector('.ProseMirror') || document.querySelector('div[contenteditable="true"]');
      if (!editor) return;
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
    }, htmlWithBase64Image);

    console.log('[Test Scenario A-2] Waiting for image parsing (5s)...');
    await page.waitForTimeout(5000);

    const screenshotPathA2 = path.resolve(__dirname, 'success_inline_A2.png');
    await page.screenshot({ path: screenshotPathA2 });
    console.log(`[Test Scenario A-2] Screenshot saved: ${screenshotPathA2}`);

    // =========================================================================
    // 4. Scenario D: Playwright Drag & Drop Simulation
    // =========================================================================
    console.log('\n--- Running Scenario D: Playwright Drag & Drop Simulation ---');
    await bodyEditor.click();

    // Select all & clear
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');

    console.log('[Test Scenario D] Inserting intro text...');
    await page.keyboard.insertText('2. アプローチD：ドラッグ＆ドロップ方式のテスト\n以下にダミーの画像をドラッグ＆ドロップしてアップロードを走らせます：\n\n');
    await page.waitForTimeout(2000);

    // Perform synthetic drop event with File object binary
    console.log('[Test Scenario D] Simulating drop event with 1x1 png file...');
    const dataTransfer = await page.evaluateHandle(async () => {
      // 1x1 Red Dot PNG base64
      const base64Data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const response = await fetch(`data:image/png;base64,${base64Data}`);
      const blob = await response.blob();
      const file = new File([blob], 'dummy_drop.png', { type: 'image/png' });
      
      const dt = new DataTransfer();
      dt.items.add(file);
      return dt;
    });

    // Dispatch drop event on the editor element
    await page.dispatchEvent('.ProseMirror', 'drop', { dataTransfer });

    console.log('[Test Scenario D] Waiting for upload and rendering (8s)...');
    await page.waitForTimeout(8000);

    const screenshotPathD = path.resolve(__dirname, 'success_inline_D.png');
    await page.screenshot({ path: screenshotPathD });
    console.log(`[Test Scenario D] Screenshot saved: ${screenshotPathD}`);

    // Save Draft
    console.log('[Test] Saving draft...');
    const saveButton = page.locator('button:has-text("下書き保存")');
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await page.waitForTimeout(5000);
    }

  } catch (error) {
    console.error('[Test] Error during inline image testing V2:', error);
    const errScreenshot = path.resolve(__dirname, 'error_inline_v2_test.png');
    await page.screenshot({ path: errScreenshot });
    console.log(`[Test] Saved error screenshot: ${errScreenshot}`);
  } finally {
    await context.close();
    console.log('[Test] Browser context closed.');
  }
}

runInlineImageTestV2();
