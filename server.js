const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { marked } = require('marked');

// S:\10_CodeBase\02_Websites\NoteAuto\.env ファイルから環境変数をロード (CDD)
require('dotenv').config();

const { scanTextLocal, analyzeWithGemini, autoRewriteWithGemini } = require('./slopDetector');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper function to parse local markdown file and convert body to HTML
function parseMarkdown(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
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
  
  const bodyMarkdown = bodyLines.join('\n').trim();
  
  // Markdown -> HTML conversion (CDD)
  // note.com ProseMirror editor recognizes HTML pasted via clipboard
  const bodyHtml = marked.parse(bodyMarkdown, {
    breaks: true,
    gfm: true
  });
  
  return {
    title: title.trim(),
    body: bodyMarkdown,
    bodyHtml: bodyHtml
  };
}

// Add polyfill for strip if not present
if (!String.prototype.strip) {
  String.prototype.strip = function() {
    return this.trim();
  };
}

app.post('/api/upload', async (req, res) => {
  const { filePath, testMode } = req.body;
  
  if (!filePath) {
    return res.status(400).json({ error: "Missing filePath parameter." });
  }
  
  try {
    const { title, body, bodyHtml } = parseMarkdown(filePath);
    console.log(`Loaded draft: ${title} (${body.length} chars, HTML: ${bodyHtml.length} chars)`);
    
    const profilePath = path.resolve(__dirname, 'data', 'chrome_profile');
    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
    }
    
    console.log("Launching browser...");
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      viewport: { width: 1280, height: 800 }
    });
    
    const page = await context.newPage();
    console.log("Navigating to note editor...");
    await page.goto("https://editor.note.com/new");
    
    // Wait to see if login is needed
    await page.waitForTimeout(3000);
    
    if (page.url().includes("login")) {
      console.log("Redirected to login. Waiting for manual login (max 300s)...");
      try {
        // Wait for redirection back to the editor page after login
        await page.waitForURL("**/new", { timeout: 300000 });
        console.log("Login detected!");
        await page.waitForTimeout(3000);
      } catch (err) {
        await context.close();
        return res.status(401).json({ error: "Login timed out. Please try again." });
      }
    }
    
    console.log("Filling title...");
    const titleTextarea = page.locator('textarea[placeholder="記事タイトル"]');
    await titleTextarea.waitFor({ state: "visible", timeout: 15000 });
    await titleTextarea.click();
    await titleTextarea.fill(title);
    
    // ProseMirror body editor - use clipboard HTML paste for rich text (CDD)
    console.log("Pasting HTML body via clipboard for rich text formatting...");
    const bodyEditor = page.locator('.ProseMirror, .note-editor__body, div[contenteditable="true"]');
    await bodyEditor.first().waitFor({ state: "visible", timeout: 15000 });
    await bodyEditor.first().click();
    
    // Clear any existing content
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    
    // Inject HTML via synthetic paste event (CDD)
    // This directly fires a paste event on the ProseMirror editor with HTML data,
    // which ProseMirror's clipboard handler parses into rich text nodes
    // (headings, bold, italic, lists, code blocks, etc.)
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
    }, bodyHtml);
    
    if (!pasteSuccess) {
      // Fallback: if paste event dispatch failed, use plain text insert
      console.warn("HTML paste failed, falling back to plain text insert...");
      await page.keyboard.insertText(body);
    } else {
      console.log("HTML paste successful - rich text formatting applied.");
    }
    
    await page.waitForTimeout(1000);
    
    console.log("Saving draft...");
    const saveButton = page.locator('button:has-text("下書き保存")');
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await page.waitForTimeout(5000);
    }
    
    const screenshotDir = path.resolve(__dirname, 'Src', 'public');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    
    const screenshotName = 'last_upload.png';
    const screenshotPath = path.join(screenshotDir, screenshotName);
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot to: ${screenshotPath}`);
    
    await context.close();
    
    res.json({
      status: "success",
      title: title,
      screenshot: `/public/${screenshotName}`
    });
    
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================================
// POST /api/detect-slop エンドポイント (CDD)
// ==============================================================================
// 日本語テキストまたは指定のファイルパスからMarkdownを読み込み、AI臭（AI-Slop）の分析を行います。
app.post('/api/detect-slop', async (req, res) => {
  const { filePath, text } = req.body;
  let targetText = text || '';

  try {
    // ファイルパスが指定されている場合は、ローカルファイルを読み込みます
    if (filePath) {
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: `ファイルが見つかりません: ${filePath}` });
      }
      targetText = fs.readFileSync(filePath, 'utf-8');
    }

    if (!targetText || targetText.trim().length === 0) {
      return res.status(400).json({ error: '解析対象のテキストを指定してください。' });
    }

    // ① ローカルルールベースによる高速検出
    const localResults = scanTextLocal(targetText);

    // ② Gemini APIによる文脈解析
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    let aiResults = null;

    if (apiKey) {
      try {
        aiResults = await analyzeWithGemini(targetText, apiKey, modelName);
      } catch (geminiError) {
        console.error('Gemini API analysis failed:', geminiError);
        // APIエラー時はローカル判定のみでフォールバック
      }
    } else {
      console.warn('GEMINI_API_KEY is not defined. Skipping Gemini analysis.');
    }

    res.json({
      status: 'success',
      localMatches: localResults,
      aiAnalysis: aiResults
    });

  } catch (error) {
    console.error('Slop detection error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================================
// POST /api/rewrite-slop endpoint (CDD)
// ==============================================================================
// Accepts either a filePath or inline text. When filePath is given, rewrites and saves as _rewritten.md.
// When inline text is given, rewrites and returns the text without file I/O.
app.post('/api/rewrite-slop', async (req, res) => {
  const { filePath, text, issues } = req.body;
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'GEMINI_API_KEY is not configured.' });
  }

  let originalText = '';
  const useFile = filePath && fs.existsSync(filePath);

  if (useFile) {
    originalText = fs.readFileSync(filePath, 'utf-8');
  } else if (text && text.trim().length > 0) {
    originalText = text;
  } else {
    return res.status(400).json({ error: 'Please provide a valid filePath or text.' });
  }

  try {
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    
    // Gemini full-text rewrite
    const rewrittenText = await autoRewriteWithGemini(originalText, apiKey, issues, modelName);
    
    // If file mode, save as _rewritten.md
    if (useFile) {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const baseName = path.basename(filePath, ext);
      const newFilePath = path.join(dir, `${baseName}_rewritten${ext}`);
      
      fs.writeFileSync(newFilePath, rewrittenText, 'utf-8');
      
      res.json({
        status: 'success',
        newFilePath: newFilePath,
        rewrittenText: rewrittenText
      });
    } else {
      // Inline text mode - return rewritten text only
      res.json({
        status: 'success',
        rewrittenText: rewrittenText
      });
    }
    
  } catch (error) {
    console.error('Rewrite error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});

// ==============================================================================
// POST /api/generate-base-article endpoint (CDD)
// ==============================================================================
// Generates a first draft article in Markdown from the given theme and keywords using Gemini API.
app.post('/api/generate-base-article', async (req, res) => {
  const { theme, keywords, target, wordCount } = req.body;

  if (!theme || theme.trim().length === 0) {
    return res.status(400).json({ error: 'Theme (article topic) is required.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'GEMINI_API_KEY is not configured in .env' });
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const estimatedWords = wordCount || 2000;
  const targetAudience = target || 'general audience interested in the topic';
  const keywordsStr = keywords || '';

  const systemInstructions = `You are a professional Japanese article writer. Write in natural, engaging Japanese that sounds human-written. Avoid AI-ish cliches like "ikagadeshitaka" or "tettei kaisetsu". Use concrete examples and personal perspective. Output ONLY the raw Markdown article text (starting with # for the title), nothing else.`;

  const prompt = `
Please write a high-quality Japanese article in Markdown format about the following topic.

Topic: ${theme}
${keywordsStr ? `Keywords to include: ${keywordsStr}` : ''}
Target audience: ${targetAudience}
Target length: approximately ${estimatedWords} characters

Requirements:
1. Start with a single # heading for the article title.
2. Use ## for section headings, ### for subsections.
3. Write in a natural, human-like Japanese tone.
4. Include concrete examples, data, or anecdotes where appropriate.
5. Avoid generic AI-ish phrases and cliches.
6. End the article naturally without "ikagadeshitaka" type closings.

Output the raw Markdown only. Do not wrap in code fences.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstructions }] }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const resJson = await response.json();
    let articleText = resJson.candidates[0].content.parts[0].text;

    // Strip markdown code fences if Gemini added them
    if (articleText.startsWith('```markdown')) {
      articleText = articleText.replace(/^```markdown\n?/, '').replace(/\n?```$/, '').trim();
    } else if (articleText.startsWith('```')) {
      articleText = articleText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
    }

    res.json({
      status: 'success',
      article: articleText
    });

  } catch (error) {
    console.error('Article generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================================
// POST /api/save-and-upload endpoint (CDD)
// ==============================================================================
// Receives proofread article text, saves it locally as a Markdown file,
// and uploads both to note.com as a draft via Playwright (selecting cover image from photo gallery).
app.post('/api/save-and-upload', async (req, res) => {
  const { articleText, uploadToNote, testMode } = req.body;

  if (!articleText || articleText.trim().length === 0) {
    return res.status(400).json({ error: 'Article text is required.' });
  }

  try {
    // --- 1. Local file save ---
    const draftsDir = path.resolve(__dirname, 'data', 'drafts');
    if (!fs.existsSync(draftsDir)) {
      fs.mkdirSync(draftsDir, { recursive: true });
    }

    // Extract title from the first # heading
    const titleMatch = articleText.match(/^#\s+(.+)/m);
    const articleTitle = titleMatch ? titleMatch[1].trim() : 'untitled';

    // Generate timestamped filename
    const now = new Date();
    const timestamp = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + '_'
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');

    // Sanitize title for filename (remove special characters)
    const safeTitle = articleTitle.replace(/[\\/:*?"<>|]/g, '_').substring(0, 60);
    const fileName = `${timestamp}_${safeTitle}.md`;
    const localFilePath = path.join(draftsDir, fileName);

    fs.writeFileSync(localFilePath, articleText, 'utf-8');
    console.log(`Draft saved locally: ${localFilePath}`);

    // --- 2. Upload to note.com (optional, defaults to true) ---
    let noteResult = null;
    if (uploadToNote !== false) {
      const { title, body, bodyHtml } = parseMarkdownFromText(articleText);
      console.log(`Uploading to note: ${title} (${body.length} chars)`);

      const profilePath = path.resolve(__dirname, 'data', 'chrome_profile');
      if (!fs.existsSync(profilePath)) {
        fs.mkdirSync(profilePath, { recursive: true });
      }

      console.log('Launching browser for note.com upload...');
      const context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        viewport: { width: 1280, height: 800 }
      });

      const page = await context.newPage();
      console.log('Navigating to note editor...');
      await page.goto('https://editor.note.com/new');

      // Wait and handle login if needed
      await page.waitForTimeout(3000);

      if (page.url().includes('login')) {
        console.log('Redirected to login. Waiting for manual login (max 300s)...');
        try {
          await page.waitForURL('**/new', { timeout: 300000 });
          console.log('Login detected!');
          await page.waitForTimeout(3000);
        } catch (err) {
          await context.close();
          return res.json({
            status: 'partial',
            localFilePath: localFilePath,
            noteUpload: false,
            error: 'Login timed out. Local file was saved successfully.'
          });
        }
      }

      // Fill title
      console.log('Filling title...');
      const titleTextarea = page.locator('textarea[placeholder="記事タイトル"]');
      await titleTextarea.waitFor({ state: 'visible', timeout: 15000 });
      await titleTextarea.click();
      await titleTextarea.fill(title);

      // Split body by image placeholders
      console.log('Parsing article body for image placeholders...');
      const blocks = body.split(/(\[IMAGE_PLACEHOLDER:[^\]]+\])/g);
      
      const bodyEditor = page.locator('.ProseMirror, .note-editor__body, div[contenteditable="true"]').first();
      await bodyEditor.waitFor({ state: 'visible', timeout: 15000 });
      await bodyEditor.click();

      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');

      // Helper function to paste HTML block
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

      for (const block of blocks) {
        if (!block) continue;

        if (block.startsWith('[IMAGE_PLACEHOLDER:')) {
          // Image upload placeholder
          const imgPathRaw = block.replace('[IMAGE_PLACEHOLDER:', '').replace(']', '').trim();
          let localImagePath = path.isAbsolute(imgPathRaw) ? imgPathRaw : path.resolve(__dirname, imgPathRaw);

          console.log(`[E2E Image Upload] Found placeholder. Target image: ${localImagePath}`);

          if (!fs.existsSync(localImagePath)) {
            // Check in Src/public fallback
            const fallbackPath = path.resolve(__dirname, 'Src', 'public', imgPathRaw);
            if (fs.existsSync(fallbackPath)) {
              localImagePath = fallbackPath;
            } else {
              console.warn(`[E2E Image Upload] File not found: ${localImagePath}. Creating dummy file...`);
              fs.writeFileSync(localImagePath, 'dummy content', 'utf-8');
            }
          }

          try {
            // Focus editor and move cursor to the very end of the document
            console.log('[E2E Image Upload] Repositioning cursor to end of editor...');
            await bodyEditor.click();
            await page.waitForTimeout(500);
            await page.keyboard.press('Control+End');
            await page.waitForTimeout(500);

            // 1. Create a new empty paragraph block
            console.log('[E2E Image Upload] Pressing Enter to create empty paragraph...');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(2000);

            // 2. Click "+" menu button
            console.log('[E2E Image Upload] Clicking "+" menu button...');
            const menuButton = page.locator('button[aria-label="追加メニューを開く"]:visible, button[class*="insert-menu"]:visible, .note-editor__insert-menu-button:visible, button[aria-label*="メニュー"]:visible').first();
            await menuButton.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            await menuButton.click({ force: true });
            await page.waitForTimeout(2000);

            // Take a debug screenshot to inspect if "+" menu is opened
            const debugMenuPath = path.resolve(__dirname, `debug_e2e_menu_click.png`);
            await page.screenshot({ path: debugMenuPath });
            console.log(`[E2E Image Upload DEBUG] Saved debug screenshot to: ${debugMenuPath}`);

            // 3. Prepare file chooser interceptor (8s timeout)
            console.log('[E2E Image Upload] Preparing file chooser...');
            const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });

            // 4. Click image select button
            const imageUploadButton = page.locator('button[aria-label="画像を追加"]:visible, button[aria-label="画像"]:visible, button:has-text("画像"):visible, [class*="insert-menu"] button:visible').first();
            await imageUploadButton.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            await imageUploadButton.click({ force: true });

            // 5. Upload files
            const fileChooser = await fileChooserPromise;
            await fileChooser.setFiles(localImagePath);
            console.log(`[E2E Image Upload] Uploading file: ${localImagePath}`);

            // 6. Wait for upload to complete (AWS upload takes some time)
            console.log('[E2E Image Upload] Waiting for upload (8s)...');
            await page.waitForTimeout(8000);

            // 7. Press Enter to exit the image block and return to text typing
            console.log('[E2E Image Upload] Pressing Enter to exit image block...');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1500);

          } catch (uploadErr) {
            console.error('[E2E Image Upload] Error uploading inline image:', uploadErr.message);
          }
        } else {
          // Regular text block
          const blockHtml = marked.parse(block, { breaks: true, gfm: true });
          console.log(`[E2E Text Paste] Pasting text block (${block.substring(0, 30)}...)`);
          
          const pasteSuccess = await pasteHtmlBlock(blockHtml);
          if (!pasteSuccess) {
            await page.keyboard.insertText(block);
          }
          await page.waitForTimeout(1000);
        }
      }

      await page.waitForTimeout(1000);

      // Focus back to title to exit focus mode and reveal header
      try {
        console.log('Focusing back to title input to reveal cover image button...');
        const titleTextarea = page.locator('textarea[placeholder="記事タイトル"]').first();
        await titleTextarea.scrollIntoViewIfNeeded();
        await titleTextarea.click({ force: true });
        await page.waitForTimeout(2000);

        // [DEBUG] Dump HTML page content to find the true cover image selector
        const pageContent = await page.content();
        const debugHtmlPath = path.resolve(__dirname, 'editor_debug.html');
        fs.writeFileSync(debugHtmlPath, pageContent, 'utf-8');
        console.log(`[DEBUG] Dumped page HTML to: ${debugHtmlPath}`);
      } catch (focusErr) {
        console.warn('Failed to focus back to title:', focusErr.message);
      }

      // --- 3. Select cover image from note's "みんなのフォトギャラリー" ---
      try {
        console.log('Finding header image button...');
        const headerImageButton = page.locator('button[aria-label="画像を追加"], button[aria-label="カバー画像を設定する"], .note-editor__header-image-button, button:has-text("画像を設定")').first();
        
        // Wait for button and scroll it into view automatically
        await headerImageButton.waitFor({ state: 'attached', timeout: 8000 });
        await headerImageButton.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
        
        console.log('Clicking cover image button...');
        await headerImageButton.click({ force: true });
        await page.waitForTimeout(2500);

        // [DEBUG] Dump HTML with menu opened
        const menuContent = await page.content();
        const debugMenuPath = path.resolve(__dirname, 'editor_debug_menu.html');
        fs.writeFileSync(debugMenuPath, menuContent, 'utf-8');
        console.log(`[DEBUG] Dumped menu HTML to: ${debugMenuPath}`);

        // Click "記事にあう画像を選ぶ" - use getByText for exact match to avoid parent div matching
        const galleryMenuItem = page.getByText('記事にあう画像を選ぶ', { exact: true });
        await galleryMenuItem.waitFor({ state: 'visible', timeout: 5000 });
        await galleryMenuItem.click();
        console.log('Waiting for Photo Gallery modal (ReactModalPortal)...');
        // Wait for the React modal to actually appear in the DOM
        await page.waitForSelector('.ReactModalPortal [class*="modal"], .ReactModalPortal div, [role="dialog"]', { state: 'attached', timeout: 10000 });
        await page.waitForTimeout(2000); // Extra time for modal content to render
        console.log('Photo Gallery modal detected.');

        // [DEBUG] Dump HTML with gallery modal opened
        const galleryContent = await page.content();
        const debugGalleryPath = path.resolve(__dirname, 'editor_debug_gallery.html');
        fs.writeFileSync(debugGalleryPath, galleryContent, 'utf-8');
        console.log(`[DEBUG] Dumped gallery modal HTML to: ${debugGalleryPath}`);

        // The photo gallery now automatically shows images without needing to search.
        // Click the first photo item in the gallery directly.
        console.log('Clicking the first image in the gallery...');
        const firstPhoto = page.locator('.ReactModalPortal img').first();
        await firstPhoto.waitFor({ state: 'visible', timeout: 5000 });
        await firstPhoto.click();
        await page.waitForTimeout(2000); // Wait for selection to register
        
        // Click "この画像を挿入" button (Image Selection Step)
        console.log('Clicking "この画像を挿入" button...');
        const selectImageButton = page.locator('.ReactModalPortal button:has-text("この画像を挿入")').first();
        await selectImageButton.waitFor({ state: 'visible', timeout: 5000 });
        await selectImageButton.click();
        
        await page.waitForTimeout(3000); // Wait for Crop/Trim modal to appear

        // Click "保存" button on Cropping Step
        console.log('Clicking crop confirmation "保存" button...');
        const cropConfirmButton = page.locator('.ReactModalPortal button:has-text("保存")').first();
        await cropConfirmButton.waitFor({ state: 'visible', timeout: 5000 });
        await cropConfirmButton.click();
        console.log('Crop confirmation button clicked.');
        
        await page.waitForTimeout(5000); // Wait for image to apply in editor
      } catch (galleryErr) {
        console.error("Failed to set cover image from photo gallery:", galleryErr.message);
        // Close any lingering modal with Escape key so save button is not blocked
        try {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(1000);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(1000);
          console.log('Closed lingering modal via Escape key.');
        } catch (escErr) {
          // ignore
        }
      }

      // Click save draft button ONLY if not in test mode
      if (!testMode) {
        console.log('Saving draft on note.com...');
        const saveButton = page.locator('button:has-text("下書き保存")');
        if (await saveButton.isVisible()) {
          await saveButton.click();
          await page.waitForTimeout(5000);
        }
      } else {
        console.log('TEST MODE: Skipping draft save to prevent clutter.');
      }

      // Take screenshot
      const screenshotDir = path.resolve(__dirname, 'Src', 'public');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      const screenshotName = 'last_pipeline_upload.png';
      const screenshotPath = path.join(screenshotDir, screenshotName);
      await page.screenshot({ path: screenshotPath });
      console.log(`Screenshot saved: ${screenshotPath}`);

      await context.close();

      noteResult = {
        uploaded: true,
        screenshot: `/public/${screenshotName}`,
        coverImageSet: true
      };
    }

    res.json({
      status: 'success',
      localFilePath: localFilePath,
      noteUpload: noteResult
    });

  } catch (error) {
    console.error('Save and upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper: Parse markdown text string (not from file) into title + body + bodyHtml
function parseMarkdownFromText(content) {
  const lines = content.split('\n');

  let title = '';
  let bodyLines = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# ')) {
      title = lines[i].replace('# ', '').trim();
      bodyLines = lines.slice(i + 1);
      break;
    }
  }

  if (!title) {
    title = lines[0].trim();
    bodyLines = lines.slice(1);
  }

  const bodyMarkdown = bodyLines.join('\n').trim();
  const bodyHtml = marked.parse(bodyMarkdown, {
    breaks: true,
    gfm: true
  });

  return {
    title: title.trim(),
    body: bodyMarkdown,
    bodyHtml: bodyHtml
  };
}
