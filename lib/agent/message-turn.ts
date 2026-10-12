import type { ChatMessage } from "../types";

export function prepareRegeneration(
  stored: ChatMessage[],
  incomingUserId: string
): { context: ChatMessage[]; answerId: string } | null {
  const answer = stored.at(-1);
  const question = stored.at(-2);
  if (
    answer?.role !== "assistant" ||
    question?.role !== "user" ||
    question.id !== incomingUserId ||
    answer.parts.some(
      (part) =>
        "state" in part &&
        [
          "approval-requested",
          "approval-responded",
          "input-streaming",
          "input-available",
        ].includes(String(part.state))
    )
  ) {
    return null;
  }
  return { answerId: answer.id, context: stored.slice(0, -1) };
}
