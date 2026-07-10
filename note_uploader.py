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

def run_uploader(draft_path, profile_path):
    title, body_text = parse_markdown(draft_path)
    logging.info(f"Loaded draft: {title} ({len(body_text)} chars)")
    
    # Ensure profile directory exists
    os.makedirs(profile_path, exist_ok=True)
    
    with sync_playwright() as p:
        logging.info(f"Launching browser with profile: {profile_path}")
        # Launch persistent context to reuse cookies/login session
        context = p.chromium.launch_persistent_context(
            user_data_dir=profile_path,
            headless=False,
            viewport={"width": 1280, "height": 800}
        )
        
        page = context.new_page()
        
        # Navigate to note's new entry editor
        logging.info("Navigating to note editor page...")
        page.goto("https://editor.note.com/new")
        
        # Check if we are redirected to login page
        time.sleep(3)
        if "login" in page.url:
            logging.warning("Not logged in. Please log in manually in the browser window.")
            logging.info("Once you have successfully logged in and see the editor page, press ENTER here to continue...")
            input("Press ENTER after successful login...")
            # After manual login, reload to make sure we are in editor
            page.goto("https://editor.note.com/new")
            time.sleep(3)
            
        # Verify if we are on editor page
        if "new" not in page.url and "edit" not in page.url:
            logging.error(f"Failed to load editor page. Current URL: {page.url}")
            context.close()
            sys.exit(1)
            
        logging.info("Editor loaded. Filling title...")
        # Note editor uses specific layout. Title uses textarea or placeholder.
        title_textarea = page.locator('textarea[placeholder="記事タイトル"]')
        title_textarea.wait_for(state="visible", timeout=10000)
        title_textarea.click()
        title_textarea.fill(title)
        
        logging.info("Filling body text...")
        # Note body editor is contenteditable ProseMirror editor
        body_editor = page.locator('.note-editor__body, div[contenteditable="true"]')
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
        context.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Auto-upload markdown draft to note.com")
    parser.add_argument("--draft", required=True, help="Path to the markdown draft file")
    parser.add_argument("--profile", default=os.path.join(os.path.dirname(__file__), "data", "chrome_profile"), help="Path to Chrome profile data directory")
    
    args = parser.parse_args()
    run_uploader(args.draft, args.profile)
