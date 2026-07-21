# -*- coding: utf-8 -*-
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

def build_wxr_xml(title, body_text):
    # MarkdownをHTMLに変換
    html_body = markdown.markdown(body_text, extensions=['fenced_code', 'tables'])
    
    # 日時フォーマット (WordPress標準: YYYY-MM-DD HH:MM:SS)
    date_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # WordPress WXR (XML) 形式の生成
    wxr_content = f"""<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
    xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
    xmlns:content="http://purl.org/rss/1.0/modules/content/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:wp="http://wordpress.org/export/1.2/"
>
<channel>
    <wp:wxr_version>1.2</wp:wxr_version>
    <item>
        <title>{title}</title>
        <content:encoded><![CDATA[{html_body}]]></content:encoded>
        <wp:post_date><![CDATA[{date_str}]]></wp:post_date>
        <wp:status><![CDATA[draft]]></wp:status>
        <wp:post_type><![CDATA[post]]></wp:post_type>
    </item>
</channel>
</rss>
"""
    return wxr_content

def main():
    parser = argparse.ArgumentParser(description="Convert Markdown draft to WordPress WXR (XML) format for note import.")
    parser.add_argument("--draft", required=True, help="Path to the markdown draft file")
    parser.add_argument("--output-dir", default=r"G:\マイドライブ\Vault_of_Heaven\01_Projects\Noteauto\Imports", help="Directory to save the XML file")
    parser.add_argument("--output-name", default=None, help="Name of the output XML file (defaults to [Title].xml)")
    
    args = parser.parse_args()
    
    title, body_text = parse_markdown(args.draft)
    xml_content = build_wxr_xml(title, body_text)
    
    # 出力ファイル名が指定されていない場合はタイトルをファイル名にする
    output_name = args.output_name
    if not output_name:
        clean_title = "".join(c for c in title if c not in r'\/:*?"<>|')
        output_name = f"{clean_title}.xml"
    else:
        if not output_name.endswith(".xml"):
            output_name = f"{output_name}.xml"
            
    # 出力パスの設定
    os.makedirs(args.output_dir, exist_ok=True)
    output_path = os.path.join(args.output_dir, output_name)
    
    # WXR形式ファイルを書き出し
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(xml_content)
        
    print(f"Successfully converted and saved to: {output_path}")

if __name__ == "__main__":
    main()
