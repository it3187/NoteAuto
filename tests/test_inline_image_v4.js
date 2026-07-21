const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');

async function runInlineImageTestV4() {
  const profilePath = path.resolve(__dirname, 'data', 'chrome_profile');
  console.log(`[TestV4] Using Chrome Profile: ${profilePath}`);

  console.log('[TestV4] Launching browser...');
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  console.log('[TestV4] Navigating to note editor...');
  await page.goto('https://editor.note.com/new');

  // Wait for load
  await page.waitForTimeout(4000);

  if (page.url().includes('login')) {
    console.log('[TestV4] Redirected to login. Waiting for manual login (max 300s)...');
    try {
      await page.waitForURL('**/new', { timeout: 300000 });
      console.log('[TestV4] Login detected!');
      await page.waitForTimeout(3000);
    } catch (err) {
      console.error('[TestV4] Login timed out.');
      await context.close();
      process.exit(1);
    }
  }

  try {
    // 1. Fill Title
    console.log('[TestV4] Filling title...');
    const titleTextarea = page.locator('textarea[placeholder="記事タイトル"]');
    await titleTextarea.waitFor({ state: 'visible', timeout: 15000 });
    await titleTextarea.click();
    await titleTextarea.fill('【E2E画像2枚テスト】途中画像挿入検証 ' + new Date().toLocaleString());
    await page.waitForTimeout(1000);

    // 2. Select Cover Image (Corrected 2-step buttons)
    console.log('[TestV4] Finding header image button...');
    const headerImageButton = page.locator('button[aria-label="画像を追加"], button[aria-label="カバー画像を設定する"], .note-editor__header-image-button, button:has-text("画像を設定")').first();
    await headerImageButton.waitFor({ state: 'attached', timeout: 10000 });
    await headerImageButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    console.log('[TestV4] Clicking cover image button...');
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
    await page.waitForTimeout(5000);

    // =========================================================================
    // 3. Define Dummy Markdown Body containing Image Placeholders
    // =========================================================================
    const body = `
ブログを書くのは楽しいけれど、ネタ切れや継続に悩むことはありませんか。
[IMAGE_PLACEHOLDER:Src/public/last_pipeline_upload.png]

## 1. 自動化がもたらす新しい執筆プロセス
エージェントが下準備やリサーチを肩代わりすることで、私たちは本当にクリエイティブな執筆に専念できます。
[IMAGE_PLACEHOLDER:error_screenshot.png]

## 2. 最後に
この新しいツールを使いこなし、自分だけの視点を発信していきましょう。
    `.trim();

    // =========================================================================
    // 4. Sequential Text Paste and Image Upload (Approach E)
    // =========================================================================
    console.log('\n--- Running Scenario: Splitting text and uploading 2 inline images ---');
    const blocks = body.split(/(\[IMAGE_PLACEHOLDER:[^\]]+\])/g);
    
    const bodyEditor = page.locator('.ProseMirror, .note-editor__body, div[contenteditable="true"]').first();
    await bodyEditor.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditor.click();

    // Clear editor
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');

    const pasteHtmlBlock = async (html) => {
      return await page.evaluate((h) => {
        const editor = document.querySelector('.ProseMirror') || document.querySelector('div[contenteditable="true"]');
        if (!editor) return false;
        editor.focus();
        const dt = new DataTransfer();
        dt.setData('text/html', h);
        dt.setData('text/plain', h.replace(/<[^>]*>/g, ''));
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
        editor.dispatchEvent(pasteEvent);
        return true;
      }, html);
    };

    let imgIndex = 1;
    for (const block of blocks) {
      if (!block) continue;

      if (block.startsWith('[IMAGE_PLACEHOLDER:')) {
        // Image Upload Placeholder
        const imgPathRaw = block.replace('[IMAGE_PLACEHOLDER:', '').replace(']', '').trim();
        let localImagePath = path.isAbsolute(imgPathRaw) ? imgPathRaw : path.resolve(__dirname, imgPathRaw);

        console.log(`[TestV4] Found placeholder. Target image: ${localImagePath}`);
        if (!fs.existsSync(localImagePath)) {
          // Check fallback in Src/public
          const fallbackPath = path.resolve(__dirname, 'Src', 'public', imgPathRaw);
          if (fs.existsSync(fallbackPath)) {
            localImagePath = fallbackPath;
          } else {
            console.warn(`[TestV4] File not found: ${localImagePath}. Creating dummy file...`);
            fs.writeFileSync(localImagePath, 'dummy content', 'utf-8');
          }
        }

        try {
          // Force cursor to end of editor
          console.log('[TestV4] Focusing editor and moving cursor to end...');
          await bodyEditor.click();
          await page.waitForTimeout(500);
          await page.keyboard.press('Control+End');
          await page.waitForTimeout(500);

          // 1. Create a new empty paragraph block
          console.log('[TestV4] Pressing Enter to create empty paragraph...');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);

          // 2. Click "+" menu button
          console.log('[TestV4] Clicking "+" menu button...');
          const menuButton = page.locator('button[aria-label="追加メニューを開く"]:visible, button[class*="insert-menu"]:visible, .note-editor__insert-menu-button:visible, button[aria-label*="メニュー"]:visible').first();
          await menuButton.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
          await menuButton.click({ force: true });
          await page.waitForTimeout(2000);

          // Take debug screenshot of menu click
          const debugMenuPath = path.resolve(__dirname, `debug_e2e_menu_click_v4_${imgIndex}.png`);
          await page.screenshot({ path: debugMenuPath });
          console.log(`[TestV4 DEBUG] Saved debug menu screenshot to: ${debugMenuPath}`);

          // 3. Prepare file chooser interceptor (8s timeout)
          console.log('[TestV4] Preparing file chooser...');
          const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });

          // 4. Click image select button (using restored exact selector!)
          console.log('[TestV4] Clicking "画像を追加" button...');
          const imageUploadButton = page.locator('button[aria-label="画像を追加"]:visible, button[aria-label="画像"]:visible, button:has-text("画像"):visible, [class*="insert-menu"] button:visible').first();
          await imageUploadButton.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
          await imageUploadButton.click({ force: true });

          // 5. Upload files
          const fileChooser = await fileChooserPromise;
          await fileChooser.setFiles(localImagePath);
          console.log(`[TestV4] Uploading file: ${localImagePath}`);

          // 6. Wait for upload to complete
          console.log('[TestV4] Waiting for upload (8s)...');
          await page.waitForTimeout(8000);

          // 7. Press Enter to exit the image block
          console.log('[TestV4] Pressing Enter to exit image block...');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1500);

          imgIndex++;

        } catch (uploadErr) {
          console.error('[TestV4] Error uploading inline image:', uploadErr.message);
          const errScreenshot = path.resolve(__dirname, `error_v4_upload_${imgIndex}.png`);
          await page.screenshot({ path: errScreenshot });
          console.log(`[TestV4] Saved error screenshot: ${errScreenshot}`);
        }
      } else {
        // Regular Text Block
        const blockHtml = marked.parse(block, { breaks: true, gfm: true });
        console.log(`[TestV4 Text Paste] Pasting text block (${block.substring(0, 30)}...)`);
        
        const pasteSuccess = await pasteHtmlBlock(blockHtml);
        if (!pasteSuccess) {
          await page.keyboard.insertText(block);
        }
        await page.waitForTimeout(1000);
      }
    }

    console.log('[TestV4] Finalizing draft...');
    await page.waitForTimeout(2000);

    const screenshotPath = path.resolve(__dirname, 'success_inline_v4.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`[TestV4] E2E Screenshot saved: ${screenshotPath}`);

    // Save Draft
    console.log('[TestV4] Saving draft...');
    const saveButton = page.locator('button:has-text("下書き保存")');
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await page.waitForTimeout(5000);
    }

  } catch (error) {
    console.error('[TestV4] Global Error during testing:', error);
  } finally {
    await context.close();
    console.log('[TestV4] Browser context closed.');
  }
}

runInlineImageTestV4();
