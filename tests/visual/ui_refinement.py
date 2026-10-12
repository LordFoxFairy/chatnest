"""UI boundary checks with explicit history/tool fixtures; no model calls.

Breaks caught: narrow tool headers clip state; sources overwhelm chat; method
description repeats; task action scrolls offscreen; select/textarea styling and
keyboard flow diverge; Escape dismisses a workspace underneath a modal.
"""
import argparse
import json
import os
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--case", choices=["layout", "sources", "method", "dialog", "workspace", "availability", "all"], default="all")
args = parser.parse_args()
base = os.environ.get("LOCAL_TEST_BASE_URL", "http://127.0.0.1:3003")
output = Path(".local-review")
output.mkdir(exist_ok=True)
method = "一个名称比较长的内容调查方法与公开传播线索核验"
description = "对照原文与候选内容，标记来源和未完成的核验。"
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width":1440,"height":900}, reduced_motion="reduce")
    errors, submissions = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    def reject_submission(route):
        submissions.append(route.request.post_data_json)
        route.fulfill(status=503,json={"code":"offline:api","message":"UI fixture: no model calls permitted"})
    page.route("**/api/chat",reject_submission)
    chat_id = str(uuid4())
    sources = [{"title":"参考页面 "+str(i)+" · 真实标题需要保留可读性", "url":f"https://example.com/source-{i}"} for i in range(6)]
    messages = [{"id":str(uuid4()),"role":"user","parts":[{"type":"text","text":"以下是明确的界面回归夹具，不是真实调查。"}]}, {"id":str(uuid4()),"role":"assistant","parts":[
        {"type":"tool-loadSkill","toolCallId":"method","state":"output-available","input":{"name":"investigate-content"},"output":{"name":"investigate-content","displayName":method,"description":description,"instructions":"Fixture only"}},
        {"type":"dynamic-tool","toolName":"exa__web_search_exa","toolCallId":"search","state":"output-available","input":{"query":"独特章节表达 site:example.com"},"output":{"sources":sources}},
        {"type":"text","text":"这是用于检查布局和交互的明确测试数据。"}
    ]}]
    page.route("**/api/messages?*", lambda route:route.fulfill(json={"messages":messages,"visibility":"private","isReadonly":False}))
    page.route("**/api/vote?*",lambda route:route.fulfill(json=[]))
    page.route("**/api/history?*",lambda route:route.fulfill(json={"chats":[],"hasMore":False}))
    page.route("**/api/agent",lambda route:route.fulfill(json={"skills":[{"name":"investigate-content","displayName":method,"description":description,"shortDescription":description}],"servers":[{"id":"exa","name":"Exa 网页搜索","keyless":True,"status":"configured","tools":["web_search_exa","web_fetch_exa"],"missingEnvironment":[]}],"modelConfigured":True,"modelProvider":"openai","uploadsConfigured":False,"limits":{"maxSteps":12,"timeoutMs":240000}}))
    page.goto(base+"/chat/"+chat_id,wait_until="networkidle",timeout=60000)
    cards = page.get_by_test_id("tool-activity")
    expect(cards).to_have_count(2)
    if args.case in ["layout","all"]:
        page.set_viewport_size({"width":320,"height":700})
        for card in cards.all():
            header=card.get_by_role("button").first
            assert header.evaluate("e=>e.scrollWidth <= e.clientWidth + 1"),"tool header clips title or execution state"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"),"page overflow"
        page.screenshot(path=str(output/"refine-narrow-after.png"),full_page=True)
    page.set_viewport_size({"width":1440,"height":900})
    if args.case in ["sources","all"]:
        expect(cards.nth(1).get_by_role("link")).to_have_count(3)
        cards.nth(1).get_by_role("button",name="展开全部来源",exact=True).click()
        expect(cards.nth(1).get_by_role("link")).to_have_count(6)
        cards.nth(1).get_by_role("button",name="收起来源",exact=True).click()
        expect(cards.nth(1).get_by_role("link")).to_have_count(3)
    if args.case in ["method","all"]:
        cards.nth(0).get_by_role("button").first.click()
        expect(cards.nth(0).get_by_text(description,exact=True)).to_have_count(1)
        expect(cards.nth(0).get_by_text("技术详情",exact=True)).to_be_visible()
        cards.nth(0).get_by_role("button").first.click()
    if args.case in ["workspace","all"]:
        page.get_by_role("button",name="打开工作区",exact=True).click()
        workspace=page.get_by_test_id("workspace")
        expect(workspace).to_be_visible()
        page.get_by_role("button",name="创建任务",exact=True).click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).not_to_be_visible()
        expect(workspace).to_be_visible()
        workspace.get_by_role("tab",name="浏览器",exact=True).focus()
        page.keyboard.press("End")
        expect(workspace.get_by_role("tab",name="来源",exact=True)).to_be_focused()
        page.keyboard.press("Home")
        expect(workspace.get_by_role("tab",name="浏览器",exact=True)).to_be_focused()
        page.keyboard.press("Escape")
        expect(workspace).not_to_be_visible()
    if args.case in ["dialog","all"]:
        page.get_by_role("button",name="创建任务",exact=True).click()
        dialog=page.get_by_role("dialog")
        goal=dialog.get_by_role("textbox",name="任务目标",exact=True)
        expect(goal).to_be_focused()
        goal.fill("检查公开传播线索")
        method_select=dialog.get_by_role("combobox",name="调查方式",exact=True)
        method_select.focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("option",name=method,exact=True)).to_be_visible()
        page.keyboard.press("End")
        expect(page.get_by_role("option",name=method,exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        expect(dialog.get_by_text(description,exact=True)).to_be_visible()
        assert method_select.get_attribute("aria-describedby"),"method purpose is not associated with its control"
        page.set_viewport_size({"width":375,"height":560})
        assert goal.evaluate("e=>parseFloat(getComputedStyle(e).fontSize)>=16"),"mobile field can trigger unwanted keyboard zoom"
        goal.fill("目标\n"*50)
        dialog.get_by_role("textbox",name="参考材料").fill("材料\n"*100)
        action=dialog.get_by_role("button",name="开始任务",exact=True)
        rect=action.bounding_box()
        assert rect and rect["y"]>=0 and rect["y"]+rect["height"]<=560,"task action outside short mobile viewport"
        assert action.evaluate("e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}"),"task action hidden by scrolling body"
        assert dialog.evaluate("e=>e.scrollWidth<=e.clientWidth+1"),"dialog horizontal overflow"
        page.screenshot(path=str(output/"refine-task-short-after.png"),full_page=True)
        page.keyboard.press("Escape")
        page.set_viewport_size({"width":1440,"height":900})
    page.screenshot(path=str(output/"refine-chat-after.png"),full_page=True)
    if args.case in ["availability","all"]:
        model_data=page.evaluate("async()=>await (await fetch('/api/models')).json()")
        failed=[True]
        def models_response(route):
            if failed[0]:
                route.fulfill(status=503,json={"code":"offline:api","cause":"Explicit unavailable-model fixture"})
            else:
                route.fulfill(json=model_data)
        page.route("**/api/models",models_response)
        page.reload(wait_until="networkidle")
        page.get_by_role("button",name="创建任务",exact=True).click()
        dialog=page.get_by_role("dialog")
        dialog.get_by_role("textbox",name="任务目标",exact=True).fill("能力恢复之前不得开始")
        expect(dialog.get_by_role("button",name="开始任务",exact=True)).to_be_disabled()
        expect(dialog.get_by_role("alert").filter(has_text="暂时无法读取能力配置")).to_be_visible()
        failed[0]=False
        dialog.get_by_role("button",name="重试",exact=True).click()
        expect(dialog.get_by_role("button",name="开始任务",exact=True)).to_be_enabled()
        expect(dialog.get_by_role("alert").filter(has_text="暂时无法读取能力配置")).not_to_be_visible()
        page.keyboard.press("Escape")
    assert not errors,errors
    assert not submissions,"keyboard navigation submitted the task unexpectedly"
    print(f"UI refinement {args.case}: passed (explicit fixtures, no model calls)")
    browser.close()
