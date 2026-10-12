import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { generateText, streamText } from "ai";

test("an OpenAI key and custom endpoint select direct access without a gateway key", async () => {
  const implementation = await import("../../lib/ai/model-connection").catch(
    () => null
  );
  assert.ok(implementation, "direct model connection configuration is missing");
  const connection = implementation.getModelConnection({
    OPENAI_API_KEY: "test-only-key",
    OPENAI_BASE_URL: "http://127.0.0.1:8123/custom/v1/",
    OPENAI_MODEL: "vendor/custom-model",
  });
  assert.equal(connection.provider, "openai");
  assert.equal(connection.configured, true);
  assert.equal(connection.baseURL, "http://127.0.0.1:8123/custom/v1");
  assert.equal(connection.modelId, "vendor/custom-model");
  assert.equal(connection.apiMode, "chat");
  assert.equal("apiKey" in connection, false);
  assert.equal(
    implementation.getModelConnection({ MODEL_PROVIDER: "openai" }).configured,
    false
  );
  assert.equal(
    implementation.getModelConnection({
      AI_GATEWAY_API_KEY: "gateway-only",
      MODEL_PROVIDER: "openai",
    }).configured,
    false
  );
  assert.equal(
    implementation.getModelConnection({
      AI_GATEWAY_API_KEY: "gateway-only",
      MODEL_PROVIDER: "gateway",
      OPENAI_API_KEY: "direct-only",
    }).provider,
    "gateway"
  );
  for (const url of [
    "file:///etc/passwd",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?key=secret",
    "https://example.com/v1/chat/completions",
  ]) {
    assert.throws(
      () => implementation.getModelConnection({ OPENAI_BASE_URL: url }),
      /OPENAI_BASE_URL/
    );
  }
});

test("custom model catalog and capabilities do not query Vercel's gateway", async () => {
  const implementation = await import("../../lib/ai/model-connection").catch(
    () => null
  );
  assert.ok(implementation, "direct model connection configuration is missing");
  const env = {
    MODEL_PROVIDER: "openai",
    OPENAI_MODEL: "custom-research",
    OPENAI_MODEL_TOOLS: "0",
    OPENAI_MODEL_VISION: "1",
  };
  assert.deepEqual(
    implementation.getRuntimeModels(env).map((model) => model.id),
    ["custom-research"]
  );
  assert.equal(
    implementation.resolveModelId("moonshotai/kimi-k2.5", env),
    "custom-research"
  );
  assert.deepEqual(implementation.getDirectCapabilities(env), {
    "custom-research": { reasoning: false, tools: false, vision: true },
  });
});

test("chat, streaming and title requests use the configured endpoint, key and exact model ID", async () => {
  const requests: {
    path?: string;
    auth?: string;
    body: Record<string, unknown>;
  }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    const input = JSON.parse(body);
    requests.push({
      auth: request.headers.authorization,
      body: input,
      path: request.url,
    });
    const common = {
      created: 1,
      id: "chatcmpl-test",
      model: "vendor/custom-model",
      object: "chat.completion",
    };
    if (request.url?.endsWith("/responses")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          created_at: 1,
          id: "resp-test",
          model: "vendor/custom-model",
          object: "response",
          output: [
            {
              content: [
                {
                  annotations: [],
                  text: "Responses 测试",
                  type: "output_text",
                },
              ],
              id: "msg-test",
              role: "assistant",
              status: "completed",
              type: "message",
            },
          ],
          status: "completed",
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        })
      );
      return;
    }
    if (input.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const chunk of [
        {
          ...common,
          choices: [
            {
              delta: { content: "流式测试", role: "assistant" },
              finish_reason: null,
              index: 0,
            },
          ],
          object: "chat.completion.chunk",
        },
        {
          ...common,
          choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
          object: "chat.completion.chunk",
        },
      ]) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          ...common,
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: { content: "连接测试", role: "assistant" },
            },
          ],
          usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
        })
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const overrides = {
    MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-only-key",
    OPENAI_API_MODE: "chat",
    OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/custom/v1`,
    OPENAI_MODEL: "vendor/custom-model",
  };
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, overrides);
  try {
    const { getLanguageModel, getTitleModel } = await import(
      "../../lib/ai/providers"
    );
    const result = await generateText({
      maxRetries: 0,
      model: getLanguageModel("vendor/custom-model"),
      prompt: "test",
    });
    assert.equal(result.text, "连接测试");
    assert.equal(
      await streamText({
        maxRetries: 0,
        model: getLanguageModel("vendor/custom-model"),
        prompt: "stream",
      }).text,
      "流式测试"
    );
    assert.equal(
      (
        await generateText({
          maxRetries: 0,
          model: getTitleModel(),
          prompt: "title",
        })
      ).text,
      "连接测试"
    );
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.equal(request.path, "/custom/v1/chat/completions");
      assert.equal(request.auth, "Bearer test-only-key");
      assert.equal(request.body.model, "vendor/custom-model");
    }
    process.env.OPENAI_API_MODE = "responses";
    assert.equal(
      (
        await generateText({
          maxRetries: 0,
          model: getLanguageModel("vendor/custom-model"),
          prompt: "responses",
        })
      ).text,
      "Responses 测试"
    );
    assert.equal(requests[3].path, "/custom/v1/responses");
    assert.equal(requests[3].auth, "Bearer test-only-key");
    assert.equal(requests[3].body.model, "vendor/custom-model");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
