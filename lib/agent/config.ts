import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const agentConfigSchema = z
  .object({
    maxOutputTokens: z.number().int().min(256).max(16_000).default(8000),
    maxSteps: z.number().int().min(1).max(30).default(12),
    servers: z
      .array(
        z.object({
          allowedTools: z
            .array(z.string().regex(/^[a-zA-Z0-9_-]+$/))
            .default([]),
          autoApproveTools: z.array(z.string()).default([]),
          headers: z.record(z.string(), z.string()).default({}),
          id: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
          name: z.string().min(1).max(80),
          url: z
            .url()
            .refine(
              (value) => new URL(value).protocol === "https:",
              "MCP endpoints must use HTTPS"
            ),
        })
      )
      .max(8)
      .default([]),
    timeoutMs: z.number().int().min(1000).max(240_000).default(240_000),
    toolTimeoutMs: z.number().int().min(1000).max(60_000).default(30_000),
  })
  .superRefine((config, ctx) => {
    const ids = new Set<string>();
    for (const server of config.servers) {
      if (ids.has(server.id)) {
        ctx.addIssue({ code: "custom", message: "Duplicate MCP server id" });
      }
      ids.add(server.id);
      if (
        server.autoApproveTools.some(
          (name) => !server.allowedTools.includes(name)
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Auto-approved tools must be explicitly allowed",
        });
      }
    }
  });

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type ServerConfig = AgentConfig["servers"][number];

export async function readAgentConfig() {
  const filename =
    process.env.AGENT_CONFIG_PATH ??
    path.join(process.cwd(), "config/agent.json");
  // Default assets are explicitly traced in next.config.ts. External config is deployment-mounted.
  return agentConfigSchema.parse(
    JSON.parse(await readFile(/* turbopackIgnore: true */ filename, "utf8"))
  );
}

export function resolveHeaders(
  server: ServerConfig,
  env: Record<string, string | undefined> = process.env
) {
  const missing = new Set<string>();
  const headers = Object.fromEntries(
    Object.entries(server.headers).map(([key, value]) => [
      key,
      value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, name: string) => {
        if (!env[name]?.trim()) {
          missing.add(name);
        }
        return env[name] ?? "";
      }),
    ])
  );
  return { headers, missing: [...missing] };
}
