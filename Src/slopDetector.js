/**
 * @file slopDetector.js
 * @description stop-ai-slop-jp の定義ファイルを読み込み、日本語AI臭のローカル静的スキャンおよびGemini APIによる文脈解析を行うモジュール
 */

const fs = require('fs');
const path = require('path');

// ==============================================================================
// 1. stop-ai-slop-jp リポジトリからのルール/フレーズの動的ロード処理 (CDD)
// ==============================================================================
// 避けるべきフレーズを phrases.md からパースし、メモリ上にロードします。
function loadSlopPhrases() {
  const phrasesPath = path.resolve(__dirname, 'stop-ai-slop-jp', 'references', 'phrases.md');
  const phrases = new Set([
    // フォールバック用の基本キーワード定義 (パース失敗時の備え)
    'いかがでしたでしょうか',
    'いかがでしたか',
    '徹底解説',
    'ぜひ参考に',
    '〜してみてください',
    'と言えるでしょう',
    '重要性を再認識',
    '注目されています',
    '現代社会において',
    '重要です',
    '泥臭さ',
    '手触り',
    '解像度',
    '本質',
    '営み',
    '文脈',
    '思考のOS',
    'ハックする',
    'インストール',
    'ケースバイケース',
    '一概には言えません'
  ]);

  if (fs.existsSync(phrasesPath)) {
    try {
      const content = fs.readFileSync(phrasesPath, 'utf-8');
      const lines = content.split('\n');
      for (let line of lines) {
        line = line.trim();
        if (line.startsWith('-')) {
          // 「」で囲まれたフレーズを抽出
          const matches = [...line.matchAll(/「([^」]+)」/g)];
          if (matches.length > 0) {
            for (const match of matches) {
              const phrase = match[1].trim();
              if (phrase.length > 1) phrases.add(phrase);
            }
          } else {
            // カンマや読点で区切られたフレーズを抽出
            const cleaned = line.replace(/^-\s*/, '').trim();
            if (cleaned && !cleaned.startsWith('[') && !cleaned.includes('|') && !cleaned.includes('**')) {
              const parts = cleaned.split(/[、,]/);
              for (const part of parts) {
                const p = part.trim();
                if (p && p.length > 1 && p.length < 20) {
                  phrases.add(p);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Error parsing phrases.md:', err);
    }
  }
  return [...phrases];
}

// ==============================================================================
// 2. ローカル静的スキャン処理 (CDD)
// ==============================================================================
// テキストに対して、正規表現とキーワードマッチを用いて高速にAI臭をスキャンします。
function scanTextLocal(text) {
  const phrases = loadSlopPhrases();
  const results = [];
  const lines = text.split('\n');

  // 各行についてスキャン
  lines.forEach((lineText, index) => {
    const lineNum = index + 1;

    // ① キーワードマッチ
    phrases.forEach(phrase => {
      let count = 0;
      let pos = lineText.indexOf(phrase);
      while (pos !== -1) {
        count++;
        pos = lineText.indexOf(phrase, pos + 1);
      }
      if (count > 0) {
        results.push({
          type: '語彙',
          phrase: phrase,
          line: lineNum,
          count: count,
          description: `AI偏愛語・定型句「${phrase}」が検出されました。`
        });
      }
    });

    // ② 記号アーティファクトの検出 (全角ダッシュ ──)
    if (lineText.includes('──') || lineText.includes('――')) {
      results.push({
        type: '記号',
        phrase: '──',
        line: lineNum,
        count: 1,
        description: '全角ダッシュ「──」が検出されました。コロンや改行、読点への置換を検討してください。'
      });
    }

    // ③ 段落末・行末の等間隔絵文字 (🚀✨💡🎯等) の検出
    const emojiMatch = lineText.match(/[🚀✨💡🎯🌱🔥🤝📝]/g);
    if (emojiMatch && emojiMatch.length >= 2) {
      results.push({
        type: '記号',
        phrase: emojiMatch.join(''),
        line: lineNum,
        count: emojiMatch.length,
        description: `同一行に装飾絵文字が ${emojiMatch.length} 個検出されました。AI特有の均等撒布の可能性があります。`
      });
    }
  });

  return results;
}

// ==============================================================================
// 3. Gemini API 連携による文脈解析 (CDD)
// ==============================================================================
// 軽量化したルール（slop_rules_light.txt）を優先的に読み込み、Geminiに構造化レビューを行わせます。
async function analyzeWithGemini(text, apiKey, modelName = 'gemini-2.5-flash') {
  const lightRulesPath = path.resolve(__dirname, 'slop_rules_light.txt');
  const skillPath = path.resolve(__dirname, 'stop-ai-slop-jp', 'SKILL.md');
  const structuresPath = path.resolve(__dirname, 'stop-ai-slop-jp', 'references', 'structures.md');
  
  let systemInstructions = 'You are an expert editor specializing in removing AI-Slop (AI-ish writing styles) from Japanese text.';
  try {
    if (fs.existsSync(lightRulesPath)) {
      systemInstructions += '\n\nHere are the core guidelines for removing AI-Slop from Japanese text:\n' + fs.readFileSync(lightRulesPath, 'utf-8');
    } else {
      if (fs.existsSync(skillPath)) {
        systemInstructions += '\n\nHere is the guide file (SKILL.md) for stop-ai-slop-jp:\n' + fs.readFileSync(skillPath, 'utf-8');
      }
      if (fs.existsSync(structuresPath)) {
        systemInstructions += '\n\nHere is the structural patterns reference (structures.md):\n' + fs.readFileSync(structuresPath, 'utf-8');
      }
    }
  } catch (err) {
    console.error('Failed to load rules for prompt:', err);
  }

  // 構造化JSONで結果を返却するように指示
  const prompt = `
以下の日本語テキストを、読み込んでいる stop-ai-slop-jp の採点基準およびコアルールに基づいて厳格にレビューしてください。
5軸（立場、リズム、主体性、具体性、削減）をそれぞれ 1〜10 点で採点し、35点/50点未満の場合は「書き直し」を推奨してください。
また、特にAI臭さが顕著な箇所を抽出し、具体的な Before/After の書き換え提案を最大5件まで提示してください。

返却は必ず以下のJSONスキーマに従った純粋なJSONデータとして出力してください。コメント(// や /* */)や説明のためのテキストは絶対にJSONの中に含めないでください。

{
  "score": 30,
  "axes": {
    "立場": { "score": 6, "reason": "立場に関する評価理由" },
    "リズム": { "score": 5, "reason": "リズムに関する評価理由" },
    "主体性": { "score": 6, "reason": "主体性に関する評価理由" },
    "具体性": { "score": 7, "reason": "具体性に関する評価理由" },
    "削減": { "score": 6, "reason": "削減に関する評価理由" }
  },
  "issues": [
    {
      "type": "立場",
      "original": "AI臭い元の文章",
      "reason": "なぜこれがAI臭いか",
      "suggested": "改善後の人間らしい文章"
    }
  ],
  "summary": "全体を通じたAI臭さの度合いや特徴の総評"
}

■ 対象のテキスト:
${text}
`;

  // Gemini API エンドポイント（v1beta）の呼び出し
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json'
      },
      systemInstruction: {
        parts: [{ text: systemInstructions }]
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const resJson = await response.json();
  try {
    let textResponse = resJson.candidates[0].content.parts[0].text.trim();
    
    // Markdownコードブロック記法 (```json ... ```) やコメントを正規表現でクリーンアップ (CDD)
    if (textResponse.startsWith('```json')) {
      textResponse = textResponse.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (textResponse.startsWith('```')) {
      textResponse = textResponse.replace(/^```/, '').replace(/```$/, '').trim();
    }
    
    // 行末コメントや単体のコメントを削除
    textResponse = textResponse.replace(/\/\/.*$/gm, '');
    
    return JSON.parse(textResponse);
  } catch (err) {
    console.error('Failed to parse Gemini JSON response:', err, resJson);
    throw new Error('Gemini APIからの応答JSONのパースに失敗しました。');
  }
}

// ==============================================================================
// 4. Build system instructions for rewrite prompt (CDD)
// ==============================================================================
// Loads slop rule files and constructs the system instructions string.
// The actual API call is delegated to geminiService.js.
function buildRewriteSystemInstructions() {
  const lightRulesPath = path.resolve(__dirname, 'slop_rules_light.txt');
  const skillPath = path.resolve(__dirname, 'stop-ai-slop-jp', 'SKILL.md');
  const structuresPath = path.resolve(__dirname, 'stop-ai-slop-jp', 'references', 'structures.md');

  let systemInstructions =
    'You are an expert Japanese editor specializing in removing AI-Slop from articles. ' +
    'Your task is to rewrite the entire provided text so that it sounds natural, human-written, ' +
    'and fixes the specific issues provided. Output ONLY the raw rewritten markdown text, ' +
    'with no introductory or concluding remarks, no markdown code block fences (like ```), just the text itself.';

  try {
    if (fs.existsSync(lightRulesPath)) {
      systemInstructions +=
        '\n\nHere are the core rules for removing AI-Slop from Japanese text. You MUST strictly comply with these rules:\n' +
        fs.readFileSync(lightRulesPath, 'utf-8');
    } else {
      if (fs.existsSync(skillPath)) {
        systemInstructions +=
          '\n\nHere is the guide file (SKILL.md) for stop-ai-slop-jp. You MUST strictly comply with its rules and standards:\n' +
          fs.readFileSync(skillPath, 'utf-8');
      }
      if (fs.existsSync(structuresPath)) {
        systemInstructions +=
          '\n\nHere is the structural patterns reference (structures.md):\n' +
          fs.readFileSync(structuresPath, 'utf-8');
      }
    }
  } catch (err) {
    console.error('Failed to load rules for rewrite prompt:', err);
  }

  return systemInstructions;
}

module.exports = {
  scanTextLocal,
  analyzeWithGemini,
  buildRewriteSystemInstructions
};
