import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { dynamicTool, type ToolSet } from "ai";
import { readAgentConfig, resolveHeaders } from "./config";
import { normalizeMcpOutput } from "./mcp-output";
import { buildSkillsPrompt, createSkillTools, discoverSkills } from "./skills";

export async function createAgentRuntime(
  signal: AbortSignal,
  connect: typeof createMCPClient = createMCPClient
) {
  const [config, skills] = await Promise.all([
    readAgentConfig(),
    discoverSkills(),
  ]);
  const clients = new Set<MCPClient>();
  const runSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(config.timeoutMs),
  ]);
  const tools: ToolSet = { ...createSkillTools(skills) };
  const unavailable: string[] = [];
  const close = async () => {
    await Promise.allSettled([...clients].map((client) => client.close()));
    clients.clear();
  };

  try {
    const results = await Promise.allSettled(
      config.servers.map(async (server) => {
        runSignal.throwIfAborted();
        const { headers, missing } = resolveHeaders(server);
        if (missing.length > 0) {
          unavailable.push(`${server.name}: credentials are not configured`);
          return;
        }
        let client: MCPClient | undefined;
        try {
          client = await connect({
            transport: {
              fetch: (input, init) =>
                fetch(input, {
                  ...init,
                  signal: AbortSignal.any([
                    runSignal,
                    AbortSignal.timeout(config.toolTimeoutMs),
                    ...(init?.signal ? [init.signal] : []),
                  ]),
                }),
              headers,
              type: "http",
              url: server.url,
            },
          });
          clients.add(client);
          const discovered = await client.tools();
          runSignal.throwIfAborted();
          const serverTools: ToolSet = {};
          for (const [name, remote] of Object.entries(discovered)) {
            if (!server.allowedTools.includes(name)) {
              continue;
            }
            const alias = `${server.id}__${name}`;
            if (tools[alias]) {
              throw new Error("MCP tool alias collision");
            }
            serverTools[alias] = dynamicTool({
              description: `${server.name}: ${remote.description ?? name}`,
              execute: (input, options) => {
                runSignal.throwIfAborted();
                return Promise.resolve(
                  remote.execute(input, {
                    ...options,
                    abortSignal: AbortSignal.any([
                      runSignal,
                      ...(options.abortSignal ? [options.abortSignal] : []),
                    ]),
                  })
                ).then((output) => {
                  if (
                    output &&
                    typeof output === "object" &&
                    "isError" in output &&
                    output.isError
                  ) {
                    throw new Error(
                      `${server.name} 暂时未能返回结果；可能是限流或访问失败，请稍后重试。`
                    );
                  }
                  return normalizeMcpOutput(server.id, name, output);
                });
              },
              inputSchema: remote.inputSchema,
              needsApproval: !server.autoApproveTools.includes(name),
            });
          }
          Object.assign(tools, serverTools);
        } catch (error) {
          if (runSignal.aborted) {
            throw new Error("MCP setup was cancelled", { cause: error });
          }
          unavailable.push(
            `${server.name}: connection or tool discovery failed`
          );
          if (client) {
            clients.delete(client);
            await client.close().catch(() => undefined);
          }
        }
      })
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      throw failed.reason;
    }
    runSignal.throwIfAborted();
    return {
      close,
      config,
      instructions: `${buildSkillsPrompt(skills)}\nAvailable execution tools: ${Object.keys(tools).join(", ")}\nUnavailable services: ${unavailable.join("; ") || "none"}. Never claim to have used an unavailable service.`,
      signal: runSignal,
      tools,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
