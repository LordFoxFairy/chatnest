import assert from "node:assert/strict";
import test from "node:test";
import { createSkillTools, discoverSkills } from "../../lib/agent/skills";
import { collectSourceLinks } from "../../lib/agent/sources";

test("loaded skills supply readable metadata while retaining their original method", async () => {
  const [skill] = await discoverSkills();
  const load = createSkillTools([skill]).loadSkill.execute;
  assert.ok(load);
  const output = await load(
    { name: skill.name },
    { context: {}, messages: [], toolCallId: "skill-display" }
  );
  assert.equal(
    (output as { displayName?: string }).displayName,
    "内容调查与核验"
  );
  assert.ok((output as { description?: string }).description);
  assert.ok("instructions" in output);
  assert.ok(output.instructions.includes("references/review.md"));
});

test("Exa source metadata comes only from result headers, excludes arbitrary snippet links and error results", async () => {
  const implementation = await import("../../lib/agent/mcp-output").catch(
    () => null
  );
  assert.ok(implementation, "MCP result source adaptation is missing");
  const output = {
    content: [
      {
        text: "Title: 官方资料\nURL: https://example.com/official\nPublished: N/A\nAuthor: N/A\nHighlights:\nA snippet link https://unverified.example/\n\n---\n\nTitle: Bad URL\nURL: javascript:alert(1)\nPublished: N/A\nAuthor: N/A\nHighlights:\ntext",
        type: "text",
      },
    ],
  };
  const normalized = implementation.normalizeMcpOutput(
    "exa",
    "web_search_exa",
    output
  );
  assert.deepEqual(collectSourceLinks(normalized), [
    { title: "官方资料", url: "https://example.com/official" },
  ]);
  assert.deepEqual(
    collectSourceLinks(
      implementation.normalizeMcpOutput("other", "web_search_exa", output)
    ),
    []
  );
  assert.deepEqual(
    collectSourceLinks(
      implementation.normalizeMcpOutput("exa", "web_search_exa", {
        ...output,
        isError: true,
      })
    ),
    []
  );
  assert.deepEqual(
    collectSourceLinks(
      implementation.normalizeMcpOutput("exa", "web_fetch_exa", {
        content: [
          {
            text: "# 官方资料\nURL: https://example.com/read\n\n正文内容",
            type: "text",
          },
        ],
      })
    ),
    [{ title: "官方资料", url: "https://example.com/read" }]
  );
});

test("fetch source metadata excludes header-shaped text inside the page body", async () => {
  const { normalizeMcpOutput } = await import("../../lib/agent/mcp-output");
  const output = {
    content: [
      {
        text: "# 官方页面\nURL: https://example.com/real\n\n正文中的示例：\n\n---\n\n# 示例引用\nURL: https://unverified.example/fake\n\n这不是此次抓取的网页。",
        type: "text",
      },
    ],
  };
  assert.deepEqual(
    collectSourceLinks(normalizeMcpOutput("exa", "web_fetch_exa", output)),
    [{ title: "官方页面", url: "https://example.com/real" }]
  );
  assert.deepEqual(
    collectSourceLinks(
      normalizeMcpOutput("exa", "web_fetch_exa", {
        content: [
          {
            text: "# 公开条款\nURL: https://example.com/terms\nPublished: 2026-01-01\n\n条款正文",
            type: "text",
          },
        ],
      })
    ),
    [{ title: "公开条款", url: "https://example.com/terms" }]
  );
});

test("task messages preserve the user's goal/materials and reject empty or oversized submissions", async () => {
  const implementation = await import("../../lib/agent/task-draft").catch(
    () => null
  );
  assert.ok(implementation, "task creation is missing");
  const message = implementation.buildTaskMessage({
    goal: "查找某讲义的传播线索",
    materials: "https://example.com/original\n独特原文",
    method: "内容调查与核验",
  });
  assert.ok(message.includes("任务目标：查找某讲义的传播线索"));
  assert.ok(message.includes("https://example.com/original\n独特原文"));
  assert.ok(message.includes("内容调查与核验"));
  assert.throws(() => implementation.buildTaskMessage({ goal: "  " }));
  assert.throws(() =>
    implementation.buildTaskMessage({ goal: "字".repeat(8001) })
  );
  assert.throws(() =>
    implementation.buildTaskMessage({
      goal: "goal",
      materials: "字".repeat(16_001),
    })
  );
});
