const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper function to parse local markdown file
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
      title = lines[i].replace("# ", "").strip();
      bodyLines = lines.slice(i + 1);
      break;
    }
  }
  
  if (!title) {
    title = lines[0].trim();
    bodyLines = lines.slice(1);
  }
  
  return {
    title: title.trim(),
    body: bodyLines.join('\n').trim()
  };
}

// Add polyfill for strip if not present
if (!String.prototype.strip) {
  String.prototype.strip = function() {
    return this.trim();
  };
}

app.post('/api/upload', async (req, res) => {
  const { filePath } = req.body;
  
  if (!filePath) {
    return res.status(400).json({ error: "Missing filePath parameter." });
  }
  
  try {
    const { title, body } = parseMarkdown(filePath);
    console.log(`Loaded draft: ${title} (${body.length} chars)`);
    
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
      console.log("Redirected to login. Waiting for manual login (max 120s)...");
      try {
        // Wait for redirection back to the editor page after login
        await page.waitForURL("**/new", { timeout: 120000 });
        console.log("Login detected!");
        await page.waitForTimeout(3000);
      } catch (err) {
        await context.close();
        return res.status(401).json({ error: "Login timed out. Please try again." });
      }
    }
    
    console.log("Filling title and body...");
    const titleTextarea = page.locator('textarea[placeholder="記事タイトル"]');
    await titleTextarea.waitFor({ state: "visible", timeout: 15000 });
    await titleTextarea.click();
    await titleTextarea.fill(title);
    
    const bodyEditor = page.locator('.note-editor__body, div[contenteditable="true"]');
    await bodyEditor.waitFor({ state: "visible", timeout: 15000 });
    await bodyEditor.click();
    
    // Clear and insert
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(body);
    
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

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
