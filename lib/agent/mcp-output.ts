import { collectSourceLinks } from "./sources";

export function normalizeMcpOutput(
  server: string,
  tool: string,
  output: unknown
) {
  if (
    server !== "exa" ||
    !["web_search_exa", "web_fetch_exa"].includes(tool) ||
    !output ||
    typeof output !== "object"
  ) {
    return output;
  }
  const result = output as {
    isError?: boolean;
    content?: { type: string; text?: string }[];
  };
  if (result.isError || !Array.isArray(result.content)) {
    return output;
  }
  const headers = result.content.flatMap((part) => {
    if (part.type !== "text" || typeof part.text !== "string") {
      return [];
    }
    const text = part.text.slice(0, 120_000);
    // Fetch content includes untrusted page text. Only its first service header
    // is unambiguous; later header-shaped body text must not become provenance.
    const blocks =
      tool === "web_fetch_exa" ? [text] : text.split(/\r?\n\r?\n---\r?\n\r?\n/);
    return blocks.flatMap((block) => {
      const match =
        tool === "web_fetch_exa"
          ? block.match(
              /^# ([^\r\n]+)\r?\nURL: ([^\r\n]+)\r?\n(?:Published: [^\r\n]+\r?\n)?\r?\n/
            )
          : block.match(
              /^Title: ([^\r\n]+)\r?\nURL: ([^\r\n]+)\r?\n(?:Published:|Content:|Author:)/
            );
      return match ? [{ title: match[1], url: match[2] }] : [];
    });
  });
  const sources = collectSourceLinks(headers);
  return sources.length ? { ...result, sources } : output;
}
