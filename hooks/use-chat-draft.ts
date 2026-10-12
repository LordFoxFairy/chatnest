"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// Session storage keeps original-content drafts in this browser tab, not on the server.
export function useChatDraft(
  key: string
): [string, Dispatch<SetStateAction<string>>] {
  const [draft, setDraft] = useState({ key: "", value: "" });
  const current = useRef(draft);
  const setValue = useCallback<Dispatch<SetStateAction<string>>>(
    (action) => {
      const old = current.current.key === key ? current.current.value : "";
      const next = {
        key,
        value: typeof action === "function" ? action(old) : action,
      };
      current.current = next;
      setDraft(next);
      try {
        if (next.value) {
          sessionStorage.setItem(key, next.value);
        } else {
          sessionStorage.removeItem(key);
        }
      } catch {
        /* Drafts still work when browser storage is unavailable. */
      }
    },
    [key]
  );
  useEffect(() => {
    if (current.current.key === key) {
      return;
    }
    let value = "";
    try {
      value = sessionStorage.getItem(key) ?? "";
    } catch {
      /* Private browsing may block storage. */
    }
    const next = { key, value };
    current.current = next;
    setDraft(next);
  }, [key]);
  return [draft.key === key ? draft.value : "", setValue];
}
