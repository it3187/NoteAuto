/**
 * @file fileUtils.js
 * @description File I/O utility module for local draft saving, markdown parsing, and path normalization.
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

/**
 * Parse a local markdown file into title, body (markdown), and bodyHtml.
 * @param {string} filePath - Absolute path to the markdown file
 * @returns {object} { title, body, bodyHtml }
 * @throws {Error} If the file does not exist
 */
function parseMarkdown(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return parseMarkdownFromText(content);
}

/**
 * Parse a markdown text string into title, body (markdown), and bodyHtml.
 * @param {string} content - Markdown text content
 * @returns {object} { title, body, bodyHtml }
 */
function parseMarkdownFromText(content) {
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

/**
 * Save article text locally as a timestamped markdown file in the data/drafts directory.
 * @param {string} articleText - Full article text in Markdown format
 * @param {string} [baseDir] - Base directory for the project (defaults to 2 levels up from this file)
 * @returns {object} { filePath, fileName, title }
 */
function saveDraftLocally(articleText, baseDir = null) {
  const projectRoot = baseDir || path.resolve(__dirname, "..", "..");
  const draftsDir = path.join(projectRoot, "data", "drafts");

  if (!fs.existsSync(draftsDir)) {
    fs.mkdirSync(draftsDir, { recursive: true });
  }

  // Extract title from first # heading
  const titleMatch = articleText.match(/^#\s+(.+)/m);
  const articleTitle = titleMatch ? titleMatch[1].trim() : "untitled";

  // Generate timestamped filename
  const now = new Date();
  const timestamp =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "_" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");

  // Sanitize title for filename
  const safeTitle = articleTitle
    .replace(/[\\/:*?"<>|]/g, "_")
    .substring(0, 60);
  const fileName = `${timestamp}_${safeTitle}.md`;
  const filePath = path.join(draftsDir, fileName);

  fs.writeFileSync(filePath, articleText, "utf-8");
  console.log(`Draft saved locally: ${filePath}`);

  return { filePath, fileName, title: articleTitle };
}

module.exports = {
  parseMarkdown,
  parseMarkdownFromText,
  saveDraftLocally,
};
