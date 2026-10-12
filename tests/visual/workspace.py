from playwright.sync_api import sync_playwright, expect
import os

base = os.environ.get("LOCAL_TEST_BASE_URL", "http://127.0.0.1:3000")

# Break caught: the right workspace is missing, loses its selected tab, or overflows mobile.
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(base+"/")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="打开工作区", exact=True).click()
    workspace = page.get_by_test_id("workspace")
    expect(workspace).to_be_visible()
    expect(workspace.get_by_role("tab", name="浏览器", exact=True)).to_have_attribute("aria-selected", "true")
    workspace.get_by_role("tab", name="来源", exact=True).click()
    expect(workspace.get_by_text("还没有返回来源", exact=True)).to_be_visible()
    workspace.get_by_role("button", name="关闭工作区", exact=True).click()
    page.get_by_role("button", name="打开工作区", exact=True).click()
    expect(workspace.get_by_role("tab", name="来源", exact=True)).to_have_attribute("aria-selected", "true")
    workspace.get_by_role("button", name="展开工作区", exact=True).click()
    assert workspace.bounding_box()["width"] > 1000
    workspace.get_by_role("button", name="收起工作区", exact=True).click()
    page.set_viewport_size({"width": 390, "height": 844})
    expect(workspace).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    workspace.get_by_role("button", name="关闭工作区", exact=True).click()
    expect(page.get_by_test_id("multimodal-input")).to_be_visible()
    browser.close()
print("workspace layout and state passed")
