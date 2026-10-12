"use client";

import { MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { fetcher } from "@/lib/utils";
import type { ChatHistory } from "./sidebar-history";

export function ChatSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.isComposing
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const { data, error, isLoading, mutate } = useSWR<ChatHistory>(
    open
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?limit=30&search=${encodeURIComponent(debounced)}`
      : null,
    fetcher,
    { shouldRetryOnError: false }
  );
  const changeQuery = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
    []
  );
  const select = useCallback(() => {
    setOpen(false);
    setOpenMobile(false);
  }, [setOpenMobile]);
  const retry = useCallback(() => {
    mutate();
  }, [mutate]);
  const openChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) {
      setQuery("");
      setDebounced("");
    }
  }, []);
  return (
    <Dialog onOpenChange={openChange} open={open}>
      <DialogTrigger asChild>
        <SidebarMenuButton
          aria-label="搜索对话"
          className="h-10 gap-3 rounded-lg px-2.5 text-sm"
        >
          <Search className="size-[18px]" />
          <span>搜索对话</span>
          <span className="ml-auto text-[10px] text-muted-foreground">⌘ K</span>
        </SidebarMenuButton>
      </DialogTrigger>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[560px]">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle>搜索对话</DialogTitle>
          <DialogDescription>
            检索你的全部历史标题，不局限于侧栏已加载的对话。
          </DialogDescription>
        </DialogHeader>
        <div className="relative mx-5 mb-4">
          <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
          <input
            aria-label="搜索历史标题"
            autoComplete="off"
            autoFocus
            className="h-10 w-full rounded-xl border bg-secondary/30 pr-3 pl-9 text-sm"
            maxLength={100}
            onChange={changeQuery}
            placeholder="输入标题关键词…"
            value={query}
          />
        </div>
        <div
          aria-live="polite"
          className="max-h-[min(50dvh,400px)] min-h-[180px] overflow-y-auto border-t px-3 py-3"
        >
          {isLoading || query.trim() !== debounced ? (
            <p className="px-3 py-5 text-sm text-muted-foreground">正在查找…</p>
          ) : error ? (
            <div className="px-3 py-5 text-sm text-muted-foreground">
              暂时无法读取历史。
              <button className="ml-2 underline" onClick={retry} type="button">
                重试
              </button>
            </div>
          ) : data?.chats.length ? (
            <ul>
              {data.chats.map((chat) => (
                <li key={chat.id}>
                  <Link
                    className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-secondary focus-visible:bg-secondary"
                    href={`/chat/${chat.id}`}
                    onClick={select}
                  >
                    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {chat.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(chat.createdAt).toLocaleDateString("zh-CN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-8 text-center">
              <p className="text-sm">
                {debounced ? "没有匹配的对话" : "还没有历史对话"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {debounced
                  ? "换一个标题关键词试试；目前不搜索消息正文。"
                  : "开始一次对话后，可在这里找回。"}
              </p>
            </div>
          )}
        </div>
        <div className="border-t px-5 py-3 text-[11px] text-muted-foreground">
          {data?.hasMore
            ? "匹配较多，显示前 30 条；可补充关键词缩小范围。"
            : "仅搜索当前账号的标题 · Tab 选择 · Enter 打开 · Esc 关闭"}
        </div>
      </DialogContent>
    </Dialog>
  );
}
