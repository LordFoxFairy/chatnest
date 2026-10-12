"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  ArrowUpIcon,
  BrainIcon,
  EyeIcon,
  Globe,
  LockIcon,
  WrenchIcon,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useWindowSize } from "usehooks-ts";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useAgentInfo } from "@/hooks/use-agent-info";
import { MAX_MESSAGE_CHARACTERS } from "@/lib/agent/input-limits";
import {
  type ChatModel,
  chatModels,
  DEFAULT_CHAT_MODEL,
  type ModelCapabilities,
} from "@/lib/ai/models";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn, fetcher } from "@/lib/utils";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ComposerMenu } from "./composer-menu";
import { StopIcon } from "./icons";
import { PreviewAttachment } from "./preview-attachment";
import type { VisibilityType } from "./visibility-selector";

function setCookie(name: string, value: string) {
  const maxAge = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: needed for client-side cookie setting
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
}

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages: _messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType: _selectedVisibilityType,
  selectedModelId,
  onModelChange: _onModelChange,
  editingMessage,
  onCancelEdit,
  isLoading: _isLoading,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage:
    | UseChatHelpers<ChatMessage>["sendMessage"]
    | (() => Promise<void>);
  className?: string;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  editingMessage?: ChatMessage | null;
  onCancelEdit?: () => void;
  isLoading?: boolean;
}) {
  const { data: agentInfo } = useAgentInfo();
  const { searchMode, setSearchMode } = useActiveChat();
  const cancelSearch = useCallback(
    () => setSearchMode("auto"),
    [setSearchMode]
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const hasAutoFocused = useRef(false);
  useEffect(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const liveChatId = useRef(chatId);
  const previousUploadChatId = useRef(chatId);
  liveChatId.current = chatId;
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  useEffect(() => {
    if (previousUploadChatId.current !== chatId) {
      previousUploadChatId.current = chatId;
      setUploadQueue([]);
    }
  }, [chatId]);
  const handleInput = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value),
    [setInput]
  );

  const submitForm = useCallback(() => {
    if (attachments.length > 15) {
      toast.error("一条消息最多添加 15 张图片，请移除多余图片。");
      return;
    }
    if (input.length > MAX_MESSAGE_CHARACTERS) {
      toast.error(
        `单条消息最多 ${MAX_MESSAGE_CHARACTERS.toLocaleString()} 字符，请拆分内容后发送。`
      );
      return;
    }
    if (editingMessage) {
      (sendMessage as () => Promise<void>)();
      return;
    }
    window.history.pushState(
      {},
      "",
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
    );

    sendMessage({
      parts: [
        ...attachments.map((attachment) => ({
          filename: attachment.name,
          mediaType: attachment.contentType,
          type: "file" as const,
          url: attachment.url,
        })),
        ...(input.trim() ? [{ text: input, type: "text" as const }] : []),
      ],
      role: "user",
    });

    setAttachments([]);
    setInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    editingMessage,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    width,
    chatId,
  ]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!agentInfo?.uploadsConfigured) {
        toast.error("图片上传尚未配置，请在设置中查看存储连接说明。");
        return;
      }
      if (
        !["image/jpeg", "image/png"].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      ) {
        toast.error("仅支持不超过 5 MB 的 JPEG 或 PNG 图片。");
        return;
      }
      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/files/upload`,
          {
            body: formData,
            method: "POST",
          }
        );

        if (response.ok) {
          const data = await response.json();
          const { url, pathname, contentType } = data;

          return {
            contentType,
            name: file.name || pathname,
            url,
          };
        }
        const { error } = await response.json();
        toast.error(error);
      } catch {
        toast.error("图片上传失败，请检查连接后重试。");
      }
    },
    [agentInfo?.uploadsConfigured]
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const uploadChatId = chatId;
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      if (attachments.length + files.length > 15) {
        toast.error("一条消息最多添加 15 张图片。");
        return;
      }

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        if (liveChatId.current !== uploadChatId) {
          return;
        }
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch {
        toast.error("图片上传失败，请稍后重试。");
      } finally {
        if (liveChatId.current === uploadChatId) {
          setUploadQueue([]);
        }
      }
    },
    [chatId, attachments.length, setAttachments, uploadFile]
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      const uploadChatId = chatId;
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith("image/")
      );

      if (imageItems.length === 0) {
        return;
      }

      event.preventDefault();
      if (uploadQueue.length) {
        toast.error("图片仍在上传，请稍候。");
        return;
      }
      if (status !== "ready" && status !== "error") {
        toast.error("请等待当前回复完成后再添加图片。");
        return;
      }
      if (attachments.length + imageItems.length > 15) {
        toast.error("一条消息最多添加 15 张图片。");
        return;
      }

      setUploadQueue((prev) => [...prev, "粘贴的图片"]);

      try {
        const uploadPromises = imageItems
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null)
          .map((file) => uploadFile(file));

        const uploadedAttachments = await Promise.all(uploadPromises);
        if (liveChatId.current !== uploadChatId) {
          return;
        }
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) =>
            attachment !== undefined &&
            attachment.url !== undefined &&
            attachment.contentType !== undefined
        );

        setAttachments((curr) => [
          ...curr,
          ...(successfullyUploadedAttachments as Attachment[]),
        ]);
      } catch {
        toast.error("粘贴的图片上传失败，请稍后重试。");
      } finally {
        if (liveChatId.current === uploadChatId) {
          setUploadQueue([]);
        }
      }
    },
    [
      chatId,
      uploadQueue.length,
      attachments.length,
      status,
      setAttachments,
      uploadFile,
    ]
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.addEventListener("paste", handlePaste);
    return () => textarea.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleCancelEditMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      onCancelEdit?.();
    },
    [onCancelEdit]
  );

  const handlePromptSubmit = useCallback(() => {
    if (!input.trim() && attachments.length === 0) {
      return;
    }
    if (status === "ready" || status === "error") {
      submitForm();
    } else {
      toast.error("请等待当前回复完成，或点击停止。");
    }
  }, [attachments.length, input, status, submitForm]);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape" && editingMessage && onCancelEdit) {
        e.preventDefault();
        onCancelEdit();
      }
    },
    [editingMessage, onCancelEdit]
  );

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {editingMessage && onCancelEdit ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>正在修改消息 · 发送后会重新生成回复</span>
          <button
            className="rounded px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            onMouseDown={handleCancelEditMouseDown}
            type="button"
          >
            取消
          </button>
        </div>
      ) : null}

      <input
        accept="image/jpeg,image/png"
        className="pointer-events-none fixed -top-4 -left-4 size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <PromptInput
        className="[&>div]:rounded-[24px] [&>div]:border [&>div]:border-border [&>div]:bg-card [&>div]:shadow-[var(--shadow-composer)] [&>div]:transition-shadow [&>div]:duration-200 [&>div]:ring-0! [&>div]:focus-within:border-foreground/25! [&>div]:focus-within:shadow-[var(--shadow-composer-focus)]"
        onSubmit={handlePromptSubmit}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            className="flex w-full self-start flex-row gap-2 overflow-x-auto px-3 pt-3 no-scrollbar"
            data-testid="attachments-preview"
          >
            {attachments.map((attachment) => (
              <AttachmentPreviewItem
                attachment={attachment}
                fileInputRef={fileInputRef}
                key={attachment.url}
                setAttachments={setAttachments}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                attachment={{
                  contentType: "",
                  name: filename,
                  url: "",
                }}
                isUploading={true}
                key={filename}
              />
            ))}
          </div>
        )}
        <PromptInputTextarea
          aria-label="消息输入框"
          className="min-h-[56px] text-[16px] leading-relaxed px-5 pt-4 pb-2 placeholder:text-muted-foreground"
          data-testid="multimodal-input"
          onChange={handleInput}
          onKeyDown={handleTextareaKeyDown}
          placeholder={editingMessage ? "修改消息…" : "询问任何问题"}
          ref={textareaRef}
          value={input}
        />
        <PromptInputFooter className="px-3 pb-3">
          <PromptInputTools>
            <ComposerMenu
              busy={
                status === "submitted" ||
                status === "streaming" ||
                uploadQueue.length > 0
              }
              fileInputRef={fileInputRef}
              selectedModelId={selectedModelId}
            />
            {searchMode === "web" && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs"
                data-testid="search-mode-chip"
              >
                <Globe className="size-3.5" />
                联网搜索
                <button
                  aria-label="取消联网搜索"
                  className="rounded-full p-0.5 hover:bg-background"
                  onClick={cancelSearch}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
          </PromptInputTools>

          {status === "submitted" || status === "streaming" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              aria-label="发送消息"
              className={cn(
                "h-9 w-9 rounded-full transition-all duration-200",
                input.trim() || attachments.length > 0
                  ? "bg-foreground text-background hover:opacity-85 active:scale-95"
                  : "bg-muted text-muted-foreground/25 cursor-not-allowed"
              )}
              data-testid="send-button"
              disabled={
                (!input.trim() && attachments.length === 0) ||
                uploadQueue.length > 0
              }
              status={status}
              variant="secondary"
            >
              <ArrowUpIcon className="size-4" />
            </PromptInputSubmit>
          )}
        </PromptInputFooter>
      </PromptInput>
      {input.length >= MAX_MESSAGE_CHARACTERS * 0.8 && (
        <p
          aria-live="polite"
          className={cn(
            "px-2 text-right text-xs",
            input.length > MAX_MESSAGE_CHARACTERS
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {input.length.toLocaleString()} /{" "}
          {MAX_MESSAGE_CHARACTERS.toLocaleString()} 字符
          {input.length > MAX_MESSAGE_CHARACTERS ? " · 请拆分后发送" : ""}
        </p>
      )}
    </div>
  );
}

export const MultimodalInput = PureMultimodalInput;

function PureAttachmentPreviewItem({
  attachment,
  fileInputRef,
  setAttachments,
}: {
  attachment: Attachment;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
}) {
  const handleRemove = useCallback(() => {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((a) => a.url !== attachment.url)
    );
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [attachment.url, fileInputRef, setAttachments]);

  return <PreviewAttachment attachment={attachment} onRemove={handleRemove} />;
}

const AttachmentPreviewItem = memo(PureAttachmentPreviewItem);

function ModelSelectorOption({
  capabilities,
  curated,
  model,
  onModelChange,
  selectedModelId,
  setOpen,
}: {
  capabilities: Record<string, ModelCapabilities> | undefined;
  curated: boolean;
  model: ChatModel;
  onModelChange?: (modelId: string) => void;
  selectedModelId: string;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const logoProvider = model.provider;
  const maybeWithTooltip = (icon: ReactNode, label: string) => {
    if (!curated) {
      return icon;
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{icon}</span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  };
  const handleSelect = useCallback(() => {
    if (!curated) {
      return;
    }
    onModelChange?.(model.id);
    setCookie("chat-model", model.id);
    setOpen(false);
    setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>("[data-testid='multimodal-input']")
        ?.focus();
    }, 50);
  }, [curated, model.id, onModelChange, setOpen]);

  const option = (
    <ModelSelectorItem
      aria-disabled={!curated}
      className={cn(
        "flex w-full transition-colors",
        model.id === selectedModelId &&
          "border-b border-dashed border-foreground/50",
        curated
          ? "data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
          : "cursor-not-allowed opacity-40 data-[selected=true]:bg-transparent data-[selected=true]:opacity-60 data-[selected=true]:ring-1 data-[selected=true]:ring-muted-foreground/30 data-[selected=true]:ring-inset"
      )}
      onSelect={handleSelect}
      value={model.id}
    >
      <ModelSelectorLogo provider={logoProvider} />
      <ModelSelectorName>{model.name}</ModelSelectorName>
      <div className="ml-auto flex items-center gap-2 text-foreground/70">
        {capabilities?.[model.id]?.tools
          ? maybeWithTooltip(
              <WrenchIcon className="size-3.5" />,
              "Supports tool use"
            )
          : null}
        {capabilities?.[model.id]?.vision
          ? maybeWithTooltip(<EyeIcon className="size-3.5" />, "支持图片")
          : null}
        {capabilities?.[model.id]?.reasoning
          ? maybeWithTooltip(<BrainIcon className="size-3.5" />, "支持推理")
          : null}
        {!curated && <LockIcon className="size-3 text-muted-foreground/50" />}
      </div>
    </ModelSelectorItem>
  );

  if (curated) {
    return option;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="w-full cursor-not-allowed">{option}</div>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        此模型尚未在服务端开放。
      </TooltipContent>
    </Tooltip>
  );
}

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    fetcher,
    { dedupingInterval: 3_600_000, revalidateOnFocus: false }
  );

  const capabilities: Record<string, ModelCapabilities> | undefined =
    modelsData?.capabilities ?? modelsData;
  const dynamicModels: ChatModel[] | undefined = modelsData?.models;
  const activeModels = dynamicModels ?? chatModels;

  const selectedModel =
    activeModels.find((m: ChatModel) => m.id === selectedModelId) ??
    activeModels.find((m: ChatModel) => m.id === DEFAULT_CHAT_MODEL) ??
    activeModels[0];
  const { provider } = selectedModel;

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button
          aria-label="选择模型"
          className="h-10 max-w-[240px] justify-between gap-2 rounded-xl px-2 text-[17px] font-medium text-foreground transition-colors hover:bg-secondary"
          data-testid="model-selector"
          variant="ghost"
        >
          {provider ? <ModelSelectorLogo provider={provider} /> : null}
          <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent commandDefaultValue={selectedModel.id}>
        <ModelSelectorInput placeholder="搜索模型…" />
        <ModelSelectorList>
          {(() => {
            const curatedIds = new Set<string>(
              modelsData?.selectableModelIds ?? chatModels.map((m) => m.id)
            );
            const allModels = modelsData?.selectableModelIds
              ? activeModels
              : dynamicModels
                ? [
                    ...chatModels,
                    ...dynamicModels.filter((m) => !curatedIds.has(m.id)),
                  ]
                : chatModels;

            const grouped: Record<
              string,
              { model: ChatModel; curated: boolean }[]
            > = {};
            for (const model of allModels) {
              const key = curatedIds.has(model.id)
                ? "_available"
                : model.provider;
              if (!grouped[key]) {
                grouped[key] = [];
              }
              grouped[key].push({ curated: curatedIds.has(model.id), model });
            }

            const sortedKeys = Object.keys(grouped).sort((a, b) => {
              if (a === "_available") {
                return -1;
              }
              if (b === "_available") {
                return 1;
              }
              return a.localeCompare(b);
            });

            const providerNames: Record<string, string> = {
              alibaba: "Alibaba",
              anthropic: "Anthropic",
              "arcee-ai": "Arcee AI",
              bytedance: "ByteDance",
              cohere: "Cohere",
              deepseek: "DeepSeek",
              google: "Google",
              inception: "Inception",
              kwaipilot: "Kwaipilot",
              meituan: "Meituan",
              meta: "Meta",
              minimax: "MiniMax",
              mistral: "Mistral",
              moonshotai: "Moonshot",
              morph: "Morph",
              nvidia: "Nvidia",
              openai: "OpenAI",
              perplexity: "Perplexity",
              "prime-intellect": "Prime Intellect",
              xai: "xAI",
              xiaomi: "Xiaomi",
              zai: "Zai",
            };

            return sortedKeys.map((key) => (
              <ModelSelectorGroup
                heading={
                  key === "_available"
                    ? "可选模型"
                    : (providerNames[key] ?? key)
                }
                key={key}
              >
                {grouped[key].map(({ model, curated }) => (
                  <ModelSelectorOption
                    capabilities={capabilities}
                    curated={curated}
                    key={model.id}
                    model={model}
                    onModelChange={onModelChange}
                    selectedModelId={selectedModel.id}
                    setOpen={setOpen}
                  />
                ))}
              </ModelSelectorGroup>
            ));
          })()}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

export const ModelSelectorCompact = memo(PureModelSelectorCompact);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      stop();
      setMessages((messages) => messages);
    },
    [setMessages, stop]
  );

  return (
    <Button
      aria-label="停止生成"
      className="h-9 w-9 rounded-full bg-foreground p-1 text-background transition-all duration-200 hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/25 disabled:cursor-not-allowed"
      data-testid="stop-button"
      onClick={handleClick}
      type="button"
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
