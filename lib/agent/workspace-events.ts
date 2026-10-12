type Message = {
  role: string;
  parts: {
    type: string;
    toolName?: string;
    toolCallId?: string;
    state?: string;
  }[];
};
export function browserWorkspaceEvents(
  messages: Message[],
  running: boolean
): string[] {
  const latestUser = messages.findLastIndex(
    (message) => message.role === "user"
  );
  return messages.flatMap((message, index) =>
    message.role === "assistant"
      ? message.parts.flatMap((part) => {
          const browser =
            part.type.startsWith("tool-browser__") ||
            (part.type === "dynamic-tool" &&
              part.toolName?.startsWith("browser__"));
          const ready =
            part.state === "approval-requested" ||
            (running &&
              index > latestUser &&
              ["input-available", "output-available"].includes(
                part.state ?? ""
              ));
          return browser && ready && part.toolCallId ? [part.toolCallId] : [];
        })
      : []
  );
}
