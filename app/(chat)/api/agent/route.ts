import { auth } from "@/app/(auth)/auth";
import { readAgentConfig, resolveHeaders } from "@/lib/agent/config";
import { discoverSkills } from "@/lib/agent/skills";
import { getModelConnection } from "@/lib/ai/model-connection";

export async function GET() {
  if (!(await auth())?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [config, skills] = await Promise.all([
      readAgentConfig(),
      discoverSkills(),
    ]);
    return Response.json(
      {
        limits: { maxSteps: config.maxSteps, timeoutMs: config.timeoutMs },
        modelConfigured: getModelConnection().configured,
        modelProvider: getModelConnection().provider,
        servers: config.servers.map((server) => ({
          id: server.id,
          keyless: !Object.keys(server.headers).length,
          missingEnvironment: resolveHeaders(server).missing,
          name: server.name,
          status: resolveHeaders(server).missing.length
            ? "not_configured"
            : "configured",
          tools: server.allowedTools,
        })),
        skills: skills.map(
          ({ name, description, displayName, shortDescription }) => ({
            description,
            displayName,
            name,
            shortDescription,
          })
        ),
        uploadsConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return Response.json(
      { error: "Agent 配置无法读取，请检查配置文件和技能目录。" },
      { status: 500 }
    );
  }
}
