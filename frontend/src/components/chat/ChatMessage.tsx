import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
// Import a highlight.js theme (GitHub Dark — works well on both light and dark UI)
import "highlight.js/styles/github-dark-dimmed.css";

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
// MarkdownContent — renders assistant markdown safely
// Compatible with react-markdown v9
// ─────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const mdComponents = {
  // Code: inline (no className) vs fenced block (has language-* className)
  code({ className, children }: any) {
    if (!className) {
      return (
        <code className="px-1 py-0.5 rounded text-[11px] bg-muted/70 text-foreground font-mono">
          {children}
        </code>
      );
    }
    return <code className={cn("text-[11px] font-mono", className)}>{children}</code>;
  },
  // pre: omit `node` so it doesn't leak into the DOM
  pre({ node: _n, children }: any) {
    return (
      <pre className="overflow-x-auto rounded-lg my-2 p-3 text-[11px] leading-relaxed bg-[#22272e]">
        {children}
      </pre>
    );
  },
  h1: ({ node: _n, children }: any) => (
    <h1 className="text-base font-bold mt-3 mb-1 text-foreground">{children}</h1>
  ),
  h2: ({ node: _n, children }: any) => (
    <h2 className="text-[13px] font-semibold mt-2.5 mb-1 text-foreground">{children}</h2>
  ),
  h3: ({ node: _n, children }: any) => (
    <h3 className="text-[12px] font-semibold mt-2 mb-0.5 text-foreground">{children}</h3>
  ),
  h4: ({ node: _n, children }: any) => (
    <h4 className="text-[11px] font-semibold mt-1.5 mb-0.5 text-foreground">{children}</h4>
  ),
  p: ({ node: _n, children }: any) => (
    <p className="text-[12px] leading-relaxed mb-1.5 last:mb-0">{children}</p>
  ),
  ul: ({ node: _n, children }: any) => (
    <ul className="list-disc list-outside pl-4 my-1.5 space-y-0.5 text-[12px]">{children}</ul>
  ),
  ol: ({ node: _n, children }: any) => (
    <ol className="list-decimal list-outside pl-4 my-1.5 space-y-0.5 text-[12px]">{children}</ol>
  ),
  li: ({ node: _n, children }: any) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ node: _n, children }: any) => (
    <blockquote className="border-l-2 border-primary/40 pl-3 my-2 italic text-muted-foreground text-[12px]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
  strong: ({ node: _n, children }: any) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ node: _n, children }: any) => <em className="italic">{children}</em>,
  a: ({ node: _n, href, children }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  table: ({ node: _n, children }: any) => (
    <div className="overflow-x-auto my-2 w-full">
      <table className="text-[11px] border-collapse w-full">{children}</table>
    </div>
  ),
  thead: ({ node: _n, children }: any) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ node: _n, children }: any) => (
    <th className="border border-border px-2 py-1 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ node: _n, children }: any) => (
    <td className="border border-border px-2 py-1 text-muted-foreground">{children}</td>
  ),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const MarkdownContent: React.FC<{ content: string }> = ({ content }) => (
  <div className="chat-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={mdComponents}
    >
      {content}
    </ReactMarkdown>
  </div>
);

// ─────────────────────────────────────────────────────
// ChatMessage component
// ─────────────────────────────────────────────────────

interface ChatMessageProps {
  message: ChatMessageData;
}

export const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ message }) => {
  const isUser = message.role === "user";
  const hasThinking = message.thinkingStartedAt !== undefined || message.thinkingTime !== undefined;

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          isUser ? "max-w-[70%]" : "w-full",
          "rounded-[8px] px-4 py-2.5 mt-2 transition-all duration-200",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-[2px] shadow-sm"
            : "bg-card text-foreground rounded-tl-[2px] border border-border",
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

        {/* Message content */}
        {message.content && (
          <>
            {isUser ? (
              // User messages: preserve line breaks, no markdown
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
            ) : (
              // Assistant messages: full markdown rendering
              <MarkdownContent content={message.content} />
            )}
          </>
        )}
      </div>
    </div>
  );
});
