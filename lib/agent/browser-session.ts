import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMCPClient, type MCPTransport } from "@ai-sdk/mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createConnection } from "@playwright/mcp";
import { chromium } from "playwright";
import {
  BrowserControl,
  type BrowserMode,
  publicBrowserUrl,
} from "./browser-policy";
import { createBrowserProxy } from "./browser-proxy";

const permitted: Record<string, string[]> = {
  browser_click: ["target", "element", "button", "doubleClick"],
  browser_mouse_click_xy: ["x", "y", "button"],
  browser_mouse_wheel: ["deltaX", "deltaY"],
  browser_navigate: ["url"],
  browser_navigate_back: [],
  browser_press_key: ["key"],
  browser_snapshot: ["depth"],
  browser_type: ["target", "element", "text", "submit", "slowly"],
};
export const browserToolNames = Object.keys(permitted);
export const browserReadTools = ["browser_snapshot"];

export async function createBrowserSession() {
  const proxy = await createBrowserProxy();
  const outputDir = await mkdtemp(
    join(tmpdir(), "research-browser-mcp-")
  ).catch(async (error) => {
    await proxy.close();
    throw error;
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({
      chromiumSandbox: true,
      headless: true,
      ...(process.env.BROWSER_EXECUTABLE_PATH
        ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
        : {}),
      args: [
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
      env: Object.fromEntries(
        ["HOME", "PATH", "TMPDIR", "LANG"].flatMap((name) =>
          process.env[name] ? [[name, process.env[name] as string]] : []
        )
      ),
      proxy: { bypass: "<-loopback>", server: proxy.url },
    });
  } catch (error) {
    await proxy.close();
    await rm(outputDir, { force: true, recursive: true });
    throw error;
  }
  const connectionCleanup: (() => Promise<void>)[] = [];
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: { height: 800, width: 1280 },
    });
    // Non-network navigation must also be blocked (HTTP proxy cannot see file:).
    await context.route("**/*", async (route) => {
      try {
        publicBrowserUrl(route.request().url());
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    const control = new BrowserControl();
    await context.newPage();
    let tail: Promise<unknown> = Promise.resolve();
    let updated = Date.now();
    let title = "新标签页";
    let url = "about:blank";
    let closed = false;
    const serial = <T>(operation: () => Promise<T>): Promise<T> => {
      const next = tail
        .catch(() => undefined)
        .then(() => {
          if (closed) {
            throw new Error("Browser session closed");
          }
          return operation();
        });
      tail = next;
      return next;
    };
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = await createConnection(
      {
        capabilities: ["core", "vision"],
        imageResponses: "omit",
        outputDir,
        outputMaxSize: 10 * 1024 * 1024,
        snapshot: { mode: "full" },
        timeouts: { action: 5000, navigation: 15_000 },
        webmcp: false,
      },
      async () => context
    );
    connectionCleanup.push(() => server.close());
    await server.connect(serverTransport);
    const client = await createMCPClient({
      transport: clientTransport as MCPTransport,
    });
    connectionCleanup.push(() => client.close());
    const tools = await client.tools();
    const activePage = async () => {
      const pages = context.pages().filter((page) => !page.isClosed());
      if (pages.length <= 1) {
        return pages[0];
      }
      const result = await client.callTool({
        arguments: { action: "list" },
        name: "browser_tabs",
        options: { timeout: 5000 },
      });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .filter((part: { type: string; text?: string }) => part.type === "text")
        .map((part: { text?: string }) => part.text ?? "")
        .join("\n");
      const index = text.match(/^- (\d+): \(current\)/m);
      if (!index) {
        throw new Error("Cannot identify active browser tab");
      }
      return pages[Number(index[1])];
    };
    const refresh = async () => {
      const page = await activePage();
      url = page?.url() ?? "about:blank";
      title = (await page?.title().catch(() => "浏览器")) ?? "新标签页";
      updated = Date.now();
    };
    return {
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        control.setMode("paused");
        await Promise.allSettled([
          client.close(),
          server.close(),
          browser.close(),
          proxy.close(),
        ]);
        await rm(outputDir, { force: true, recursive: true });
      },
      context,
      control,
      execute: (
        name: string,
        input: Record<string, unknown>,
        actor: number | "manual",
        signal?: AbortSignal
      ) =>
        serial(async () => {
          signal?.throwIfAborted();
          if (actor === "manual") {
            if (control.mode !== "manual") {
              throw new Error("请先接管浏览器");
            }
          } else {
            control.assertAgent(actor);
          }
          const keys = permitted[name];
          if (!keys) {
            throw new Error("Tool is not allowed");
          }
          const args = Object.fromEntries(
            keys
              .filter((key) => input[key] !== undefined)
              .map((key) => [key, input[key]])
          );
          if (JSON.stringify(args).length > 10_000) {
            throw new Error("Browser input too large");
          }
          if (name === "browser_navigate") {
            args.url = publicBrowserUrl(String(args.url));
          }
          const result = await client.callTool({
            arguments: args,
            name,
            // Do not abandon the underlying browser command on stream abort:
            // takeover must await its actual completion, not an early client rejection.
            options: { timeout: 20_000 },
          });
          await refresh();
          const content = Array.isArray(result.content) ? result.content : [];
          const text = content
            .filter(
              (part: { type: string; text?: string }) => part.type === "text"
            )
            .map((part: { text?: string }) => part.text ?? "")
            .join("\n")
            .slice(0, 16_000);
          if (result.isError) {
            throw new Error(text.slice(0, 2000) || "Browser action failed");
          }
          // Persist DOM observations and actual provenance, not screenshots/base64 or host files.
          return { text, ...(url.startsWith("http") ? { title, url } : {}) };
        }),
      frame: () =>
        serial(async () => {
          const page = await activePage();
          if (!page) {
            return null;
          }
          await refresh();
          return page.screenshot({ timeout: 5000, type: "png" });
        }),
      setMode: async (mode: BrowserMode) => {
        control.setMode(mode);
        // Revocation is immediate; acknowledge takeover only at an operation boundary.
        await tail.catch(() => undefined);
        await refresh();
      },
      state: () => ({
        height: 800,
        mode: control.mode,
        title,
        updated,
        url,
        width: 1280,
      }),
      tools,
    };
  } catch (error) {
    await Promise.allSettled([
      ...connectionCleanup.map((close) => close()),
      browser.close(),
      proxy.close(),
    ]);
    await rm(outputDir, { force: true, recursive: true });
    throw error;
  }
}

export type BrowserSession = Awaited<ReturnType<typeof createBrowserSession>>;
type Entry = {
  owner: string;
  session: Promise<BrowserSession>;
  touched: number;
};
const globalBrowsers = globalThis as typeof globalThis & {
  researchBrowsers?: Map<string, Entry>;
};
const sessions = globalBrowsers.researchBrowsers ?? new Map<string, Entry>();
globalBrowsers.researchBrowsers = sessions;
const idleMs = 20 * 60_000;

export async function getBrowserSession(
  owner: string,
  chatId: string,
  create = false
) {
  const key = `${owner}:${chatId}`;
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.touched > idleMs) {
      sessions.delete(id);
      entry.session.then((session) => session.close()).catch(() => undefined);
    }
  }
  let entry = sessions.get(key);
  if (!entry && create) {
    if (
      sessions.size >= 4 ||
      [...sessions.values()].filter((item) => item.owner === owner).length >= 2
    ) {
      throw new Error("浏览器会话已达上限，请先结束旧会话。");
    }
    entry = { owner, session: createBrowserSession(), touched: now };
    sessions.set(key, entry);
    entry.session.catch(() => {
      if (sessions.get(key) === entry) {
        sessions.delete(key);
      }
    });
    const timer = setInterval(() => {
      const current = sessions.get(key);
      if (!current || current !== entry) {
        clearInterval(timer);
        return;
      }
      if (Date.now() - current.touched > idleMs) {
        sessions.delete(key);
        clearInterval(timer);
        current.session
          .then((session) => session.close())
          .catch(() => undefined);
      }
    }, 60_000);
    timer.unref();
  }
  if (!entry) {
    return null;
  }
  entry.touched = now;
  return await entry.session;
}

export async function closeBrowserSession(owner: string, chatId: string) {
  const key = `${owner}:${chatId}`;
  const entry = sessions.get(key);
  sessions.delete(key);
  await (await entry?.session)?.close();
}
