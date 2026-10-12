"use client";
import {
  BookOpen,
  Check,
  CircleHelp,
  Copy,
  ExternalLink,
  Monitor,
  Moon,
  Plug,
  Settings2,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAgentInfo } from "@/hooks/use-agent-info";

type Tab = "skills" | "tools" | "settings";

export function AgentLibrary({
  tab = "skills",
  compact = false,
  label: triggerLabel,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  tab?: Tab;
  compact?: boolean;
  label?: string;
  open?: boolean;
  onOpenChange?: (value: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [activeTab, setActiveTab] = useState<Tab>(tab);
  const { data, error, isLoading, mutate } = useAgentInfo(open);
  const environmentTemplate = [
    "# 添加到现有 .env.local；不要覆盖已有数据库和认证配置",
    "# 直连 OpenAI / 兼容接口",
    "MODEL_PROVIDER=openai",
    "OPENAI_API_KEY=",
    "OPENAI_BASE_URL=https://api.openai.com/v1",
    "OPENAI_MODEL=gpt-4.1",
    "# 默认 Chat Completions；仅服务支持 Responses 时改成 responses",
    "OPENAI_API_MODE=chat",
    "# Vercel 网关是另一种接法，使用时改为 MODEL_PROVIDER=gateway",
    "# AI_GATEWAY_API_KEY=",
    ...new Set(
      data?.servers.flatMap((server) => server.missingEnvironment ?? []) ?? []
    ),
    "# 可选：图片上传",
    "BLOB_READ_WRITE_TOKEN=",
  ]
    .map((line) => (/^[A-Z][A-Z0-9_]*$/.test(line) ? `${line}=` : line))
    .join("\n");
  const handleCopyConfig = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(environmentTemplate);
      toast.success("已复制配置模板，不包含任何真实密钥");
    } catch {
      toast.error("复制失败，请手动选择下方模板");
    }
  }, [environmentTemplate]);
  const handleRefresh = useCallback(() => {
    mutate();
  }, [mutate]);
  const { theme, setTheme } = useTheme();
  const tabs = [
    { icon: Settings2, id: "settings" as const, label: "常规" },
    { icon: Plug, id: "tools" as const, label: "工具连接" },
    { icon: BookOpen, id: "skills" as const, label: "技能" },
  ];
  const current = tabs.find((item) => item.id === tab) ?? tabs[0];
  const Icon = current.icon;
  const handleOpenChange = useCallback(
    (value: boolean) => {
      setInternalOpen(value);
      onOpenChange?.(value);
      if (value) {
        setActiveTab(tab);
      }
    },
    [tab, onOpenChange]
  );
  const handleTab = useCallback(
    (event: MouseEvent<HTMLButtonElement>) =>
      setActiveTab(event.currentTarget.dataset.tab as Tab),
    []
  );
  const handleTheme = useCallback(
    (event: MouseEvent<HTMLButtonElement>) =>
      setTheme(event.currentTarget.dataset.theme ?? "system"),
    [setTheme]
  );
  const handleTabKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const tabIds: Tab[] = ["settings", "tools", "skills"];
      const index = tabIds.indexOf(event.currentTarget.dataset.tab as Tab);
      const delta =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!delta) {
        return;
      }
      event.preventDefault();
      const next = tabIds[(index + delta + tabIds.length) % tabIds.length];
      setActiveTab(next);
      document.getElementById(`agent-tab-${next}`)?.focus();
    },
    []
  );
  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button
            aria-label={triggerLabel ?? current.label}
            className={
              compact
                ? "h-8 rounded-full px-2.5 text-xs text-muted-foreground"
                : "h-10 w-full justify-start gap-3 rounded-lg px-2.5 text-sm font-normal text-sidebar-foreground"
            }
            variant="ghost"
          >
            <Icon className="size-[18px]" />
            <span>{triggerLabel ?? current.label}</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[85dvh] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-[680px]">
        <DialogHeader className="px-6 pt-6 pb-5">
          <DialogTitle className="text-xl">设置</DialogTitle>
          <DialogDescription>
            管理外观、模型与工具连接，以及 Agent 可用的技能。
          </DialogDescription>
        </DialogHeader>
        <div
          aria-label="能力分类"
          className="flex gap-1 border-b px-5"
          role="tablist"
        >
          {tabs.map(({ id, label, icon: TabIcon }) => (
            <button
              aria-controls={`agent-panel-${id}`}
              aria-selected={activeTab === id}
              className={`flex items-center gap-2 border-b-2 px-3 py-3 text-sm ${activeTab === id ? "border-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              data-tab={id}
              id={`agent-tab-${id}`}
              key={id}
              onClick={handleTab}
              onKeyDown={handleTabKey}
              role="tab"
              tabIndex={activeTab === id ? 0 : -1}
              type="button"
            >
              <TabIcon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <div
          aria-labelledby={`agent-tab-${activeTab}`}
          className="min-h-[300px] px-6 py-6"
          id={`agent-panel-${activeTab}`}
          role="tabpanel"
        >
          {!!isLoading && (
            <p className="text-sm text-muted-foreground">正在读取实际配置…</p>
          )}
          {!!error && (
            <p className="text-sm text-destructive" role="alert">
              无法读取配置，请检查服务后重试。
              <button
                className="ml-2 underline underline-offset-4"
                onClick={handleRefresh}
                type="button"
              >
                重新读取
              </button>
            </p>
          )}
          {data && activeTab === "skills" && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">
                Agent
                先看到技能名称和用途，遇到相关任务才读取完整指令。不是固定流水线。
              </p>
              {data.skills.map((skill) => (
                <div className="rounded-xl border p-4" key={skill.name}>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <BookOpen className="size-4 shrink-0" />
                    <span className="break-all">
                      {skill.displayName ?? skill.name}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground">
                      <Check className="size-3" />
                      按需加载
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {skill.shortDescription ?? skill.description}
                  </p>
                  {!!skill.displayName && (
                    <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                      {skill.name}
                    </p>
                  )}
                </div>
              ))}
              {!data.skills.length && <p className="text-sm">暂无技能。</p>}
              <div className="flex gap-2 text-xs leading-5 text-muted-foreground">
                <CircleHelp className="mt-0.5 size-4 shrink-0" />
                <p>目前支持技能指令与文本参考，尚未接入脚本执行沙箱。</p>
              </div>
            </div>
          )}
          {data && activeTab === "tools" && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">
                使用现成 MCP 服务。密钥保留在服务端，不进入聊天或浏览器。
              </p>
              {data.servers.map((server) => (
                <div className="rounded-xl border p-4" key={server.id}>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Plug className="size-4" />
                    {server.name}
                    <span className="ml-auto rounded-full bg-secondary px-2.5 py-1 text-xs font-normal text-muted-foreground">
                      {server.status === "configured"
                        ? server.keyless
                          ? "免密钥 · 连接待验证"
                          : "已配置 · 连接待验证"
                        : "待配置密钥"}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-6 text-muted-foreground">
                    {server.id === "exa"
                      ? "可免密钥搜索和读取网页。免费用量有限，限流或访问失败会在对话中提示。"
                      : "搜索与正文读取由服务提供；只开放明确允许的工具。"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {server.tools.map((name) => (
                      <span
                        className="rounded-md bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground"
                        key={name}
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {!data.servers.length && (
                <p className="text-sm">尚未配置 MCP 服务。</p>
              )}
              <a
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                href="https://exa.ai/docs/get-started/exa-mcp"
                rel="noreferrer"
                target="_blank"
              >
                Exa 官方接入说明
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
          {data && activeTab === "settings" && (
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 text-sm font-medium">外观</h3>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: Sun, id: "light", label: "浅色" },
                    { icon: Moon, id: "dark", label: "深色" },
                    { icon: Monitor, id: "system", label: "跟随系统" },
                  ].map(({ id, label, icon: ThemeIcon }) => (
                    <button
                      aria-pressed={theme === id}
                      className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm ${theme === id ? "border-foreground bg-secondary" : "text-muted-foreground hover:bg-secondary/50"}`}
                      data-theme={id}
                      key={id}
                      onClick={handleTheme}
                      type="button"
                    >
                      <ThemeIcon className="size-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {data.modelProvider === "openai"
                      ? "OpenAI / 兼容接口"
                      : "Vercel 模型网关"}
                  </span>
                  <span>{data.modelConfigured ? "已配置" : "待配置密钥"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">图片上传</span>
                  <span>
                    {data.uploadsConfigured ? "已配置存储" : "待配置存储"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">每轮执行上限</span>
                  <span>
                    {data.limits.maxSteps} 步 / {data.limits.timeoutMs / 1000}{" "}
                    秒
                  </span>
                </div>
              </div>
              <section className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">连接配置</h3>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={handleRefresh}
                    type="button"
                  >
                    刷新状态
                  </button>
                </div>
                <ol className="my-3 space-y-2 text-xs leading-5 text-muted-foreground">
                  <li>1. 在现有 .env.local 填入 API Key、接口地址和模型名。</li>
                  <li>
                    2. 已内置免密钥搜索，也可连接其他 MCP；图片存储是可选项。
                  </li>
                  <li>3. 重启服务，再刷新状态。已配置不代表已经验证连接。</li>
                </ol>
                <p className="mb-3 text-xs leading-5 text-muted-foreground">
                  OpenAI Key 填 OPENAI_API_KEY；自定义接口地址填 OPENAI_BASE_URL
                  （例如 https://你的服务/v1，不包含
                  /chat/completions）；模型名填
                  OPENAI_MODEL，以服务商提供的名称为准。AI_GATEWAY_API_KEY
                  仅用于 Vercel 网关，不能用 OpenAI Key 替代。
                </p>
                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-xs text-muted-foreground">
                    只复制字段，不显示或保存密钥
                  </span>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-secondary"
                    onClick={handleCopyConfig}
                    type="button"
                  >
                    <Copy className="size-3.5" />
                    复制配置模板
                  </button>
                </div>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary p-3 text-[11px] leading-6">
                  {environmentTemplate}
                </pre>
              </section>
              <p className="border-t pt-4 text-xs leading-5 text-muted-foreground">
                连接与限制由 config/agent.json 和 .env.local 管理。当前不支持
                PDF 解析、脚本执行或后台任务恢复。
              </p>
            </div>
          )}
        </div>
        <div className="border-t px-6 py-3 text-xs text-muted-foreground">
          基于 Vercel AI SDK · 能力按需扩展
        </div>
      </DialogContent>
    </Dialog>
  );
}
