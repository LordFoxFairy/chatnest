"use client";
import { FileSearch, ScanText, Search } from "lucide-react";
import { type MouseEvent, useCallback } from "react";
export function SuggestedActions({
  onSelect,
}: {
  onSelect: (text: string) => void;
}) {
  const suggestions = [
    {
      icon: Search,
      label: "查找传播线索",
      text: "帮我调查一个知识产品的网上传播线索。目标是：",
    },
    {
      icon: ScanText,
      label: "对照可疑内容",
      text: "帮我对照原作品与可疑内容，区分相似表达、共同知识和仍需核实的部分。原文与候选内容如下：",
    },
    {
      icon: FileSearch,
      label: "整理来源报告",
      text: "把以下线索整理成可复核的报告，保留真实来源、对应片段和未核实事项：",
    },
  ];
  const handleSelect = useCallback(
    (event: MouseEvent<HTMLButtonElement>) =>
      onSelect(event.currentTarget.dataset.prompt ?? ""),
    [onSelect]
  );
  return (
    <div
      className="flex flex-wrap justify-center gap-2 pt-1"
      data-testid="suggested-actions"
    >
      {suggestions.map(({ label, icon: Icon, text }) => (
        <button
          className="flex items-center gap-2 rounded-full border border-border/70 px-3.5 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          data-prompt={text}
          key={label}
          onClick={handleSelect}
          type="button"
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
