"""Actual shared Chromium browser and APIs: no SSE/model/browser mocks."""
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors = []
    browser_responses = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda response: browser_responses.append(response.url) if "/api/browser?chatId=" in response.url and "frame=" not in response.url else None)
    page.goto("http://127.0.0.1:3000/", wait_until="networkidle")
    page.get_by_role("button", name="打开工作区", exact=True).click()
    expect(page.get_by_role("button", name="启动浏览器", exact=True)).to_be_enabled()
    endpoint = browser_responses[-1]
    workspace = page.get_by_test_id("workspace")
    workspace.get_by_role("button", name="启动浏览器", exact=True).click()
    expect(workspace.get_by_text("你正在控制", exact=True)).to_be_visible(timeout=60000)
    expect(workspace.get_by_role("img", name="当前浏览器页面", exact=True)).to_be_visible(timeout=30000)
    workspace.get_by_role("textbox", name="浏览器网址", exact=True).fill("https://example.com")
    workspace.get_by_role("button", name="打开网址", exact=True).click()
    expect(workspace.get_by_text("Example Domain", exact=True)).to_be_visible(timeout=30000)
    expect(workspace.get_by_role("textbox", name="浏览器网址", exact=True)).to_have_value("https://example.com/")
    frame = page.request.get(endpoint + "&frame=1")
    assert frame.status == 200 and frame.body().startswith(bytes.fromhex("89504e470d0a1a0a"))
    workspace.get_by_role("button", name="暂停浏览器", exact=True).click()
    expect(workspace.get_by_text("已暂停", exact=True)).to_be_visible()
    assert page.request.post(endpoint, headers={"Origin": "http://127.0.0.1:3000"}, data={"action": "navigate", "url": "https://example.org"}).status == 409
    workspace.get_by_role("button", name="接管", exact=True).click()
    expect(workspace.get_by_text("你正在控制", exact=True)).to_be_visible()
    assert page.request.post(endpoint, headers={"Origin": "https://evil.example"}, data={"action": "mode", "mode": "agent"}).status == 403
    assert page.request.post(endpoint, headers={"Origin": "http://127.0.0.1:3000"}, data={"action": "navigate", "url": "http://127.0.0.1:3000"}).status == 409
    with page.expect_response(lambda response: "/api/browser?" in response.url and response.request.method == "POST") as clicked:
        workspace.get_by_role("button", name="浏览器画面，接管后可点击和输入", exact=True).click(position={"x": 10, "y": 10})
    assert clicked.value.status == 200
    key_requests = []
    page.on("request", lambda request: key_requests.append(request.post_data_json["key"]) if request.method == "POST" and "/api/browser?" in request.url and request.post_data_json.get("action") == "key" else None)
    page.keyboard.type("abc")
    page.wait_for_function("document.querySelector('[aria-label=浏览器网址]').disabled === false")
    assert key_requests == ["a", "b", "c"], "fast human keyboard input was dropped"
    workspace.get_by_role("tab", name="来源", exact=True).click()
    workspace.get_by_role("tab", name="浏览器", exact=True).click()
    expect(workspace.get_by_text("Example Domain", exact=True)).to_be_visible()
    workspace.get_by_role("button", name="交回 Agent", exact=True).click()
    expect(workspace.get_by_text("Agent 可控制", exact=True)).to_be_visible()
    Path(".local-review").mkdir(exist_ok=True)
    page.screenshot(path=".local-review/browser-workspace.png", full_page=True)
    isolated = browser.new_context()
    stranger = isolated.new_page()
    stranger.goto("http://127.0.0.1:3000/", wait_until="networkidle")
    assert stranger.request.get(endpoint).json()["session"] is None
    isolated.close()
    workspace.get_by_role("button", name="结束浏览器会话", exact=True).click()
    expect(workspace.get_by_role("button", name="启动浏览器", exact=True)).to_be_visible()
    assert page.request.get(endpoint + "&frame=1").status == 204
    assert not errors, errors
    browser.close()
print("real browser: navigation/frame/pause/takeover/hand-back/isolation/CSRF passed")
