// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler memoizes this UI's event closures.
"use client";
import {
  ArrowLeft,
  ArrowUpRight,
  Globe,
  Hand,
  Loader2,
  Pause,
  Play,
  Power,
  RefreshCw,
} from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { useActiveChat } from "@/hooks/use-active-chat";
import { fetcher } from "@/lib/utils";

type BrowserData = {
  enabled: boolean;
  session: null | {
    mode: "agent" | "paused" | "manual";
    url: string;
    title: string;
    updated: number;
    width: number;
    height: number;
  };
};

export function BrowserWorkspace({ active }: { active: boolean }) {
  const { chatId, stop, isReadonly } = useActiveChat();
  const endpoint = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/browser?chatId=${chatId}`;
  const { data, error, mutate } = useSWR<BrowserData>(
    isReadonly ? null : endpoint,
    fetcher,
    { refreshInterval: active ? 2000 : 0, revalidateOnFocus: active }
  );
  const [address, setAddress] = useState("");
  const [textInput, setTextInput] = useState("");
  const [pending, setPending] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [frameError, setFrameError] = useState(false);
  const frameUrl = useRef<string | null>(null);
  const frameAbort = useRef<AbortController | null>(null);
  const actionQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingCount = useRef(0);
  const mounted = useRef(true);
  const session = data?.session;
  const manual = session?.mode === "manual";
  const hasSession = Boolean(session);
  const generation = useRef(chatId);
  generation.current = chatId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setAddress(session?.url.startsWith("http") ? session.url : "");
  }, [session?.url]);
  useEffect(() => {
    if (!active || !hasSession) {
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const controller = new AbortController();
      frameAbort.current = controller;
      try {
        const response = await fetch(`${endpoint}&frame=1`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Frame unavailable");
        }
        if (response.status !== 204) {
          const blob = await response.blob();
          if (disposed) {
            return;
          }
          const next = URL.createObjectURL(blob);
          if (frameUrl.current) {
            URL.revokeObjectURL(frameUrl.current);
          }
          frameUrl.current = next;
          setFrame(next);
          setFrameError(false);
        }
      } catch {
        if (!disposed) {
          setFrameError(true);
        }
      } finally {
        if (!disposed) {
          timer = setTimeout(refresh, 1200);
        }
      }
    };
    refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      frameAbort.current?.abort();
    };
  }, [active, endpoint, hasSession]);
  useEffect(
    () => () => {
      if (frameUrl.current) {
        URL.revokeObjectURL(frameUrl.current);
      }
    },
    []
  );
  const command = useCallback(
    (action: Record<string, unknown>) => {
      const originatingChat = chatId;
      pendingCount.current += 1;
      setPending(true);
      const queued = actionQueue.current
        .catch(() => undefined)
        .then(async () => {
          try {
            if (!mounted.current) {
              return false;
            }
            if (action.action === "mode" && action.mode !== "agent") {
              stop();
            }
            const response = await fetch(endpoint, {
              body: JSON.stringify(action),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            });
            const result = await response.json();
            if (!mounted.current || originatingChat !== generation.current) {
              return false;
            }
            if (!response.ok) {
              throw new Error(result.error ?? "浏览器操作失败");
            }
            await mutate(result, { revalidate: false });
            if (!result.session) {
              setFrame(null);
            }
            return true;
          } catch (failure) {
            if (mounted.current && originatingChat === generation.current) {
              toast.error(
                failure instanceof Error ? failure.message : "浏览器操作失败"
              );
            }
            return false;
          } finally {
            pendingCount.current -= 1;
            if (mounted.current && originatingChat === generation.current) {
              setPending(pendingCount.current > 0);
            }
          }
        });
      actionQueue.current = queued;
      return queued;
    },
    [chatId, endpoint, mutate, stop]
  );

  const navigate = useCallback(() => {
    const url = address.trim();
    if (url) {
      command({
        action: "navigate",
        url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
      });
    }
  }, [address, command]);
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (!manual || !session || pending || frameError) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    command({
      action: "click",
      x: Math.floor(
        ((event.clientX - bounds.left) / bounds.width) * session.width
      ),
      y: Math.floor(
        ((event.clientY - bounds.top) / bounds.height) * session.height
      ),
    });
    event.currentTarget.focus();
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      !manual ||
      frameError ||
      event.key === "Tab" ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    const modifiers = [
      event.ctrlKey && "Control",
      event.metaKey && "Meta",
      event.altKey && "Alt",
      event.shiftKey && event.key.length > 1 && "Shift",
    ].filter(Boolean);
    command({ action: "key", key: [...modifiers, event.key].join("+") });
  };

  if (isReadonly) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        浏览器会话仅对这段对话的拥有者可见。
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {session ? (
        <>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Button
              aria-label="浏览器后退"
              disabled={!manual || pending}
              onClick={() => command({ action: "back" })}
              size="icon"
              variant="ghost"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <form
              className="flex min-w-0 flex-1 items-center rounded-lg bg-secondary/60 px-3"
              onSubmit={(event) => {
                event.preventDefault();
                navigate();
              }}
            >
              <Globe className="mr-2 size-3.5 shrink-0 text-muted-foreground" />
              <input
                aria-label="浏览器网址"
                className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"
                disabled={!manual || pending}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="输入公网网址"
                value={address}
              />
              <button
                aria-label="打开网址"
                className="p-1 disabled:opacity-30"
                disabled={!manual || pending || !address.trim()}
                type="submit"
              >
                <ArrowUpRight className="size-4" />
              </button>
            </form>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-xs">
            <span className="mr-auto flex items-center gap-2 text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${manual ? "bg-amber-500" : session.mode === "agent" ? "bg-emerald-500" : "bg-muted-foreground"}`}
              />
              {pending
                ? "正在切换或操作…"
                : manual
                  ? "你正在控制"
                  : session.mode === "agent"
                    ? "Agent 可控制"
                    : "已暂停"}
            </span>
            {!manual && (
              <Button
                className="h-8 gap-1.5 rounded-lg text-xs"
                disabled={pending}
                onClick={() => command({ action: "mode", mode: "manual" })}
                variant="outline"
              >
                <Hand className="size-3.5" />
                接管
              </Button>
            )}
            {session.mode !== "paused" && (
              <Button
                aria-label="暂停浏览器"
                disabled={pending}
                onClick={() => command({ action: "mode", mode: "paused" })}
                size="icon"
                variant="ghost"
              >
                <Pause className="size-3.5" />
              </Button>
            )}
            {session.mode !== "agent" && (
              <Button
                className="h-8 gap-1.5 rounded-lg text-xs"
                disabled={pending}
                onClick={() => command({ action: "mode", mode: "agent" })}
                variant="outline"
              >
                <Play className="size-3.5" />
                交回 Agent
              </Button>
            )}
            <Button
              aria-label="结束浏览器会话"
              disabled={pending}
              onClick={() => command({ action: "close" })}
              size="icon"
              variant="ghost"
            >
              <Power className="size-3.5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-secondary/25 p-3 sm:p-5">
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="size-3.5" />
              <span className="truncate">{session.title}</span>
              <span className="ml-auto shrink-0">实时快照 · 1280 × 800</span>
            </div>
            {frame ? (
              <button
                aria-label="浏览器画面，接管后可点击和输入"
                className="block w-full overflow-hidden rounded-lg border bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={click}
                onKeyDown={key}
                onWheel={(event) => {
                  if (manual && !pending) {
                    command({
                      action: "scroll",
                      deltaY: Math.max(-1500, Math.min(1500, event.deltaY)),
                    });
                  }
                }}
                type="button"
              >
                {/* A frame from the shared browser, never an iframe of the target URL. */}
                {/* biome-ignore lint/performance/noImgElement: authenticated ephemeral browser screenshot */}
                <img
                  alt="当前浏览器页面"
                  className="block aspect-[8/5] w-full select-none object-contain"
                  draggable={false}
                  src={frame}
                />
              </button>
            ) : (
              <div className="flex aspect-[8/5] items-center justify-center rounded-lg border bg-background text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                正在获取浏览器画面…
              </div>
            )}
            {frameError ? (
              <p className="mt-3 text-xs text-destructive">
                画面暂时不可用，正在重新连接。请勿依赖旧画面操作。
              </p>
            ) : null}
            {manual ? (
              <form
                className="mt-4 flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (textInput.trim()) {
                    command({ action: "type", text: textInput }).then(
                      (sent) => {
                        if (sent) {
                          setTextInput("");
                        }
                      }
                    );
                  }
                }}
              >
                <input
                  aria-label="输入到网页"
                  className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
                  disabled={pending}
                  maxLength={2000}
                  onChange={(event) => setTextInput(event.target.value)}
                  placeholder="先点击网页输入框，再在此输入中文或粘贴文字"
                  value={textInput}
                />
                <Button
                  className="h-8 rounded-lg text-xs"
                  disabled={pending || !textInput.trim()}
                  type="submit"
                  variant="ghost"
                >
                  输入
                </Button>
              </form>
            ) : null}
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              {manual
                ? "点击画面操作网页，支持滚轮和快捷键。中文或粘贴文本可通过上方输入栏填写，不会自动提交表单。"
                : session.mode === "paused"
                  ? "页面已保留。接管或交回 Agent 后继续。"
                  : "浏览器与聊天使用同一会话。Agent 的网页操作需要确认；你可以随时暂停或接管。"}
            </p>
            {session.mode === "agent" && (
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                交回控制权不会自动重启旧任务，请在聊天中发送“继续”。
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border bg-background">
            <Globe className="size-6 text-muted-foreground" />
          </div>
          <h2 className="text-base font-medium">一起浏览，随时接管</h2>
          <p className="mt-3 max-w-xs text-sm leading-7 text-muted-foreground">
            Agent
            的网页操作会显示在这里。你可以查看页面、暂停任务，或接过浏览器自己操作。
          </p>
          <Button
            className="mt-6 gap-2 rounded-full px-5"
            disabled={!data?.enabled || pending}
            onClick={() => command({ action: "start" })}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Globe className="size-4" />
            )}
            启动浏览器
          </Button>
          <p className="mt-4 max-w-xs text-xs leading-6 text-muted-foreground">
            {error
              ? "连接失败，请重试。"
              : data
                ? data.enabled
                  ? "使用独立浏览器，不读取你本机浏览器的登录信息。仅支持公网网页。"
                  : "尚未启用本地浏览器运行环境；请配置 BROWSER_RUNTIME=local。"
                : "正在检查浏览器运行环境…"}
          </p>
          {error ? (
            <Button
              className="mt-2 gap-2"
              onClick={() => mutate()}
              variant="ghost"
            >
              <RefreshCw className="size-3.5" />
              重试
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
