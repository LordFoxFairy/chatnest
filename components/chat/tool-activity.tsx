"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import {
  BookOpen,
  ExternalLink,
  FileText,
  Globe,
  Monitor,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAgentInfo } from "@/hooks/use-agent-info";
import { collectSourceLinks } from "@/lib/agent/sources";
import type { ChatMessage } from "@/lib/types";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "../ai-elements/tool";

export function ToolActivity({
  part,
  approve,
  isReadonly,
  isRunning,
}: {
  part: ToolPart;
  approve: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  isReadonly: boolean;
  isRunning: boolean;
}) {
  const name =
    part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
  const { data: info } = useAgentInfo();
  const input = part.input as
    | { name?: string; query?: string; url?: string }
    | undefined;
  const output = part.output as
    | { displayName?: string; description?: string }
    | undefined;
  const skill =
    name === "loadSkill"
      ? info?.skills.find((item) => item.name === input?.name)
      : undefined;
  const browserTitles: Record<string, string> = {
    browser_click: "点击页面",
    browser_close: "关闭网页",
    browser_navigate: "打开网页",
    browser_press_key: "操作键盘",
    browser_scroll: "滚动页面",
    browser_snapshot: "查看网页",
    browser_tabs: "管理网页标签",
    browser_take_screenshot: "查看页面截图",
    browser_type: "输入内容",
  };
  const shortName = name.split("__").at(-1) ?? name;
  const title =
    name === "loadSkill"
      ? (output?.displayName ?? skill?.displayName ?? "读取调查方法")
      : name === "readSkillResource"
        ? "读取方法参考"
        : name.includes("search")
          ? "搜索网页"
          : name.includes("extract") || name.includes("fetch")
            ? "读取网页正文"
            : (browserTitles[shortName] ?? name);
  const sources = name.includes("__") ? collectSourceLinks(part.output) : [];
  const [open, setOpen] = useState(
    part.state === "approval-requested" || part.state === "output-error"
  );
  const [allSources, setAllSources] = useState(false);
  useEffect(() => {
    if (part.state === "approval-requested" || part.state === "output-error") {
      setOpen(true);
    }
  }, [part.state]);
  const sourceListId = useId();
  const toggleSources = useCallback(() => setAllSources((value) => !value), []);
  const visibleSources = allSources ? sources : sources.slice(0, 3);
  const MethodIcon =
    name === "loadSkill"
      ? BookOpen
      : name === "readSkillResource"
        ? FileText
        : name.includes("search")
          ? Search
          : name.includes("fetch") || name.includes("extract")
            ? Globe
            : name.startsWith("browser__")
              ? Monitor
              : undefined;
  const methodDescription =
    output?.description ??
    skill?.shortDescription ??
    skill?.description ??
    "读取方法指引，再根据目标选择后续操作。";
  const approval = "approval" in part ? part.approval : undefined;
  const handleDeny = useCallback(() => {
    if (approval) {
      approve({ approved: false, id: approval.id, reason: "用户拒绝执行" });
    }
  }, [approve, approval]);
  const handleAllow = useCallback(() => {
    if (approval) {
      approve({ approved: true, id: approval.id });
    }
  }, [approve, approval]);
  const incomplete =
    !isRunning &&
    (part.state === "input-streaming" || part.state === "input-available");
  return (
    <div className="my-1 max-w-full" data-testid="tool-activity">
      <Tool
        className="mb-2 overflow-hidden rounded-xl border-border/60 bg-card/40"
        onOpenChange={setOpen}
        open={open}
      >
        <ToolHeader
          icon={
            MethodIcon ? (
              <MethodIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : undefined
          }
          state={incomplete ? "output-error" : part.state}
          statusLabel={
            incomplete
              ? "未完成"
              : name === "loadSkill" && part.state === "output-available"
                ? "方法已就绪"
                : undefined
          }
          title={title}
          {...(part.type === "dynamic-tool"
            ? { toolName: name, type: "dynamic-tool" }
            : { type: part.type })}
        />
        <ToolContent>
          {name === "loadSkill" && (
            <p className="text-sm leading-6 text-muted-foreground">
              {methodDescription}
            </p>
          )}
          {!!input?.query && (
            <p className="break-words text-sm text-muted-foreground">
              查找：{input.query}
            </p>
          )}
          {!!(incomplete || part.errorText) && (
            <p className="text-sm text-destructive" role="alert">
              {incomplete
                ? "本轮没有收到执行结果，该步骤尚未完成。"
                : part.errorText}
            </p>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer py-1">技术详情</summary>
            <div className="mt-3 space-y-3">
              <ToolInput input={part.input} />
              <ToolOutput errorText={part.errorText} output={part.output} />
            </div>
          </details>
          {part.state === "approval-requested" && approval && !isReadonly && (
            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <span className="mr-auto text-xs text-muted-foreground">
                执行前需要你的确认
              </span>
              <button
                className="rounded-lg border px-3 py-1.5 text-xs"
                onClick={handleDeny}
                type="button"
              >
                拒绝
              </button>
              <button
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs text-background"
                onClick={handleAllow}
                type="button"
              >
                允许执行
              </button>
            </div>
          )}
        </ToolContent>
      </Tool>
      {name === "loadSkill" && part.state === "output-available" && !open && (
        <p className="mb-2 text-xs text-muted-foreground">
          {methodDescription}
        </p>
      )}
      {sources.length > 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-1.5"
          id={sourceListId}
        >
          {visibleSources.map((source) => (
            <a
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              href={source.url}
              key={source.url}
              rel="noopener noreferrer"
              target="_blank"
              title={`${source.title} · ${new URL(source.url).hostname}`}
            >
              <span className="min-w-0 max-w-[200px] truncate">
                {source.title}
              </span>
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ))}
          {sources.length > 3 && (
            <Button
              aria-controls={sourceListId}
              aria-expanded={allSources}
              aria-label={allSources ? "收起来源" : "展开全部来源"}
              className="text-muted-foreground"
              onClick={toggleSources}
              size="xs"
              variant="ghost"
            >
              {allSources ? "收起" : `+${sources.length - 3} 条来源`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
