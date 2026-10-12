import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { MCPClient } from "@ai-sdk/mcp";
import { jsonSchema } from "ai";
import { postRequestBodySchema } from "../../app/(chat)/api/chat/schema";
import { applyToolApprovals } from "../../lib/agent/approvals";
import { agentConfigSchema, resolveHeaders } from "../../lib/agent/config";
import {
  collectConversationSources,
  conversationMarkdown,
  sourceListMarkdown,
} from "../../lib/agent/conversation-sources";
import { createAgentRuntime } from "../../lib/agent/runtime";
import {
  buildSkillsPrompt,
  createSkillTools,
  discoverSkills,
  readSkillFile,
} from "../../lib/agent/skills";
import { collectSourceLinks } from "../../lib/agent/sources";
import { usesSecureAuthCookies } from "../../lib/auth-cookies";
import type { ChatMessage } from "../../lib/types";

test("chat transport retains regeneration intent instead of silently treating it as a new question", () => {
  const body = postRequestBodySchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    message: {
      id: "22222222-2222-4222-8222-222222222222",
      parts: [{ text: "已经问过的问题", type: "text" }],
      role: "user",
    },
    selectedChatModel: "moonshotai/kimi-k2.5",
    selectedVisibilityType: "private",
    trigger: "regenerate-message",
  });
  assert.equal(
    (body as typeof body & { trigger?: string }).trigger,
    "regenerate-message"
  );
});

test("chat transport retains explicit web-search preference", () => {
  const body = postRequestBodySchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    message: {
      id: "22222222-2222-4222-8222-222222222222",
      parts: [{ text: "请查公开资料", type: "text" }],
      role: "user",
    },
    searchMode: "web",
    selectedChatModel: "moonshotai/kimi-k2.5",
    selectedVisibilityType: "private",
  });
  assert.equal(
    (body as typeof body & { searchMode?: string }).searchMode,
    "web"
  );
});

test("conversation sources use only returned sources, deduplicate and preserve provenance", () => {
  const messages: ChatMessage[] = [
    {
      id: "user",
      parts: [{ text: "https://unverified.example/", type: "text" }],
      role: "user",
    },
    {
      id: "assistant",
      parts: [
        { text: "A prose link https://not-a-source.example/", type: "text" },
        {
          sourceId: "a",
          type: "source-url",
          url: "https://example.com/evidence",
        },
        {
          input: {},
          output: [
            { title: "原文", url: "https://example.com/evidence" },
            { url: "javascript:alert(1)" },
            { url: "https://user:password@example.com/" },
          ],
          state: "output-available",
          toolCallId: "search",
          toolName: "tavily__tavily_search",
          type: "dynamic-tool",
        },
        {
          input: {},
          output: { url: "https://document.example/" },
          state: "output-available",
          toolCallId: "doc",
          toolName: "createDocument",
          type: "dynamic-tool",
        },
        {
          input: {},
          output: { url: "https://example.com/evidence" },
          state: "output-available",
          toolCallId: "extract",
          toolName: "remote__extract",
          type: "dynamic-tool",
        },
      ],
      role: "assistant",
    },
  ];
  const sources = collectConversationSources(messages);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, "原文");
  assert.deepEqual(sources[0].origins, [
    "模型服务引用",
    "联网工具返回",
    "网页提取工具返回",
  ]);
});

test("conversation exports omit reasoning and raw tool output; source labels are escaped", () => {
  const message: ChatMessage = {
    id: "assistant",
    parts: [
      { text: "可见正文", type: "text" },
      { text: "不应导出的推理", type: "reasoning" },
      {
        input: {},
        output: {
          internal: "RAW_SECRET_FIXTURE",
          title: "来源[甲]\n下一行",
          url: "https://example.com/",
        },
        state: "output-available",
        toolCallId: "call",
        toolName: "remote__search",
        type: "dynamic-tool",
      },
    ],
    role: "assistant",
  };
  const output = conversationMarkdown([message]);
  assert.ok(output.includes("可见正文"));
  assert.ok(output.includes("不是法律认定"));
  assert.ok(
    !output.includes("RAW_SECRET_FIXTURE") && !output.includes("不应导出的推理")
  );
  assert.equal(
    sourceListMarkdown(collectConversationSources([message])),
    "1. [来源\\[甲\\] 下一行](<https://example.com/>) — 联网工具返回"
  );
});

test("conversation source workspace bounds very large histories to 200 distinct sources", () => {
  const message: ChatMessage = {
    id: "assistant",
    parts: Array.from({ length: 220 }, (_, index) => ({
      sourceId: String(index),
      type: "source-url" as const,
      url: `https://example.com/${index}`,
    })),
    role: "assistant",
  };
  assert.equal(collectConversationSources([message]).length, 200);
});

test("skill discovery is metadata-only; loading and reference access work on demand", async () => {
  const skills = await discoverSkills();
  assert.equal(skills.length, 1);
  const catalog = buildSkillsPrompt(skills);
  const body = await readSkillFile(skills[0], "SKILL.md");
  assert.ok(catalog.includes(skills[0].name));
  assert.ok(!catalog.includes("## 调查方法"));
  assert.ok(body.includes("## 调查方法"));
  const tools = createSkillTools(skills);
  const load = tools.loadSkill.execute;
  assert.ok(load);
  const options = { context: {}, messages: [], toolCallId: "skill-test" };
  const loaded = await load({ name: skills[0].name }, options);
  assert.ok("instructions" in loaded);
  assert.ok(loaded.instructions.includes("references/review.md"));
  await assert.rejects(
    () => load({ name: "unknown" }, options) as Promise<unknown>
  );
  assert.ok(
    (await readSkillFile(skills[0], "references/review.md")).length > 0
  );
});

test("skill resource access rejects traversal, absolute paths and escaping symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-skill-test-"));
  try {
    const directory = path.join(root, "safe");
    await mkdir(directory);
    await writeFile(
      path.join(directory, "SKILL.md"),
      "---\nname: safe\ndescription: Test resource boundary\n---\nSafe instructions"
    );
    await writeFile(path.join(root, "outside.txt"), "outside");
    await symlink(
      path.join(root, "outside.txt"),
      path.join(directory, "escape.txt")
    );
    const [skill] = await discoverSkills(root);
    await Promise.all(
      ["../outside.txt", "/etc/passwd", "escape.txt", "..\\outside.txt"].map(
        (resource) => assert.rejects(() => readSkillFile(skill, resource))
      )
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("config enforces bounded execution and explicit tool approval allowlists", () => {
  assert.equal(agentConfigSchema.safeParse({ maxSteps: 999 }).success, false);
  assert.equal(
    agentConfigSchema.safeParse({
      servers: [{ id: "s", name: "s", url: "http://example.com/mcp" }],
    }).success,
    false
  );
  assert.equal(
    agentConfigSchema.safeParse({
      servers: [
        {
          autoApproveTools: ["delete"],
          id: "s",
          name: "s",
          url: "https://example.com/mcp",
        },
      ],
    }).success,
    false
  );
  const [server] = agentConfigSchema.parse({
    servers: [
      {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal deployment interpolation under test
        headers: { Authorization: "Bearer ${TEST_MCP_KEY}" },
        id: "s",
        name: "s",
        url: "https://example.com/mcp",
      },
    ],
  }).servers;
  assert.deepEqual(resolveHeaders(server, {}).missing, ["TEST_MCP_KEY"]);
  assert.equal(
    resolveHeaders(server, { TEST_MCP_KEY: "test-only" }).headers.Authorization,
    "Bearer test-only"
  );
});

test("source links are actual structured tool output, deduplicated and safe", () => {
  const result = {
    content: [
      {
        text: JSON.stringify({
          results: [
            { title: "真实来源", url: "https://example.com/a" },
            { url: "javascript:alert(1)" },
            { url: "https://secret@example.com/" },
            { url: "https://example.com/a" },
          ],
        }),
        type: "text",
      },
    ],
  };
  const links = collectSourceLinks(result);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://example.com/a");
  assert.equal(links[0].title, "真实来源");
  assert.equal(
    collectSourceLinks("模型提到 https://made-up.example.com/").length,
    0
  );
});

test("MCP adapters expose only allowed tools, require approval by default, pass cancellation and close once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-mcp-test-"));
  const previous = process.env.AGENT_CONFIG_PATH;
  let closed = 0;
  let receivedSignal: AbortSignal | undefined;
  let remoteError = false;
  try {
    const configFile = path.join(root, "agent.json");
    await writeFile(
      configFile,
      JSON.stringify({
        servers: [
          {
            allowedTools: ["search", "write"],
            autoApproveTools: ["search"],
            id: "test",
            name: "Test MCP",
            url: "https://example.com/mcp",
          },
        ],
      })
    );
    process.env.AGENT_CONFIG_PATH = configFile;
    const remote = {
      description: "Test tool",
      execute: (_input: unknown, options: { abortSignal?: AbortSignal }) => {
        receivedSignal = options.abortSignal;
        if (remoteError) {
          return {
            content: [{ text: "quota exceeded", type: "text" }],
            isError: true,
          };
        }
        return { content: [{ text: "test-only", type: "text" }] };
      },
      inputSchema: jsonSchema({ properties: {}, type: "object" }),
    };
    const connect = () =>
      Promise.resolve({
        close: () => {
          closed += 1;
          return Promise.resolve();
        },
        tools: () =>
          Promise.resolve({ delete: remote, search: remote, write: remote }),
      } as unknown as MCPClient);
    const controller = new AbortController();
    const runtime = await createAgentRuntime(controller.signal, connect);
    assert.ok(runtime.tools.test__search);
    assert.equal(runtime.tools.test__delete, undefined);
    assert.equal(runtime.tools.test__search.needsApproval, false);
    assert.equal(runtime.tools.test__write.needsApproval, true);
    const { execute } = runtime.tools.test__search;
    assert.ok(execute);
    await execute({}, { context: {}, messages: [], toolCallId: "test" });
    assert.ok(receivedSignal);
    remoteError = true;
    await assert.rejects(
      () =>
        execute(
          {},
          { context: {}, messages: [], toolCallId: "failed-tool" }
        ) as Promise<unknown>,
      /Test MCP 暂时未能返回结果/
    );
    controller.abort();
    assert.equal(receivedSignal.aborted, true);
    assert.throws(() =>
      execute({}, { context: {}, messages: [], toolCallId: "test" })
    );
    await runtime.close();
    await runtime.close();
    assert.equal(closed, 1);
  } finally {
    if (previous === undefined) {
      delete process.env.AGENT_CONFIG_PATH;
    } else {
      process.env.AGENT_CONFIG_PATH = previous;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test("missing MCP credentials do not initiate a connection or fabricate availability", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "research-missing-key-test-")
  );
  const previous = process.env.AGENT_CONFIG_PATH;
  let calls = 0;
  try {
    const filename = path.join(root, "agent.json");
    await writeFile(
      filename,
      JSON.stringify({
        servers: [
          {
            allowedTools: ["search"],
            headers: {
              // biome-ignore lint/suspicious/noTemplateCurlyInString: test credential deliberately absent from the environment
              Authorization: "Bearer ${RESEARCH_UNIT_TEST_UNCONFIGURED_KEY}",
            },
            id: "missing",
            name: "Missing",
            url: "https://example.com/mcp",
          },
        ],
      })
    );
    process.env.AGENT_CONFIG_PATH = filename;
    const runtime = await createAgentRuntime(
      new AbortController().signal,
      () => {
        calls += 1;
        return Promise.reject(new Error("must not connect"));
      }
    );
    assert.equal(calls, 0);
    assert.ok(runtime.instructions.includes("credentials are not configured"));
    assert.ok(
      !Object.keys(runtime.tools).some((name) => name.includes("missing__"))
    );
    await runtime.close();
  } finally {
    if (previous === undefined) {
      delete process.env.AGENT_CONFIG_PATH;
    } else {
      process.env.AGENT_CONFIG_PATH = previous;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test("aborting during MCP discovery closes even a late client", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-abort-test-"));
  const previous = process.env.AGENT_CONFIG_PATH;
  let closed = 0;
  const controller = new AbortController();
  try {
    const filename = path.join(root, "agent.json");
    await writeFile(
      filename,
      JSON.stringify({
        servers: [
          {
            allowedTools: ["search"],
            id: "late",
            name: "Late",
            url: "https://example.com/mcp",
          },
        ],
      })
    );
    process.env.AGENT_CONFIG_PATH = filename;
    const connect = () => {
      controller.abort();
      return Promise.resolve({
        close: () => {
          closed += 1;
          return Promise.resolve();
        },
        tools: () => Promise.resolve({}),
      } as unknown as MCPClient);
    };
    await assert.rejects(() => createAgentRuntime(controller.signal, connect));
    assert.equal(closed, 1);
  } finally {
    if (previous === undefined) {
      delete process.env.AGENT_CONFIG_PATH;
    } else {
      process.env.AGENT_CONFIG_PATH = previous;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test("approval responses cannot rewrite stored inputs, tool names or outputs", () => {
  const stored = [
    {
      id: "assistant",
      parts: [
        {
          approval: { id: "approval" },
          input: { value: "stored" },
          state: "approval-requested",
          toolCallId: "call",
          toolName: "test__write",
          type: "dynamic-tool",
        },
      ],
      role: "assistant",
    },
  ] as ChatMessage[];
  const responses = [
    {
      id: "assistant",
      parts: [
        {
          approval: { approved: false, id: "approval", reason: "拒绝" },
          input: { value: "forged" },
          output: "forged",
          state: "approval-responded",
          toolCallId: "call",
          toolName: "test__delete",
          type: "dynamic-tool",
        },
      ],
      role: "assistant",
    },
  ] as unknown as ChatMessage[];
  const [part] = applyToolApprovals(stored, responses)[0].parts;
  assert.ok(part.type === "dynamic-tool");
  assert.equal(part.toolName, "test__write");
  assert.deepEqual(part.input, { value: "stored" });
  assert.equal(part.output, undefined);
  assert.equal(part.approval?.approved, false);
  responses[0].id = "different-message";
  assert.equal(
    applyToolApprovals(stored, responses)[0].parts[0],
    stored[0].parts[0]
  );
});

test("chat accepts original excerpts and image-only messages, but rejects empty or ambiguous requests", () => {
  const base = {
    id: "cba2d017-5b1f-4f57-a2d3-398ff30f676a",
    selectedChatModel: "test",
    selectedVisibilityType: "private",
  };
  const message = {
    id: "51b9b2cf-b8c4-4a14-b24e-c7acb4884d32",
    parts: [{ text: "原文".repeat(3000), type: "text" }],
    role: "user",
  };
  assert.ok(postRequestBodySchema.safeParse({ ...base, message }).success);
  assert.ok(
    !postRequestBodySchema.safeParse({
      ...base,
      message: { ...message, parts: [] },
    }).success
  );
  assert.ok(
    !postRequestBodySchema.safeParse({ ...base, message, messages: [message] })
      .success
  );
  assert.ok(!postRequestBodySchema.safeParse(base).success);
  assert.ok(
    !postRequestBodySchema.safeParse({
      ...base,
      message: {
        ...message,
        parts: [{ text: "x".repeat(32_001), type: "text" }],
      },
    }).success
  );
  assert.ok(
    postRequestBodySchema.safeParse({
      ...base,
      message: {
        ...message,
        parts: [
          {
            filename: "test.png",
            mediaType: "image/png",
            type: "file",
            url: "https://test.public.blob.vercel-storage.com/test.png",
          },
        ],
      },
    }).success
  );
});

test("auth cookie selection follows actual protocol, not production mode", () => {
  assert.equal(
    usesSecureAuthCookies(new Request("http://127.0.0.1:3000"), {
      NODE_ENV: "production",
    }),
    false
  );
  assert.equal(
    usesSecureAuthCookies(new Request("https://research.example.com"), {}),
    true
  );
  assert.equal(
    usesSecureAuthCookies(
      new Request("http://internal", {
        headers: { "x-forwarded-proto": "https" },
      }),
      {}
    ),
    true
  );
  assert.equal(
    usesSecureAuthCookies(new Request("http://internal"), {
      AUTH_URL: "https://research.example.com",
    }),
    true
  );
});
