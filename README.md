# NoteAuto - note自動下書き保存ツール

このツールは、ローカルで記述したMarkdown形式の記事下書きを、noteの編集エディタ（`https://editor.note.com/new`）に自動で貼り付けて下書き保存するPythonスクリプトです。

---

## 📦 セットアップ方法

1. **必要なライブラリのインストール**:
   以下のコマンドを実行して、Playwrightおよびマークダウンパーサーをインストールします。
   ```bash
   pip install -r requirements.txt
   ```

2. **Playwrightのブラウザ初期化**:
   Playwright用のChromiumブラウザ本体をインストールします。
   ```bash
   playwright install chromium
   ```

---

## 🚀 使い方

以下のコマンドを実行すると、ヘッドフルブラウザが起動し、自動でnoteのエディター画面を開いて下書きをアップロードします。

```bash
python note_uploader.py --draft "G:\マイドライブ\Vault_of_Heaven\03_Journal\Monetization\Note\note_draft.md"
```

### 🔐 初回起動時の注意（ログインセッションの保存）
- 初回起動時、noteにログインしていない場合はブラウザがログイン画面で停止します。
- ブラウザ上で手動でメールログイン ＆ セキュリティ認証（reCAPTCHA）を完了させてください。
- ログインが完了してエディタ画面が表示されたら、ターミナル上で **`ENTER`** キーを押すと、自動入力処理が再開されます。
- ログイン状態（Cookieやセッション）はローカルの `data/chrome_profile` フォルダ内に保存されるため、**2回目以降は認証なしで完全に自動で下書き保存が実行されます。**
