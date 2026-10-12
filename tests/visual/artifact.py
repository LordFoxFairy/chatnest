"""Existing official document panel UI, with explicit persisted-document fixtures."""
import json
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import expect, sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    chat_id, doc_id = str(uuid4()), str(uuid4())
    title = "文档侧栏测试"
    messages = [
        {"id": str(uuid4()), "role": "user", "parts": [{"type": "text", "text": "整理为文档"}]},
        {"id": str(uuid4()), "role": "assistant", "parts": [{"type": "tool-createDocument", "toolCallId": "document-fixture", "state": "output-available", "input": {"title": title, "kind": "text"}, "output": {"id": doc_id, "title": title, "kind": "text"}}]},
    ]
    page.route("**/api/messages?*", lambda route: route.fulfill(json={"messages": messages, "isReadonly": False, "visibility": "private", "userId": "fixture"}))
    page.route("**/api/vote?*", lambda route: route.fulfill(json=[]))
    page.route("**/api/document?*", lambda route: route.fulfill(json=[{"id": doc_id, "title": title, "content": "# 文档正文\n\n这是明确的 UI 测试文档。", "kind": "text", "createdAt": "2026-10-10T00:00:00Z", "userId": "fixture"}]))
    page.route("**/api/suggestions?*", lambda route: route.fulfill(json=[]))
    page.goto("http://127.0.0.1:3000/chat/" + chat_id, wait_until="networkidle", timeout=60000)
    page.get_by_role("button", name="收起侧栏", exact=True).click()
    page.get_by_test_id("document-preview").click()
    expect(page.get_by_test_id("artifact-close-button")).to_be_visible()
    expect(page.locator('[data-slot="artifact-content"]').get_by_text("这是明确的 UI 测试文档。", exact=True)).to_be_visible()
    page.wait_for_function("document.querySelector('[data-testid=artifact]').getBoundingClientRect().width >= innerWidth * 0.55")
    Path(".local-review").mkdir(exist_ok=True)
    page.screenshot(path=".local-review/document-panel.png", full_page=True)
    page.get_by_test_id("artifact-close-button").click()
    expect(page.get_by_test_id("artifact-close-button")).to_have_count(0)
    expect(page.get_by_test_id("multimodal-input")).to_be_visible()
    page.get_by_test_id("document-preview").focus()
    page.keyboard.press("Enter")
    expect(page.get_by_test_id("artifact-close-button")).to_be_visible()
    page.get_by_test_id("artifact-close-button").click()
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_test_id("document-preview").click()
    expect(page.get_by_test_id("artifact-close-button")).to_be_visible()
    page.wait_for_function("document.querySelector('[data-testid=artifact]').getBoundingClientRect().width >= innerWidth * 0.95")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=".local-review/document-panel-mobile.png", full_page=True)
    page.get_by_test_id("artifact-close-button").click()
    expect(page.get_by_test_id("multimodal-input")).to_be_visible()
    assert not errors, errors
    print(json.dumps({"fixtureOnly": True, "checks": ["收起会话侧栏后文档仍可打开和关闭", "文档正文展示"], "pageErrors": errors}, ensure_ascii=False))
    browser.close()
