"""Chat-centric interaction tests. SSE fixtures replace only the unavailable external model."""
import argparse
import json
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--case", choices=["home", "regenerate", "menu", "search", "all"], default="all")
case = parser.parse_args().case
output = Path(".local-review")
output.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin="http://127.0.0.1:3000")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    checks = []
    if case in ["home", "all"]:
        page.goto("http://127.0.0.1:3000/", wait_until="networkidle", timeout=60000)
        composer = page.get_by_test_id("multimodal-input")
        expect(page.get_by_test_id("composer-menu")).to_be_visible()
        expect(page.get_by_test_id("model-selector")).to_have_count(1)
        expect(page.get_by_test_id("setup-notice")).to_have_count(0)
        expect(page.get_by_role("button", name="Skills", exact=True)).to_have_count(0)
        page.get_by_test_id("composer-menu").click()
        expect(page.get_by_role("menuitem", name="添加图片")).to_be_disabled()
        expect(page.get_by_role("menuitemcheckbox", name="联网搜索")).to_be_disabled()
        page.get_by_role("menuitem", name="设置", exact=True).click()
        dialog = page.get_by_role("dialog")
        expect(dialog.get_by_role("tab", name="常规", exact=True)).to_be_visible()
        dialog.get_by_role("button", name="深色", exact=True).click()
        expect(page.locator("html")).to_have_class("dark")
        page.keyboard.press("Escape")
        page.get_by_test_id("user-nav-button").click()
        page.get_by_role("menuitem", name="设置", exact=True).click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.get_by_role("tab", name="技能", exact=True).click()
        expect(page.get_by_text("investigate-content", exact=True)).to_be_visible()
        page.get_by_role("tab", name="常规", exact=True).click()
        page.get_by_role("dialog").get_by_role("button", name="浅色", exact=True).click()
        page.keyboard.press("Escape")
        composer.fill("写一段产品介绍")
        page.reload(wait_until="networkidle")
        expect(page.get_by_test_id("multimodal-input")).to_have_value("写一段产品介绍")
        page.get_by_test_id("multimodal-input").fill("")
        page.screenshot(path=str(output / "chat-home-light.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        expect(page.get_by_test_id("model-selector")).to_have_count(1)
        expect(page.get_by_test_id("model-selector")).to_be_visible()
        expect(page.get_by_test_id("composer-menu")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=str(output / "chat-home-mobile.png"), full_page=True)
        page.set_viewport_size({"width": 1440, "height": 960})
        checks.append("统一附件/工具入口、账号设置、单一模型选择、草稿与移动布局")
    if case in ["regenerate", "menu", "all"]:
        chat_id, user_id, answer_id = str(uuid4()), str(uuid4()), str(uuid4())
        messages = [
            {"id": user_id, "role": "user", "parts": [{"type": "text", "text": "解释这段示例代码"}]},
            {"id": answer_id, "role": "assistant", "parts": [
                {"type": "text", "text": "原来的完整回答。\n\n```python\nprint('hello')\n```\n\n| 项目 | 说明 |\n| --- | --- |\n| 输出 | hello |"},
                {"type": "source-url", "sourceId": "fixture", "url": "https://example.com/reference", "title": "示例参考"},
            ]},
        ]
        page.route("**/api/messages?*", lambda route: route.fulfill(json={"messages": messages, "isReadonly": False, "visibility": "private", "userId": "fixture"}))
        page.route("**/api/vote?*", lambda route: route.fulfill(json=[]))
        page.goto("http://127.0.0.1:3000/chat/" + chat_id, wait_until="networkidle", timeout=60000)
        if case in ["menu", "all"]:
            page.get_by_role("button", name="对话菜单", exact=True).click()
            page.get_by_role("menuitem", name="来源与导出", exact=False).click()
            expect(page.get_by_test_id("workspace").get_by_role("link", name="示例参考", exact=False)).to_have_attribute("href", "https://example.com/reference")
            page.keyboard.press("Escape")
            expect(page.get_by_role("table")).to_be_visible()
            expect(page.get_by_text("print('hello')", exact=True)).to_be_visible()
            checks.append("来源入口收进对话菜单、Markdown 代码与表格")
        if case in ["regenerate", "all"]:
            requests = []
            def reply(route):
                requests.append(route.request.post_data_json)
                chunks = [
                    {"type": "start", "messageId": str(uuid4())}, {"type": "start-step"},
                    {"type": "text-start", "id": "answer"},
                    {"type": "text-delta", "id": "answer", "delta": "重新生成的回答"},
                    {"type": "text-end", "id": "answer"}, {"type": "finish-step"},
                    {"type": "finish", "finishReason": "stop"},
                ]
                stream = "".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n"
                route.fulfill(status=200, content_type="text/event-stream", headers={"x-vercel-ai-ui-message-stream": "v1"}, body=stream)
            page.route("**/api/chat", reply)
            page.get_by_test_id("message-assistant").last.hover()
            page.get_by_role("button", name="重新生成", exact=True).click()
            expect(page.get_by_text("重新生成的回答", exact=True)).to_be_visible()
            expect(page.get_by_test_id("message-user")).to_have_count(1)
            assert len(requests) == 1 and requests[0]["trigger"] == "regenerate-message"
            assert requests[0]["message"]["id"] == user_id and requests[0]["message"]["parts"][0]["text"] == "解释这段示例代码"
            page.unroute("**/api/chat", reply)
            page.route("**/api/chat", lambda route: route.fulfill(status=503, json={"code": "offline:configuration", "message": "模型连接不可用"}))
            page.get_by_test_id("message-assistant").last.hover()
            page.get_by_role("button", name="重新生成", exact=True).click()
            expect(page.get_by_test_id("conversation-error")).to_be_visible()
            expect(page.get_by_text("重新生成的回答", exact=True)).to_be_visible()
            expect(page.get_by_test_id("message-user")).to_have_count(1)
            page.unroute("**/api/chat")
            # A server/network stream can close without throwing and without a finish chunk.
            incomplete = [{"type": "start", "messageId": str(uuid4())}, {"type": "text-start", "id": "partial"}, {"type": "text-delta", "id": "partial", "delta": "未完成的新回答"}]
            page.route("**/api/chat", lambda route: route.fulfill(status=200, content_type="text/event-stream", headers={"x-vercel-ai-ui-message-stream": "v1"}, body="".join("data: " + json.dumps(chunk) + "\n\n" for chunk in incomplete)))
            page.get_by_test_id("message-assistant").last.hover()
            page.get_by_role("button", name="重新生成", exact=True).click()
            expect(page.get_by_test_id("stop-button")).to_have_count(0)
            expect(page.get_by_text("重新生成的回答", exact=True)).to_be_visible()
            expect(page.get_by_text("未完成的新回答", exact=True)).to_have_count(0)
            checks.append("重新生成复用原问题、失败保留原回答")
    if case in ["search", "all"]:
        page.unroute("**/api/chat")
        page.route("**/api/agent", lambda route: route.fulfill(json={
            "skills": [{"name": "investigate-content", "description": "Test fixture skill"}],
            "servers": [{"id": "tavily", "name": "Tavily", "status": "configured", "tools": ["tavily_search"], "missingEnvironment": []}],
            "modelConfigured": True, "uploadsConfigured": False, "limits": {"maxSteps": 12, "timeoutMs": 240000},
        }))
        page.goto("http://127.0.0.1:3000/", wait_until="networkidle")
        page.get_by_test_id("composer-menu").click()
        web = page.get_by_role("menuitemcheckbox", name="联网搜索")
        expect(web).to_be_enabled()
        web.click()
        expect(page.get_by_test_id("search-mode-chip")).to_be_visible()
        received = []
        def capture_search(route):
            received.append(route.request.post_data_json)
            route.fulfill(status=503, json={"code": "offline:configuration", "message": "Explicit model fixture failure"})
        page.route("**/api/chat", capture_search)
        page.get_by_test_id("multimodal-input").fill("按公开资料核实这个问题")
        page.get_by_test_id("send-button").click()
        expect(page.get_by_test_id("conversation-error")).to_be_visible()
        assert received[0]["searchMode"] == "web"
        page.get_by_role("button", name="取消联网搜索", exact=True).click()
        expect(page.get_by_test_id("search-mode-chip")).to_have_count(0)
        checks.append("联网搜索选择可取消，偏好真实传给服务器")
    assert not errors, errors
    print(json.dumps({"fixtureOnlyForModel": True, "checks": checks, "pageErrors": errors}, ensure_ascii=False))
    browser.close()
