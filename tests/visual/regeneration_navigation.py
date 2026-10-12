"""Client navigation/cache/cancellation with explicit external-model and history fixtures."""
import json
from uuid import uuid4
from playwright.sync_api import expect, sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    ids = {name: str(uuid4()) for name in ["A", "B"]}
    stored = {name: [
        {"id": str(uuid4()), "role": "user", "parts": [{"type": "text", "text": "问题 " + name}]},
        {"id": str(uuid4()), "role": "assistant", "parts": [{"type": "text", "text": "原回答 " + name}]},
    ] for name in ids}
    page.route("**/api/history?*", lambda route: route.fulfill(json={"chats": [{"id": id, "title": "导航夹具 " + name, "createdAt": "2026-10-10T00:00:00Z", "userId": "fixture", "visibility": "private"} for name, id in ids.items()], "hasMore": False}))
    def messages_response(route):
        name = next(name for name, id in ids.items() if id in route.request.url)
        route.fulfill(json={"messages": stored[name], "isReadonly": False, "visibility": "private", "userId": "fixture"})
    page.route("**/api/messages?*", messages_response)
    page.route("**/api/vote?*", lambda route: route.fulfill(json=[]))
    def response(route):
        stored["A"][-1]["parts"] = [{"type": "text", "text": "新回答 A"}]
        chunks = [{"type": "start", "messageId": stored["A"][-1]["id"]}, {"type": "text-start", "id": "new"}, {"type": "text-delta", "id": "new", "delta": "新回答 A"}, {"type": "text-end", "id": "new"}, {"type": "finish", "finishReason": "stop"}]
        route.fulfill(status=200, content_type="text/event-stream", headers={"x-vercel-ai-ui-message-stream": "v1"}, body="".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n")
    page.route("**/api/chat", response)
    page.goto("http://127.0.0.1:3000/chat/" + ids["A"], wait_until="networkidle", timeout=60000)
    page.get_by_test_id("message-assistant").last.hover()
    page.get_by_role("button", name="重新生成", exact=True).click()
    expect(page.get_by_text("新回答 A", exact=True)).to_be_visible()
    page.get_by_role("link", name="导航夹具 B", exact=True).click()
    expect(page.get_by_text("原回答 B", exact=True)).to_be_visible()
    page.get_by_role("link", name="导航夹具 A", exact=True).click()
    expect(page.get_by_text("新回答 A", exact=True)).to_be_visible()
    # Controlled late delivery tests old-instance callbacks and actual SDK AbortSignal wiring.
    page.evaluate("""() => {
      const original = window.fetch;
      window.lateStreams = [];
      window.fetch = (input, options) => {
        if (!String(input).endsWith('/api/chat')) return original(input, options);
        const index = window.lateStreams.length;
        const encoder = new TextEncoder();
        let controller;
        const stream = new ReadableStream({start(c) {
          controller = c;
          for (const chunk of [{type:'start', messageId:crypto.randomUUID()}, {type:'text-start', id:'late'}, {type:'text-delta', id:'late', delta:'流式夹具 '+index}])
            c.enqueue(encoder.encode('data: '+JSON.stringify(chunk)+'\\n\\n'));
        }});
        const entry = {aborted: false, finish() {
          for(const chunk of [{type:'text-end',id:'late'}, {type:'finish',finishReason:'stop'}]) controller.enqueue(encoder.encode('data: '+JSON.stringify(chunk)+'\\n\\n'));
          controller.close();
        }, fail() {controller.error(new Error('Explicit late-stream fixture failure'));}};
        options.signal.addEventListener('abort', () => {entry.aborted = true;});
        window.lateStreams.push(entry);
        return Promise.resolve(new Response(stream, {headers:{'content-type':'text/event-stream', 'x-vercel-ai-ui-message-stream':'v1'}}));
      };
    }""")
    page.get_by_test_id("message-assistant").last.hover()
    page.get_by_role("button", name="重新生成", exact=True).click()
    expect(page.get_by_text("流式夹具 0", exact=True)).to_be_visible()
    page.get_by_role("link", name="导航夹具 B", exact=True).click()
    expect(page.get_by_text("原回答 B", exact=True)).to_be_visible()
    assert page.evaluate("window.lateStreams[0].aborted"), "navigation failed to stop the previous chat instance"
    page.get_by_test_id("message-assistant").last.hover()
    page.get_by_role("button", name="重新生成", exact=True).click()
    expect(page.get_by_text("流式夹具 1", exact=True)).to_be_visible()
    page.evaluate("window.lateStreams[0].finish()")
    # Same browser event loop: the old finish is consumed before the new failure.
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    expect(page.get_by_text("流式夹具 1", exact=True)).to_be_visible()
    expect(page.get_by_text("原回答 B", exact=True)).to_have_count(0)
    page.evaluate("window.lateStreams[1].fail()")
    expect(page.get_by_text("原回答 B", exact=True)).to_be_visible()
    expect(page.get_by_test_id("conversation-error")).to_be_visible()
    # Returning to the SAME question must also isolate the old Chat instance.
    page.get_by_role("link", name="导航夹具 A", exact=True).click()
    expect(page.get_by_text("新回答 A", exact=True)).to_be_visible()
    page.get_by_test_id("message-assistant").last.hover()
    page.get_by_role("button", name="重新生成", exact=True).click()
    expect(page.get_by_text("流式夹具 2", exact=True)).to_be_visible()
    page.get_by_role("link", name="导航夹具 B", exact=True).click()
    expect(page.get_by_text("原回答 B", exact=True)).to_be_visible()
    page.get_by_role("link", name="导航夹具 A", exact=True).click()
    expect(page.get_by_text("新回答 A", exact=True)).to_be_visible()
    page.get_by_test_id("message-assistant").last.hover()
    page.get_by_role("button", name="重新生成", exact=True).click()
    expect(page.get_by_text("流式夹具 3", exact=True)).to_be_visible()
    page.evaluate("window.lateStreams[2].finish()")
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    expect(page.get_by_text("流式夹具 3", exact=True)).to_be_visible()
    page.evaluate("window.lateStreams[3].fail()")
    expect(page.get_by_text("新回答 A", exact=True)).to_be_visible()
    assert not errors, errors
    print(json.dumps({"fixtureOnly": True, "checks": ["成功重新生成后切换对话不退回旧缓存", "切换中止旧会话", "旧回调不干扰当前回答恢复"], "pageErrors": errors}, ensure_ascii=False))
    browser.close()
