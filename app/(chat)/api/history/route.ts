import type { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { deleteAllChatsByUserId, getChatsByUserId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const parsed = z
    .object({
      ending_before: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      search: z.string().trim().max(100).default(""),
      starting_after: z.uuid().optional(),
    })
    .safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return new ChatbotError("bad_request:api").toResponse();
  }
  const { limit, search } = parsed.data;
  const startingAfter = parsed.data.starting_after ?? null;
  const endingBefore = parsed.data.ending_before ?? null;

  if (startingAfter && endingBefore) {
    return new ChatbotError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chats = await getChatsByUserId({
    endingBefore,
    id: session.user.id,
    limit,
    search,
    startingAfter,
  });

  return Response.json(chats, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE() {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const result = await deleteAllChatsByUserId({ userId: session.user.id });

  return Response.json(result, { status: 200 });
}
