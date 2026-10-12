"use client";

import { ArrowUp, Globe } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useId,
  useState,
} from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useAgentInfo } from "@/hooks/use-agent-info";
import type { ModelCapabilities } from "@/lib/ai/models";
import { fetcher } from "@/lib/utils";

export function TaskDialog({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted?: () => void;
}) {
  const { startTask, currentModelId, status } = useActiveChat();
  const { data: info, error, isLoading, mutate } = useAgentInfo(open);
  const {
    data: models,
    error: modelsError,
    mutate: reloadModels,
  } = useSWR(
    open ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models` : null,
    fetcher
  );
  const capabilities: Record<string, ModelCapabilities> | undefined =
    models?.capabilities ?? models;
  const canUseTools = Boolean(capabilities?.[currentModelId]?.tools);
  const canSearch =
    canUseTools &&
    Boolean(
      info?.servers.some(
        (server) =>
          server.status === "configured" &&
          server.tools.some((name) => name.includes("search"))
      )
    );
  const [goal, setGoal] = useState("");
  const [materials, setMaterials] = useState("");
  const [method, setMethod] = useState("");
  const [useWeb, setUseWeb] = useState(true);
  const fieldId = useId();
  const skill = canUseTools
    ? info?.skills.find((item) => item.name === method)
    : undefined;
  const busy = status === "submitted" || status === "streaming";
  const fieldClass =
    "[field-sizing:fixed] w-full resize-none rounded-xl bg-background px-3 py-2.5 text-base md:text-sm focus-visible:ring-ring/20";
  const handleGoal = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setGoal(event.target.value),
    []
  );
  const handleMaterials = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      setMaterials(event.target.value),
    []
  );
  const handleMethod = useCallback(
    (value: string) => setMethod(value === "auto" ? "" : value),
    []
  );
  const handleWeb = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setUseWeb(event.target.checked),
    []
  );
  const handleCancel = useCallback(() => onOpenChange(false), [onOpenChange]);
  const handleRetry = useCallback(() => {
    mutate();
    reloadModels();
  }, [mutate, reloadModels]);
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        !goal.trim() ||
        !info?.modelConfigured ||
        !models ||
        error ||
        modelsError
      ) {
        return;
      }
      startTask(
        { goal, materials, method: skill?.displayName ?? skill?.name },
        useWeb && canSearch
      );
      onOpenChange(false);
      setGoal("");
      setMaterials("");
      setMethod("");
      onStarted?.();
    },
    [
      goal,
      materials,
      skill,
      useWeb,
      canSearch,
      info?.modelConfigured,
      models,
      error,
      modelsError,
      startTask,
      onOpenChange,
      onStarted,
    ]
  );
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[540px]">
        <DialogHeader className="shrink-0 px-6 pb-4 pt-6 pr-12">
          <DialogTitle>创建任务</DialogTitle>
          <DialogDescription>
            将在新对话中开始，你可以继续补充要求或停止。
          </DialogDescription>
        </DialogHeader>
        {!!isLoading && (
          <p className="px-6 pb-3 text-xs text-muted-foreground">
            正在读取可用方法与连接…
          </p>
        )}
        {!!(error || modelsError) && (
          <p className="px-6 pb-3 text-xs text-destructive" role="alert">
            暂时无法读取能力配置。
            <button
              className="ml-2 underline"
              onClick={handleRetry}
              type="button"
            >
              重试
            </button>
          </p>
        )}
        <form className="flex min-h-0 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-6 pb-5">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`${fieldId}-goal`}
              >
                任务目标
              </label>
              <Textarea
                autoFocus
                className={`${fieldClass} h-28 min-h-24`}
                id={`${fieldId}-goal`}
                maxLength={8000}
                onChange={handleGoal}
                placeholder="你想查清什么？例如：寻找这篇文章的转载线索，核对疑似复制内容并给出来源。"
                required
                rows={4}
                value={goal}
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`${fieldId}-materials`}
              >
                参考材料{" "}
                <span className="font-normal text-muted-foreground">
                  （可选）
                </span>
              </label>
              <Textarea
                className={`${fieldClass} h-20`}
                id={`${fieldId}-materials`}
                maxLength={16_000}
                onChange={handleMaterials}
                placeholder="粘贴原文链接、内容片段或需要关注的范围。"
                rows={2}
                value={materials}
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`${fieldId}-method`}
              >
                调查方式
              </label>
              <Select
                disabled={!canUseTools}
                onValueChange={handleMethod}
                value={method || "auto"}
              >
                <SelectTrigger
                  aria-describedby={`${fieldId}-method-help`}
                  className="h-10 w-full rounded-xl bg-background"
                  id={`${fieldId}-method`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="auto">根据目标自动选择</SelectItem>
                  {info?.skills.map((item) => (
                    <SelectItem key={item.name} value={item.name}>
                      {item.displayName ?? item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p
                className="text-xs leading-5 text-muted-foreground"
                id={`${fieldId}-method-help`}
              >
                {models
                  ? canUseTools
                    ? (skill?.shortDescription ??
                      skill?.description ??
                      "Agent 会选择合适的方法，并在使用时说明用途。")
                    : "当前模型不支持工具，请在对话中切换模型后再使用调查方式。"
                  : "正在读取模型能力…"}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={useWeb && canSearch}
                className="size-4 accent-foreground"
                disabled={!canSearch}
                onChange={handleWeb}
                type="checkbox"
              />
              <Globe className="size-4 text-muted-foreground" />
              优先联网查找资料
            </label>
            {!isLoading && !!models && !canSearch && (
              <p className="text-xs text-muted-foreground">
                暂时无法联网查找，请检查工具连接和模型能力。
              </p>
            )}
            {info && !info.modelConfigured && (
              <p className="text-xs text-destructive" role="alert">
                请先在设置中连接模型，任务才能开始。
              </p>
            )}
            {!!busy && (
              <p className="text-xs text-muted-foreground">
                开始新任务会停止当前回复，已有内容仍保留在原对话。
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-background px-6 py-4">
            <Button onClick={handleCancel} type="button" variant="ghost">
              取消
            </Button>
            <Button
              className="rounded-full"
              disabled={
                !goal.trim() ||
                !info?.modelConfigured ||
                !models ||
                !!error ||
                !!modelsError
              }
              type="submit"
            >
              开始任务
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
