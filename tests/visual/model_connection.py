"""Actual production chat against a local OpenAI-compatible HTTP fixture, never a paid API."""
import json
import http.cookiejar
import os
import signal
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import expect, sync_playwright

requests = []
class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        requests.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
        common = {"id": "chatcmpl-local-fixture", "object": "chat.completion", "created": 1, "model": "custom/research-model"}
        self.send_response(200)
        if body.get("stream"):
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for chunk in [
                {**common, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "直连流式验证成功"}, "finish_reason": None}]},
                {**common, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
            ]:
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({**common, "choices": [{"index": 0, "message": {"role": "assistant", "content": "连接验证成功"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}).encode())

fixture = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
threading.Thread(target=fixture.serve_forever, daemon=True).start()
env = {**os.environ, "MODEL_PROVIDER": "openai", "OPENAI_API_KEY": "local-test-only", "OPENAI_BASE_URL": f"http://127.0.0.1:{fixture.server_port}/custom/v1", "OPENAI_MODEL": "custom/research-model", "OPENAI_API_MODE": "chat", "BROWSER_RUNTIME": "disabled"}
for key in ["PLAYWRIGHT", "PLAYWRIGHT_TEST_BASE_URL", "CI_PLAYWRIGHT"]:
    env.pop(key, None)
process = subprocess.Popen(["corepack", "pnpm", "start", "--hostname", "127.0.0.1", "--port", "3001"], env=env, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = "http://127.0.0.1:3001"
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
try:
    deadline = time.monotonic() + 40
    while True:
        if process.poll() is not None:
            raise AssertionError("isolated production server failed to start")
        try:
            with opener.open(base + "/api/models", timeout=2) as response:
                catalog = json.load(response)
            break
        except Exception:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.2)
    assert catalog.get("selectableModelIds") == ["custom/research-model"], "custom model catalog was not applied at runtime"
    assert [model["id"] for model in catalog["models"]] == ["custom/research-model"]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base, wait_until="networkidle", timeout=60000)
        expect(page.get_by_test_id("model-selector")).to_have_text("custom/research-model")
        page.get_by_test_id("model-selector").click()
        expect(page.get_by_role("option").filter(has_text="Kimi")).to_have_count(0)
        page.keyboard.press("Escape")
        info = page.request.get(base + "/api/agent").json()
        assert info["modelConfigured"] and info["modelProvider"] == "openai"
        assert "local-test-only" not in json.dumps(info)
        chat_id = None
        try:
            page.get_by_test_id("multimodal-input").fill("验证自定义接口连接")
            page.get_by_test_id("send-button").click()
            expect(page.get_by_test_id("message-assistant").last).to_contain_text("直连流式验证成功", timeout=30000)
            expect(page.get_by_test_id("stop-button")).to_have_count(0)
            page.wait_for_url("**/chat/*")
            chat_id = page.url.rsplit("/", 1)[-1]
            deadline = time.monotonic() + 10
            while not (any(item["body"].get("stream") for item in requests) and any(not item["body"].get("stream") for item in requests)):
                assert time.monotonic() < deadline, "title and chat must use the configured API"
                time.sleep(0.1)
            for item in requests:
                assert item["path"] == "/custom/v1/chat/completions"
                assert item["auth"] == "Bearer local-test-only"
                assert item["body"]["model"] == "custom/research-model"
            page.reload(wait_until="networkidle")
            expect(page.get_by_test_id("message-assistant").last).to_contain_text("直连流式验证成功")
            assert not errors, errors
            print("production custom endpoint: model catalog, provider state, exact URL/key/model, chat/title/stream and persistence passed (local HTTP fixture)")
        finally:
            if chat_id:
                assert page.request.delete(base + "/api/chat?id=" + chat_id).ok
            browser.close()
finally:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    fixture.shutdown()
    fixture.server_close()
