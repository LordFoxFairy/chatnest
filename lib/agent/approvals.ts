import type { ChatMessage } from "@/lib/types";

/** Keep stored calls authoritative: clients may answer an approval, not rewrite a tool call. */
export function applyToolApprovals(
  stored: ChatMessage[],
  responses: ChatMessage[]
): ChatMessage[] {
  const approvals = new Map<
    string,
    { id: string; approved: boolean; reason?: string }
  >();
  for (const message of responses) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts) {
      if (
        "toolCallId" in part &&
        "approval" in part &&
        (part.state === "approval-responded" ||
          part.state === "output-denied") &&
        typeof part.approval?.approved === "boolean"
      ) {
        approvals.set(`${message.id}:${part.toolCallId}`, {
          approved: part.approval.approved,
          id: part.approval.id,
          ...(typeof part.approval.reason === "string"
            ? { reason: part.approval.reason.slice(0, 1000) }
            : {}),
        });
      }
    }
  }
  return stored.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (
        message.role !== "assistant" ||
        !("toolCallId" in part) ||
        !("approval" in part) ||
        part.state !== "approval-requested"
      ) {
        return part;
      }
      const response = approvals.get(`${message.id}:${part.toolCallId}`);
      if (!response || response.id !== part.approval.id) {
        return part;
      }
      return {
        ...part,
        approval: response,
        state: "approval-responded",
      } as ChatMessage["parts"][number];
    }),
  }));
}
