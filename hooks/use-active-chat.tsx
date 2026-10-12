"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { Chat, useChat } from "@ai-sdk/react";
import {
  type ChatInit,
  type ChatTransport,
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatDraft } from "@/hooks/use-chat-draft";
import { buildTaskMessage, type TaskDraft } from "@/lib/agent/task-draft";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import type { Vote } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: VisibilityType;
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  showCreditCardAlert: boolean;
  setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
  startNewChat: () => void;
  startTask: (draft: TaskDraft, useWeb: boolean) => void;
  error: Error | undefined;
  clearError: () => void;
  loadError: Error | undefined;
  retryLoad: () => void;
  searchMode: "auto" | "web";
  setSearchMode: Dispatch<SetStateAction<"auto" | "web">>;
  regenerateAnswer: () => Promise<void>;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

export function ActiveChatProvider({
  children,
  ownerId = "local",
}: {
  children: ReactNode;
  ownerId?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, refreshNewChat] = useState(0);
  const { setDataStream, setWaitingStatus } = useDataStream();
  const { mutate } = useSWRConfig();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef(generateUUID());
  const pendingTask = useRef<{
    chatId: string;
    text: string;
    useWeb: boolean;
  } | null>(null);
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = pendingTask.current?.chatId ?? generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;
  const [searchMode, setSearchMode] = useState<"auto" | "web">("auto");
  const searchModeRef = useRef(searchMode);
  searchModeRef.current = searchMode;
  const regenerationSnapshot = useRef<{
    chatId: string;
    messages: ChatMessage[];
  } | null>(null);

  const [currentModelId, setCurrentModelId] = useState(DEFAULT_CHAT_MODEL);
  const { data: modelCatalog } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    fetcher,
    { dedupingInterval: 3_600_000, revalidateOnFocus: false }
  );
  useEffect(() => {
    const ids: string[] | undefined = modelCatalog?.selectableModelIds;
    if (ids?.length && !ids.includes(currentModelId)) {
      setCurrentModelId(ids[0]);
    }
  }, [modelCatalog, currentModelId]);
  const currentModelIdRef = useRef(currentModelId);
  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const [input, setInput] = useChatDraft(
    `research:draft:${ownerId}:${isNewChat ? "new" : chatId}`
  );
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);

  const {
    data: chatData,
    isLoading,
    error: loadError,
    mutate: reloadChat,
  } = useSWR(
    isNewChat
      ? null
      : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const initialMessages: ChatMessage[] = isNewChat
    ? []
    : (chatData?.messages ?? []);
  const visibility: VisibilityType = isNewChat
    ? "private"
    : (chatData?.visibility ?? "private");

  const chatOptions: ChatInit<ChatMessage> & {
    transport: ChatTransport<ChatMessage>;
  } = {
    generateId: generateUUID,
    id: chatId,
    messages: initialMessages,
    onData: (dataPart) => {
      if (dataPart.type === "data-waiting-status") {
        setWaitingStatus(dataPart.data);
        return;
      }
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onError: (streamError) => {
      if (
        streamError.message?.includes("AI Gateway requires a valid credit card")
      ) {
        setShowCreditCardAlert(true);
      } else if (streamError instanceof ChatbotError) {
        toast({ description: streamError.message, type: "error" });
      } else {
        toast({
          description: streamError.message || "这一轮执行失败，请稍后重试。",
          type: "error",
        });
      }
    },
    onFinish: ({
      isAbort,
      isError,
      isDisconnect,
      finishReason,
      messages: finishedMessages,
    }) => {
      const snapshot = regenerationSnapshot.current;
      // useChat forwards old-instance callbacks through its latest callback refs.
      // The stored question UUID identifies the originating turn, not just the current URL.
      if (
        snapshot?.chatId === chatId &&
        finishedMessages.some(
          (item) =>
            item.role === "user" && item.id === snapshot.messages.at(-2)?.id
        )
      ) {
        if (
          isAbort ||
          isError ||
          isDisconnect ||
          !finishReason ||
          finishReason === "error"
        ) {
          setMessages(snapshot.messages);
        } else {
          mutate(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`,
            (current: Record<string, unknown> | undefined) =>
              current ? { ...current, messages: finishedMessages } : current,
            { revalidate: false }
          );
          const answerId = snapshot.messages.at(-1)?.id;
          mutate<Vote[]>(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`,
            (current) => current?.filter((item) => item.messageId !== answerId),
            { revalidate: false }
          );
        }
        regenerationSnapshot.current = null;
      }
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    transport: new DefaultChatTransport({
      api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);
        const isToolApprovalContinuation =
          lastMessage?.role === "assistant" &&
          lastMessage.parts?.some((part) => {
            const { state } = part as { state?: string };
            return state === "approval-responded" || state === "output-denied";
          });

        return {
          body: {
            id: request.id,
            ...(isToolApprovalContinuation
              ? { messages: request.messages }
              : { message: lastMessage }),
            searchMode: searchModeRef.current,
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibility,
            trigger: request.trigger,
            ...request.body,
          },
        };
      },
    }),
  };

  const chatOptionsRef = useRef(chatOptions);
  chatOptionsRef.current = chatOptions;
  const chatInstanceRef = useRef<Chat<ChatMessage> | null>(null);
  if (chatInstanceRef.current?.id !== chatId) {
    // Isolate SDK instance callbacks, including A -> B -> A navigation.
    // The hook's default latest-ref wrappers otherwise deliver old callbacks to the new instance.
    const instance: Chat<ChatMessage> = new Chat({
      ...chatOptions,
      onData: (part) => {
        if (chatInstanceRef.current === instance) {
          chatOptionsRef.current.onData?.(part);
        }
      },
      onError: (streamError) => {
        if (chatInstanceRef.current === instance) {
          chatOptionsRef.current.onError?.(streamError);
        }
      },
      onFinish: (event) => {
        if (chatInstanceRef.current === instance) {
          chatOptionsRef.current.onFinish?.(event);
        }
      },
      sendAutomaticallyWhen: (event) =>
        chatInstanceRef.current === instance
          ? (chatOptionsRef.current.sendAutomaticallyWhen?.(event) ?? false)
          : false,
      transport: {
        reconnectToStream: (request) =>
          chatOptionsRef.current.transport.reconnectToStream(request),
        sendMessages: (request) =>
          chatOptionsRef.current.transport.sendMessages(request),
      },
    });
    chatInstanceRef.current = instance;
  }
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse,
    error,
    clearError,
  } = useChat<ChatMessage>({ chat: chatInstanceRef.current });

  const regenerateAnswer = useCallback(async () => {
    if (
      status === "streaming" ||
      status === "submitted" ||
      messages.at(-1)?.role !== "assistant"
    ) {
      return;
    }
    const snapshot = { chatId, messages };
    regenerationSnapshot.current = snapshot;
    clearError();
    try {
      await regenerate();
    } catch {
      if (regenerationSnapshot.current === snapshot) {
        setMessages(snapshot.messages);
        regenerationSnapshot.current = null;
      }
    }
  }, [chatId, messages, status, clearError, regenerate, setMessages]);

  const startNewChat = useCallback(() => {
    pendingTask.current = null;
    stop();
    clearError();
    setSearchMode("auto");
    newChatIdRef.current = generateUUID();
    if (isNewChat) {
      setMessages([]);
      setInput("");
    }
    try {
      sessionStorage.removeItem(`research:draft:${ownerId}:new`);
    } catch {
      // Storage can be disabled; opening a new chat still works.
    }
    refreshNewChat((revision) => revision + 1);
    router.push("/");
  }, [router, setMessages, stop, clearError, setInput, ownerId, isNewChat]);
  const startTask = useCallback(
    (draft: TaskDraft, useWeb: boolean) => {
      const text = buildTaskMessage(draft);
      startNewChat();
      pendingTask.current = { chatId: newChatIdRef.current, text, useWeb };
    },
    [startNewChat]
  );
  const retryLoad = useCallback(() => {
    reloadChat();
  }, [reloadChat]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        startNewChat();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [startNewChat]);

  useEffect(() => {
    if (status === "submitted" || status === "ready" || status === "error") {
      setWaitingStatus(undefined);
    }
  }, [status, setWaitingStatus]);

  const hydratedChatId = useRef<string | null>(isNewChat ? chatId : null);

  useEffect(() => {
    if (isNewChat) {
      hydratedChatId.current = chatId;
      return;
    }
    if (chatData?.messages && hydratedChatId.current !== chatId) {
      hydratedChatId.current = chatId;
      setMessages(chatData.messages);
    }
  }, [chatId, chatData?.messages, setMessages, isNewChat]);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      setSearchMode("auto");
      regenerationSnapshot.current = null;
      clearError();
      if (isNewChat) {
        setMessages([]);
      }
    }
  }, [chatId, isNewChat, setMessages, clearError]);

  useEffect(() => {
    const task = pendingTask.current;
    if (!isNewChat || task?.chatId !== chatId) {
      return;
    }
    pendingTask.current = null;
    searchModeRef.current = task.useWeb ? "web" : "auto";
    setSearchMode(searchModeRef.current);
    window.history.replaceState(
      {},
      "",
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
    );
    sendMessage({ parts: [{ text: task.text, type: "text" }], role: "user" });
  }, [chatId, isNewChat, sendMessage]);

  useEffect(() => {
    try {
      const cookieModel = document.cookie
        .split("; ")
        .find((row) => row.startsWith("chat-model="))
        ?.split("=")[1];
      if (cookieModel) {
        setCurrentModelId(decodeURIComponent(cookieModel));
      }
    } catch {
      // An invalid client cookie must not prevent opening a conversation.
    }
  }, []);

  const hasAppendedQueryRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("query");
    if (query && !hasAppendedQueryRef.current) {
      hasAppendedQueryRef.current = true;
      window.history.replaceState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        parts: [{ text: query, type: "text" }],
        role: "user" as const,
      });
    }
  }, [sendMessage, chatId]);

  useAutoResume({
    autoResume: !isNewChat && !!chatData,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isNewChat
    ? false
    : isLoading || Boolean(loadError) || (chatData?.isReadonly ?? false);

  const { data: votes } = useSWR<Vote[]>(
    !isReadonly && messages.length >= 2
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      addToolApprovalResponse,
      chatId,
      clearError,
      currentModelId,
      error,
      input,
      isLoading: !isNewChat && isLoading,
      isReadonly,
      loadError,
      messages,
      regenerate,
      regenerateAnswer,
      retryLoad,
      searchMode,
      sendMessage,
      setCurrentModelId,
      setInput,
      setMessages,
      setSearchMode,
      setShowCreditCardAlert,
      showCreditCardAlert,
      startNewChat,
      startTask,
      status,
      stop,
      visibilityType: visibility,
      votes,
    }),
    [
      chatId,
      error,
      clearError,
      loadError,
      retryLoad,
      searchMode,
      regenerateAnswer,
      startNewChat,
      startTask,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      setInput,
      visibility,
      isReadonly,
      isNewChat,
      isLoading,
      votes,
      currentModelId,
      showCreditCardAlert,
    ]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
