/**
 * @file server.js
 * @description NoteAuto API entry point. Routing only - all business logic is delegated to modules.
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// Load environment variables from .env
require("dotenv").config();

// --- Module Imports ---
const { scanTextLocal, analyzeWithGemini, buildRewriteSystemInstructions } = require("./slopDetector");
const GeminiService = require("./services/geminiService");
const { uploadToNote } = require("./services/noteUploader");
const { parseMarkdown, saveDraftLocally } = require("./utils/fileUtils");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- Lazy-initialized Gemini Service ---
let _geminiService = null;
function getGeminiService() {
  if (!_geminiService) {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    _geminiService = new GeminiService(apiKey, modelName);
  }
  return _geminiService;
}

// ==============================================================================
// POST /api/upload - Upload a local markdown file to note.com
// ==============================================================================
app.post("/api/upload", async (req, res) => {
  const { filePath, testMode } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "Missing filePath parameter." });
  }

  try {
    const { title } = parseMarkdown(filePath);
    const articleText = fs.readFileSync(filePath, "utf-8");
    console.log(`Loaded draft: ${title} (${articleText.length} chars)`);

    const profilePath = path.resolve(__dirname, "..", "data", "chrome_profile");
    const screenshotDir = path.resolve(__dirname, "public");

    const result = await uploadToNote({
      articleText,
      userDirPath: profilePath,
      testMode: !!testMode,
      screenshotDir,
    });

    res.json({
      status: "success",
      title,
      screenshot: result.screenshot,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================================
// POST /api/detect-slop - Scan text for AI-Slop patterns
// ==============================================================================
app.post("/api/detect-slop", async (req, res) => {
  const { filePath, text } = req.body;
  let targetText = text || "";

  try {
    if (filePath) {
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: `File not found: ${filePath}` });
      }
      targetText = fs.readFileSync(filePath, "utf-8");
    }

    if (!targetText || targetText.trim().length === 0) {
      return res.status(400).json({ error: "Please provide text or filePath to analyze." });
    }

    // Local rule-based scan
    const localResults = scanTextLocal(targetText);

    // Gemini API contextual analysis
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    let aiResults = null;

    if (apiKey) {
      try {
        aiResults = await analyzeWithGemini(targetText, apiKey, modelName);
      } catch (geminiError) {
        console.error("Gemini API analysis failed:", geminiError);
      }
    } else {
      console.warn("GEMINI_API_KEY is not defined. Skipping Gemini analysis.");
    }

    res.json({
      status: "success",
      localMatches: localResults,
      aiAnalysis: aiResults,
    });
  } catch (error) {
    console.error("Slop detection error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================================
// POST /api/rewrite-slop - Rewrite text to remove AI-Slop
// ==============================================================================
app.post("/api/rewrite-slop", async (req, res) => {
  const { filePath, text, issues } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: "GEMINI_API_KEY is not configured." });
  }

  let originalText = "";
  const useFile = filePath && fs.existsSync(filePath);

  if (useFile) {
    originalText = fs.readFileSync(filePath, "utf-8");
  } else if (text && text.trim().length > 0) {
    originalText = text;
  } else {
    return res.status(400).json({ error: "Please provide a valid filePath or text." });
  }

  try {
    const gemini = getGeminiService();
    const systemInstructions = buildRewriteSystemInstructions();

    const rewrittenText = await gemini.rewriteSlop({
      text: originalText,
      issues: issues || [],
      systemInstructions,
    });

    if (useFile) {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const baseName = path.basename(filePath, ext);
      const newFilePath = path.join(dir, `${baseName}_rewritten${ext}`);
      fs.writeFileSync(newFilePath, rewrittenText, "utf-8");

      res.json({
        status: "success",
        newFilePath,
        rewrittenText,
      });
    } else {
      res.json({
        status: "success",
        rewrittenText,
      });
    }
  } catch (error) {
    console.error("Rewrite error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================================
// POST /api/generate-base-article - Generate a first-draft article
// ==============================================================================
app.post("/api/generate-base-article", async (req, res) => {
  const { theme, keywords, target, wordCount } = req.body;

  if (!theme || theme.trim().length === 0) {
    return res.status(400).json({ error: "Theme (article topic) is required." });
  }

  try {
    const gemini = getGeminiService();
    const articleText = await gemini.generateBaseArticle({
      theme,
      keywords: keywords || "",
      target: target || "",
      wordCount: wordCount || 2000,
    });

    res.json({
      status: "success",
      article: articleText,
    });
  } catch (error) {
    console.error("Article generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================================
// POST /api/save-and-upload - Save locally & optionally upload to note.com
// ==============================================================================
app.post("/api/save-and-upload", async (req, res) => {
  const { articleText, uploadToNote: shouldUpload, testMode } = req.body;

  if (!articleText || articleText.trim().length === 0) {
    return res.status(400).json({ error: "Article text is required." });
  }

  try {
    // 1. Save locally
    const { filePath: localFilePath } = saveDraftLocally(articleText);

    // 2. Upload to note.com (optional)
    let noteResult = null;
    if (shouldUpload !== false) {
      const profilePath = path.resolve(__dirname, "..", "data", "chrome_profile");
      const screenshotDir = path.resolve(__dirname, "public");

      try {
        noteResult = await uploadToNote({
          articleText,
          userDirPath: profilePath,
          testMode: !!testMode,
          screenshotDir,
        });
      } catch (uploadError) {
        console.error("Note upload failed:", uploadError.message);
        return res.json({
          status: "partial",
          localFilePath,
          noteUpload: false,
          error: `Local file saved. Upload failed: ${uploadError.message}`,
        });
      }
    }

    res.json({
      status: "success",
      localFilePath,
      noteUpload: noteResult,
    });
  } catch (error) {
    console.error("Save and upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================================
// Start Server
// ==============================================================================
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
