import os
import sys
import argparse
import logging
import time
from playwright.sync_api import sync_playwright

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def parse_markdown(file_path):
    if not os.path.exists(file_path):
        logging.error(f"Markdown file not found: {file_path}")
        sys.exit(1)
        
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    title = ""
    body_lines = []
    
    # Extract title from the first H1 tag (# Title)
    for idx, line in enumerate(lines):
        if line.startswith("# "):
            title = line.replace("# ", "").strip()
            # The rest of the file is the body
            body_lines = lines[idx+1:]
            break
            
    if not title:
        # Fallback to first line if no # title found
        title = lines[0].strip()
        body_lines = lines[1:]
        
    body_text = "".join(body_lines).strip()
    return title, body_text

def run_uploader(draft_path, profile_path, headless=False):
    title, body_text = parse_markdown(draft_path)
    logging.info(f"Loaded draft: {title} ({len(body_text)} chars)")
    
    # Ensure profile directory exists
    os.makedirs(profile_path, exist_ok=True)
    
    with sync_playwright() as p:
        logging.info(f"Launching browser with profile: {profile_path}")
        # Launch persistent context to reuse cookies/login session
        context = p.chromium.launch_persistent_context(
            user_data_dir=profile_path,
            headless=headless,
            viewport={"width": 1280, "height": 800}
        )
        
        page = context.new_page()
        
        # Navigate to note's new entry editor
        logging.info("Navigating to note editor page...")
        page.goto("https://editor.note.com/new")
        
        # Check if we are redirected to login page or loaded editor
        logging.info("Waiting for page load state determination...")
        try:
            # エディタのタイトル欄か、ログイン画面のメールアドレス入力欄のいずれかが出現するまで待つ
            page.locator('textarea.note-editor__title, textarea.note-editor__title-textarea, input[placeholder*="メールアドレス"], input[type="email"]').wait_for(state="attached", timeout=15000)
        except Exception:
            logging.info("Timeout waiting for layout determination, checking URL directly.")
            
        current_url = page.url
        logging.info(f"Current URL: {current_url}")
        if "new" not in current_url and "edit" not in current_url:
            logging.warning("Not on editor page. Please log in manually in the browser window.")
            logging.info("Once you have successfully logged in and see the editor page, press ENTER here to continue...")
            input("Press ENTER after successful login...")
            # After manual login, reload to make sure we are in editor
            if "new" not in page.url and "edit" not in page.url:
                page.goto("https://editor.note.com/new")
                time.sleep(3)
            
        # Verify if we are on editor page
        if "new" not in page.url and "edit" not in page.url:
            logging.error(f"Failed to load editor page. Current URL: {page.url}")
            context.close()
            sys.exit(1)
            
        try:
            logging.info("Editor loaded. Filling title...")
            # 日本語の文字化けを防ぐため、クラス名またはプレースホルダーを使用
            title_textarea = page.locator('textarea.note-editor__title, textarea.note-editor__title-textarea, textarea[placeholder="記事タイトル"]')
            title_textarea.wait_for(state="visible", timeout=30000)
            title_textarea.click()
            title_textarea.fill(title)
            
            logging.info("Filling body text...")
            # タイトル入力後、Tabキーでフォーカスを本文へ移動させる
            page.keyboard.press("Tab")
            time.sleep(0.5)
            
            # Note body editor is contenteditable ProseMirror editor
            # より精度の高いクラス .ProseMirror を優先して取得
            body_editor = page.locator('.ProseMirror, .note-editor__body, div[contenteditable="true"]').first
            body_editor.wait_for(state="visible", timeout=10000)
            body_editor.click()
            
            # Select all and delete any existing text in body
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            
            # Insert text via keyboard simulation (handles note's RichText conversion perfectly)
            page.keyboard.insert_text(body_text)
            
            # Wait for autosave or click Save button
            logging.info("Saving draft...")
            save_button = page.locator('button:has-text("下書き保存")')
            if save_button.is_visible():
                save_button.click()
                logging.info("Draft save button clicked.")
                time.sleep(5) # Wait for network requests
            else:
                logging.info("Auto-save completed or button not visible.")
                
            # Take screenshot of the finished draft
            screenshot_path = os.path.join(os.path.dirname(__file__), "last_draft_screenshot.png")
            page.screenshot(path=screenshot_path)
            logging.info(f"Saved draft screenshot to: {screenshot_path}")
            logging.info("Successfully created draft on note!")
        except Exception as e:
            error_screenshot_path = os.path.join(os.path.dirname(__file__), "error_screenshot.png")
            page.screenshot(path=error_screenshot_path)
            logging.error(f"Error occurred. Saved error screenshot to: {error_screenshot_path}")
            raise e
        finally:
            context.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Auto-upload markdown draft to note.com")
    parser.add_argument("--draft", required=True, help="Path to the markdown draft file")
    parser.add_argument("--profile", default=os.path.join(os.path.dirname(__file__), "data", "chrome_profile"), help="Path to Chrome profile data directory")
    parser.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    
    args = parser.parse_args()
    run_uploader(args.draft, args.profile, args.headless)
