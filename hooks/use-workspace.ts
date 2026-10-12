"use client";
import { useCallback } from "react";
import useSWR from "swr";
import { useActiveChat } from "./use-active-chat";

export type WorkspaceTab = "browser" | "document" | "sources";
type State = {
  open: boolean;
  tab: WorkspaceTab;
  expanded: boolean;
  width: number;
};
const initial: State = {
  expanded: false,
  open: false,
  tab: "browser",
  width: 60,
};

export function useWorkspace() {
  const { chatId } = useActiveChat();
  const { data: state = initial, mutate } = useSWR<State>(
    `workspace:${chatId}`,
    null,
    { fallbackData: initial }
  );
  const update = useCallback(
    (patch: Partial<State>) => {
      mutate((current) => ({ ...(current ?? initial), ...patch }), {
        revalidate: false,
      });
    },
    [mutate]
  );
  const open = useCallback(
    (tab?: WorkspaceTab) => update({ open: true, ...(tab ? { tab } : {}) }),
    [update]
  );
  const close = useCallback(
    () => update({ expanded: false, open: false }),
    [update]
  );
  return {
    ...state,
    close,
    show: open,
    update,
  };
}
