import os
import sys
import json
import argparse
import urllib.request
import urllib.error
import time

# Ensure stdout uses UTF-8 to prevent Japanese encoding errors in Windows terminal
sys.stdout.reconfigure(encoding='utf-8')

# Base URL for NoteAuto Express backend
SERVER_URL = "http://localhost:3000"

def check_server_running():
    try:
        urllib.request.urlopen(f"{SERVER_URL}/api/detect-slop", timeout=2)
        return True
    except urllib.error.HTTPError:
        return True # Server is running, got 400 or other HTTP response
    except Exception:
        return False

def call_api(endpoint, data):
    url = f"{SERVER_URL}{endpoint}"
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            return json.loads(res_body)
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        try:
            return json.loads(err_msg)
        except Exception:
            return {"error": f"HTTP Error {e.code}: {err_msg}"}
    except Exception as e:
        return {"error": str(e)}

def parse_args():
    parser = argparse.ArgumentParser(description="NoteAuto CLI Pipeline")
    parser.add_argument("--theme", type=str, help="記事のテーマ")
    parser.add_argument("--keywords", type=str, default="", help="キーワード (任意、カンマ区切り)")
    parser.add_argument("--target", type=str, default="", help="ターゲット層 (任意)")
    parser.add_argument("--wordcount", type=int, default=2000, help="文字数の目安")
    parser.add_argument("--upload", action="store_true", help="note.comに下書き自動アップロードを行う")
    parser.add_argument("--no-upload", action="store_true", help="note.comへのアップロードをスキップし、ローカル保存のみにする")
    parser.add_argument("--mock", action="store_true", help="Gemini APIを使わずに tests/fixtures/mock_article.md のダミーデータでテスト走行する")
    return parser.parse_args()

def main():
    args = parse_args()

    print("=" * 60)
    print("           NoteAuto CLI 記事作成 ＆ 校正パイプライン")
    print("=" * 60)

    # 1. Check if server is running
    print("[1/5] バックエンドサーバーの接続確認中...")
    if not check_server_running():
        print("エラー: バックエンドサーバーが起動していません。")
        print("server.js をポート3000で起動してから再実行してください。")
        sys.exit(1)
    print("-> OK!")

    # 2. Get User Inputs (either from args or interactive prompt)
    theme = args.theme
    keywords = args.keywords
    target = args.target
    word_count = args.wordcount
    upload = None

    if args.mock and not theme:
        theme = "Mock Article Test"

    if args.upload:
        upload = True
    elif args.no_upload:
        upload = False

    if not theme:
        print("テーマは必須入力です。終了します。")
        sys.exit(1)
    
    if not args.theme and not args.mock:
        keywords = input("■ キーワード (任意、カンマ区切り): ").strip()
        target = input("■ ターゲット層 (任意): ").strip()
        word_count_str = input("■ 文字数の目安 (デフォルト 2000): ").strip()
        word_count = int(word_count_str) if word_count_str.isdigit() else 2000

    print("\n--- 設定内容 ---")
    print(f"■ テーマ: {theme}")
    print(f"■ キーワード: {keywords}")
    print(f"■ ターゲット: {target}")
    print(f"■ 文字数: {word_count}")

    print("\n" + "=" * 40)
    print(" パイプライン実行中... (途中で終了しないでください)")
    print("=" * 40)

    if args.mock:
        print("\n★ [MOCK MODE] Gemini API呼び出しを完全スキップします。")
        mock_file = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "mock_article.md")
        if not os.path.exists(mock_file):
            print(f"エラー: モックファイルが存在しません: {mock_file}")
            sys.exit(1)
        with open(mock_file, "r", encoding="utf-8") as f:
            rewritten_text = f.read()
        print(f"-> Mock article loaded: {mock_file}")
        before_score = "N/A (Mock)"
        after_score = "N/A (Mock)"
    else:
        # Step 1: Generate Article
        print("\n[Step 1/4] 記事を生成中 (Gemini)...")
        gen_res = call_api("/api/generate-base-article", {
            "theme": theme,
            "keywords": keywords,
            "target": target,
            "wordCount": word_count
        })
        if "error" in gen_res:
            print(f"エラー: 記事の生成に失敗しました。 {gen_res['error']}")
            sys.exit(1)
        article_text = gen_res["article"]
        print("-> Article generated!")

        print("Gemini API レートリミット回避のため、12秒間スリープします...")
        time.sleep(12)

        # Step 2: First Slop Scan
        print("\n[Step 2/4] スロップ判定を実行中...")
        scan_res1 = call_api("/api/detect-slop", {"text": article_text})
        print(f"DEBUG scan_res1 response: {scan_res1}")
        if "error" in scan_res1:
            print(f"エラー: スキャンに失敗しました。 {scan_res1['error']}")
            sys.exit(1)
        
        ai_analysis = scan_res1.get("aiAnalysis")
        if ai_analysis:
            before_score = ai_analysis.get("score", "N/A")
            issues = ai_analysis.get("issues", [])
        else:
            print("警告: AI-Slopスキャン結果が空のため、ローカル判定結果のみを使用します。")
            before_score = "N/A (制限によりスキップ)"
            issues = [match.get("description", "問題点あり") for match in scan_res1.get("localMatches", [])]
            
        print(f"➔ 初回スロップ点数: {before_score}/50 点")

        print("Gemini API レートリミット回避のため、12秒間スリープします...")
        time.sleep(12)

        # Step 3: Rewrite Slop
        print("\n[Step 3/4] ルール同期型校正リライトを実行中...")
        rewrite_res = call_api("/api/rewrite-slop", {
            "text": article_text,
            "issues": issues
        })
        if "error" in rewrite_res:
            print(f"エラー: 校正リライトに失敗しました。 {rewrite_res['error']}")
            sys.exit(1)
        
        rewritten_text = rewrite_res["rewrittenText"]
        print("-> Rewrite completed!")

        # テスト走行用：ダミー画像プレースホルダーを本文に2箇所自動で挿入
        sections = rewritten_text.split("\n## ")
        if len(sections) >= 3:
            sections[1] = "\n[IMAGE_PLACEHOLDER:Src/public/last_pipeline_upload.png]\n\n" + sections[1]
            sections[2] = "\n[IMAGE_PLACEHOLDER:error_screenshot.png]\n\n" + sections[2]
            rewritten_text = "\n## ".join(sections)
            print("★ [DEBUG] テスト走行用の画像プレースホルダー2枚を本文の各章見出し直前に挿入しました。")

        print("Gemini API レートリミット回避のため、12秒間スリープします...")
        time.sleep(12)

        # Step 4: Final Slop Scan
        print("\n[Step 4/4] 最終判定を実行中...")
        scan_res2 = call_api("/api/detect-slop", {"text": rewritten_text})
        if "error" in scan_res2:
            print(f"エラー: 最終スキャンに失敗しました。 {scan_res2['error']}")
            sys.exit(1)
        
        ai_analysis2 = scan_res2.get("aiAnalysis")
        if ai_analysis2:
            after_score = ai_analysis2.get("score", "N/A")
        else:
            after_score = "N/A (制限によりスキップ)"
            
        print(f"-> Final score (after rewrite): {after_score}/50")
        if isinstance(before_score, int) and isinstance(after_score, int):
            print(f"* Improvement: {before_score} -> {after_score} (diff: +{after_score - before_score})")
        else:
            print(f"* Improvement: {before_score} -> {after_score}")

    # Print summary
    print("\n" + "=" * 40)
    print(" 最終原稿プレビュー (最初の5行):")
    print("=" * 40)
    lines = rewritten_text.split("\n")
    for line in lines[:5]:
        print(line)
    print("...")

    # Upload Decision
    if upload is None:
        print("\n" + "=" * 40)
        upload_confirm = input("■ note.com に下書き保存しますか？ (y/n): ").strip().lower()
        upload = (upload_confirm == 'y')

    if upload:
        print("\nnote.com へのアップロード処理を開始中... (みんなのフォトギャラリーから画像を設定します)")
        upload_res = call_api("/api/save-and-upload", {"articleText": rewritten_text})
        if "error" in upload_res:
            print(f"エラー: アップロードに失敗しました。 {upload_res['error']}")
        else:
            print("\n" + "★" * 30)
            print(" 保存成功！")
            print(f"■ ローカルファイル: {upload_res['localFilePath']}")
            if upload_res.get("noteUpload"):
                print("■ note.com への下書き保存が完了しました！")
            print("★" * 30)
    else:
        # Save locally only
        print("\nローカル保存のみ実行します...")
        save_res = call_api("/api/save-and-upload", {"articleText": rewritten_text, "uploadToNote": False})
        if "error" in save_res:
            print(f"エラー: ローカル保存に失敗しました。 {save_res['error']}")
        else:
            print(f"-> Saved locally: {save_res['localFilePath']}")

    print("\nすべての処理が終了しました。")

if __name__ == "__main__":
    main()
