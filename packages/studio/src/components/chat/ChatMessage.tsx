import { memo } from "react";
import type { Theme } from "../../hooks/use-theme";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "../ai-elements/message";
import { XCircle, PauseCircle } from "lucide-react";

export interface ChatMessageProps {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
  readonly theme: Theme;
  readonly aborted?: boolean;
  readonly isZh?: boolean;
  readonly onContinue?: () => void;
}

export const ChatMessage = memo(function ChatMessage({
  role,
  content,
  aborted,
  isZh = true,
  onContinue,
}: ChatMessageProps) {
  const isUser = role === "user";
  const isError = content.startsWith("\u2717");

  return (
    <Message from={role}>
      <MessageContent>
        {isUser ? (
          <div className="text-[17px] leading-[1.72]">{content}</div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-[17px] leading-[1.72] text-destructive">
            <XCircle size={14} className="shrink-0" />
            <span>{content.replace(/^\u2717\s*/, "")}</span>
          </div>
        ) : (
          <>
            <MessageResponse>{content}</MessageResponse>
            {aborted && (
              <div className="flex items-center gap-2 mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                <PauseCircle size={14} className="shrink-0" />
                <span>{isZh ? "\u751f\u6210\u5df2\u4e2d\u65ad" : "Generation interrupted"}</span>
                {onContinue && (
                  <button
                    onClick={onContinue}
                    className="ml-2 text-primary hover:underline font-medium"
                  >
                    {isZh ? "\u7ee7\u7eed\u751f\u6210" : "Continue"}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </MessageContent>
    </Message>
  );
});

ChatMessage.displayName = "ChatMessage";
