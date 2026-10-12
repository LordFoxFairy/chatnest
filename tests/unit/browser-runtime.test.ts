import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ModelMessage } from "ai";

test("real MCP browser preserves page across agent/manual control and rejects unsafe tools", async () => {
  const implementation = await import("../../lib/agent/browser-session").catch(
    () => null
  );
  assert.ok(implementation, "shared browser session is missing");
  const session = await implementation.createBrowserSession();
  try {
    const lease = session.control.agentLease();
    const result = await session.execute(
      "browser_navigate",
      { url: "https://example.com" },
      lease
    );
    assert.match(JSON.stringify(result), /Example Domain/);
    assert.equal(session.state().url, "https://example.com/");
    const frame = await session.frame();
    assert.ok(frame);
    assert.equal(frame.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    session.control.setMode("manual");
    await assert.rejects(
      () =>
        session.execute(
          "browser_navigate",
          { url: "https://example.org" },
          lease
        ),
      /control/
    );
    await session.execute(
      "browser_mouse_wheel",
      { deltaX: 0, deltaY: 200 },
      "manual"
    );
    session.control.setMode("agent");
    await assert.rejects(
      () => session.execute("browser_snapshot", {}, lease),
      /control/
    );
    assert.match(
      JSON.stringify(
        await session.execute(
          "browser_snapshot",
          {},
          session.control.agentLease()
        )
      ),
      /Example Domain/
    );
    await assert.rejects(
      () =>
        session.execute(
          "browser_run_code_unsafe",
          { code: "()=>process.env" },
          session.control.agentLease()
        ),
      /allowed/
    );
    await assert.rejects(
      () =>
        session.execute(
          "browser_navigate",
          { url: "http://127.0.0.1:3000" },
          session.control.agentLease()
        ),
      /public/
    );
    const blocked = await session.context.newPage();
    await assert.rejects(() => blocked.goto("http://127.0.0.1:3000"));
    await blocked.close();
    const [original] = session.context.pages();
    await original.setContent(
      '<title>Original page</title><h1>Original page</h1><input aria-label="Query" />'
    );
    const popup = await session.context.newPage();
    await popup.setContent("<title>Popup page</title><h1>Popup page</h1>");
    const snapshot = await session.execute(
      "browser_snapshot",
      {},
      session.control.agentLease()
    );
    assert.match(snapshot.text, /Original page/);
    assert.equal(
      session.state().title,
      "Original page",
      "viewer must show the MCP-selected page, not the newest popup"
    );
    await popup.close();
    session.control.setMode("manual");
    await original.getByRole("textbox", { name: "Query" }).focus();
    await session.execute(
      "browser_type",
      { target: ":focus", text: "知识产权测试" },
      "manual"
    );
    assert.equal(
      await original.getByRole("textbox", { name: "Query" }).inputValue(),
      "知识产权测试"
    );
  } finally {
    await session.close();
  }
});

test("a stored browser approval cannot regain authority in a freshly constructed agent run", async () => {
  const { createBrowserTools } = await import("../../lib/agent/browser-tools");
  const { getBrowserSession, closeBrowserSession } = await import(
    "../../lib/agent/browser-session"
  );
  const previous = process.env.BROWSER_RUNTIME;
  process.env.BROWSER_RUNTIME = "local";
  const owner = `test-${randomUUID()}`;
  const chatId = randomUUID();
  try {
    const tools = await createBrowserTools(
      owner,
      chatId,
      new AbortController().signal
    );
    const navigate = tools.browser__browser_navigate;
    assert.ok(typeof navigate.needsApproval === "function");
    assert.equal(
      await navigate.needsApproval(
        { url: "https://example.com" },
        { context: {}, messages: [], toolCallId: "old" }
      ),
      true
    );
    const session = await getBrowserSession(owner, chatId);
    assert.ok(session);
    await session.setMode("manual");
    await session.execute(
      "browser_navigate",
      { url: "https://example.org" },
      "manual"
    );
    await session.setMode("agent");
    const renewed = await createBrowserTools(
      owner,
      chatId,
      new AbortController().signal
    );
    assert.ok(renewed.browser__browser_navigate.execute);
    await assert.rejects(
      async () =>
        renewed.browser__browser_navigate.execute?.(
          { url: "https://example.com" },
          { context: {}, messages: [], toolCallId: "old" }
        ),
      /control/
    );
    assert.equal(session.state().url, "https://example.org/");
    assert.ok(
      typeof renewed.browser__browser_navigate.needsApproval === "function"
    );
    assert.equal(
      await renewed.browser__browser_navigate.needsApproval(
        { url: "https://example.com" },
        { context: {}, messages: [], toolCallId: "new" }
      ),
      true
    );
    await renewed.browser__browser_navigate.execute?.(
      { url: "https://example.com" },
      { context: {}, messages: [], toolCallId: "new" }
    );
    assert.equal(session.state().url, "https://example.com/");
    const approvalHistory: ModelMessage[] = [
      {
        content: [
          {
            approvalId: "approved-old",
            toolCallId: "new",
            type: "tool-approval-request",
          },
        ],
        role: "assistant",
      },
    ];
    for (let index = 0; index < 205; index += 1) {
      session.control.issueApproval(
        `eviction-${index}`,
        session.control.agentLease()
      );
    }
    await assert.rejects(
      async () =>
        renewed.browser__browser_navigate.needsApproval instanceof Function &&
        renewed.browser__browser_navigate.needsApproval(
          { url: "https://example.org" },
          { context: {}, messages: approvalHistory, toolCallId: "new" }
        ),
      /control/
    );
    await closeBrowserSession(owner, chatId);
    const restarted = await createBrowserTools(
      owner,
      chatId,
      new AbortController().signal
    );
    await assert.rejects(
      async () =>
        restarted.browser__browser_navigate.needsApproval instanceof Function &&
        restarted.browser__browser_navigate.needsApproval(
          { url: "https://example.org" },
          { context: {}, messages: approvalHistory, toolCallId: "new" }
        ),
      /control/
    );
  } finally {
    await closeBrowserSession(owner, chatId);
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "BROWSER_RUNTIME");
    } else {
      process.env.BROWSER_RUNTIME = previous;
    }
  }
});
