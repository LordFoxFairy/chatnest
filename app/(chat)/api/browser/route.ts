import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { sameOriginBrowserControl } from "@/lib/agent/browser-policy";
import {
  closeBrowserSession,
  getBrowserSession,
} from "@/lib/agent/browser-session";
import { getChatById } from "@/lib/db/queries";

export const maxDuration = 60;
const idSchema = z.string().uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("close") }),
  z.object({
    action: z.literal("mode"),
    mode: z.enum(["manual", "agent", "paused"]),
  }),
  z.object({ action: z.literal("navigate"), url: z.string().max(2048) }),
  z.object({
    action: z.literal("click"),
    x: z.number().min(0).max(1279),
    y: z.number().min(0).max(799),
  }),
  z.object({ action: z.literal("key"), key: z.string().min(1).max(80) }),
  z.object({
    action: z.literal("scroll"),
    deltaY: z.number().min(-1500).max(1500),
  }),
  z.object({ action: z.literal("back") }),
  z.object({ action: z.literal("type"), text: z.string().min(1).max(2000) }),
]);
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

async function authorize(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const id = idSchema.safeParse(
    new URL(request.url).searchParams.get("chatId")
  );
  if (!id.success) {
    return {
      error: Response.json({ error: "Invalid chat ID" }, { status: 400 }),
    };
  }
  const chat = await getChatById({ id: id.data });
  if (chat && chat.userId !== session.user.id) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { chatId: id.data, owner: session.user.id };
}

export async function GET(request: Request) {
  const access = await authorize(request);
  if (access.error) {
    return access.error;
  }
  const enabled = process.env.BROWSER_RUNTIME === "local";
  const session = enabled
    ? await getBrowserSession(access.owner, access.chatId)
    : null;
  if (new URL(request.url).searchParams.get("frame") === "1") {
    const frame = await session?.frame();
    return frame
      ? new Response(new Uint8Array(frame), {
          headers: { ...headers, "Content-Type": "image/png" },
        })
      : new Response(null, { headers, status: 204 });
  }
  return Response.json(
    { enabled, session: session?.state() ?? null },
    { headers }
  );
}

export async function POST(request: Request) {
  if (!sameOriginBrowserControl(request)) {
    return Response.json(
      { error: "Cross-origin control blocked" },
      { status: 403 }
    );
  }
  const access = await authorize(request);
  if (access.error) {
    return access.error;
  }
  if (process.env.BROWSER_RUNTIME !== "local") {
    return Response.json(
      { error: "当前运行环境未启用本地浏览器。" },
      { status: 503 }
    );
  }
  const action = actionSchema.safeParse(await request.json().catch(() => null));
  if (!action.success) {
    return Response.json({ error: "Invalid browser action" }, { status: 400 });
  }
  try {
    const command = action.data;
    if (command.action === "close") {
      await closeBrowserSession(access.owner, access.chatId);
      return Response.json({ enabled: true, session: null }, { headers });
    }
    const session = await getBrowserSession(
      access.owner,
      access.chatId,
      command.action === "start"
    );
    if (!session) {
      return Response.json({ error: "请先启动浏览器。" }, { status: 409 });
    }
    if (command.action === "start") {
      await session.setMode("manual");
    } else if (command.action === "mode") {
      await session.setMode(command.mode);
    } else if (command.action === "navigate") {
      await session.execute("browser_navigate", { url: command.url }, "manual");
    } else if (command.action === "click") {
      await session.execute(
        "browser_mouse_click_xy",
        { x: command.x, y: command.y },
        "manual"
      );
    } else if (command.action === "key") {
      await session.execute(
        "browser_press_key",
        { key: command.key },
        "manual"
      );
    } else if (command.action === "scroll") {
      await session.execute(
        "browser_mouse_wheel",
        { deltaX: 0, deltaY: command.deltaY },
        "manual"
      );
    } else if (command.action === "back") {
      await session.execute("browser_navigate_back", {}, "manual");
    } else if (command.action === "type") {
      await session.execute(
        "browser_type",
        { submit: false, target: ":focus", text: command.text },
        "manual"
      );
    }
    return Response.json(
      { enabled: true, session: session.state() },
      { headers }
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Browser operation failed";
    const userMessage = /public|公网|control|接管|上限|暂停/.test(detail)
      ? detail
      : "浏览器操作失败，请检查网址或重试。";
    return Response.json({ error: userMessage }, { headers, status: 409 });
  }
}
