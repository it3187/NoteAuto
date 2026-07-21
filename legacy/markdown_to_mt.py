import os
import sys
import argparse
from datetime import datetime
import markdown

# Windowsでのエンコードエラー防止
sys.stdout.reconfigure(encoding='utf-8')

def parse_markdown(file_path):
    if not os.path.exists(file_path):
        print(f"Error: File not found {file_path}")
        sys.exit(1)
        
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    lines = content.split('\n')
    title = ""
    body_lines = []
    
    # 最初のH1タグをタイトルとして抽出
    for idx, line in enumerate(lines):
        if line.startswith("# "):
            title = line.replace("# ", "").strip()
            body_lines = lines[idx+1:]
            break
            
    if not title:
        # 見つからない場合は最初の行をタイトルにする
        title = lines[0].strip()
        body_lines = lines[1:]
        
    body_text = "\n".join(body_lines).strip()
    return title, body_text

def convert_to_mt(title, body_text):
    # MarkdownをHTMLに変換して、noteのインポート時に装飾（見出し、太字、箇条書きなど）が正しく適用されるようにする
    html_body = markdown.markdown(body_text, extensions=['fenced_code', 'tables'])
    
    # noteのインポート仕様に合わせたMT形式のフォーマット
    date_str = datetime.now().strftime("%m/%d/%Y %I:%M:%S %p")
    
    mt_format = f"""TITLE: {title}
STATUS: Draft
DATE: {date_str}
-----
BODY:
{html_body}
-----
--------
"""
    return mt_format

def main():
    parser = argparse.ArgumentParser(description="Convert Markdown draft to note Movable Type (MT) import format.")
    parser.add_argument("--draft", required=True, help="Path to the markdown draft file")
    parser.add_argument("--output-dir", default=r"G:\マイドライブ\Vault_of_Heaven\01_Projects\Noteauto\Imports", help="Directory to save the converted MT file")
    parser.add_argument("--output-name", default=None, help="Name of the output MT file (defaults to [Title].txt)")
    
    args = parser.parse_args()
    
    title, body_text = parse_markdown(args.draft)
    mt_content = convert_to_mt(title, body_text)
    
    # 出力ファイル名が指定されていない場合はタイトルをファイル名にする
    output_name = args.output_name
    if not output_name:
        # OSのファイル名に使えない禁則文字を除去
        clean_title = "".join(c for c in title if c not in r'\/:*?"<>|')
        output_name = f"{clean_title}.txt"
    
    # 出力パスの設定
    os.makedirs(args.output_dir, exist_ok=True)
    output_path = os.path.join(args.output_dir, output_name)
    
    # MT形式ファイルを書き出し
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(mt_content)
        
    print(f"Successfully converted and saved to: {output_path}")

if __name__ == "__main__":
    main()
