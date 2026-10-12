"use client";
import { Globe, ImagePlus, ListPlus, Plus, Settings2 } from "lucide-react";
import { type RefObject, useCallback, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useAgentInfo } from "@/hooks/use-agent-info";
import type { ModelCapabilities } from "@/lib/ai/models";
import { fetcher } from "@/lib/utils";
import { AgentLibrary } from "./agent-library";
import { TaskDialog } from "./task-dialog";

export function ComposerMenu({
  fileInputRef,
  selectedModelId,
  busy,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  selectedModelId: string;
  busy: boolean;
}) {
  const { searchMode, setSearchMode } = useActiveChat();
  const { data: info } = useAgentInfo();
  const { data: models } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    fetcher,
    { dedupingInterval: 3_600_000, revalidateOnFocus: false }
  );
  const capabilities: Record<string, ModelCapabilities> | undefined =
    models?.capabilities ?? models;
  const canUpload = Boolean(
    info?.uploadsConfigured && capabilities?.[selectedModelId]?.vision
  );
  const canSearch = Boolean(
    info?.modelConfigured &&
      capabilities?.[selectedModelId]?.tools &&
      info?.servers.some(
        (server) =>
          server.status === "configured" &&
          server.tools.some((name) => name.includes("search"))
      )
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const openTask = useCallback(() => setTaskOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const addImage = useCallback(
    () => fileInputRef.current?.click(),
    [fileInputRef]
  );
  const chooseSearch = useCallback(
    (value: boolean) => setSearchMode(value ? "web" : "auto"),
    [setSearchMode]
  );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="添加附件和工具"
            className="size-9 rounded-full text-foreground hover:bg-secondary"
            data-testid="composer-menu"
            size="icon"
            variant="ghost"
          >
            <Plus className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[280px] rounded-2xl p-2"
          side="top"
        >
          <DropdownMenuItem disabled={busy || !canUpload} onSelect={addImage}>
            <ImagePlus className="size-4" />
            添加图片
          </DropdownMenuItem>
          <p className="px-2 pb-2 text-[11px] leading-5 text-muted-foreground">
            {info?.uploadsConfigured
              ? capabilities?.[selectedModelId]?.vision
                ? "JPEG / PNG，每张不超过 5 MB。"
                : "当前模型不支持图片，请切换模型。"
              : "未连接图片存储，可在设置中配置。"}
          </p>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={searchMode === "web"}
            disabled={busy || !canSearch}
            onCheckedChange={chooseSearch}
          >
            <Globe className="mr-2 size-4" />
            联网搜索
          </DropdownMenuCheckboxItem>
          <p className="px-2 pb-2 text-[11px] leading-5 text-muted-foreground">
            {canSearch
              ? "让 Agent 优先查找公开资料并提供来源。"
              : "需要可用的搜索连接和支持工具的模型。"}
          </p>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={openTask}>
            <ListPlus className="size-4" />
            创建任务
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openSettings}>
            <Settings2 className="size-4" />
            设置
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TaskDialog onOpenChange={setTaskOpen} open={taskOpen} />
      <AgentLibrary
        hideTrigger
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
        tab="settings"
      />
    </>
  );
}
