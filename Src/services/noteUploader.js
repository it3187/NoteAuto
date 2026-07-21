/**
 * @file noteUploader.js
 * @description Playwright-based browser automation module for note.com draft uploads.
 *              Implements Approach E (plus-menu image insertion) and crop modal bypass.
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { marked } = require("marked");

/**
 * Upload an article to note.com as a draft via Playwright browser automation.
 * Handles login detection, rich-text HTML paste, inline image insertion via Approach E,
 * cover image selection from photo gallery, and crop modal bypass.
 *
 * @param {object} params
 * @param {string} params.articleText - Full article text in Markdown format
 * @param {string} params.userDirPath - Path to persistent Chrome profile directory
 * @param {boolean} [params.isHeadless=false] - Whether to run browser in headless mode
 * @param {boolean} [params.testMode=false] - When true, skip draft save to prevent clutter
 * @param {string} [params.screenshotDir] - Directory to save screenshots
 * @returns {Promise<object>} Result object with success status and screenshot path
 */
async function uploadToNote({
  articleText,
  userDirPath,
  isHeadless = false,
  testMode = false,
  screenshotDir = null,
}) {
  if (!fs.existsSync(userDirPath)) {
    fs.mkdirSync(userDirPath, { recursive: true });
  }

  console.log("Launching browser...");
  const context = await chromium.launchPersistentContext(userDirPath, {
    headless: isHeadless,
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    // --- Navigation & Login ---
    console.log("Navigating to note editor...");
    await page.goto("https://editor.note.com/new");
    await page.waitForTimeout(3000);

    if (page.url().includes("login")) {
      console.log("Redirected to login. Waiting for manual login (max 300s)...");
      await page.waitForURL("**/new", { timeout: 300000 });
      console.log("Login detected!");
      await page.waitForTimeout(3000);
    }

    // --- Parse Markdown ---
    const { title, body, bodyHtml } = _parseMarkdownFromText(articleText);
    console.log(`Uploading to note: ${title} (${body.length} chars)`);

    // --- Fill Title ---
    console.log("Filling title...");
    const titleTextarea = page.locator('textarea[placeholder="\u8a18\u4e8b\u30bf\u30a4\u30c8\u30eb"]');
    await titleTextarea.waitFor({ state: "visible", timeout: 15000 });
    await titleTextarea.click();
    await titleTextarea.fill(title);

    // --- Body: Split by image placeholders and paste sequentially ---
    console.log("Parsing article body for image placeholders...");
    const blocks = body.split(/(\[IMAGE_PLACEHOLDER:[^\]]+\])/g);

    const bodyEditor = page
      .locator('.ProseMirror, .note-editor__body, div[contenteditable="true"]')
      .first();
    await bodyEditor.waitFor({ state: "visible", timeout: 15000 });
    await bodyEditor.click();

    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");

    for (const block of blocks) {
      if (!block) continue;

      if (block.startsWith("[IMAGE_PLACEHOLDER:")) {
        await _insertInlineImage(page, bodyEditor, block, __dirname);
      } else {
        await _pasteTextBlock(page, block);
      }
    }

    await page.waitForTimeout(1000);

    // --- Cover Image: Select from photo gallery ---
    await _setCoverImageFromGallery(page);

    // --- Save Draft ---
    if (!testMode) {
      console.log("Saving draft on note.com...");
      const saveButton = page.locator('button:has-text("\u4e0b\u66f8\u304d\u4fdd\u5b58")');
      if (await saveButton.isVisible()) {
        await saveButton.click();
        await page.waitForTimeout(5000);
      }
    } else {
      console.log("TEST MODE: Skipping draft save to prevent clutter.");
    }

    // --- Screenshot ---
    const shotDir = screenshotDir || path.resolve(__dirname, "..", "public");
    if (!fs.existsSync(shotDir)) {
      fs.mkdirSync(shotDir, { recursive: true });
    }
    const screenshotName = "last_pipeline_upload.png";
    const screenshotPath = path.join(shotDir, screenshotName);
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved: ${screenshotPath}`);

    await context.close();

    return {
      success: true,
      uploaded: true,
      screenshot: `/public/${screenshotName}`,
      coverImageSet: true,
    };
  } catch (error) {
    console.error("Upload error:", error);
    await context.close();
    throw error;
  }
}

// =============================================================================
// Private Helper: Paste HTML text block into ProseMirror editor
// =============================================================================
async function _pasteTextBlock(page, blockText) {
  const blockHtml = marked.parse(blockText, { breaks: true, gfm: true });
  console.log(`[Text Paste] Pasting text block (${blockText.substring(0, 30)}...)`);

  const pasteSuccess = await page.evaluate((html) => {
    const editor =
      document.querySelector(".ProseMirror") ||
      document.querySelector('div[contenteditable="true"]');
    if (!editor) return false;

    editor.focus();
    const dt = new DataTransfer();
    dt.setData("text/html", html);
    dt.setData("text/plain", html.replace(/<[^>]*>/g, ""));
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    editor.dispatchEvent(pasteEvent);
    return true;
  }, blockHtml);

  if (!pasteSuccess) {
    await page.keyboard.insertText(blockText);
  }
  await page.waitForTimeout(1000);
}

// =============================================================================
// Private Helper: Insert inline image via Approach E (plus-menu + filechooser)
// =============================================================================
async function _insertInlineImage(page, bodyEditor, placeholderBlock, baseDir) {
  const imgPathRaw = placeholderBlock
    .replace("[IMAGE_PLACEHOLDER:", "")
    .replace("]", "")
    .trim();

  let localImagePath = path.isAbsolute(imgPathRaw)
    ? imgPathRaw
    : path.resolve(baseDir, "..", imgPathRaw);

  console.log(`[Image Upload] Found placeholder. Target: ${localImagePath}`);

  if (!fs.existsSync(localImagePath)) {
    const fallbackPath = path.resolve(baseDir, "..", "public", imgPathRaw);
    if (fs.existsSync(fallbackPath)) {
      localImagePath = fallbackPath;
    } else {
      console.warn(`[Image Upload] File not found: ${localImagePath}. Creating dummy file...`);
      const dummyDir = path.dirname(localImagePath);
      if (!fs.existsSync(dummyDir)) fs.mkdirSync(dummyDir, { recursive: true });
      fs.writeFileSync(localImagePath, "dummy content", "utf-8");
    }
  }

  try {
    // 1. Move cursor to end
    console.log("[Image Upload] Repositioning cursor to end of editor...");
    await bodyEditor.click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Control+End");
    await page.waitForTimeout(500);

    // 2. Create new empty paragraph
    console.log("[Image Upload] Pressing Enter to create empty paragraph...");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    // 3. Click "+" menu button
    console.log('[Image Upload] Clicking "+" menu button...');
    const menuButton = page
      .locator(
        'button[aria-label="\u8ffd\u52a0\u30e1\u30cb\u30e5\u30fc\u3092\u958b\u304f"]:visible, ' +
          'button[class*="insert-menu"]:visible, ' +
          ".note-editor__insert-menu-button:visible, " +
          'button[aria-label*="\u30e1\u30cb\u30e5\u30fc"]:visible'
      )
      .first();
    await menuButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await menuButton.click({ force: true });
    await page.waitForTimeout(2000);

    // 4. Prepare file chooser
    console.log("[Image Upload] Preparing file chooser...");
    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 8000 });

    // 5. Click image upload button
    const imageUploadButton = page
      .locator(
        'button[aria-label="\u753b\u50cf\u3092\u8ffd\u52a0"]:visible, ' +
          'button[aria-label="\u753b\u50cf"]:visible, ' +
          'button:has-text("\u753b\u50cf"):visible, ' +
          '[class*="insert-menu"] button:visible'
      )
      .first();
    await imageUploadButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await imageUploadButton.click({ force: true });

    // 6. Upload file
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(localImagePath);
    console.log(`[Image Upload] Uploading file: ${localImagePath}`);

    // 7. Wait for upload
    console.log("[Image Upload] Waiting for upload (8s)...");
    await page.waitForTimeout(8000);

    // 8. Exit image block
    console.log("[Image Upload] Pressing Enter to exit image block...");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
  } catch (uploadErr) {
    console.error("[Image Upload] Error uploading inline image:", uploadErr.message);
  }
}

// =============================================================================
// Private Helper: Set cover image from note's photo gallery
// =============================================================================
async function _setCoverImageFromGallery(page) {
  try {
    // Focus back to title to reveal header controls
    console.log("Focusing back to title input to reveal cover image button...");
    const titleTextarea = page.locator('textarea[placeholder="\u8a18\u4e8b\u30bf\u30a4\u30c8\u30eb"]').first();
    await titleTextarea.scrollIntoViewIfNeeded();
    await titleTextarea.click({ force: true });
    await page.waitForTimeout(2000);

    // Find and click header image button
    console.log("Finding header image button...");
    const headerImageButton = page
      .locator(
        'button[aria-label="\u753b\u50cf\u3092\u8ffd\u52a0"], ' +
          'button[aria-label="\u30ab\u30d0\u30fc\u753b\u50cf\u3092\u8a2d\u5b9a\u3059\u308b"], ' +
          ".note-editor__header-image-button, " +
          'button:has-text("\u753b\u50cf\u3092\u8a2d\u5b9a")'
      )
      .first();

    await headerImageButton.waitFor({ state: "attached", timeout: 8000 });
    await headerImageButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    console.log("Clicking cover image button...");
    await headerImageButton.click({ force: true });
    await page.waitForTimeout(2500);

    // Click gallery menu item
    const galleryMenuItem = page.getByText("\u8a18\u4e8b\u306b\u3042\u3046\u753b\u50cf\u3092\u9078\u3076", { exact: true });
    await galleryMenuItem.waitFor({ state: "visible", timeout: 5000 });
    await galleryMenuItem.click();
    console.log("Waiting for Photo Gallery modal (ReactModalPortal)...");

    await page.waitForSelector(
      '.ReactModalPortal [class*="modal"], .ReactModalPortal div, [role="dialog"]',
      { state: "attached", timeout: 10000 }
    );
    await page.waitForTimeout(2000);
    console.log("Photo Gallery modal detected.");

    // Click first photo
    console.log("Clicking the first image in the gallery...");
    const firstPhoto = page.locator(".ReactModalPortal img").first();
    await firstPhoto.waitFor({ state: "visible", timeout: 5000 });
    await firstPhoto.click();
    await page.waitForTimeout(2000);

    // Click image selection button
    console.log('Clicking "Insert this image" button...');
    const selectImageButton = page
      .locator('.ReactModalPortal button:has-text("\u3053\u306e\u753b\u50cf\u3092\u633f\u5165")')
      .first();
    await selectImageButton.waitFor({ state: "visible", timeout: 5000 });
    await selectImageButton.click();
    await page.waitForTimeout(3000);

    // Click crop confirmation button
    console.log('Clicking crop confirmation "Save" button...');
    const cropConfirmButton = page
      .locator('.ReactModalPortal button:has-text("\u4fdd\u5b58")')
      .first();
    await cropConfirmButton.waitFor({ state: "visible", timeout: 5000 });
    await cropConfirmButton.click();
    console.log("Crop confirmation button clicked.");
    await page.waitForTimeout(5000);
  } catch (galleryErr) {
    console.error("Failed to set cover image from photo gallery:", galleryErr.message);
    try {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
      console.log("Closed lingering modal via Escape key.");
    } catch (escErr) {
      // ignore
    }
  }
}

// =============================================================================
// Private Helper: Parse markdown text into title + body + bodyHtml
// =============================================================================
function _parseMarkdownFromText(content) {
  const lines = content.split("\n");

  let title = "";
  let bodyLines = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("# ")) {
      title = lines[i].replace("# ", "").trim();
      bodyLines = lines.slice(i + 1);
      break;
    }
  }

  if (!title) {
    title = lines[0].trim();
    bodyLines = lines.slice(1);
  }

  const bodyMarkdown = bodyLines.join("\n").trim();
  const bodyHtml = marked.parse(bodyMarkdown, {
    breaks: true,
    gfm: true,
  });

  return {
    title: title.trim(),
    body: bodyMarkdown,
    bodyHtml: bodyHtml,
  };
}

module.exports = { uploadToNote };
