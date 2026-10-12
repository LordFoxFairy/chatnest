"use client";

import { AlertCircle, RotateCcw, X } from "lucide-react";
import { useCallback } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import { AgentLibrary } from "./agent-library";

export function ConversationNotice({ onRestore }: { onRestore: () => void }) {
  const { error, clearError, loadError, retryLoad } = useActiveChat();
  const dismiss = useCallback(() => clearError(), [clearError]);
  if (!error && !loadError) {
    return null;
  }
  return (
    <div
      className="mb-3 flex items-start gap-3 rounded-xl border border-border bg-secondary/50 p-3.5"
      data-testid="conversation-error"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {loadError ? "暂时无法打开这段对话" : "这一轮还没有完成"}
        </p>
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
          {(loadError ?? error)?.message.slice(0, 280)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {loadError ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs"
              onClick={retryLoad}
              type="button"
            >
              <RotateCcw className="size-3.5" />
              重新加载
            </button>
          ) : (
            <button
              className="rounded-lg border bg-background px-2.5 py-1.5 text-xs"
              onClick={onRestore}
              type="button"
            >
              恢复刚才的输入
            </button>
          )}
          <AgentLibrary compact label="检查连接" tab="settings" />
        </div>
      </div>
      {!loadError && (
        <button
          aria-label="关闭执行提示"
          className="rounded-lg p-1 hover:bg-secondary"
          onClick={dismiss}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
