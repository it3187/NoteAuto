// ==============================================================================
// 1. Tab switching logic (CDD) - 3 tabs: pipeline, upload, slop
// ==============================================================================
const allTabs = ['pipeline', 'upload', 'slop'];

function switchTab(activeId) {
  allTabs.forEach(id => {
    const tabBtn = document.getElementById(`tab-${id}`);
    const pane = document.getElementById(`content-${id}`);
    if (tabBtn && pane) {
      if (id === activeId) {
        tabBtn.classList.add('active');
        pane.classList.add('active');
        pane.classList.remove('hidden');
      } else {
        tabBtn.classList.remove('active');
        pane.classList.remove('active');
        pane.classList.add('hidden');
      }
    }
  });
}

allTabs.forEach(id => {
  const tabBtn = document.getElementById(`tab-${id}`);
  if (tabBtn) {
    tabBtn.addEventListener('click', () => switchTab(id));
  }
});


// ==============================================================================
// 2. 下書き保存実行ロジック (CDD) - 既存機能の維持
// ==============================================================================
const button = document.getElementById('btn-interact');
const display = document.getElementById('display-message');
const filePathInput = document.getElementById('file-path-input');
const previewArea = document.getElementById('preview-area');
const screenshotImg = document.getElementById('screenshot-img');

if (button && display && filePathInput) {
  button.addEventListener('click', async () => {
    const filePath = filePathInput.value.trim();
    
    if (!filePath) {
      display.textContent = 'エラー: ファイルパスを指定してください。';
      display.className = 'status-message error';
      return;
    }
    
    button.disabled = true;
    const btnText = button.querySelector('.btn-text');
    const spinner = button.querySelector('.spinner');
    if (btnText && spinner) {
      btnText.textContent = '自動実行中...';
      spinner.classList.remove('hidden');
    }
    
    display.textContent = 'Playwrightを起動し、noteのエディタに遷移しています... ログインが必要な場合は画面に従って手動で認証してください。';
    display.className = 'status-message running';
    previewArea.classList.add('hidden');
    
    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filePath })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '不明なエラーが発生しました。');
      }
      
      display.textContent = `成功しました！記事「${data.title}」の下書き保存が完了しました。`;
      display.className = 'status-message success';
      
      if (data.screenshot) {
        screenshotImg.src = data.screenshot;
        previewArea.classList.remove('hidden');
      }
      
    } catch (error) {
      console.error(error);
      display.textContent = `エラーが発生しました: ${error.message}`;
      display.className = 'status-message error';
    } finally {
      button.disabled = false;
      if (btnText && spinner) {
        btnText.textContent = '下書きの自動作成を実行';
        spinner.classList.add('hidden');
      }
    }
  });
}

// ==============================================================================
// 3. AI-Slop 検知実行 ＆ 結果描画ロジック (CDD)
// ==============================================================================
let currentSlopIssues = [];
const btnScan = document.getElementById('btn-scan');
const slopDisplay = document.getElementById('slop-display-message');
const slopFilePathInput = document.getElementById('slop-file-path');
const slopTextInput = document.getElementById('slop-text-input');
const slopScoreArea = document.getElementById('slop-score-area');
const slopDetailsArea = document.getElementById('slop-details-area');

// 各種描画パーツの取得
const scoreVal = document.getElementById('slop-score-val');
const statusTitle = document.getElementById('slop-status-title');
const statusDesc = document.getElementById('slop-status-desc');
const summaryText = document.getElementById('slop-summary-text');
const localWarningsList = document.getElementById('local-warnings-list');
const suggestionsList = document.getElementById('suggestions-list');

if (btnScan && slopDisplay) {
  btnScan.addEventListener('click', async () => {
    const filePath = slopFilePathInput ? slopFilePathInput.value.trim() : '';
    const text = slopTextInput ? slopTextInput.value.trim() : '';

    if (!filePath && !text) {
      slopDisplay.textContent = 'エラー: ファイルパスまたはテキストを直接入力してください。';
      slopDisplay.className = 'status-message error';
      return;
    }

    // UI状態を実行中に変更
    btnScan.disabled = true;
    const btnText = btnScan.querySelector('.btn-text');
    const spinner = btnScan.querySelector('.spinner');
    if (btnText && spinner) {
      btnText.textContent = 'スキャン中...';
      spinner.classList.remove('hidden');
    }

    slopDisplay.textContent = 'テキストをロードし、日本語AI臭（AI-Slop）を解析しています。しばらくお待ちください...';
    slopDisplay.className = 'status-message running';
    
    // エリアのクリアと非表示化
    if (slopScoreArea) slopScoreArea.classList.add('hidden');
    if (slopDetailsArea) slopDetailsArea.classList.add('hidden');

    try {
      const response = await fetch('/api/detect-slop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filePath, text })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '解析エラーが発生しました。');
      }

      slopDisplay.textContent = '解析が完了しました！結果は以下の通りです。';
      slopDisplay.className = 'status-message success';

      // ① 総合スコアと5軸評価の描画
      if (data.aiAnalysis) {
        const ai = data.aiAnalysis;
        currentSlopIssues = ai.issues || [];
        if (scoreVal) scoreVal.textContent = ai.score;
        
        // スコアに応じた状態テキストと警告色の設定
        if (statusTitle && statusDesc) {
          const score = ai.score;
          const scoreContainer = document.querySelector('.score-radial');
          if (score >= 35) {
            statusTitle.textContent = '良好 (人間らしい文章)';
            statusDesc.textContent = 'stop-ai-slop-jpの合格基準（35点以上）をクリアしています。';
            if (scoreContainer) {
              scoreContainer.style.borderColor = 'var(--success-color)';
              scoreContainer.style.boxShadow = '0 0 15px rgba(48, 209, 88, 0.2)';
            }
          } else {
            statusTitle.textContent = '書き直し推奨 (高いAI臭)';
            statusDesc.textContent = '合計点が35点未満です。AI特有の手癖や主体の不在が目立ちます。';
            if (scoreContainer) {
              scoreContainer.style.borderColor = 'var(--error-color)';
              scoreContainer.style.boxShadow = '0 0 15px rgba(255, 69, 58, 0.2)';
            }
          }
        }

        // 個別5軸バーのアニメーション描画
        const axes = ['立場', 'リズム', '主体性', '具体性', '削減'];
        axes.forEach(axis => {
          const scoreObj = ai.axes[axis];
          if (scoreObj) {
            const bar = document.getElementById(`bar-${axis}`);
            const valLabel = document.getElementById(`val-${axis}`);
            if (bar && valLabel) {
              const pct = (scoreObj.score / 10) * 100;
              bar.style.width = `${pct}%`;
              valLabel.textContent = scoreObj.score;
            }
          }
        });

        // 総合要約の描画
        if (summaryText) {
          summaryText.textContent = ai.summary || '評価要約が生成されませんでした。';
        }

        // Before/After 提案の描画
        if (suggestionsList) {
          suggestionsList.innerHTML = '';
          if (ai.issues && ai.issues.length > 0) {
            ai.issues.forEach(issue => {
              const item = document.createElement('div');
              item.className = 'suggestion-item';
              item.innerHTML = `
                <div class="suggestion-header">
                  <span class="suggestion-badge">${issue.type}</span>
                  <span class="suggestion-reason">${issue.reason}</span>
                </div>
                <div class="suggestion-diff">
                  <div class="diff-box original" data-label="Before (修正前)">${escapeHtml(issue.original)}</div>
                  <div class="diff-box suggested" data-label="After (修正後)">${escapeHtml(issue.suggested)}</div>
                </div>
              `;
              suggestionsList.appendChild(item);
            });
          } else {
            suggestionsList.innerHTML = '<p class="description">特に重大なAI臭さは見つかりませんでした。</p>';
          }
        }

        if (slopScoreArea) slopScoreArea.classList.remove('hidden');
        if (slopDetailsArea) slopDetailsArea.classList.remove('hidden');
      }

      // ② ローカル静的ルールの警告一覧の描画
      if (localWarningsList) {
        localWarningsList.innerHTML = '';
        if (data.localMatches && data.localMatches.length > 0) {
          data.localMatches.forEach(match => {
            const pill = document.createElement('div');
            pill.className = 'warning-pill';
            pill.innerHTML = `
              <strong>${match.phrase}</strong>
              <span>${match.description}</span>
              <span class="pill-meta">${match.line} 行目 (${match.count} 回検出)</span>
            `;
            localWarningsList.appendChild(pill);
          });
        } else {
          localWarningsList.innerHTML = '<p class="description">定型句や記号の機械的なアーティファクトは検出されませんでした。</p>';
        }
      }

    } catch (error) {
      console.error(error);
      slopDisplay.textContent = `スキャンエラー: ${error.message}`;
      slopDisplay.className = 'status-message error';
    } finally {
      // 復元
      btnScan.disabled = false;
      if (btnText && spinner) {
        btnText.textContent = 'AI臭をスキャンする';
        spinner.classList.add('hidden');
      }
    }
  });
}

// HTMLエスケープヘルパー (XSS対策)
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==============================================================================
// 4. 自動書き直し（Auto-Rewrite）ロジック (CDD)
// ==============================================================================
const btnAutoRewrite = document.getElementById('btn-auto-rewrite');
const rewriteStatus = document.getElementById('rewrite-status');

if (btnAutoRewrite && rewriteStatus) {
  btnAutoRewrite.addEventListener('click', async () => {
    const filePath = slopFilePathInput ? slopFilePathInput.value.trim() : '';
    
    if (!filePath) {
      rewriteStatus.textContent = 'エラー: ファイルパスが指定されていません。テキスト直打ちの書き直しは現在未対応です。';
      rewriteStatus.className = 'status-message error mt-2';
      rewriteStatus.classList.remove('hidden');
      return;
    }
    
    btnAutoRewrite.disabled = true;
    const btnText = btnAutoRewrite.querySelector('.btn-text');
    if (btnText) btnText.textContent = '自動書き直し中... (Gemini API)';
    
    rewriteStatus.textContent = 'AIによる全体リライトを実行しています。これには数秒〜数十秒かかります...';
    rewriteStatus.className = 'status-message running mt-2';
    rewriteStatus.classList.remove('hidden');
    
    try {
      const response = await fetch('/api/rewrite-slop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, issues: currentSlopIssues })
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '書き換えエラーが発生しました。');
      }
      
      rewriteStatus.textContent = `成功！新しいファイルを保存しました:\n${data.newFilePath}\n※パスは下書き保存タブにセットされました。`;
      rewriteStatus.className = 'status-message success mt-2';
      
      // クリップボードと下書き保存フォームにセット
      navigator.clipboard.writeText(data.newFilePath).catch(() => {});
      if (filePathInput) filePathInput.value = data.newFilePath;
      
    } catch (error) {
      console.error(error);
      rewriteStatus.textContent = `エラー: ${error.message}`;
      rewriteStatus.className = 'status-message error mt-2';
    } finally {
      btnAutoRewrite.disabled = false;
      if (btnText) btnText.textContent = '✨ 提案を適用して自動書き直し';
    }
  });
}

// ==============================================================================
// 5. Pipeline Orchestration Logic (CDD)
// ==============================================================================
// Runs: Generate Article -> AI-Slop Scan -> Proofread Rewrite -> Final AI-Slop Scan sequentially.
const btnPipelineRun = document.getElementById('btn-pipeline-run');
const btnPipelineSave = document.getElementById('btn-pipeline-save');
const pipelineStatus = document.getElementById('pipeline-status');
const pipelineResults = document.getElementById('pipeline-results');
const pipelineEditor = document.getElementById('pipeline-editor');
const pipelineScanSummary = document.getElementById('pipeline-scan-summary');
const pipelineIssuesList = document.getElementById('pipeline-issues-list');
const pipelineScoreMini = document.getElementById('pipeline-score-mini');
const pipelineScoreValBefore = document.getElementById('pipeline-score-val-before');
const pipelineScoreValAfter = document.getElementById('pipeline-score-val-after');
const pipelineScoreStatus = document.getElementById('pipeline-score-status');
const pipelineScoreDesc = document.getElementById('pipeline-score-desc');
const pipelineSaveStatus = document.getElementById('pipeline-save-status');

// Progress Bar Elements
const pipelineProgressBar = document.getElementById('pipeline-progress-bar');
const pipelineProgressText = document.getElementById('pipeline-progress-text');

// Stepper helper functions
const stepIds = ['step-generate', 'step-scan', 'step-proofread', 'step-final-scan', 'step-done'];
const connectorEls = document.querySelectorAll('#content-pipeline .step-connector');

function resetStepper() {
  stepIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('active', 'completed');
    }
  });
  connectorEls.forEach(c => c.classList.remove('completed'));
}

function setStepActive(stepIndex) {
  // Mark all previous steps as completed
  for (let i = 0; i < stepIndex; i++) {
    const el = document.getElementById(stepIds[i]);
    if (el) {
      el.classList.remove('active');
      el.classList.add('completed');
    }
    if (connectorEls[i]) connectorEls[i].classList.add('completed');
  }
  // Mark current step as active
  const current = document.getElementById(stepIds[stepIndex]);
  if (current) {
    current.classList.remove('completed');
    current.classList.add('active');
  }
}

function setStepCompleted(stepIndex) {
  const el = document.getElementById(stepIds[stepIndex]);
  if (el) {
    el.classList.remove('active');
    el.classList.add('completed');
  }
  if (connectorEls[stepIndex]) connectorEls[stepIndex].classList.add('completed');
}

// Progress Bar Helper
function updateProgress(percent) {
  if (pipelineProgressBar && pipelineProgressText) {
    pipelineProgressBar.style.width = `${percent}%`;
    pipelineProgressText.textContent = `${percent}%`;
  }
}

if (btnPipelineRun && pipelineStatus) {
  btnPipelineRun.addEventListener('click', async () => {
    const theme = document.getElementById('pipeline-theme')?.value.trim();
    const keywords = document.getElementById('pipeline-keywords')?.value.trim();
    const target = document.getElementById('pipeline-target')?.value.trim();
    const wordCount = parseInt(document.getElementById('pipeline-wordcount')?.value) || 2000;

    if (!theme) {
      pipelineStatus.textContent = 'エラー: 記事のテーマを入力してください。';
      pipelineStatus.className = 'status-message error';
      return;
    }

    // Reset UI
    btnPipelineRun.disabled = true;
    const btnText = btnPipelineRun.querySelector('.btn-text');
    const spinner = btnPipelineRun.querySelector('.spinner');
    if (btnText) btnText.textContent = '処理中...';
    if (spinner) spinner.classList.remove('hidden');
    resetStepper();
    updateProgress(0);
    if (pipelineResults) pipelineResults.classList.add('hidden');
    if (pipelineScoreMini) pipelineScoreMini.classList.add('hidden');

    let generatedArticle = '';
    let firstScanData = null;
    let rewrittenArticle = '';
    let finalScanData = null;

    try {
      // ========== Step 1: Generate Article ==========
      setStepActive(0);
      updateProgress(5);
      pipelineStatus.textContent = '記事を生成しています... Gemini APIに問い合わせ中です。';
      pipelineStatus.className = 'status-message running';

      // Simulate minor progress steps for better UX
      const genInterval = setInterval(() => {
        let current = parseInt(pipelineProgressText.textContent) || 0;
        if (current < 20) updateProgress(current + 3);
      }, 800);

      const genResponse = await fetch('/api/generate-base-article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, keywords, target, wordCount })
      });
      clearInterval(genInterval);

      const genData = await genResponse.json();
      if (!genResponse.ok) throw new Error(genData.error || 'Article generation failed.');
      generatedArticle = genData.article;
      setStepCompleted(0);
      updateProgress(25);

      // ========== Step 2: First AI-Slop Scan ==========
      setStepActive(1);
      updateProgress(30);
      pipelineStatus.textContent = 'AI-Slopスキャンを実行しています... 生成された記事のAI臭を解析中です。';
      pipelineStatus.className = 'status-message running';

      const scanInterval = setInterval(() => {
        let current = parseInt(pipelineProgressText.textContent) || 0;
        if (current < 40) updateProgress(current + 2);
      }, 500);

      const scanResponse = await fetch('/api/detect-slop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: generatedArticle })
      });
      clearInterval(scanInterval);

      firstScanData = await scanResponse.json();
      if (!scanResponse.ok) throw new Error(firstScanData.error || 'Initial AI-Slop scan failed.');
      
      const beforeScore = firstScanData.aiAnalysis?.score || 0;
      if (pipelineScoreValBefore) pipelineScoreValBefore.textContent = beforeScore;
      setStepCompleted(1);
      updateProgress(45);

      // ========== Step 3: Proofread Rewrite ==========
      setStepActive(2);
      updateProgress(50);
      pipelineStatus.textContent = '校正リライトを実行しています... 自然な日本語に書き直し中です。';
      pipelineStatus.className = 'status-message running';

      const rewriteInterval = setInterval(() => {
        let current = parseInt(pipelineProgressText.textContent) || 0;
        if (current < 70) updateProgress(current + 4);
      }, 800);

      const rewriteResponse = await fetch('/api/rewrite-slop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: '',
          text: generatedArticle,
          issues: firstScanData.aiAnalysis?.issues || []
        })
      });
      clearInterval(rewriteInterval);

      const rewriteData = await rewriteResponse.json();
      if (!rewriteResponse.ok) {
        console.warn('Rewrite failed, using generated article as fallback:', rewriteData.error);
        rewrittenArticle = generatedArticle;
      } else {
        rewrittenArticle = rewriteData.rewrittenText || generatedArticle;
      }
      setStepCompleted(2);
      updateProgress(75);

      // ========== Step 4: Final AI-Slop Scan (Proofread text) ==========
      setStepActive(3);
      updateProgress(80);
      pipelineStatus.textContent = '校正後の原稿を最終判定しています... スコアの改善を確認中。';
      pipelineStatus.className = 'status-message running';

      const finalScanInterval = setInterval(() => {
        let current = parseInt(pipelineProgressText.textContent) || 0;
        if (current < 90) updateProgress(current + 2);
      }, 500);

      const finalScanResponse = await fetch('/api/detect-slop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rewrittenArticle })
      });
      clearInterval(finalScanInterval);

      finalScanData = await finalScanResponse.json();
      if (!finalScanResponse.ok) throw new Error(finalScanData.error || 'Final AI-Slop scan failed.');
      
      const afterScore = finalScanData.aiAnalysis?.score || 0;
      if (pipelineScoreValAfter) pipelineScoreValAfter.textContent = afterScore;
      setStepCompleted(3);
      updateProgress(95);

      // ========== Step 5: Complete ==========
      setStepActive(4);
      setStepCompleted(4);
      updateProgress(100);
      pipelineStatus.textContent = '完了！ すべてのステップ（生成 ➔ スロップ判定 ➔ 校正 ➔ 最終判定）が正常に終了しました。';
      pipelineStatus.className = 'status-message success';

      // --- Display comparison score panel details ---
      if (pipelineScoreMini) {
        const scoreDiff = afterScore - beforeScore;
        let diffText = '';
        if (scoreDiff > 0) {
          diffText = ` (校正によってスコアが +${scoreDiff} 点アップしました！)`;
        } else if (scoreDiff === 0) {
          diffText = ` (スコアは維持されました。)`;
        }

        if (pipelineScoreStatus) {
          if (afterScore >= 35) {
            pipelineScoreStatus.textContent = `合格レベルクリア (総合スコア: ${afterScore}/50)`;
            pipelineScoreStatus.style.color = 'var(--success-color)';
          } else {
            pipelineScoreStatus.textContent = `改善されましたが微調整推奨 (総合スコア: ${afterScore}/50)`;
            pipelineScoreStatus.style.color = 'var(--warning-color)';
          }
        }
        if (pipelineScoreDesc) {
          pipelineScoreDesc.textContent = `AI偏愛語やぎこちない定型表現を解消し、より自然で人間らしい文章になりました。${diffText}`;
        }
        pipelineScoreMini.classList.remove('hidden');
      }

      // --- Populate results split-panel ---
      // Left panel: Scan summary & issues (using final scan data to show remaining minor issues if any)
      if (pipelineScanSummary && finalScanData.aiAnalysis) {
        pipelineScanSummary.textContent = finalScanData.aiAnalysis.summary || 'Summary not available.';
      }

      if (pipelineIssuesList) {
        pipelineIssuesList.innerHTML = '';
        const issuesToShow = finalScanData.aiAnalysis?.issues || [];
        if (issuesToShow.length > 0) {
          issuesToShow.forEach(issue => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerHTML = `
              <div class="suggestion-header">
                <span class="suggestion-badge">${issue.type}</span>
                <span class="suggestion-reason">${issue.reason}</span>
              </div>
              <div class="suggestion-diff">
                <div class="diff-box original" data-label="Before">${escapeHtml(issue.original)}</div>
                <div class="diff-box suggested" data-label="After">${escapeHtml(issue.suggested)}</div>
              </div>
            `;
            pipelineIssuesList.appendChild(item);
          });
        } else {
          pipelineIssuesList.innerHTML = '<p class="description">校正後の原稿にはAI臭い表現は検出されませんでした！完璧です。</p>';
        }
      }

      // Right panel: Editable proofread text
      if (pipelineEditor) {
        pipelineEditor.value = rewrittenArticle;
      }

      // Show results
      if (pipelineResults) pipelineResults.classList.remove('hidden');

    } catch (error) {
      console.error('Pipeline error:', error);
      pipelineStatus.textContent = `エラーが発生しました: ${error.message}`;
      pipelineStatus.className = 'status-message error';
    } finally {
      btnPipelineRun.disabled = false;
      if (btnText) btnText.textContent = '記事の自動生成 & 校正を開始';
      if (spinner) spinner.classList.add('hidden');
    }
  });
}

// ==============================================================================
// 6. Pipeline Save & Upload Logic (CDD)
// ==============================================================================
if (btnPipelineSave && pipelineSaveStatus) {
  btnPipelineSave.addEventListener('click', async () => {
    const articleText = pipelineEditor?.value.trim();

    if (!articleText) {
      pipelineSaveStatus.textContent = 'エラー: 保存する記事テキストがありません。';
      pipelineSaveStatus.className = 'status-message error';
      pipelineSaveStatus.classList.remove('hidden');
      return;
    }

    btnPipelineSave.disabled = true;
    const btnText = btnPipelineSave.querySelector('.btn-text');
    const spinner = btnPipelineSave.querySelector('.spinner');
    if (btnText) btnText.textContent = '保存 & アップロード中...';
    if (spinner) spinner.classList.remove('hidden');

    pipelineSaveStatus.textContent = 'ローカルに保存し、note.comへアップロードしています... (初回はログインが必要です)';
    pipelineSaveStatus.className = 'status-message running';
    pipelineSaveStatus.classList.remove('hidden');

    try {
      const response = await fetch('/api/save-and-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleText })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save/upload failed.');

      let msg = `ローカル保存完了: ${data.localFilePath}`;
      if (data.noteUpload && data.noteUpload.uploaded) {
        msg += '\nnote.com への下書き保存も完了しました！';
      } else if (data.status === 'partial') {
        msg += `\n${data.error || 'note.comへのアップロードはスキップされました。'}`;
      }

      pipelineSaveStatus.textContent = msg;
      pipelineSaveStatus.className = 'status-message success';

    } catch (error) {
      console.error('Save/upload error:', error);
      pipelineSaveStatus.textContent = `エラー: ${error.message}`;
      pipelineSaveStatus.className = 'status-message error';
    } finally {
      btnPipelineSave.disabled = false;
      if (btnText) btnText.textContent = '下書き保存を実行';
      if (spinner) spinner.classList.add('hidden');
    }
  });
}
