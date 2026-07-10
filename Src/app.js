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
    
    // UI state: Running
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
      
      // Success state
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
      // Restore UI state
      button.disabled = false;
      if (btnText && spinner) {
        btnText.textContent = '下書きの自動作成を実行';
        spinner.classList.add('hidden');
      }
    }
  });
}
