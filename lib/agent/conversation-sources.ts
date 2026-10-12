import type { UIMessage } from "ai";
import { collectSourceLinks, type SourceLink } from "./sources";

export type ConversationSource = SourceLink & { origins: string[] };
export function collectConversationSources(
  messages: UIMessage[]
): ConversationSource[] {
  const collected = new Map<string, ConversationSource>();
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts) {
      let links: SourceLink[] = [];
      let origin = "模型服务引用";
      if (part.type === "source-url") {
        links = collectSourceLinks({ title: part.title, url: part.url });
      } else if (
        (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
        "output" in part &&
        part.state === "output-available"
      ) {
        const name =
          part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
        if (!name.includes("__")) {
          continue;
        }
        origin = name.includes("extract") ? "网页提取工具返回" : "联网工具返回";
        links = collectSourceLinks(part.output);
      }
      for (const link of links) {
        const existing = collected.get(link.url);
        if (existing) {
          if (!existing.origins.includes(origin)) {
            existing.origins.push(origin);
          }
          if (existing.title === new URL(link.url).hostname && link.title) {
            existing.title = link.title;
          }
        } else if (collected.size < 200) {
          collected.set(link.url, { ...link, origins: [origin] });
        }
      }
    }
  }
  return [...collected.values()];
}

function safeLabel(text: string) {
  return text.replace(/[\r\n]/g, " ").replace(/[\\[\]]/g, "\\$&");
}
export function sourceListMarkdown(sources: ConversationSource[]) {
  return sources
    .map(
      (source, index) =>
        `${index + 1}. [${safeLabel(source.title)}](<${source.url}>) — ${source.origins.join("、")}`
    )
    .join("\n");
}
export function conversationMarkdown(messages: UIMessage[]) {
  const content = messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant"
    )
    .map((message) => {
      const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n\n");
      return text
        ? `## ${message.role === "user" ? "用户" : "助手"}\n\n${text}`
        : "";
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
  const sources = collectConversationSources(messages);
  return `# Research 对话记录\n\n> AI 辅助记录，不是法律认定。来源链接需要核对原文；导出不包含隐藏推理、图片文件或完整工具日志。\n\n${content}\n\n## 已返回的来源\n\n${sources.length ? sourceListMarkdown(sources) : "当前对话没有可汇总的来源。"}\n`;
}
