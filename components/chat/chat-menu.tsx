"use client";
import { Check, Globe, Link2, Lock, MoreHorizontal } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import { useWorkspace } from "@/hooks/use-workspace";
import { collectConversationSources } from "@/lib/agent/conversation-sources";

export function ChatMenu() {
  const {
    chatId,
    messages,
    isReadonly,
    visibilityType: initialVisibilityType,
  } = useActiveChat();
  const { visibilityType, setVisibilityType, saving } = useChatVisibility({
    chatId,
    initialVisibilityType,
  });
  const workspace = useWorkspace();
  const count = useMemo(
    () => collectConversationSources(messages).length,
    [messages]
  );
  const openSources = useCallback(
    () => workspace.show("sources"),
    [workspace.show]
  );
  const makePrivate = useCallback(() => {
    setVisibilityType("private");
  }, [setVisibilityType]);
  const makePublic = useCallback(() => {
    setVisibilityType("public");
  }, [setVisibilityType]);
  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      toast.success(
        visibilityType === "private"
          ? "已复制链接，私密对话仅你能访问"
          : "已复制链接，获得链接的人可以查看"
      );
    } catch {
      toast.error("无法复制链接，请从浏览器地址栏复制。");
    }
  }, [chatId, visibilityType]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="对话菜单"
          className="size-9 rounded-full"
          data-testid="chat-menu"
          size="icon"
          variant="ghost"
        >
          <MoreHorizontal className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px] rounded-xl p-1.5"
      >
        <DropdownMenuItem onSelect={copyLink}>
          <Link2 className="size-4" />
          复制对话链接
        </DropdownMenuItem>
        {!isReadonly && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>可见范围</DropdownMenuLabel>
            <DropdownMenuItem disabled={saving} onSelect={makePrivate}>
              <Lock className="size-4" />
              <span>私密，仅自己可访问</span>
              {visibilityType === "private" && (
                <Check className="ml-auto size-4" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={saving} onSelect={makePublic}>
              <Globe className="size-4" />
              <span>公开，获得链接的人可访问</span>
              {visibilityType === "public" && (
                <Check className="ml-auto size-4" />
              )}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openSources}>
          <Globe className="size-4" />
          <span>来源与导出</span>
          {count > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {count}
            </span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
