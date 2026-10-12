import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareRegeneration } from "../../lib/agent/message-turn";
import type { ChatMessage } from "../../lib/types";

const question: ChatMessage = {
  id: "question",
  parts: [{ text: "Stored question", type: "text" }],
  role: "user",
};
const answer: ChatMessage = {
  id: "answer",
  parts: [{ text: "Original answer", type: "text" }],
  role: "assistant",
};

test("regeneration reuses the stored question and excludes the old answer", () => {
  const result = prepareRegeneration([question, answer], question.id);
  assert.deepEqual(result, { answerId: answer.id, context: [question] });
});

test("only the latest answered user turn can be regenerated", () => {
  const next = { ...question, id: "next" };
  assert.equal(
    prepareRegeneration([question, answer, next], question.id),
    null
  );
  assert.equal(prepareRegeneration([question], question.id), null);
  assert.equal(prepareRegeneration([question, answer], "tampered-id"), null);
});

test("regeneration cannot discard a pending tool approval", () => {
  const pending = {
    ...answer,
    parts: [
      {
        approval: { id: "approval" },
        input: {},
        state: "approval-requested",
        toolCallId: "call",
        toolName: "search",
        type: "dynamic-tool",
      },
    ],
  } as ChatMessage;
  assert.equal(prepareRegeneration([question, pending], question.id), null);
});
