// Real Postgres persistence test; random fixture records only, no model calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import dotenv from "dotenv";
import postgres from "postgres";
import type { DBMessage } from "../../lib/db/schema";

dotenv.config({ path: ".env.local", quiet: true });

test("regeneration replaces only the unchanged latest answer, clears its feedback and rolls back failures", async () => {
  const queries = await import("../../lib/db/queries");
  const replace = (
    queries as unknown as {
      replaceRegeneratedAnswer?: (input: {
        chatId: string;
        userId: string;
        snapshot: DBMessage[];
        answer: DBMessage;
      }) => Promise<void>;
    }
  ).replaceRegeneratedAnswer;
  assert.equal(
    typeof replace,
    "function",
    "missing safe regeneration persistence"
  );
  if (!replace) {
    return;
  }
  const sql = postgres(process.env.POSTGRES_URL ?? "", { max: 1 });
  const ownerId = randomUUID(),
    chatId = randomUUID(),
    questionId = randomUUID(),
    answerId = randomUUID();
  const email = `REGEN-TEST-${ownerId}@fixture.test`;
  const snapshot: DBMessage[] = [
    {
      attachments: [],
      chatId,
      createdAt: new Date(Date.now() - 2000),
      id: questionId,
      parts: [{ text: "Original question", type: "text" }],
      role: "user",
    },
    {
      attachments: [],
      chatId,
      createdAt: new Date(Date.now() - 1000),
      id: answerId,
      parts: [{ text: "Original answer", type: "text" }],
      role: "assistant",
    },
  ];
  try {
    await sql`insert into "User" ("id", "email", "isAnonymous") values (${ownerId}, ${email}, true)`;
    await queries.saveChat({
      id: chatId,
      title: "Explicit regeneration fixture",
      userId: ownerId,
      visibility: "private",
    });
    await queries.saveMessages({ messages: snapshot });
    await queries.voteMessage({ chatId, messageId: answerId, type: "up" });
    const replacement = {
      ...snapshot[1],
      parts: [{ text: "Replacement answer", type: "text" }],
    };
    await assert.rejects(
      replace({ answer: replacement, chatId, snapshot, userId: randomUUID() })
    );
    assert.deepEqual(
      (await queries.getMessagesByChatId({ id: chatId }))[1].parts,
      snapshot[1].parts
    );
    await replace({ answer: replacement, chatId, snapshot, userId: ownerId });
    const records = await queries.getMessagesByChatId({ id: chatId });
    assert.equal(records.length, 2);
    assert.deepEqual(records[0].parts, snapshot[0].parts);
    assert.deepEqual(records[1].parts, replacement.parts);
    assert.equal((await queries.getVotesByChatId({ id: chatId })).length, 0);
    // A stale concurrent generation must never overwrite a newer answer.
    await assert.rejects(
      replace({
        answer: {
          ...replacement,
          parts: [{ text: "Stale answer", type: "text" }],
        },
        chatId,
        snapshot,
        userId: ownerId,
      })
    );
    assert.deepEqual(
      (await queries.getMessagesByChatId({ id: chatId }))[1].parts,
      replacement.parts
    );
    const currentSnapshot = await queries.getMessagesByChatId({ id: chatId });
    await queries.saveMessages({
      messages: [
        {
          ...snapshot[0],
          createdAt: new Date(),
          id: randomUUID(),
          parts: [{ text: "Next question", type: "text" }],
        },
      ],
    });
    await assert.rejects(
      replace({
        answer: replacement,
        chatId,
        snapshot: currentSnapshot,
        userId: ownerId,
      })
    );
    assert.equal((await queries.getMessagesByChatId({ id: chatId })).length, 3);
  } finally {
    await sql.begin(async (tx) => {
      await tx`delete from "Vote_v2" where "chatId" = ${chatId}`;
      await tx`delete from "Message_v2" where "chatId" = ${chatId}`;
      await tx`delete from "Chat" where "id" = ${chatId} and "userId" = ${ownerId}`;
      await tx`delete from "User" where "id" = ${ownerId} and "email" = ${email}`;
    });
    await sql.end();
  }
});
