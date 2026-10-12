"""Explicit UI fixtures, not real searches: exercise MCP output and approval rendering."""
import json
import os
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import expect, sync_playwright

base = os.environ.get("LOCAL_TEST_BASE_URL", "http://127.0.0.1:3000")

output = Path(".local-review")
output.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
    errors = []
    requests = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    assistant_id = str(uuid4())
    chat_id = str(uuid4())
    messages = [
        {"id": str(uuid4()), "role": "user", "parts": [{"type": "text", "text": "界面测试夹具：核实来源，并确认两个后续操作。"}]},
        {"id": assistant_id, "role": "assistant", "parts": [
            {"type": "text", "text": "以下为组件测试数据，不是真实联网调查结果。"},
            {"type": "dynamic-tool", "toolName": "tavily__tavily_search", "toolCallId": "search", "state": "output-available", "input": {"query": "test fixture"}, "output": {"content": [{"type": "text", "text": json.dumps({"results": [{"url": "https://example.com/evidence", "title": "测试来源 · 示例页面"}, {"url": "javascript:alert(1)"}]})}]}},
            {"type": "dynamic-tool", "toolName": "test__write_a", "toolCallId": "write-a", "state": "approval-requested", "input": {"value": "fixture"}, "approval": {"id": "approve-a"}},
            {"type": "dynamic-tool", "toolName": "test__write_b", "toolCallId": "write-b", "state": "approval-requested", "input": {"value": "fixture"}, "approval": {"id": "approve-b"}},
        ]},
    ]
    page.route("**/api/messages?*", lambda route: route.fulfill(json={"messages": messages, "isReadonly": False, "visibility": "private", "userId": "fixture"}))
    page.route("**/api/vote?*", lambda route: route.fulfill(json=[]))
    def chat_response(route):
        body = route.request.post_data_json
        requests.append(body)
        # A real SDK SSE envelope for the explicit test reply; no remote model is called.
        chunks = [
            {"type": "start", "messageId": str(uuid4())},
            {"type": "start-step"},
            {"type": "text-start", "id": "text"},
            {"type": "text-delta", "id": "text", "delta": "界面测试回应：已记录确认选择。"},
            {"type": "text-end", "id": "text"},
            {"type": "finish-step"},
            {"type": "finish", "finishReason": "stop"},
        ]
        sse = "".join("data: " + json.dumps(c, ensure_ascii=False) + "\n\n" for c in chunks) + "data: [DONE]\n\n"
        route.fulfill(status=200, content_type="text/event-stream", headers={"x-vercel-ai-ui-message-stream": "v1"}, body=sse)
    page.route("**/api/chat", chat_response)
    page.goto(base+"/chat/" + chat_id, wait_until="networkidle", timeout=60000)
    cards = page.get_by_test_id("tool-activity")
    expect(cards).to_have_count(3)
    source = page.get_by_role("link", name="测试来源 · 示例页面")
    expect(source).to_have_attribute("href", "https://example.com/evidence")
    assert page.locator('a[href^="javascript:"]').count() == 0
    cards.nth(0).get_by_role("button").first.click()
    cards.nth(0).get_by_text("技术详情", exact=True).click()
    expect(cards.nth(0).get_by_text("调用参数", exact=True)).to_be_visible()
    page.screenshot(path=str(output / "tool-fixture.png"), full_page=True)
    page.get_by_role("button", name="对话菜单", exact=True).click()
    page.get_by_role("menuitem", name="来源与导出", exact=False).click()
    workspace = page.get_by_test_id("workspace")
    expect(workspace.get_by_text("联网工具返回 · 核验状态未标记", exact=True)).to_be_visible()
    workspace.get_by_role("textbox", name="筛选来源").fill("no-result")
    expect(workspace.get_by_text("没有匹配的来源", exact=True)).to_be_visible()
    workspace.get_by_role("textbox", name="筛选来源").fill("example.com")
    expect(workspace.get_by_role("link", name="测试来源 · 示例页面")).to_have_attribute("href", "https://example.com/evidence")
    with page.expect_download() as download_info:
        workspace.get_by_role("button", name="导出对话与来源", exact=True).click()
    downloaded = Path(download_info.value.path()).read_text()
    assert "https://example.com/evidence" in downloaded and "不是法律认定" in downloaded
    assert "以下为组件测试数据" in downloaded and "javascript:" not in downloaded
    workspace.get_by_role("button", name="复制清单", exact=True).click()
    assert "https://example.com/evidence" in page.evaluate("navigator.clipboard.readText()")
    page.screenshot(path=str(output / "source-workspace-fixture.png"), full_page=True)
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="对话菜单", exact=True).click()
    page.get_by_role("menuitem", name="来源与导出", exact=False).click()
    expect(page.get_by_test_id("workspace").get_by_role("button", name="导出对话与来源", exact=True)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "mobile source workspace overflow"
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 1440, "height": 960})
    cards.nth(1).get_by_role("button", name="拒绝", exact=True).click()
    expect(cards.nth(1).get_by_text("已回应", exact=True)).to_be_visible()
    assert len(requests) == 0, "continued before all approvals were answered"
    cards.nth(2).get_by_role("button", name="允许执行", exact=True).click()
    expect(page.get_by_text("界面测试回应：已记录确认选择。", exact=True)).to_be_visible()
    assert len(requests) == 1
    parts = requests[0]["messages"][-1]["parts"]
    approvals = {part["approval"]["id"]: part["approval"]["approved"] for part in parts if "approval" in part}
    assert approvals == {"approve-a": False, "approve-b": True}, approvals
    # A later user message must be a new user turn, not a repeated approval payload.
    page.get_by_test_id("multimodal-input").fill("确认之后的新问题")
    page.get_by_test_id("send-button").click()
    expect(page.get_by_test_id("message-user").last).to_contain_text("确认之后的新问题")
    page.wait_for_function("document.querySelector('[data-testid=stop-button]') === null")
    assert len(requests) == 2
    assert requests[1]["message"]["role"] == "user" and "messages" not in requests[1]
    # A deliberately unfinished SSE fixture verifies true streaming status and AbortSignal wiring.
    page.get_by_role("button", name="Research 首页", exact=True).click()
    expect(page.get_by_test_id("greeting")).to_be_visible()
    page.evaluate("""() => {
      const originalFetch = window.fetch;
      window.fixtureAborted = false;
      window.fetch = (input, options) => {
        if (!String(input).endsWith('/api/chat')) return originalFetch(input, options);
        const encoder = new TextEncoder();
        const stream = new ReadableStream({ start(controller) {
          const chunks = [
            {type:'start', messageId:crypto.randomUUID()},
            {type:'start-step'},
            {type:'tool-input-available', toolCallId:'pending', toolName:'test__search', dynamic:true, input:{query:'streaming fixture'}}
          ];
          for (const chunk of chunks) controller.enqueue(encoder.encode('data: '+JSON.stringify(chunk)+'\\n\\n'));
          options.signal.addEventListener('abort', () => { window.fixtureAborted = true; controller.close(); });
        }});
        return Promise.resolve(new Response(stream, {headers:{'content-type':'text/event-stream','x-vercel-ai-ui-message-stream':'v1'}}));
      };
    }""")
    page.get_by_test_id("multimodal-input").fill("正在执行中的取消测试夹具")
    page.get_by_test_id("send-button").click()
    expect(page.get_by_test_id("tool-activity")).to_contain_text("执行中")
    page.get_by_test_id("stop-button").click()
    expect(page.get_by_test_id("stop-button")).not_to_be_visible()
    expect(page.get_by_test_id("tool-activity")).to_contain_text("未完成")
    assert page.evaluate("window.fixtureAborted"), "stop did not abort the request"
    assert not errors, errors
    print(json.dumps({"fixtureOnly": True, "checks": ["工具返回折叠展示", "安全来源链接", "来源工作区筛选与实际下载", "多确认不提前续跑", "拒绝与批准正确回传", "确认后的新消息不被误当续跑", "流式工具过程可见、停止确实取消请求"], "pageErrors": errors}, ensure_ascii=False))
    browser.close()
