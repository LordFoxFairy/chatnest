"""Real task entry/navigation with explicit model-stream fixtures; no paid model calls."""
import json
import os
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import expect, sync_playwright

base = os.environ.get("LOCAL_TEST_BASE_URL", "http://127.0.0.1:3000")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width":1440,"height":960})
    errors, requests, saved = [], [], {}
    page.on("pageerror", lambda error: errors.append(str(error)))
    skill = {"name":"investigate-content","displayName":"内容调查与核验","shortDescription":"查找传播线索，对照原文，说明来源与不确定性。","description":"调查与核验"}
    page.route("**/api/agent", lambda route: route.fulfill(json={"skills":[skill],"servers":[{"id":"exa","name":"Exa 网页搜索","status":"configured","tools":["web_search_exa","web_fetch_exa"],"missingEnvironment":[],"keyless":True}],"modelConfigured":True,"modelProvider":"openai","uploadsConfigured":False,"limits":{"maxSteps":12,"timeoutMs":240000}}))
    page.route("**/api/history?*", lambda route: route.fulfill(json={"chats":[],"hasMore":False}))
    def respond(route):
        requests.append(route.request.post_data_json)
        body = requests[-1]
        saved[body["id"]] = [body["message"], {"id":str(uuid4()),"role":"assistant","parts":[{"type":"text","text":"任务界面测试回应。"}]}]
        chunks = [{"type":"start","messageId":str(uuid4())},{"type":"start-step"},{"type":"tool-input-available","toolName":"loadSkill","toolCallId":"method","input":{"name":"investigate-content"}},{"type":"tool-output-available","toolCallId":"method","output":{"name":"investigate-content","displayName":"内容调查与核验","description":skill["shortDescription"],"instructions":"Explicit fixture instructions"}},{"type":"text-start","id":"answer"},{"type":"text-delta","id":"answer","delta":"任务界面测试回应。"},{"type":"text-end","id":"answer"},{"type":"finish-step"},{"type":"finish","finishReason":"stop"}]
        route.fulfill(status=200,content_type="text/event-stream",headers={"x-vercel-ai-ui-message-stream":"v1"},body="".join("data: "+json.dumps(chunk)+"\n\n" for chunk in chunks)+"data: [DONE]\n\n")
    page.route("**/api/chat",respond)
    page.route("**/api/messages?*",lambda route: route.fulfill(json={"messages":saved.get(route.request.url.split("chatId=")[-1],[]),"isReadonly":False,"visibility":"private"}))
    page.route("**/api/vote?*",lambda route:route.fulfill(json=[]))
    page.goto(base+"/",wait_until="networkidle")
    page.get_by_role("button",name="创建任务",exact=True).click()
    dialog=page.get_by_role("dialog")
    expect(dialog.get_by_role("button",name="开始任务",exact=True)).to_be_disabled()
    dialog.get_by_role("textbox",name="任务目标",exact=True).fill("查找示例讲义的传播线索")
    dialog.get_by_role("textbox",name="参考材料").fill("https://example.com/original\n独特表达")
    dialog.get_by_role("combobox",name="调查方式",exact=True).click()
    page.get_by_role("option",name="内容调查与核验",exact=True).click()
    expect(dialog.get_by_text(skill["shortDescription"],exact=True)).to_be_visible()
    Path(".local-review").mkdir(exist_ok=True)
    page.screenshot(path=".local-review/task-dialog.png",full_page=True)
    dialog.get_by_role("button",name="开始任务",exact=True).click()
    expect(page.get_by_text("任务界面测试回应。",exact=True)).to_be_visible(timeout=30000)
    assert len(requests)==1,requests
    first_id=requests[0]["id"]
    expect(page).to_have_url(base+"/chat/"+first_id)
    assert requests[0]["searchMode"]=="web"
    text=requests[0]["message"]["parts"][0]["text"]
    assert "查找示例讲义的传播线索" in text and "https://example.com/original" in text and "内容调查与核验" in text
    expect(page.get_by_test_id("tool-activity")).to_contain_text("内容调查与核验")
    expect(page.get_by_test_id("tool-activity")).to_contain_text("方法已就绪")
    page.get_by_role("button",name="创建任务",exact=True).click()
    dialog.get_by_role("textbox",name="任务目标",exact=True).fill("另一个独立任务")
    dialog.get_by_role("button",name="开始任务",exact=True).click()
    expect(page.get_by_test_id("message-user")).to_contain_text("另一个独立任务")
    page.wait_for_function("document.querySelector('[data-testid=stop-button]') === null")
    assert len(requests)==2 and requests[1]["id"]!=first_id
    assert len(page.get_by_test_id("message-user").all())==1,"task appended to the previous conversation"
    expect(page).to_have_url(base+"/chat/"+requests[1]["id"])
    page.reload(wait_until="networkidle")
    expect(page.get_by_test_id("message-user")).to_contain_text("另一个独立任务")
    assert len(requests)==2,"reload must not rerun the task"
    # Interrupt an old stream when starting an independent task.
    page.get_by_role("button",name="Research 首页",exact=True).click()
    expect(page.get_by_test_id("greeting")).to_be_visible()
    expect(page.get_by_test_id("multimodal-input")).to_have_value("")
    page.evaluate("""() => {
      const originalFetch = window.fetch;
      let first = true;
      window.taskInterrupted = false;
      window.fetch = (input, options) => {
        if (!String(input).endsWith('/api/chat') || !first) return originalFetch(input, options);
        first = false;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({start(controller) {
          for (const chunk of [{type:'start',messageId:crypto.randomUUID()},{type:'start-step'},{type:'text-start',id:'pending'},{type:'text-delta',id:'pending',delta:'旧任务仍在执行'}]) controller.enqueue(encoder.encode('data: '+JSON.stringify(chunk)+'\\n\\n'));
          options.signal.addEventListener('abort',()=>{window.taskInterrupted=true;controller.close();});
        }});
        return Promise.resolve(new Response(stream,{headers:{'content-type':'text/event-stream','x-vercel-ai-ui-message-stream':'v1'}}));
      };
    }""")
    page.get_by_test_id("multimodal-input").fill("等待中断的旧任务")
    page.get_by_test_id("send-button").click()
    expect(page.get_by_text("旧任务仍在执行",exact=True)).to_be_visible()
    page.get_by_role("button",name="创建任务",exact=True).click()
    expect(dialog.get_by_text("开始新任务会停止当前回复，已有内容仍保留在原对话。",exact=True)).to_be_visible()
    dialog.get_by_role("textbox",name="任务目标",exact=True).fill("中断后开始的独立任务")
    dialog.get_by_role("button",name="开始任务",exact=True).click()
    expect(page.get_by_text("任务界面测试回应。",exact=True)).to_be_visible(timeout=30000)
    assert page.evaluate("window.taskInterrupted"),"new task did not stop the previous stream"
    assert len(requests)==3 and len({body["id"] for body in requests})==3
    expect(page.get_by_test_id("message-user")).to_contain_text("中断后开始的独立任务")
    expect(page.get_by_text("旧任务仍在执行",exact=True)).to_have_count(0)
    page.set_viewport_size({"width":390,"height":844})
    page.get_by_test_id("composer-menu").click()
    page.get_by_role("menuitem",name="创建任务",exact=True).click()
    expect(dialog.get_by_role("textbox",name="任务目标",exact=True)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=".local-review/task-dialog-mobile.png",full_page=True)
    page.keyboard.press("Escape")
    expect(dialog).not_to_be_visible()
    assert not errors,errors
    print("task UX: required goal, method metadata, search preference, isolated URLs/reload, interruption of old stream, readable skill status and mobile entry passed (explicit stream fixtures)")
    browser.close()
