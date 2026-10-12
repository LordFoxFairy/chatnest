// Server consumers only. Never return credentials in API metadata.
import {
  type ChatModel,
  chatModels,
  DEFAULT_CHAT_MODEL,
  type ModelCapabilities,
} from "./models";

type Environment = Record<string, string | undefined>;

export function getModelConnection(env: Environment = process.env) {
  const provider =
    env.MODEL_PROVIDER ??
    (env.OPENAI_API_KEY || env.OPENAI_BASE_URL || env.OPENAI_MODEL
      ? "openai"
      : "gateway");
  if (provider !== "openai" && provider !== "gateway") {
    throw new Error("MODEL_PROVIDER must be openai or gateway");
  }
  const baseURL = (
    env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const apiMode = env.OPENAI_API_MODE || "chat";
  if (provider === "openai") {
    let parsed: URL;
    try {
      parsed = new URL(baseURL);
    } catch {
      // biome-ignore lint/style/useErrorCause: URL parse errors can contain credentials; report only the field name.
      throw new Error("OPENAI_BASE_URL must be an HTTP(S) API base URL");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      /\/(chat\/completions|responses)$/.test(parsed.pathname)
    ) {
      throw new Error(
        "OPENAI_BASE_URL must be the API base URL, without credentials or endpoint suffix"
      );
    }
    if (apiMode !== "chat" && apiMode !== "responses") {
      throw new Error("OPENAI_API_MODE must be chat or responses");
    }
  }
  return {
    apiMode: apiMode as "chat" | "responses",
    baseURL,
    configured:
      provider === "openai"
        ? Boolean(env.OPENAI_API_KEY?.trim())
        : Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN),
    modelId: env.OPENAI_MODEL?.trim() || "gpt-4.1",
    provider,
  };
}

export function getRuntimeModels(env: Environment = process.env): ChatModel[] {
  const connection = getModelConnection(env);
  return connection.provider === "gateway"
    ? chatModels
    : [
        {
          description: "服务端配置的 OpenAI / 兼容接口模型",
          id: connection.modelId,
          name: connection.modelId,
          provider: "openai",
        },
      ];
}

export function resolveModelId(
  selected: string,
  env: Environment = process.env
) {
  const models = getRuntimeModels(env);
  return models.some((model) => model.id === selected)
    ? selected
    : getModelConnection(env).provider === "openai"
      ? models[0].id
      : DEFAULT_CHAT_MODEL;
}

export function getDirectCapabilities(
  env: Environment = process.env
): Record<string, ModelCapabilities> {
  const { modelId } = getModelConnection(env);
  return {
    [modelId]: {
      reasoning: false,
      tools: env.OPENAI_MODEL_TOOLS !== "0",
      vision: env.OPENAI_MODEL_VISION === "1",
    },
  };
}
