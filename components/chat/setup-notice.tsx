"use client";

import { Plug, RefreshCw } from "lucide-react";
import { useCallback } from "react";
import { useAgentInfo } from "@/hooks/use-agent-info";
import { AgentLibrary } from "./agent-library";

export function SetupNotice() {
  const { data, error, mutate } = useAgentInfo();
  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);
  if (!error && (!data || data.modelConfigured)) {
    return null;
  }
  return (
    <div
      className="mx-auto mb-4 flex w-full max-w-[752px] items-start gap-3 rounded-2xl border border-border/70 bg-secondary/40 p-3.5"
      data-testid="setup-notice"
    >
      <Plug className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">
          {error ? "暂时无法读取连接状态" : "连接模型后，即可开始对话"}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {error
            ? "不影响你整理草稿。可重试读取实际配置。"
            : "先写下目标也可以，草稿会留在当前浏览器标签页。"}
        </p>
      </div>
      {error ? (
        <button
          aria-label="刷新连接状态"
          className="rounded-lg p-2 hover:bg-secondary"
          onClick={refresh}
          type="button"
        >
          <RefreshCw className="size-4" />
        </button>
      ) : (
        <AgentLibrary compact label="配置连接" tab="settings" />
      )}
    </div>
  );
}
