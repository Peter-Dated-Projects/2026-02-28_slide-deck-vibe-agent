import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** If true, the assistant is still in a thinking state (timer runs live) */
  isThinking?: boolean;
  /** Textual content shown when the thinking block is expanded */
  thinkingContent?: string;
  /** Epoch ms when thinking started. Used to compute elapsed time. */
  thinkingStartedAt?: number;
  /** Final elapsed seconds, set once thinking is done */
  thinkingTime?: number;
}

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

// ─────────────────────────────────────────────────────
// ThinkingBlock sub-component
// ─────────────────────────────────────────────────────

interface ThinkingBlockProps {
  isThinking: boolean;
  thinkingContent?: string;
  thinkingStartedAt?: number;
  thinkingTime?: number;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  isThinking,
  thinkingContent,
  thinkingStartedAt,
  thinkingTime,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(thinkingTime ?? 0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live timer while still thinking
  useEffect(() => {
    if (isThinking && thinkingStartedAt) {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - thinkingStartedAt) / 1000));
      }, 500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Snap to the final recorded time if available
      if (thinkingTime !== undefined) setElapsed(thinkingTime);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isThinking, thinkingStartedAt, thinkingTime]);

  const label = isThinking ? `Agent thinking for ${elapsed}s…` : `Agent thought for ${elapsed}s`;

  return (
    <div className="mb-3">
      {/* Toggle row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 group",
          "border text-muted-foreground hover:text-foreground",
          isThinking
            ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
            : "border-border bg-muted/30 hover:bg-muted/60",
        )}
      >
        {/* Pulsing brain icon while active */}
        <Brain
          className={cn(
            "w-3 h-3 flex-shrink-0",
            isThinking ? "text-primary animate-pulse" : "text-muted-foreground",
          )}
        />
        <span className="flex-1 text-left">{label}</span>
        {expanded ? (
          <ChevronDown className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Expanded thinking content */}
      {expanded && (
        <div
          className={cn(
            "mt-1.5 ml-2 pl-3 border-l-2 text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground",
            "transition-all duration-200",
            isThinking ? "border-primary/40" : "border-border",
          )}
        >
          {thinkingContent ? (
            <span>{thinkingContent}</span>
          ) : (
            <span className="italic opacity-60">
              {isThinking ? "Thinking…" : "No thinking content available."}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────
// ChatMessage component
// ─────────────────────────────────────────────────────

interface ChatMessageProps {
  message: ChatMessageData;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === "user";
  const hasThinking = message.thinkingStartedAt !== undefined || message.thinkingTime !== undefined;

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 mt-2 transition-all duration-200",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm shadow-sm"
            : "bg-surface text-foreground rounded-tl-sm border border-border",
        )}
      >
        {/* Thinking block — only for assistant messages */}
        {!isUser && hasThinking && (
          <ThinkingBlock
            isThinking={!!message.isThinking}
            thinkingContent={message.thinkingContent}
            thinkingStartedAt={message.thinkingStartedAt}
            thinkingTime={message.thinkingTime}
          />
        )}

        {/* Message text (hidden while still thinking and no content yet) */}
        {message.content && (
          <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
        )}
      </div>
    </div>
  );
};
