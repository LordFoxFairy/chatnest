// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler memoizes workspace event closures.
"use client";
import {
  FileText,
  Globe,
  Maximize2,
  Minimize2,
  Monitor,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useArtifact } from "@/hooks/use-artifact";
import { useWorkspace, type WorkspaceTab } from "@/hooks/use-workspace";
import { browserWorkspaceEvents } from "@/lib/agent/workspace-events";
import { cn } from "@/lib/utils";
import { BrowserWorkspace } from "./browser-workspace";
import { ConversationSources } from "./conversation-sources";

const tabs = [
  { icon: Monitor, id: "browser", title: "浏览器" },
  { icon: FileText, id: "document", title: "文档" },
  { icon: Globe, id: "sources", title: "来源" },
] as const;

export function Workspace({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const { artifact } = useArtifact();
  const { chatId, messages, status } = useActiveChat();
  const pane = useRef<HTMLElement>(null);
  const previousArtifact = useRef({ id: "init", visible: false });
  const previousChat = useRef(chatId);
  const browserCalls = useRef(new Set<string>());
  const artifactId = artifact.documentId;
  const visible = artifact.isVisible;
  useEffect(() => {
    if (previousChat.current !== chatId) {
      previousChat.current = chatId;
      previousArtifact.current = { id: "init", visible: false };
      browserCalls.current.clear();
      return;
    }
    if (
      visible &&
      (!previousArtifact.current.visible ||
        previousArtifact.current.id !== artifactId)
    ) {
      workspace.show("document");
    }
    if (
      !visible &&
      previousArtifact.current.visible &&
      workspace.tab === "document"
    ) {
      workspace.close();
    }
    previousArtifact.current = { id: artifactId, visible };
  }, [
    chatId,
    visible,
    artifactId,
    workspace.show,
    workspace.tab,
    workspace.close,
  ]);
  useEffect(() => {
    for (const callId of browserWorkspaceEvents(
      messages,
      status === "streaming" || status === "submitted"
    )) {
      if (!browserCalls.current.has(callId)) {
        browserCalls.current.add(callId);
        workspace.show("browser");
      }
    }
  }, [messages, status, workspace.show]);
  useEffect(() => {
    if (!workspace.open) {
      return;
    }
    const close = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
      ) {
        workspace.close();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [workspace.open, workspace.close]);

  const select = (tab: WorkspaceTab) => workspace.update({ tab });
  return (
    <>
      {workspace.open && !workspace.expanded && (
        <hr
          aria-label="调整工作区宽度"
          aria-orientation="vertical"
          aria-valuemax={70}
          aria-valuemin={35}
          aria-valuenow={workspace.width}
          className="relative z-10 hidden w-1 shrink-0 cursor-col-resize bg-border/50 hover:bg-muted-foreground/30 md:block"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              workspace.update({ width: Math.min(70, workspace.width + 5) });
            }
            if (event.key === "ArrowRight") {
              workspace.update({ width: Math.max(35, workspace.width - 5) });
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              return;
            }
            const parent = pane.current?.parentElement?.getBoundingClientRect();
            if (parent) {
              workspace.update({
                width: Math.max(
                  35,
                  Math.min(
                    70,
                    ((parent.right - event.clientX) / parent.width) * 100
                  )
                ),
              });
            }
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
          }}
          tabIndex={0}
        />
      )}
      <aside
        aria-label="工作区"
        className={cn(
          "flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-background",
          !workspace.open && "hidden",
          workspace.expanded
            ? "fixed inset-0 z-50 h-dvh w-full"
            : "fixed inset-0 z-40 h-dvh w-full md:relative md:inset-auto md:z-auto md:w-[var(--workspace-width)]"
        )}
        data-testid="workspace"
        ref={pane}
        style={
          { "--workspace-width": `${workspace.width}%` } as React.CSSProperties
        }
      >
        <div className="flex h-14 shrink-0 items-center gap-1 border-b px-3">
          <div
            aria-label="工作区内容"
            className="flex min-w-0 flex-1 items-center gap-1"
            role="tablist"
          >
            {tabs.map(({ id, title, icon: Icon }) => (
              <button
                aria-controls={`workspace-${id}`}
                aria-selected={workspace.tab === id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs transition-colors",
                  workspace.tab === id
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60"
                )}
                id={`workspace-tab-${id}`}
                key={id}
                onClick={() => select(id)}
                onKeyDown={(event) => {
                  const index = tabs.findIndex((item) => item.id === id);
                  if (
                    ["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                      event.key
                    )
                  ) {
                    event.preventDefault();
                    const next =
                      tabs[
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : (index + (event.key === "ArrowRight" ? 1 : 2)) %
                              tabs.length
                      ].id;
                    select(next);
                    document.getElementById(`workspace-tab-${next}`)?.focus();
                  }
                }}
                role="tab"
                tabIndex={workspace.tab === id ? 0 : -1}
                type="button"
              >
                <Icon className="size-3.5" />
                {title}
              </button>
            ))}
          </div>
          <Button
            aria-label={workspace.expanded ? "收起工作区" : "展开工作区"}
            className="hidden size-8 md:inline-flex"
            onClick={() => workspace.update({ expanded: !workspace.expanded })}
            size="icon"
            variant="ghost"
          >
            {workspace.expanded ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
          <Button
            aria-label="关闭工作区"
            className="size-8"
            onClick={workspace.close}
            size="icon"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div
          aria-labelledby="workspace-tab-browser"
          className={cn(
            "min-h-0 flex-1",
            workspace.tab !== "browser" && "hidden"
          )}
          id="workspace-browser"
          role="tabpanel"
        >
          <BrowserWorkspace
            active={workspace.open && workspace.tab === "browser"}
            key={chatId}
          />
        </div>
        <div
          aria-labelledby="workspace-tab-document"
          className={cn(
            "min-h-0 flex-1",
            workspace.tab !== "document" && "hidden"
          )}
          id="workspace-document"
          role="tabpanel"
        >
          {artifact.documentId === "init" ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <FileText className="mb-4 size-8 text-muted-foreground/50" />
              <h2 className="text-sm font-medium">还没有打开文档</h2>
              <p className="mt-3 max-w-xs text-sm leading-7 text-muted-foreground">
                让 Agent 创建文档，或点击对话里的文档卡片，在这里查看和编辑。
              </p>
            </div>
          ) : (
            children
          )}
        </div>
        <div
          aria-labelledby="workspace-tab-sources"
          className={cn(
            "min-h-0 flex-1",
            workspace.tab !== "sources" && "hidden"
          )}
          id="workspace-sources"
          role="tabpanel"
        >
          <ConversationSources embedded key={chatId} />
        </div>
      </aside>
    </>
  );
}
