"use client";
import { RotateCcw } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import {
  MessageAction as Action,
  MessageActions as Actions,
} from "../ai-elements/message";
import { CopyIcon, PencilEditIcon, ThumbDownIcon, ThumbUpIcon } from "./icons";

export function PureMessageActions({
  chatId,
  message,
  vote,
  isLoading,
  onEdit,
  onRegenerate,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  onEdit?: () => void;
  onRegenerate?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [, copyToClipboard] = useCopyToClipboard();
  const [savingVote, setSavingVote] = useState(false);
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const handleCopy = useCallback(async () => {
    if (!text) {
      toast.error("这条消息没有可复制的正文。");
      return;
    }
    if (await copyToClipboard(text)) {
      toast.success("已复制正文");
    } else {
      toast.error("无法访问剪贴板，请手动选择正文复制。");
    }
  }, [copyToClipboard, text]);
  const saveVote = useCallback(
    async (type: "up" | "down") => {
      setSavingVote(true);
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote`,
          {
            body: JSON.stringify({ chatId, messageId: message.id, type }),
            headers: { "Content-Type": "application/json" },
            method: "PATCH",
          }
        );
        if (!response.ok) {
          throw new Error("Feedback was not saved");
        }
        await mutate<Vote[]>(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`,
          (current) => [
            ...(current ?? []).filter((item) => item.messageId !== message.id),
            { chatId, isUpvoted: type === "up", messageId: message.id },
          ],
          { revalidate: false }
        );
        toast.success("已保存反馈");
      } catch {
        toast.error("反馈没有保存，请稍后重试。");
      } finally {
        setSavingVote(false);
      }
    },
    [chatId, message.id, mutate]
  );
  const handleUpvote = useCallback(() => {
    saveVote("up");
  }, [saveVote]);
  const handleDownvote = useCallback(() => {
    saveVote("down");
  }, [saveVote]);
  if (isLoading) {
    return null;
  }
  const visibility =
    "transition-opacity duration-150 sm:opacity-0 sm:group-hover/message:opacity-100 focus-within:opacity-100";
  if (message.role === "user") {
    return (
      <Actions className={`-mr-0.5 justify-end ${visibility}`}>
        {onEdit ? (
          <Action
            className="size-7 text-muted-foreground hover:text-foreground"
            data-testid="message-edit-button"
            onClick={onEdit}
            tooltip="修改消息"
          >
            <PencilEditIcon />
          </Action>
        ) : null}
        <Action
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={handleCopy}
          tooltip="复制正文"
        >
          <CopyIcon />
        </Action>
      </Actions>
    );
  }
  return (
    <Actions className={`-ml-0.5 ${visibility}`}>
      {!!onRegenerate && (
        <Action
          className="text-muted-foreground hover:text-foreground"
          onClick={onRegenerate}
          tooltip="重新生成"
        >
          <RotateCcw className="size-4" />
        </Action>
      )}
      <Action
        className="text-muted-foreground hover:text-foreground"
        onClick={handleCopy}
        tooltip="复制正文"
      >
        <CopyIcon />
      </Action>
      <Action
        className="text-muted-foreground hover:text-foreground"
        data-testid="message-upvote"
        disabled={savingVote || vote?.isUpvoted}
        onClick={handleUpvote}
        tooltip="这条回复有帮助"
      >
        <ThumbUpIcon />
      </Action>
      <Action
        className="text-muted-foreground hover:text-foreground"
        data-testid="message-downvote"
        disabled={savingVote || (vote && !vote.isUpvoted)}
        onClick={handleDownvote}
        tooltip="这条回复需要改进"
      >
        <ThumbDownIcon />
      </Action>
    </Actions>
  );
}
export const MessageActions = memo(PureMessageActions);
