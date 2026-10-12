import { connection } from "next/server";
import {
  getModelConnection,
  getRuntimeModels,
} from "@/lib/ai/model-connection";
import { getCapabilities } from "@/lib/ai/model-service";
import { getAllGatewayModels, isDemo } from "@/lib/ai/models";

export async function GET() {
  await connection();
  const headers = {
    "Cache-Control": "no-store",
  };

  const curatedCapabilities = await getCapabilities();
  if (getModelConnection().provider === "openai") {
    return Response.json(
      {
        capabilities: curatedCapabilities,
        models: getRuntimeModels(),
        selectableModelIds: getRuntimeModels().map((model) => model.id),
      },
      { headers }
    );
  }

  if (isDemo) {
    const models = await getAllGatewayModels();
    const capabilities = Object.fromEntries(
      models.map((m) => [m.id, curatedCapabilities[m.id] ?? m.capabilities])
    );

    return Response.json({ capabilities, models }, { headers });
  }

  return Response.json(curatedCapabilities, { headers });
}
