export type SourceLink = { url: string; title: string };
export function collectSourceLinks(value: unknown): SourceLink[] {
  const links = new Map<string, SourceLink>();
  let visited = 0;
  function visit(node: unknown, depth = 0) {
    visited += 1;
    if (depth > 7 || visited > 250 || links.size >= 12) {
      return;
    }
    if (typeof node === "string") {
      try {
        visit(JSON.parse(node), depth + 1);
      } catch {
        /* Only structured source fields. */
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, depth + 1);
      }
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    const record = node as Record<string, unknown>;
    const raw = record.url ?? record.source_url ?? record.href;
    if (typeof raw === "string") {
      try {
        const url = new URL(raw);
        if (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !links.has(url.href)
        ) {
          links.set(url.href, {
            title:
              typeof record.title === "string"
                ? record.title.slice(0, 180)
                : url.hostname,
            url: url.href,
          });
        }
      } catch {
        /* Ignore invalid URLs. */
      }
    }
    for (const child of Object.values(record)) {
      visit(child, depth + 1);
    }
  }
  visit(value);
  return [...links.values()];
}
