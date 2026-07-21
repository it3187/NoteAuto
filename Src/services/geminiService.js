/**
 * @file geminiService.js
 * @description Gemini API wrapper module for article generation and slop rewriting.
 *              Uses the official @google/generative-ai SDK.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

class GeminiService {
  /**
   * @param {string} apiKey - Gemini API key from .env
   * @param {string} [modelName] - Model name (default: gemini-2.5-flash)
   */
  constructor(apiKey, modelName = "gemini-2.5-flash") {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
  }

  /**
   * Generate a first-draft article in Markdown from the given theme and keywords.
   * @param {object} params
   * @param {string} params.theme - Article topic (required)
   * @param {string} [params.keywords] - Comma-separated keywords
   * @param {string} [params.target] - Target audience description
   * @param {number} [params.wordCount] - Approximate character count target
   * @returns {Promise<string>} Generated article in Markdown format
   */
  async generateBaseArticle({ theme, keywords = "", target = "", wordCount = 2000 }) {
    const targetAudience = target || "general audience interested in the topic";

    const systemInstructions =
      "You are a professional Japanese article writer. Write in natural, engaging Japanese that sounds human-written. " +
      'Avoid AI-ish cliches like "ikagadeshitaka" or "tettei kaisetsu". Use concrete examples and personal perspective. ' +
      "Output ONLY the raw Markdown article text (starting with # for the title), nothing else.";

    const prompt = `
Please write a high-quality Japanese article in Markdown format about the following topic.

Topic: ${theme}
${keywords ? `Keywords to include: ${keywords}` : ""}
Target audience: ${targetAudience}
Target length: approximately ${wordCount} characters

Requirements:
1. Start with a single # heading for the article title.
2. Use ## for section headings, ### for subsections.
3. Write in a natural, human-like Japanese tone.
4. Include concrete examples, data, or anecdotes where appropriate.
5. Avoid generic AI-ish phrases and cliches.
6. End the article naturally without "ikagadeshitaka" type closings.

Output the raw Markdown only. Do not wrap in code fences.`;

    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: systemInstructions,
    });

    const result = await model.generateContent(prompt);
    let articleText = result.response.text();

    // Strip markdown code fences if Gemini added them
    articleText = this._stripCodeFences(articleText);

    return articleText;
  }

  /**
   * Rewrite text to remove AI-Slop using Gemini API.
   * System instructions incorporate the lightweight rules from slop_rules_light.txt.
   * @param {object} params
   * @param {string} params.text - Original text to rewrite
   * @param {Array} [params.issues] - Detected slop issues for targeted fixes
   * @param {string} [params.systemInstructions] - Pre-built system instructions including slop rules
   * @param {string} [params.rewriteModelName] - Override model for rewrite (default: gemini-2.5-pro)
   * @returns {Promise<string>} Rewritten article text
   */
  async rewriteSlop({ text, issues = [], systemInstructions = "", rewriteModelName = "" }) {
    const modelToUse = rewriteModelName || "gemini-2.5-pro";

    let sysInstructions = systemInstructions;
    if (!sysInstructions) {
      sysInstructions =
        "You are an expert Japanese editor specializing in removing AI-Slop from articles. " +
        "Your task is to rewrite the entire provided text so that it sounds natural, human-written, " +
        "and fixes the specific issues provided. Output ONLY the raw rewritten markdown text, " +
        "with no introductory or concluding remarks, no markdown code block fences, just the text itself.";
    }

    const issuesText = (issues || [])
      .map(
        (i, idx) =>
          `Issue ${idx + 1}: [${i.type}] "${i.original}" -> ${i.reason}.\nSuggestion: ${i.suggested}`
      )
      .join("\n\n");

    const prompt = `
The following text contains unnatural AI expressions (AI-Slop).
Strictly follow the stop-ai-slop-jp core rules and scoring criteria loaded in your system instructions.
Resolve all identified issues while maintaining the original context, meaning, and tone.
Rewrite the entire text into natural, readable Japanese that sounds human-written.

Issues identified:
${issuesText || "None specified. Please rewrite to remove all AI-ish expressions naturally."}

Target text:
${text}

Output rules:
Output ONLY the fully rewritten text. Do not include markdown code block symbols or any preamble.`;

    const model = this.genAI.getGenerativeModel({
      model: modelToUse,
      systemInstruction: sysInstructions,
    });

    const result = await model.generateContent(prompt);
    let rewrittenText = result.response.text();

    // Strip markdown code fences if Gemini added them
    rewrittenText = this._stripCodeFences(rewrittenText);

    return rewrittenText;
  }

  /**
   * Remove markdown code fences that Gemini sometimes adds to responses.
   * @param {string} text
   * @returns {string} Cleaned text
   * @private
   */
  _stripCodeFences(text) {
    if (!text) return text;
    if (text.startsWith("```markdown")) {
      return text.replace(/^```markdown\n?/, "").replace(/\n?```$/, "").trim();
    }
    if (text.startsWith("```")) {
      return text.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
    }
    return text;
  }
}

module.exports = GeminiService;
