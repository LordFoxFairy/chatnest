"""Opt-in REAL model + Skills + public Exa MCP test. No model/tool fixtures.

Run only when explicitly authorized: LIVE_AGENT_TEST=1 python3 tests/visual/live_task.py
Uses the running server's private configuration. Does not read or print keys.
"""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

assert os.environ.get("LIVE_AGENT_TEST") == "1", "This test calls the real configured model; explicitly opt in."
base = "http://127.0.0.1:3000"
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width":1440,"height":960})
    errors = []
    page.on("pageerror",lambda error: errors.append(str(error)))
    chat_id = None
    try:
        page.goto(base,wait_until="networkidle")
        model = page.request.get(base+"/api/models").json()["selectableModelIds"][0]
        assert model == "gpt-5.6-luna", "live test expects the user's selected model"
        page.get_by_role("button",name="创建任务",exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("textbox",name="任务目标",exact=True).fill("做一次简短的真实联网能力核验：使用所选调查方法，搜索 OpenAI 官方版权投诉说明，读取一个官方网页正文，再给出一条真实来源链接和该表单适用范围。无需比对侵权，注明没有进行原文对比。不要创建文档，不要提交投诉，不要操作浏览器，只用搜索和正文读取工具。结果不超过200字。")
        dialog.get_by_role("combobox",name="调查方式",exact=True).select_option(label="内容调查与核验")
        with page.expect_response(lambda response: response.url.endswith("/api/chat") and response.request.method=="POST",timeout=60000) as response_info:
            dialog.get_by_role("button",name="开始任务",exact=True).click()
        assert response_info.value.ok, f"chat HTTP status {response_info.value.status}"
        page.wait_for_url("**/chat/*")
        chat_id = page.url.rsplit("/",1)[-1]
        expect(page.get_by_test_id("message-assistant").last).to_be_visible(timeout=120000)
        expect(page.get_by_test_id("stop-button")).to_have_count(0,timeout=240000)
        deadline = time.monotonic()+15
        while True:
            response = page.request.get(base+"/api/messages?chatId="+chat_id)
            assert response.ok
            messages = response.json()["messages"]
            if any(item["role"]=="assistant" for item in messages): break
            assert time.monotonic()<deadline,"assistant reply was not saved"
            page.wait_for_timeout(250)
        parts = [part for item in messages if item["role"]=="assistant" for part in item["parts"]]
        tools = {part.get("toolName",part["type"].removeprefix("tool-")):part for part in parts if part["type"]=="dynamic-tool" or part["type"].startswith("tool-")}
        print(json.dumps({"actualToolStates":[{"name":name,"state":part["state"],"error":part.get("errorText")} for name,part in tools.items()],"actualAnswer":"\n".join(part["text"] for part in parts if part["type"]=="text")},ensure_ascii=False),flush=True)
        for name in ["loadSkill","exa__web_search_exa","exa__web_fetch_exa"]:
            assert name in tools, f"actual run did not use {name}; tools: {list(tools)}"
            assert tools[name]["state"]=="output-available",f"{name} did not complete"
        assert tools["loadSkill"]["output"]["displayName"]=="内容调查与核验"
        sources = tools["exa__web_fetch_exa"]["output"].get("sources",[])
        assert any(source["url"].startswith("https://openai.com/") for source in sources),"no returned official page source"
        text = "\n".join(part["text"] for part in parts if part["type"]=="text")
        assert "https://openai.com/" in text,"answer has no actual official link"
        expect(page.get_by_test_id("tool-activity").filter(has_text="方法已就绪")).to_be_visible()
        page.reload(wait_until="networkidle")
        expect(page.get_by_test_id("message-assistant").last.locator('a[href^="https://openai.com/"]').first).to_be_visible(timeout=30000)
        reloaded = page.request.get(base+"/api/messages?chatId="+chat_id).json()["messages"]
        assert reloaded == messages,"saved task changed on reload"
        expect(page.get_by_test_id("tool-activity").filter(has_text="方法已就绪")).to_be_visible()
        page.get_by_role("button",name="对话菜单",exact=True).click()
        page.get_by_role("menuitem",name="来源与导出",exact=False).click()
        workspace = page.get_by_test_id("workspace")
        expect(workspace.locator('a[href^="https://openai.com/"]').first).to_be_visible()
        assert not errors,errors
        Path(".local-review").mkdir(exist_ok=True)
        page.screenshot(path=".local-review/live-task.png",full_page=True)
        print(json.dumps({"realModelAndMcp":True,"model":model,"tools":[{"name":name,"state":part["state"]} for name,part in tools.items()],"fetchedSources":sources,"answer":text,"savedAndReloaded":True,"sourceWorkspace":True,"pageErrors":errors},ensure_ascii=False))
    finally:
        if chat_id:
            page.request.post(base+"/api/browser?chatId="+chat_id,data={"action":"close"},headers={"Origin":base})
            assert page.request.delete(base+"/api/chat?id="+chat_id).ok,"cleanup of this test's chat failed"
        browser.close()
