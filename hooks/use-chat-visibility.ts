"use client";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { updateChatVisibility } from "@/app/(chat)/actions";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import type { VisibilityType } from "@/components/chat/visibility-selector";

export function useChatVisibility({
  chatId,
  initialVisibilityType,
}: {
  chatId: string;
  initialVisibilityType: VisibilityType;
}) {
  const { mutate } = useSWRConfig();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const { data: visibilityType, mutate: setLocalVisibility } =
    useSWR<VisibilityType>(`${chatId}-visibility`, null, {
      fallbackData: initialVisibilityType,
    });
  const setVisibilityType = useCallback(
    async (visibility: VisibilityType) => {
      if (pending.current || visibility === visibilityType) {
        return;
      }
      pending.current = true;
      setSaving(true);
      try {
        await updateChatVisibility({ chatId, visibility });
        await setLocalVisibility(visibility, { revalidate: false });
        await Promise.all([
          mutate(unstable_serialize(getChatHistoryPaginationKey)),
          mutate(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`
          ),
          mutate(
            (key) => typeof key === "string" && key.includes("/api/history?")
          ),
        ]);
        toast.success(
          visibility === "private"
            ? "已设为私密"
            : "已设为公开，获得链接的人可以访问"
        );
      } catch {
        toast.error("可见范围未更新，请稍后重试。");
      } finally {
        pending.current = false;
        setSaving(false);
      }
    },
    [chatId, visibilityType, mutate, setLocalVisibility]
  );
  return {
    saving,
    setVisibilityType,
    visibilityType: visibilityType ?? initialVisibilityType,
  };
}
