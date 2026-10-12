"use client";

import useSWR from "swr";

export type AgentInfo = {
  skills: {
    name: string;
    description: string;
    displayName?: string;
    shortDescription?: string;
  }[];
  servers: {
    id: string;
    name: string;
    status: "configured" | "not_configured";
    tools: string[];
    missingEnvironment: string[];
    keyless?: boolean;
  }[];
  modelConfigured: boolean;
  modelProvider?: "openai" | "gateway";
  uploadsConfigured: boolean;
  limits: { maxSteps: number; timeoutMs: number };
};

async function readInfo(url: string): Promise<AgentInfo> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("暂时无法读取能力配置，请稍后重试。");
  }
  return response.json();
}

export function useAgentInfo(enabled = true) {
  return useSWR<AgentInfo>(
    enabled ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/agent` : null,
    readInfo,
    { dedupingInterval: 15_000, shouldRetryOnError: false }
  );
}
