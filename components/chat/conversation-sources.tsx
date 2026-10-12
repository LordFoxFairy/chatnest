"use client";

import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Search,
  X,
} from "lucide-react";
import { type ChangeEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  collectConversationSources,
  conversationMarkdown,
  sourceListMarkdown,
} from "@/lib/agent/conversation-sources";

export function ConversationSources({
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  embedded = false,
}: {
  open?: boolean;
  onOpenChange?: (value: boolean) => void;
  hideTrigger?: boolean;
  embedded?: boolean;
}) {
  const { messages, chatId } = useActiveChat();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const sources = useMemo(
    () => collectConversationSources(messages),
    [messages]
  );
  const matching = sources.filter((source) =>
    `${source.title} ${source.url}`
      .toLowerCase()
      .includes(query.toLowerCase().trim())
  );
  const changeQuery = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
    []
  );
  const changeOpen = useCallback(
    (value: boolean) => {
      setInternalOpen(value);
      onOpenChange?.(value);
      if (value) {
        setQuery("");
      }
    },
    [onOpenChange]
  );
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sourceListMarkdown(matching));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("无法复制，请打开来源页手动保存链接。");
    }
  }, [matching]);
  const download = useCallback(() => {
    const url = URL.createObjectURL(
      new Blob([conversationMarkdown(messages)], {
        type: "text/markdown;charset=utf-8",
      })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `research-${chatId.slice(0, 8)}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("已导出对话文字与来源清单");
  }, [messages, chatId]);
  if (!messages.length && !embedded) {
    return null;
  }
  const Header = embedded ? "div" : SheetHeader;
  const Title = embedded ? "h2" : SheetTitle;
  const Description = embedded ? "p" : SheetDescription;
  const content = (
    <>
      <Header className="border-b p-5 pr-14">
        <Title className="text-sm font-medium">来源工作区</Title>
        <Description className="mt-2 text-xs leading-6 text-muted-foreground">
          当前对话实际返回的链接。出现链接不等于已核验内容。
        </Description>
        {!embedded && (
          <SheetClose asChild>
            <Button
              aria-label="关闭来源工作区"
              className="absolute top-4 right-4"
              size="icon"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </SheetClose>
        )}
      </Header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
          <input
            aria-label="筛选来源"
            className="h-10 w-full rounded-xl border bg-secondary/30 pr-3 pl-9 text-sm"
            onChange={changeQuery}
            placeholder="按标题或网址筛选…"
            value={query}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {query ? `${matching.length} / ` : ""}
            {sources.length} 条来源
            {sources.length === 200 ? " · 展示上限 200" : ""}
          </span>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg p-1.5 hover:bg-secondary disabled:opacity-40"
            disabled={!matching.length}
            onClick={copy}
            type="button"
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? "已复制" : "复制清单"}
          </button>
        </div>
        <div
          className="min-h-0 flex-1 space-y-3 overflow-y-auto"
          data-testid="source-list"
        >
          {matching.map((source, index) => (
            <a
              className="group block rounded-xl border p-4 transition-colors hover:bg-secondary/50"
              href={source.url}
              key={source.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary text-[10px] tabular-nums">
                  {index + 1}
                </span>
                <span className="truncate">{new URL(source.url).hostname}</span>
                <ExternalLink className="ml-auto size-3.5 shrink-0" />
              </div>
              <h3 className="break-words text-sm font-medium leading-6">
                {source.title}
              </h3>
              <p className="mt-2 break-all text-[11px] leading-5 text-muted-foreground">
                {source.url}
              </p>
              <p className="mt-3 border-t pt-2 text-[10px] text-muted-foreground">
                {source.origins.join(" · ")} · 核验状态未标记
              </p>
            </a>
          ))}
          {!matching.length && (
            <div className="rounded-xl border border-dashed px-5 py-10 text-center">
              <Globe className="mx-auto mb-3 size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium">
                {query ? "没有匹配的来源" : "还没有返回来源"}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {query
                  ? "换一个标题关键词或域名试试。"
                  : "联网工具或模型服务返回来源后，会在这里汇总；不会从回答文字中猜测链接。"}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="border-t p-5">
        <Button
          className="w-full gap-2 rounded-xl"
          onClick={download}
          variant="outline"
        >
          <Download className="size-4" />
          导出对话与来源
        </Button>
        <p className="mt-2 text-center text-[10px] leading-5 text-muted-foreground">
          Markdown 文件，仅保存到本机，不会发给第三方。
        </p>
      </div>
    </>
  );
  if (embedded) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        {content}
      </div>
    );
  }
  return (
    <Sheet onOpenChange={changeOpen} open={open}>
      {!hideTrigger && (
        <SheetTrigger asChild>
          <Button
            aria-label={`来源工作区${sources.length ? `，${sources.length} 条来源` : ""}`}
            className="gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
            variant="ghost"
          >
            <Globe className="size-4" />
            <span className="hidden sm:inline">来源</span>
            {sources.length > 0 && (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums">
                {sources.length}
              </span>
            )}
          </Button>
        </SheetTrigger>
      )}
      <SheetContent
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-[440px]"
        showCloseButton={false}
      >
        {content}
      </SheetContent>
    </Sheet>
  );
}
