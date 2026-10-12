"""Real local auth/database/UI integration; only explicitly created fixture rows are removed."""
import json
import re
import subprocess
from urllib.parse import quote
from uuid import uuid4
from playwright.sync_api import expect, sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 960})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:3000", wait_until="networkidle", timeout=60000)
    session = context.request.get("http://127.0.0.1:3000/api/auth/session").json()
    ids = [str(uuid4()) for _ in range(31)]
    prefix = "UI-TEST-" + uuid4().hex[:8]
    fixture = {"ownerId": session["user"]["id"], "foreignId": str(uuid4()), "ids": ids, "prefix": prefix}
    def fixture_command(mode):
        result = subprocess.run(["node", "tests/visual/history-fixture.mjs"], input=json.dumps({**fixture, "mode": mode}),
                                text=True, capture_output=True, check=False)
        assert result.returncode == 0, "Local fixture setup/cleanup failed; inspect the helper without exposing environment values."
    fixture_command("seed")
    try:
        page.reload(wait_until="networkidle")
        base = "http://127.0.0.1:3000/api/history?"
        first = context.request.get(base + "limit=20").json()
        assert ids[29] not in [chat["id"] for chat in first["chats"]], "older fixture unexpectedly in first page"
        matching = context.request.get(base + "search=" + quote(prefix + " oldneedle特殊%_")).json()
        assert [chat["id"] for chat in matching["chats"]] == [ids[29]], "search leaked foreign rows or missed older history"
        assert context.request.get(base + "limit=NaN").status == 400
        assert context.request.get(base + "ending_before=invalid").status == 400
        assert context.request.get(base + "search=" + quote("%_")).json()["chats"][0]["id"] == ids[29]
        page.keyboard.press("Control+k")
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("textbox", name="搜索历史标题").fill(prefix + " oldneedle")
        result = dialog.get_by_role("link", name=re.compile("oldneedle"))
        expect(result).to_have_count(1)
        result.click()
        expect(page.get_by_text("真实数据库测试正文29", exact=True)).to_be_visible()
        page.get_by_test_id("multimodal-input").fill("属于旧对话的草稿")
        page.goto("http://127.0.0.1:3000/chat/" + ids[0], wait_until="networkidle")
        expect(page.get_by_text("真实数据库测试正文0", exact=True)).to_be_visible()
        expect(page.get_by_test_id("multimodal-input")).to_have_value("")
        page.get_by_test_id("multimodal-input").fill("属于新对话的草稿")
        # Client-side navigation, not only a reload: existing messages must rehydrate.
        page.keyboard.press("Control+k")
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("textbox", name="搜索历史标题").fill(prefix + " oldneedle")
        dialog.get_by_role("link", name=re.compile("oldneedle")).click()
        expect(page.get_by_text("真实数据库测试正文29", exact=True)).to_be_visible()
        expect(page.get_by_test_id("multimodal-input")).to_have_value("属于旧对话的草稿")
        # Public/private state is accepted only after the actual server mutation.
        page.get_by_role("button", name="对话菜单", exact=True).click()
        expect(page.get_by_role("menuitem", name="公开，获得链接的人可访问", exact=True)).to_be_visible()
        page.get_by_role("menuitem", name="公开，获得链接的人可访问", exact=True).click()
        expect(page.locator("[data-sonner-toast]").filter(has_text="公开")).to_be_visible(timeout=20000)
        outsider = p.request.new_context()
        outsider.get("http://127.0.0.1:3000/")
        messages_url = "http://127.0.0.1:3000/api/messages?chatId=" + ids[29]
        public_result = outsider.get(messages_url)
        assert public_result.status == 200 and public_result.json()["isReadonly"] is True
        page.get_by_role("button", name="对话菜单", exact=True).click()
        page.get_by_role("menuitem", name="私密，仅自己可访问", exact=True).click()
        expect(page.locator("[data-sonner-toast]").filter(has_text="私密")).to_be_visible(timeout=20000)
        assert outsider.get(messages_url).status == 403
        outsider.dispose()
        title_before = prefix + " 对话 0"
        renamed = prefix + " 已重命名的调查"
        page.get_by_role("button", name="对话操作：" + title_before, exact=True).click()
        page.get_by_role("menuitem", name="重命名", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("textbox", name="对话标题").fill(" ")
        expect(dialog.get_by_role("button", name="保存标题", exact=True)).to_be_disabled()
        dialog.get_by_role("textbox", name="对话标题").fill(renamed)
        dialog.get_by_role("button", name="保存标题", exact=True).click()
        expect(dialog).not_to_be_visible(timeout=20000)
        expect(page.get_by_role("button", name="对话操作：" + renamed, exact=True)).to_be_visible(timeout=20000)
        matches = context.request.get(base + "search=" + quote(renamed)).json()["chats"]
        assert len(matches) == 1 and matches[0]["id"] == ids[0]
        # Failed deletion must not remove the row or claim success.
        delete_url = "http://127.0.0.1:3000/api/chat?id=" + ids[0]
        page.route(delete_url, lambda route: route.fulfill(status=503, json={"error": "fixture failure"}))
        page.get_by_role("button", name="对话操作：" + renamed, exact=True).click()
        page.get_by_role("menuitem", name="删除对话", exact=True).click()
        delete_dialog = page.get_by_role("alertdialog")
        delete_dialog.get_by_role("button", name="删除对话", exact=True).click()
        expect(page.locator("[data-sonner-toast]").filter(has_text="删除没有完成")).to_be_visible()
        expect(delete_dialog).to_be_visible()
        assert context.request.get(base + "search=" + quote(renamed)).json()["chats"][0]["id"] == ids[0]
        page.unroute(delete_url)
        # Explicitly delete only our own fixture record, exercising actual database deletion.
        delete_dialog.get_by_role("button", name="删除对话", exact=True).click()
        expect(delete_dialog).not_to_be_visible(timeout=20000)
        expect(page.get_by_role("button", name="对话操作：" + renamed, exact=True)).to_have_count(0)
        assert context.request.get(base + "search=" + quote(renamed)).json()["chats"] == []
        assert not errors, errors
        print(json.dumps({"checks": ["真实全历史标题搜索", "跨账号隔离与通配符转义", "快捷键打开检索", "对话切换与草稿隔离", "公开/私密真实权限切换", "真实重命名持久化", "删除失败保留记录、成功才移除"], "pageErrors": errors}, ensure_ascii=False))
    finally:
        fixture_command("cleanup")
        browser.close()
